import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import {
  addAlbumTracksSchema,
  createAlbumSchema,
  reorderAlbumSchema,
  updateAlbumSchema,
  type AlbumDetailDto,
  type AlbumDto,
  type TrackDto,
} from '@mss/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { albumTracks, albums, albumLikes, tracks } from '../db/schema.js';
import { albumCoverPublicUrl, appendTracksToAlbum, collapseOwnAlbumDuplicates, findOwnAlbum, resolvePublishedAlbum } from '../lib/albums.js';
import { computeAvailability } from '../lib/track-availability.js';
import { deleteObject, getObjectFull, putObject } from '../lib/storage.js';
import { heldTrackIdsForUser, toTrackDto } from './tracks.js';

const COVER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const COVER_MAX_BYTES = 10 * 1024 * 1024;

type AlbumRow = typeof albums.$inferSelect;

function toAlbumDto(row: AlbumRow, trackCount: number): AlbumDto {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    year: row.year,
    type: row.type,
    coverUrl: albumCoverPublicUrl(row.id, row.coverStorageKey),
    trackCount,
  };
}

async function countTracks(albumId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(albumTracks)
    .where(eq(albumTracks.albumId, albumId));
  return count;
}

async function dropCover(key: string | null): Promise<void> {
  if (key) await deleteObject(config.minio.bucketCovers, key).catch(() => undefined);
}

async function albumTracksDto(albumId: string, userId: string, album: AlbumDto): Promise<AlbumDetailDto> {
  const rows = await db
    .select({ track: tracks })
    .from(albumTracks)
    .innerJoin(tracks, eq(albumTracks.trackId, tracks.id))
    .where(eq(albumTracks.albumId, albumId))
    .orderBy(asc(albumTracks.position));
  const heldIds = await heldTrackIdsForUser(
    userId,
    rows.map((r) => r.track.id),
  );
  const items = await Promise.all(
    rows.map(async ({ track }) => {
      const avail = await computeAvailability(track);
      return toTrackDto(track, avail, { userHolds: heldIds.has(track.id), albumId });
    }),
  );
  return { ...album, tracks: items as TrackDto[] };
}

