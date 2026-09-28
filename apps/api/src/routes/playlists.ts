import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import type { z } from 'zod';
import {
  addPlaylistEntriesSchema,
  addPlaylistTrackSchema,
  createPlaylistSchema,
  playlistEntryInputSchema,
  reorderPlaylistSchema,
  updatePlaylistSchema,
  type PlaylistDto,
  type PlaylistEntryDto,
} from '@mss/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { playlistTracks, playlists, tracks } from '../db/schema.js';
import { deleteObject, getObjectFull, putObject } from '../lib/storage.js';
import { computeAvailability } from '../lib/track-availability.js';
import { heldTrackIdsForUser, toTrackDto, toTrackDtoWithAvailability } from './tracks.js';

const COVER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const COVER_MAX_BYTES = 10 * 1024 * 1024;

type PlaylistRow = typeof playlists.$inferSelect;

function toPlaylistDto(p: PlaylistRow, trackCount: number): PlaylistDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    author: p.author,
    // Ключ обложки уникален для каждой загрузки, так что ?v= сбрасывает кэш картинки после замены.
    coverUrl: p.coverStorageKey
      ? `${config.publicUrl}/playlists/${p.id}/cover?v=${encodeURIComponent(p.coverStorageKey.split('/').pop()!)}`
      : null,
    trackCount,
  };
}

async function countTracks(playlistId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId));
  return count;
}

async function dropCover(key: string | null): Promise<void> {
  if (key) await deleteObject(config.minio.bucketCovers, key).catch(() => undefined);
}

export async function findOwnPlaylist(id: string, userId: string) {
  const [p] = await db
    .select()
    .from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.userId, userId)))
    .limit(1);
  return p ?? null;
}

