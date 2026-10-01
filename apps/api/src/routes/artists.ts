import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AlbumDto } from '@mss/shared';
import { db } from '../db/client.js';
import { albumTracks, albums, tracks } from '../db/schema.js';
import { albumCoverPublicUrl, albumIdsForUserTracks, collapseOwnAlbumDuplicates } from '../lib/albums.js';
import { artistNameMatches, pickCanonicalTracks } from '../lib/identity.js';
import { computeAvailability } from '../lib/track-availability.js';
import { heldTrackIdsForUser, toTrackDto } from './tracks.js';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toAlbumDto(
  row: typeof albums.$inferSelect,
  trackCount: number,
): AlbumDto {
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

export async function artistRoutes(app: FastifyInstance) {
  app.get('/artists', async (req) => {
    const query = req.query as { query?: string; limit?: string };
    const q = (query.query ?? '').trim();
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const trackCount = sql<number>`count(*)::int`;

    const rows = await db
      .select({ name: tracks.artist, trackCount })
      .from(tracks)
      .where(
        q
          ? and(eq(tracks.status, 'ready'), ilike(tracks.artist, `%${escapeLike(q)}%`))
          : eq(tracks.status, 'ready'),
      )
      .groupBy(tracks.artist)
      .orderBy(desc(trackCount), asc(tracks.artist))
      .limit(limit);

    return { items: rows };
  });

  app.get('/artists/:name/tracks', async (req) => {
    await app.authenticateOptional(req);
    const { name } = req.params as { name: string };
    const query = req.query as { limit?: string };
    const limit = Math.min(Number(query.limit ?? 500), 1000);

    const rows = await db
      .select()
      .from(tracks)
      .where(and(eq(tracks.status, 'ready'), ilike(tracks.artist, `%${escapeLike(name.trim())}%`)))
      .orderBy(asc(tracks.album), asc(tracks.title), asc(tracks.createdAt))
      .limit(limit);

    const held = req.userId ? await heldTrackIdsForUser(req.userId, rows.map((r) => r.id)) : new Set<string>();
    const unique = pickCanonicalTracks(rows, (a, b) => {
      const score = (t: (typeof rows)[number]) =>
        (held.has(t.id) ? 8 : 0) + (t.coverStorageKey ? 4 : 0) + (t.storageKeyMaster ? 2 : 0);
      const diff = score(b) - score(a);
      if (diff) return diff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    unique.sort(
      (a, b) =>
        (a.album ?? '').localeCompare(b.album ?? '', 'ru', { sensitivity: 'base' }) ||
        a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }),
    );

    const ids = unique.map((r) => r.id);
    const albumIds = req.userId ? await albumIdsForUserTracks(req.userId, ids) : new Map<string, string>();
    const items = await Promise.all(
      unique.map(async (r) => {
        const avail = await computeAvailability(r);
        return toTrackDto(r, avail, { userHolds: held.has(r.id), albumId: albumIds.get(r.id) ?? null });
      }),
    );
    return { items };
  });

  app.get('/artists/:name/albums', async (req) => {
    await app.authenticate(req);
    const { name } = req.params as { name: string };
    await collapseOwnAlbumDuplicates(req.userId!);
    const rows = await db
      .select()
      .from(albums)
      .where(eq(albums.userId, req.userId!))
      .orderBy(desc(albums.year), desc(albums.createdAt));
    const matched = rows.filter((row) => artistNameMatches(row.artist, name));
    const items = await Promise.all(matched.map(async (row) => toAlbumDto(row, await countTracks(row.id))));
    return { items };
  });
}