export async function albumRoutes(app: FastifyInstance) {
  app.get('/albums', async (req) => {
    await app.authenticate(req);
    await collapseOwnAlbumDuplicates(req.userId!);
    const query = req.query as { query?: string };
    const q = (query.query ?? '').trim();
    const rows = await db
      .select()
      .from(albums)
      .where(
        q
          ? and(
              eq(albums.userId, req.userId!),
              or(ilike(albums.title, `%${q}%`), ilike(albums.artist, `%${q}%`)),
            )
          : eq(albums.userId, req.userId!),
      )
      .orderBy(desc(albums.createdAt));
    const items = await Promise.all(rows.map(async (row) => toAlbumDto(row, await countTracks(row.id))));
    return { items };
  });

  app.post('/albums', async (req, reply) => {
    await app.authenticate(req);
    const body = createAlbumSchema.parse(req.body);
    const requested = body.trackIds ?? [];
    const valid = requested.length
      ? new Set((await db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, requested))).map((r) => r.id))
      : new Set<string>();
    const { album, created } = await resolvePublishedAlbum(req.userId!, {
      title: body.title,
      artist: body.artist,
      year: body.year ?? null,
      type: body.type,
      trackIds: requested.filter((id) => valid.has(id)),
    });
    const dto = toAlbumDto(album, await countTracks(album.id));
    return reply.code(created ? 201 : 200).send(await albumTracksDto(album.id, req.userId!, dto));
  });

  app.get('/albums/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    await collapseOwnAlbumDuplicates(req.userId!);
    const row = await findOwnAlbum(id, req.userId!);
    if (!row) return reply.notFound();
    return albumTracksDto(id, req.userId!, toAlbumDto(row, await countTracks(id)));
  });

  app.patch('/albums/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const body = updateAlbumSchema.parse(req.body);
    if (!(await findOwnAlbum(id, req.userId!))) return reply.notFound();
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const [row] = Object.keys(patch).length
      ? await db.update(albums).set(patch).where(eq(albums.id, id)).returning()
      : await db.select().from(albums).where(eq(albums.id, id));
    if (typeof patch.title === 'string') {
      const linked = await db.select({ id: albumTracks.trackId }).from(albumTracks).where(eq(albumTracks.albumId, id));
      const ids = linked.map((r) => r.id);
      if (ids.length) await db.update(tracks).set({ album: patch.title }).where(inArray(tracks.id, ids));
    }
    return toAlbumDto(row, await countTracks(id));
  });

  app.delete('/albums/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const row = await findOwnAlbum(id, req.userId!);
    if (!row) return reply.notFound();
    await db.delete(albums).where(eq(albums.id, id));
    await db
      .delete(albumLikes)
      .where(and(eq(albumLikes.userId, req.userId!), eq(albumLikes.source, 'local'), eq(albumLikes.albumId, id)));
    await dropCover(row.coverStorageKey);
    return reply.code(204).send();
  });

  app.put('/albums/:id/cover', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const row = await findOwnAlbum(id, req.userId!);
    if (!row) return reply.notFound();

    const data = await req.file({ limits: { fileSize: COVER_MAX_BYTES } });
    if (!data) return reply.badRequest('Нет файла');
    const ext = COVER_TYPES[data.mimetype];
    if (!ext) {
      data.file.resume();
      return reply.badRequest('Обложка должна быть в формате JPEG, PNG или WebP');
    }
    const body = await data.toBuffer().catch(() => null);
    if (!body || data.file.truncated) return reply.code(413).send({ message: 'Обложка больше 10 МБ' });

    const key = `albums/${id}/${uuidv4()}.${ext}`;
    await putObject(config.minio.bucketCovers, key, body, data.mimetype);
    const [updated] = await db.update(albums).set({ coverStorageKey: key }).where(eq(albums.id, id)).returning();
    await dropCover(row.coverStorageKey);
    return toAlbumDto(updated, await countTracks(id));
  });

  app.delete('/albums/:id/cover', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const row = await findOwnAlbum(id, req.userId!);
    if (!row) return reply.notFound();
    const [updated] = await db
      .update(albums)
      .set({ coverStorageKey: null })
      .where(eq(albums.id, id))
      .returning();
    await dropCover(row.coverStorageKey);
    return toAlbumDto(updated, await countTracks(id));
  });

  // Без авторизации, как и обложки плейлистов: <img> / Coil не шлют Bearer, id — UUID.
  app.get('/albums/:id/cover', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select({ key: albums.coverStorageKey })
      .from(albums)
      .where(eq(albums.id, id))
      .limit(1);
    if (!row?.key) return reply.notFound();
    const ext = row.key.split('.').pop()!;
    const type = Object.entries(COVER_TYPES).find(([, e]) => e === ext)?.[0] ?? 'image/jpeg';
    const buf = await getObjectFull(config.minio.bucketCovers, row.key);
    return reply.type(type).header('Cache-Control', 'public, max-age=31536000, immutable').send(buf);
  });

  app.post('/albums/:id/tracks', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!(await findOwnAlbum(id, req.userId!))) return reply.notFound();
    const { trackIds } = addAlbumTracksSchema.parse(req.body);
    const valid = new Set(
      (await db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, trackIds))).map((r) => r.id),
    );
    const count = await appendTracksToAlbum(
      id,
      trackIds.filter((trackId) => valid.has(trackId)),
    );
    return { ok: true, count };
  });

  app.put('/albums/:id/tracks/order', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!(await findOwnAlbum(id, req.userId!))) return reply.notFound();
    const { trackIds } = reorderAlbumSchema.parse(req.body);
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ trackId: albumTracks.trackId })
        .from(albumTracks)
        .where(eq(albumTracks.albumId, id))
        .orderBy(asc(albumTracks.position));
      const known = new Set(existing.map((r) => r.trackId));
      const ordered = trackIds.filter((trackId) => known.has(trackId));
      const listed = new Set(ordered);
      const final = [...ordered, ...existing.map((r) => r.trackId).filter((trackId) => !listed.has(trackId))];
      if (!final.length) return;
      const cases = sql.join(
        final.map((trackId, i) => sql`when ${trackId}::uuid then ${i}`),
        sql` `,
      );
      await tx
        .update(albumTracks)
        .set({ position: sql`(case ${albumTracks.trackId} ${cases} end)::int` })
        .where(and(eq(albumTracks.albumId, id), inArray(albumTracks.trackId, final)));
    });
    return { ok: true };
  });

  app.delete('/albums/:id/tracks/:trackId', async (req, reply) => {
    await app.authenticate(req);
    const { id, trackId } = req.params as { id: string; trackId: string };
    if (!(await findOwnAlbum(id, req.userId!))) return reply.notFound();
    await db.delete(albumTracks).where(and(eq(albumTracks.albumId, id), eq(albumTracks.trackId, trackId)));
    return { ok: true };
  });
}
