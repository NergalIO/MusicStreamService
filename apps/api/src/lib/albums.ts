import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { albumLikes, albumTracks, albums, tracks } from '../db/schema.js';
import { deleteObject } from './storage.js';

type AlbumRow = typeof albums.$inferSelect;
type AlbumDb = typeof db;

type TrackSig = {
  id: string;
  title: string;
  artist: string;
  contentHash: string | null;
  durationMs: number | null;
};

export function albumCoverPublicUrl(id: string, coverStorageKey: string | null): string | null {
  if (!coverStorageKey) return null;
  return `${config.publicUrl}/albums/${id}/cover?v=${encodeURIComponent(coverStorageKey.split('/').pop()!)}`;
}

function foldText(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function normalizeAlbumIdentity(title: string, artist: string): string {
  return `${foldText(title)}\0${foldText(artist)}`;
}

function normalizeTrackIdentity(title: string, artist: string): string {
  return `${foldText(title)}\0${foldText(artist)}`;
}

function yearsCompatible(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b) return true;
  return a === b;
}

function durationClose(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b) return true;
  return Math.abs(a - b) <= 8000;
}

function sameTrack(a: TrackSig, b: TrackSig): boolean {
  if (a.id === b.id) return true;
  const ha = a.contentHash?.toLowerCase();
  const hb = b.contentHash?.toLowerCase();
  if (ha && hb && ha === hb) return true;
  return (
    normalizeTrackIdentity(a.title, a.artist) === normalizeTrackIdentity(b.title, b.artist) &&
    durationClose(a.durationMs, b.durationMs)
  );
}

function enoughTrackOverlap(matched: number, total: number): boolean {
  if (total <= 0 || matched <= 0) return false;
  if (matched === total) return true;
  if (total <= 3) return matched >= 2;
  return matched >= Math.ceil(total * 0.6);
}

function overlapCount(left: TrackSig[], right: TrackSig[]): number {
  let matched = 0;
  const used = new Set<number>();
  for (const item of right) {
    const idx = left.findIndex((row, i) => !used.has(i) && sameTrack(row, item));
    if (idx < 0) continue;
    used.add(idx);
    matched += 1;
  }
  return matched;
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

async function loadTrackSigs(dbx: AlbumDb, ids: string[]): Promise<Map<string, TrackSig>> {
  const map = new Map<string, TrackSig>();
  if (!ids.length) return map;
  const rows = await dbx
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      contentHash: tracks.contentHash,
      durationMs: tracks.durationMs,
    })
    .from(tracks)
    .where(inArray(tracks.id, ids));
  for (const row of rows) map.set(row.id, row);
  return map;
}

async function albumTrackSigs(dbx: AlbumDb, albumId: string): Promise<TrackSig[]> {
  return dbx
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      contentHash: tracks.contentHash,
      durationMs: tracks.durationMs,
    })
    .from(albumTracks)
    .innerJoin(tracks, eq(albumTracks.trackId, tracks.id))
    .where(eq(albumTracks.albumId, albumId))
    .orderBy(asc(albumTracks.position));
}

async function albumTrackSigMap(dbx: AlbumDb, albumIds: string[]): Promise<Map<string, TrackSig[]>> {
  const map = new Map<string, TrackSig[]>();
  if (!albumIds.length) return map;
  const rows = await dbx
    .select({
      albumId: albumTracks.albumId,
      position: albumTracks.position,
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      contentHash: tracks.contentHash,
      durationMs: tracks.durationMs,
    })
    .from(albumTracks)
    .innerJoin(tracks, eq(albumTracks.trackId, tracks.id))
    .where(inArray(albumTracks.albumId, albumIds))
    .orderBy(asc(albumTracks.position));
  for (const row of rows) {
    const list = map.get(row.albumId) ?? [];
    list.push(row);
    map.set(row.albumId, list);
  }
  return map;
}

async function nextAlbumPosition(dbx: AlbumDb, albumId: string): Promise<number> {
  const [{ next }] = await dbx
    .select({ next: sql<number>`coalesce(max(${albumTracks.position}) + 1, 0)::int` })
    .from(albumTracks)
    .where(eq(albumTracks.albumId, albumId));
  return next;
}

async function appendToAlbumOn(dbx: AlbumDb, albumId: string, trackId: string): Promise<boolean> {
  return (await appendTracksToAlbumOn(dbx, albumId, [trackId])) > 0;
}

/** Добавляет трек в конец альбома. Повтор (тот же id, хеш или название) игнорируется. */
export async function appendToAlbum(albumId: string, trackId: string): Promise<boolean> {
  return appendToAlbumOn(db, albumId, trackId);
}

export async function appendTracksToAlbum(albumId: string, trackIds: string[]): Promise<number> {
  return appendTracksToAlbumOn(db, albumId, trackIds);
}

