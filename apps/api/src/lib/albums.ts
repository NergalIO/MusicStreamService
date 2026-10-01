import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { albumLikes, albumTracks, albums, tracks } from '../db/schema.js';
import { deleteObject } from './storage.js';

type AlbumRow = typeof albums.$inferSelect;
type AlbumDb = typeof db;

export function albumCoverPublicUrl(id: string, coverStorageKey: string | null): string | null {
  if (!coverStorageKey) return null;
  return `${config.publicUrl}/albums/${id}/cover?v=${encodeURIComponent(coverStorageKey.split('/').pop()!)}`;
}

export function normalizeAlbumIdentity(title: string, artist: string): string {
  const fold = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ');
  return `${fold(title)}\0${fold(artist)}`;
}

function yearsCompatible(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b) return true;
  return a === b;
}

function enoughTrackOverlap(matched: number, total: number): boolean {
  if (total <= 0 || matched <= 0) return false;
  if (matched === total) return true;
  if (total <= 3) return matched >= 2;
  return matched >= Math.ceil(total * 0.6);
}

async function withUserAlbumLock<T>(userId: string, fn: (tx: AlbumDb) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(42, hashtext(${userId}))`);
    return fn(tx as unknown as AlbumDb);
  });
}

export async function findOwnAlbum(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(albums)
    .where(and(eq(albums.id, id), eq(albums.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function appendToAlbumOn(dbx: AlbumDb, albumId: string, trackId: string): Promise<boolean> {
  const [existing] = await dbx
    .select({ trackId: albumTracks.trackId })
    .from(albumTracks)
    .where(and(eq(albumTracks.albumId, albumId), eq(albumTracks.trackId, trackId)))
    .limit(1);
  if (existing) return false;

  const [album] = await dbx.select({ title: albums.title }).from(albums).where(eq(albums.id, albumId)).limit(1);
  if (!album) return false;

  const [{ next }] = await dbx
    .select({ next: sql<number>`coalesce(max(${albumTracks.position}) + 1, 0)::int` })
    .from(albumTracks)
    .where(eq(albumTracks.albumId, albumId));
  await dbx.insert(albumTracks).values({ albumId, trackId, position: next });

  const [track] = await dbx.select({ album: tracks.album }).from(tracks).where(eq(tracks.id, trackId)).limit(1);
  if (track && !track.album) {
    await dbx.update(tracks).set({ album: album.title }).where(eq(tracks.id, trackId));
  }
  return true;
}

/** Добавляет трек в конец альбома. Повтор игнорируется. */
export async function appendToAlbum(albumId: string, trackId: string): Promise<boolean> {
  return appendToAlbumOn(db, albumId, trackId);
}

export async function appendTracksToAlbum(albumId: string, trackIds: string[]): Promise<number> {
  return appendTracksToAlbumOn(db, albumId, trackIds);
}

async function appendTracksToAlbumOn(dbx: AlbumDb, albumId: string, trackIds: string[]): Promise<number> {
  let added = 0;
  const seen = new Set<string>();
  for (const id of trackIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (await appendToAlbumOn(dbx, albumId, id)) added += 1;
  }
  return added;
}

async function absorbAlbum(dbx: AlbumDb, keepId: string, extra: AlbumRow, userId: string): Promise<void> {
  const extraIds = (
    await dbx
      .select({ trackId: albumTracks.trackId })
      .from(albumTracks)
      .where(eq(albumTracks.albumId, extra.id))
      .orderBy(asc(albumTracks.position))
  ).map((row) => row.trackId);
  if (extraIds.length) await appendTracksToAlbumOn(dbx, keepId, extraIds);

  const [keep] = await dbx.select().from(albums).where(eq(albums.id, keepId)).limit(1);
  let dropCover = extra.coverStorageKey;
  if (keep && !keep.coverStorageKey && extra.coverStorageKey) {
    await dbx.update(albums).set({ coverStorageKey: extra.coverStorageKey }).where(eq(albums.id, keepId));
    dropCover = null;
  }

  const extraLike = await dbx
    .select()
    .from(albumLikes)
    .where(and(eq(albumLikes.userId, userId), eq(albumLikes.source, 'local'), eq(albumLikes.albumId, extra.id)))
    .limit(1);
  if (extraLike[0]) {
    await dbx
      .insert(albumLikes)
      .values({ ...extraLike[0], albumId: keepId })
      .onConflictDoNothing();
    await dbx
      .delete(albumLikes)
      .where(and(eq(albumLikes.userId, userId), eq(albumLikes.source, 'local'), eq(albumLikes.albumId, extra.id)));
  }

  await dbx.delete(albums).where(eq(albums.id, extra.id));
  if (dropCover) await deleteObject(config.minio.bucketCovers, dropCover).catch(() => undefined);
}

async function albumTrackSets(dbx: AlbumDb, albumIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!albumIds.length) return map;
  const rows = await dbx
    .select({ albumId: albumTracks.albumId, trackId: albumTracks.trackId })
    .from(albumTracks)
    .where(inArray(albumTracks.albumId, albumIds));
  for (const row of rows) {
    const set = map.get(row.albumId) ?? new Set<string>();
    set.add(row.trackId);
    map.set(row.albumId, set);
  }
  return map;
}

function pickByTrackOverlap(
  own: AlbumRow[],
  sets: Map<string, Set<string>>,
  trackIds: string[],
): AlbumRow | null {
  if (!trackIds.length) return null;
  const incoming = new Set(trackIds);
  let best: AlbumRow | null = null;
  let bestMatched = 0;
  for (const row of own) {
    const set = sets.get(row.id);
    if (!set?.size) continue;
    let matched = 0;
    for (const id of incoming) if (set.has(id)) matched += 1;
    const denom = Math.max(set.size, incoming.size);
    if (!enoughTrackOverlap(matched, denom)) continue;
    if (matched > bestMatched) {
      bestMatched = matched;
      best = row;
    }
  }
  return best;
}

async function mergeOwnAlbums(
  dbx: AlbumDb,
  userId: string,
  input?: { title: string; artist: string; year?: number | null; trackIds?: string[] },
): Promise<AlbumRow | null> {
  const own = await dbx.select().from(albums).where(eq(albums.userId, userId)).orderBy(asc(albums.createdAt));
  if (!own.length) return null;

  const identity = input ? normalizeAlbumIdentity(input.title, input.artist) : null;

  const groups = new Map<string, AlbumRow[]>();
  for (const row of own) {
    const key = normalizeAlbumIdentity(row.title, row.artist);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const buckets: AlbumRow[][] = [];
    for (const row of list) {
      const bucket = buckets.find((items) => yearsCompatible(items[0].year, row.year));
      if (bucket) bucket.push(row);
      else buckets.push([row]);
    }
    for (const bucket of buckets) {
      const keep = bucket[0];
      for (const extra of bucket.slice(1)) await absorbAlbum(dbx, keep.id, extra, userId);
    }
  }

  const remaining = await dbx.select().from(albums).where(eq(albums.userId, userId)).orderBy(asc(albums.createdAt));
  const sets = await albumTrackSets(
    dbx,
    remaining.map((row) => row.id),
  );
  const absorbed = new Set<string>();
  for (const keep of remaining) {
    if (absorbed.has(keep.id)) continue;
    const keepTracks = sets.get(keep.id) ?? new Set<string>();
    for (const extra of remaining) {
      if (extra.id === keep.id || absorbed.has(extra.id)) continue;
      const extraTracks = sets.get(extra.id) ?? new Set<string>();
      let matched = 0;
      for (const id of extraTracks) if (keepTracks.has(id)) matched += 1;
      if (!enoughTrackOverlap(matched, Math.max(keepTracks.size, extraTracks.size))) continue;
      await absorbAlbum(dbx, keep.id, extra, userId);
      for (const id of extraTracks) keepTracks.add(id);
      sets.set(keep.id, keepTracks);
      absorbed.add(extra.id);
    }
  }

  if (!input) return null;

  const after = await dbx.select().from(albums).where(eq(albums.userId, userId)).orderBy(asc(albums.createdAt));
  const afterSets = await albumTrackSets(
    dbx,
    after.map((row) => row.id),
  );
  const named = after.filter(
    (row) =>
      normalizeAlbumIdentity(row.title, row.artist) === identity &&
      yearsCompatible(row.year, input.year ?? null),
  );
  return named[0] ?? pickByTrackOverlap(after, afterSets, input.trackIds ?? []);
}

/**
 * Повторная отправка того же альбома (телефон + ПК, два раза с ПК) не создаёт копию:
 * совпадение по названию/исполнителю или по большей части тех же треков.
 */
export async function resolvePublishedAlbum(
  userId: string,
  input: { title: string; artist: string; year?: number | null; type?: string; trackIds?: string[] },
): Promise<{ album: AlbumRow; created: boolean }> {
  const trackIds = [...new Set((input.trackIds ?? []).filter(Boolean))];
  return withUserAlbumLock(userId, async (tx) => {
    const keep = await mergeOwnAlbums(tx, userId, { ...input, trackIds });
    if (keep) {
      if (trackIds.length) await appendTracksToAlbumOn(tx, keep.id, trackIds);
      const [fresh] = await tx.select().from(albums).where(eq(albums.id, keep.id)).limit(1);
      return { album: fresh ?? keep, created: false };
    }

    const [row] = await tx
      .insert(albums)
      .values({
        userId,
        title: input.title,
        artist: input.artist,
        year: input.year ?? null,
        type: input.type ?? 'album',
      })
      .returning();
    if (trackIds.length) await appendTracksToAlbumOn(tx, row.id, trackIds);
    return { album: row, created: true };
  });
}

/** Склеивает уже созданные копии одного альбома у пользователя. */
export async function collapseOwnAlbumDuplicates(userId: string): Promise<void> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(albums)
    .where(eq(albums.userId, userId));
  if (n < 2) return;
  await withUserAlbumLock(userId, async (tx) => {
    await mergeOwnAlbums(tx, userId);
  });
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