/** Добавляет трек в конец плейлиста; повторное добавление игнорируется. */
export async function appendToPlaylist(playlistId: string, trackId: string): Promise<boolean> {
  const [existing] = await db
    .select({ trackId: playlistTracks.trackId })
    .from(playlistTracks)
    .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)))
    .limit(1);
  if (existing) return false;
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${playlistTracks.position}) + 1, 0)::int` })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId));
  await db.insert(playlistTracks).values({ playlistId, trackId, position: next });
  return true;
}

type EntryInput = z.infer<typeof playlistEntryInputSchema>;

/** Добавляет пачку в конец; уже присутствующие треки и дубли внутри пачки пропускаются. Возвращает число добавленных. */
export async function appendEntries(playlistId: string, items: EntryInput[]): Promise<number> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ trackId: playlistTracks.trackId, source: playlistTracks.externalSource, externalId: playlistTracks.externalId })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId));
    const seen = new Set(existing.map((r) => (r.trackId ? `local:${r.trackId}` : `${r.source}:${r.externalId}`)));

    const localIds = items.flatMap((i) => ('trackId' in i ? [i.trackId] : []));
    const validLocal = localIds.length
      ? new Set((await tx.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, localIds))).map((r) => r.id))
      : new Set<string>();

    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${playlistTracks.position}) + 1, 0)::int` })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId));

    const rows: (typeof playlistTracks.$inferInsert)[] = [];
    for (const item of items) {
      if ('trackId' in item) {
        const key = `local:${item.trackId}`;
        if (seen.has(key) || !validLocal.has(item.trackId)) continue;
        seen.add(key);
        rows.push({ playlistId, trackId: item.trackId, position: next + rows.length });
      } else {
        const key = `${item.source}:${item.externalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          playlistId,
          externalSource: item.source,
          externalId: item.externalId,
          snapshot: item.snapshot,
          position: next + rows.length,
        });
      }
    }
    for (let i = 0; i < rows.length; i += 500) await tx.insert(playlistTracks).values(rows.slice(i, i + 500));
    return rows.length;
  });
}

export async function playlistRoutes(app: FastifyInstance) {
  app.get('/playlists', async (req) => {
    await app.authenticate(req);
    const rows = await db
      .select()
      .from(playlists)
      .where(eq(playlists.userId, req.userId!))
      .orderBy(asc(playlists.createdAt));
    const items = await Promise.all(rows.map(async (p) => toPlaylistDto(p, await countTracks(p.id))));
    return { items };
  });

  app.post('/playlists', async (req) => {
    await app.authenticate(req);
    const body = createPlaylistSchema.parse(req.body);
    const [p] = await db
      .insert(playlists)
      .values({ userId: req.userId!, name: body.name })
      .returning();
    return toPlaylistDto(p, 0);
  });

  app.get('/playlists/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const p = await findOwnPlaylist(id, req.userId!);
    if (!p) return reply.notFound();
    return toPlaylistDto(p, await countTracks(id));
  });

  app.patch('/playlists/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const body = updatePlaylistSchema.parse(req.body);
    if (!(await findOwnPlaylist(id, req.userId!))) return reply.notFound();
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const [p] = Object.keys(patch).length
      ? await db.update(playlists).set(patch).where(eq(playlists.id, id)).returning()
      : await db.select().from(playlists).where(eq(playlists.id, id));
    return toPlaylistDto(p, await countTracks(id));
  });

  app.delete('/playlists/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const p = await findOwnPlaylist(id, req.userId!);
    if (!p) return reply.notFound();
    await db.delete(playlists).where(eq(playlists.id, id));
    await dropCover(p.coverStorageKey);
    return reply.code(204).send();
  });

  app.put('/playlists/:id/cover', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const p = await findOwnPlaylist(id, req.userId!);
    if (!p) return reply.notFound();

    const data = await req.file({ limits: { fileSize: COVER_MAX_BYTES } });
    if (!data) return reply.badRequest('Нет файла');
    const ext = COVER_TYPES[data.mimetype];
    if (!ext) {
      data.file.resume();
      return reply.badRequest('Обложка должна быть в формате JPEG, PNG или WebP');
    }
    const body = await data.toBuffer().catch(() => null);
    if (!body || data.file.truncated) return reply.code(413).send({ message: 'Обложка больше 10 МБ' });

    const key = `playlists/${id}/${uuidv4()}.${ext}`;
    await putObject(config.minio.bucketCovers, key, body, data.mimetype);
    const [updated] = await db
      .update(playlists)
      .set({ coverStorageKey: key })
      .where(eq(playlists.id, id))
      .returning();
    await dropCover(p.coverStorageKey);
    return toPlaylistDto(updated, await countTracks(id));
  });

  app.delete('/playlists/:id/cover', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const p = await findOwnPlaylist(id, req.userId!);
    if (!p) return reply.notFound();
    const [updated] = await db
      .update(playlists)
      .set({ coverStorageKey: null })
      .where(eq(playlists.id, id))
      .returning();
    await dropCover(p.coverStorageKey);
    return toPlaylistDto(updated, await countTracks(id));
  });

  // Без авторизации, как и /covers/:id: <img> не умеет слать Bearer, а id плейлиста — неугадываемый UUID.
  app.get('/playlists/:id/cover', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [p] = await db
      .select({ key: playlists.coverStorageKey })
      .from(playlists)
      .where(eq(playlists.id, id))
      .limit(1);
    if (!p?.key) return reply.notFound();
    const ext = p.key.split('.').pop()!;
    const type = Object.entries(COVER_TYPES).find(([, e]) => e === ext)?.[0] ?? 'image/jpeg';
    const buf = await getObjectFull(config.minio.bucketCovers, p.key);
    return reply.type(type).header('Cache-Control', 'public, max-age=31536000, immutable').send(buf);
  });

  app.get('/playlists/:id/tracks', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!(await findOwnPlaylist(id, req.userId!))) return reply.notFound();

    const rows = await db
      .select({ entry: playlistTracks, track: tracks })
      .from(playlistTracks)
      .leftJoin(tracks, eq(playlistTracks.trackId, tracks.id))
      .where(eq(playlistTracks.playlistId, id))
      .orderBy(asc(playlistTracks.position), asc(playlistTracks.addedAt));

    const localIds = rows.map((r) => r.track?.id).filter((id): id is string => !!id);
    const heldIds = await heldTrackIdsForUser(req.userId!, localIds);

    const items: PlaylistEntryDto[] = [];
    for (const { entry, track } of rows) {
      if (track) {
        const avail = await computeAvailability(track);
        items.push({
          ...toTrackDto(track, avail, { userHolds: heldIds.has(track.id) }),
          entryId: entry.id,
          position: entry.position,
        } as PlaylistEntryDto);
      } else if (entry.externalSource && entry.externalId && entry.snapshot) {
        items.push({
          entryId: entry.id,
          position: entry.position,
          external: { source: entry.externalSource as 'yandex' | 'spotify' | 'vk', id: entry.externalId, snapshot: entry.snapshot },
        });
      }
    }
    return { items };
  });

  /** Принимает `{ trackId }` (как раньше) или `{ items: [...] }` с локальными и внешними треками. */
  app.post('/playlists/:id/tracks', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!(await findOwnPlaylist(id, req.userId!))) return reply.notFound();

    const single = addPlaylistTrackSchema.safeParse(req.body);
    if (single.success) {
      const [track] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, single.data.trackId)).limit(1);
      if (!track) return reply.notFound('Трек не найден');
      const added = await appendToPlaylist(id, single.data.trackId);
      return { ok: true, added, count: added ? 1 : 0 };
    }

    const { items } = addPlaylistEntriesSchema.parse(req.body);
    const count = await appendEntries(id, items);
    return { ok: true, added: count > 0, count };
  });

  app.put('/playlists/:id/tracks/order', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!(await findOwnPlaylist(id, req.userId!))) return reply.notFound();
    const { entryIds } = reorderPlaylistSchema.parse(req.body);
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: playlistTracks.id })
        .from(playlistTracks)
        .where(eq(playlistTracks.playlistId, id))
        .orderBy(asc(playlistTracks.position));
      const known = new Set(existing.map((r) => r.id));
      const ordered = entryIds.filter((e) => known.has(e));
      // Строки, которых клиент не знал (добавлены параллельно), остаются в конце в прежнем порядке.
      const listed = new Set(ordered);
      const final = [...ordered, ...existing.map((r) => r.id).filter((e) => !listed.has(e))];
      if (!final.length) return;
      const cases = sql.join(
        final.map((entryId, i) => sql`when ${entryId}::uuid then ${i}`),
        sql` `,
      );
      await tx
        .update(playlistTracks)
        .set({ position: sql`(case ${playlistTracks.id} ${cases} end)::int` })
        .where(and(eq(playlistTracks.playlistId, id), inArray(playlistTracks.id, final)));
    });
    return { ok: true };
  });

  app.delete('/playlists/:id/entries/:entryId', async (req, reply) => {
    await app.authenticate(req);
    const { id, entryId } = req.params as { id: string; entryId: string };
    if (!(await findOwnPlaylist(id, req.userId!))) return reply.notFound();
    await db.delete(playlistTracks).where(and(eq(playlistTracks.playlistId, id), eq(playlistTracks.id, entryId)));
    return { ok: true };
  });

  app.delete('/playlists/:id/tracks/:trackId', async (req, reply) => {
    await app.authenticate(req);
    const { id, trackId } = req.params as { id: string; trackId: string };
    if (!(await findOwnPlaylist(id, req.userId!))) return reply.notFound();
    await db
      .delete(playlistTracks)
      .where(and(eq(playlistTracks.playlistId, id), eq(playlistTracks.trackId, trackId)));
    return { ok: true };
  });
}