async function appendTracksToAlbumOn(dbx: AlbumDb, albumId: string, trackIds: string[]): Promise<number> {
  const wanted = [...new Set(trackIds.filter(Boolean))];
  if (!wanted.length) return 0;
  const [album] = await dbx.select({ title: albums.title }).from(albums).where(eq(albums.id, albumId)).limit(1);
  if (!album) return 0;

  const existing = await albumTrackSigs(dbx, albumId);
  const incoming = await loadTrackSigs(dbx, wanted);
  let next = await nextAlbumPosition(dbx, albumId);
  let added = 0;

  for (const id of wanted) {
    const sig = incoming.get(id);
    if (!sig) continue;
    if (existing.some((row) => sameTrack(row, sig))) continue;
    await dbx.insert(albumTracks).values({ albumId, trackId: id, position: next });
    next += 1;
    added += 1;
    existing.push(sig);
    const [track] = await dbx.select({ album: tracks.album }).from(tracks).where(eq(tracks.id, id)).limit(1);
    if (track && !track.album) {
      await dbx.update(tracks).set({ album: album.title }).where(eq(tracks.id, id));
    }
  }
  return added;
}

async function reindexAlbumTracks(dbx: AlbumDb, albumId: string): Promise<void> {
  const rows = await dbx
    .select({ trackId: albumTracks.trackId })
    .from(albumTracks)
    .where(eq(albumTracks.albumId, albumId))
    .orderBy(asc(albumTracks.position));
  for (let i = 0; i < rows.length; i++) {
    await dbx
      .update(albumTracks)
      .set({ position: i })
      .where(and(eq(albumTracks.albumId, albumId), eq(albumTracks.trackId, rows[i].trackId)));
  }
}

async function dedupeAlbumTracksOn(dbx: AlbumDb, albumId: string): Promise<number> {
  const rows = await dbx
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      contentHash: tracks.contentHash,
      durationMs: tracks.durationMs,
    })
    .from(albumTracks)
    .innerJoin(tracks, eq(albumTracks.trackId, tracks.id))
    .where(eq(albumTracks.albumId, albumId))
    .orderBy(asc(albumTracks.position));
  const keep: TrackSig[] = [];
  const drop: string[] = [];
  for (const row of rows) {
    if (keep.some((item) => sameTrack(item, row))) drop.push(row.id);
    else keep.push(row);
  }
  if (!drop.length) return 0;
  await dbx
    .delete(albumTracks)
    .where(and(eq(albumTracks.albumId, albumId), inArray(albumTracks.trackId, drop)));
  await reindexAlbumTracks(dbx, albumId);
  return drop.length;
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
  await dedupeAlbumTracksOn(dbx, keepId);

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

function pickByTrackOverlap(own: AlbumRow[], sets: Map<string, TrackSig[]>, incoming: TrackSig[]): AlbumRow | null {
  if (!incoming.length) return null;
  let best: AlbumRow | null = null;
  let bestMatched = 0;
  for (const row of own) {
    const set = sets.get(row.id) ?? [];
    if (!set.length) continue;
    const matched = overlapCount(set, incoming);
    if (!enoughTrackOverlap(matched, Math.max(set.length, incoming.length))) continue;
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

  for (const row of own) await dedupeAlbumTracksOn(dbx, row.id);

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
  const sets = await albumTrackSigMap(
    dbx,
    remaining.map((row) => row.id),
  );
  const absorbed = new Set<string>();
  for (const keep of remaining) {
    if (absorbed.has(keep.id)) continue;
    const keepTracks = sets.get(keep.id) ?? [];
    for (const extra of remaining) {
      if (extra.id === keep.id || absorbed.has(extra.id)) continue;
      const extraTracks = sets.get(extra.id) ?? [];
      const matched = overlapCount(keepTracks, extraTracks);
      if (!enoughTrackOverlap(matched, Math.max(keepTracks.length, extraTracks.length))) continue;
      await absorbAlbum(dbx, keep.id, extra, userId);
      const merged = await albumTrackSigs(dbx, keep.id);
      sets.set(keep.id, merged);
      absorbed.add(extra.id);
    }
  }

  if (!input) return null;

  const after = await dbx.select().from(albums).where(eq(albums.userId, userId)).orderBy(asc(albums.createdAt));
  const afterSets = await albumTrackSigMap(
    dbx,
    after.map((row) => row.id),
  );
  const named = after.filter(
    (row) =>
      normalizeAlbumIdentity(row.title, row.artist) === identity &&
      yearsCompatible(row.year, input.year ?? null),
  );
  const incoming = [...(await loadTrackSigs(dbx, input.trackIds ?? [])).values()];
  return named[0] ?? pickByTrackOverlap(after, afterSets, incoming);
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
      await dedupeAlbumTracksOn(tx, keep.id);
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

/** Склеивает уже созданные копии одного альбома и убирает повторные треки внутри. */
export async function collapseOwnAlbumDuplicates(userId: string): Promise<void> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(albums)
    .where(eq(albums.userId, userId));
  if (n < 1) return;
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
