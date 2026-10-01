import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { albumLikeSchema, type LikedAlbumDto, type SourceId } from '@mss/shared';
import { db } from '../db/client.js';
import { albumLikes, albums, albumTracks, trackLikes, tracks } from '../db/schema.js';
import { albumCoverPublicUrl } from '../lib/albums.js';
import { toTrackDtoWithAvailability } from './tracks.js';

const CATALOG_STATUSES = ['ready', 'registered', 'cached', 'processing'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function likeRoutes(app: FastifyInstance) {
  app.get('/me/likes', async (req) => {
    await app.authenticate(req);
    const rows = await db
      .select({ track: tracks, likedAt: trackLikes.createdAt })
      .from(trackLikes)
      .innerJoin(tracks, eq(tracks.id, trackLikes.trackId))
      .where(and(eq(trackLikes.userId, req.userId!), inArray(tracks.status, [...CATALOG_STATUSES])))
      .orderBy(desc(trackLikes.createdAt));
    const items = await Promise.all(
      rows.map(async (r) => ({ ...(await toTrackDtoWithAvailability(r.track)), likedAt: r.likedAt })),
    );
    return { items };
  });

  app.post('/tracks/:id/like', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.badRequest('Invalid track id');
    const [track] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!track) return reply.notFound('Track not found');
    await db.insert(trackLikes).values({ userId: req.userId!, trackId: id }).onConflictDoNothing();
    return reply.code(204).send();
  });

  app.delete('/tracks/:id/like', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.badRequest('Invalid track id');
    await db.delete(trackLikes).where(and(eq(trackLikes.userId, req.userId!), eq(trackLikes.trackId, id)));
    return reply.code(204).send();
  });

  app.get('/me/liked-albums', async (req) => {
    await app.authenticate(req);
    const rows = await db
      .select()
      .from(albumLikes)
      .where(eq(albumLikes.userId, req.userId!))
      .orderBy(desc(albumLikes.createdAt));

    const localIds = rows.filter((r) => r.source === 'local').map((r) => r.albumId);
    const live = new Map<string, { title: string; artist: string; year: number | null; type: string; coverStorageKey: string | null; trackCount: number }>();
    if (localIds.length) {
      const albumRows = await db.select().from(albums).where(inArray(albums.id, localIds));
      const counts = await db
        .select({ albumId: albumTracks.albumId, count: sql<number>`count(*)::int` })
        .from(albumTracks)
        .where(inArray(albumTracks.albumId, localIds))
        .groupBy(albumTracks.albumId);
      const countMap = new Map(counts.map((c) => [c.albumId, c.count]));
      for (const row of albumRows) {
        live.set(row.id, {
          title: row.title,
          artist: row.artist,
          year: row.year,
          type: row.type,
          coverStorageKey: row.coverStorageKey,
          trackCount: countMap.get(row.id) ?? 0,
        });
      }
    }

    const items: LikedAlbumDto[] = [];
    for (const row of rows) {
      if (row.source === 'local') {
        const cur = live.get(row.albumId);
        if (cur) {
          items.push({
            source: 'local',
            id: row.albumId,
            title: cur.title,
            artist: cur.artist,
            year: cur.year,
            type: cur.type,
            coverUrl: albumCoverPublicUrl(row.albumId, cur.coverStorageKey),
            trackCount: cur.trackCount,
          });
          continue;
        }
      }
      const snap = row.snapshot;
      if (!snap?.title) continue;
      items.push({
        source: row.source as SourceId,
        id: row.albumId,
        title: snap.title,
        artist: snap.artist,
        artists: snap.artists,
        year: snap.year ?? null,
        type: snap.type ?? null,
        coverUrl: snap.coverUrl ?? null,
        trackCount: snap.trackCount,
        genre: snap.genre ?? null,
      });
    }
    return { items };
  });

  app.post('/likes/albums', async (req, reply) => {
    await app.authenticate(req);
    const body = albumLikeSchema.parse(req.body);
    await db
      .insert(albumLikes)
      .values({
        userId: req.userId!,
        source: body.source,
        albumId: body.id,
        snapshot: {
          title: body.title,
          artist: body.artist,
          artists: body.artists,
          year: body.year ?? null,
          coverUrl: body.coverUrl ?? null,
          type: body.type ?? null,
          trackCount: body.trackCount,
          genre: body.genre ?? null,
        },
      })
      .onConflictDoUpdate({
        target: [albumLikes.userId, albumLikes.source, albumLikes.albumId],
        set: {
          snapshot: {
            title: body.title,
            artist: body.artist,
            artists: body.artists,
            year: body.year ?? null,
            coverUrl: body.coverUrl ?? null,
            type: body.type ?? null,
            trackCount: body.trackCount,
            genre: body.genre ?? null,
          },
        },
      });
    return reply.code(204).send();
  });

  app.delete('/likes/albums/:source/:id', async (req, reply) => {
    await app.authenticate(req);
    const { source, id } = req.params as { source: string; id: string };
    const parsed = albumLikeSchema.shape.source.safeParse(source);
    if (!parsed.success) return reply.badRequest('Неизвестный источник');
    await db
      .delete(albumLikes)
      .where(and(eq(albumLikes.userId, req.userId!), eq(albumLikes.source, parsed.data), eq(albumLikes.albumId, id)));
    return reply.code(204).send();
  });
}
