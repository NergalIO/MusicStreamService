import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { albumTracks, albums, tracks } from '../db/schema.js';

export function albumCoverPublicUrl(id: string, coverStorageKey: string | null): string | null {
  if (!coverStorageKey) return null;
  return `${config.publicUrl}/albums/${id}/cover?v=${encodeURIComponent(coverStorageKey.split('/').pop()!)}`;
}

export async function findOwnAlbum(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(albums)
    .where(and(eq(albums.id, id), eq(albums.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Добавляет трек в конец альбома. Повтор игнорируется. */
export async function appendToAlbum(albumId: string, trackId: string): Promise<boolean> {
  const [existing] = await db
    .select({ trackId: albumTracks.trackId })
    .from(albumTracks)
    .where(and(eq(albumTracks.albumId, albumId), eq(albumTracks.trackId, trackId)))
    .limit(1);
  if (existing) return false;

  const [album] = await db.select({ title: albums.title }).from(albums).where(eq(albums.id, albumId)).limit(1);
  if (!album) return false;

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${albumTracks.position}) + 1, 0)::int` })
    .from(albumTracks)
    .where(eq(albumTracks.albumId, albumId));
  await db.insert(albumTracks).values({ albumId, trackId, position: next });

  const [track] = await db.select({ album: tracks.album }).from(tracks).where(eq(tracks.id, trackId)).limit(1);
  if (track && !track.album) {
    await db.update(tracks).set({ album: album.title }).where(eq(tracks.id, trackId));
  }
  return true;
}

export async function appendTracksToAlbum(albumId: string, trackIds: string[]): Promise<number> {
  let added = 0;
  const seen = new Set<string>();
  for (const id of trackIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (await appendToAlbum(albumId, id)) added += 1;
  }
  return added;
}

/** Последний альбом пользователя, в который входит каждый трек. */
export async function albumIdsForUserTracks(userId: string, trackIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!trackIds.length) return map;
  const rows = await db
    .select({ trackId: albumTracks.trackId, albumId: albumTracks.albumId })
    .from(albumTracks)
    .innerJoin(albums, eq(albums.id, albumTracks.albumId))
    .where(and(eq(albums.userId, userId), inArray(albumTracks.trackId, trackIds)))
    .orderBy(desc(albums.createdAt));
  for (const row of rows) {
    if (!map.has(row.trackId)) map.set(row.trackId, row.albumId);
  }
  return map;
}
