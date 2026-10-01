import type { AlbumDto, SourceId, UnifiedAlbum, UnifiedArtist, UnifiedTrack } from '@mss/shared';
import { apiFetch } from '@/lib/api';
import { apiMediaUrl } from '@/lib/api-base';
import {
  EXTERNAL_SOURCES,
  mapLocalTrack,
  matchesFilter,
  type LocalTrackDto,
  type SourceFilterId,
} from '@/lib/sources';

export interface ArtistGroup {
  key: string;
  name: string;
  imageUrl?: string;
  genres: string[];
  refs: Partial<Record<SourceId, UnifiedArtist>>;
}

export function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function localArtistLikeId(name: string): string {
  return normalizeArtistName(name).slice(0, 200);
}

export function splitArtists(artist: string): string[] {
  return artist
    .split(/\s*(?:,|&|\sfeat\.?\s|\sft\.?\s)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function artistPath(name: string, refs?: Partial<Record<SourceId, UnifiedArtist>>): string {
  const params = new URLSearchParams();
  for (const source of EXTERNAL_SOURCES) {
    const id = refs?.[source]?.id;
    if (id) params.set(source, id);
  }
  const qs = params.toString();
  return `/artist/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`;
}

async function searchLocalArtists(query: string, limit: number): Promise<UnifiedArtist[]> {
  const data = await apiFetch<{ items: { name: string; trackCount: number }[] }>(
    `/artists?query=${encodeURIComponent(query)}&limit=${limit}`,
  );
  return data.items.map((a) => ({
    source: 'local' as const,
    id: a.name,
    name: a.name,
    trackCount: a.trackCount,
  }));
}

export function groupArtists(artists: UnifiedArtist[], query: string): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();
  for (const a of artists) {
    const key = normalizeArtistName(a.name);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: a.name, genres: [], refs: {} };
      groups.set(key, g);
    }
    if (!g.refs[a.source]) g.refs[a.source] = a;
    g.imageUrl ??= a.imageUrl;
    for (const genre of a.genres ?? []) {
      if (!g.genres.includes(genre)) g.genres.push(genre);
    }
  }
  const q = normalizeArtistName(query);
  const rank = (g: ArtistGroup) => (g.key === q ? 100 : g.key.startsWith(q) ? 10 : 0) + Object.keys(g.refs).length;
  return [...groups.values()].sort((a, b) => rank(b) - rank(a));
}

export async function searchArtistsEverywhere(
  query: string,
  filter: SourceFilterId,
  limit = 12,
): Promise<ArtistGroup[]> {
  const tasks: Promise<UnifiedArtist[]>[] = [];
  if (matchesFilter(filter, 'local')) tasks.push(searchLocalArtists(query, limit));
  for (const source of EXTERNAL_SOURCES) {
    if (window.electronAPI && matchesFilter(filter, source)) {
      tasks.push(window.electronAPI.connectors.searchArtists(source, query, limit));
    }
  }
  if (tasks.length === 1) return groupArtists(await tasks[0], query);
  const settled = await Promise.allSettled(tasks);
  const all = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!all.length) {
    const rejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected) throw rejected.reason;
  }
  return groupArtists(all, query);
}

/** Находит исполнителя во внешнем источнике: по id из URL или по точному совпадению имени. */
export async function resolveExternalArtist(
  source: (typeof EXTERNAL_SOURCES)[number],
  name: string,
  id: string | null,
): Promise<UnifiedArtist | null> {
  if (!window.electronAPI) return null;
  const found = await window.electronAPI.connectors.searchArtists(source, name, 10).catch(() => []);
  if (id) {
    return found.find((a) => a.id === id) ?? { source, id, name };
  }
  const key = normalizeArtistName(name);
  return found.find((a) => normalizeArtistName(a.name) === key) ?? null;
}

export async function loadLocalArtistTracks(name: string): Promise<UnifiedTrack[]> {
  const data = await apiFetch<{ items: LocalTrackDto[] }>(
    `/artists/${encodeURIComponent(name)}/tracks`,
  );
  return dedupeLocalTracks(data.items.map((t) => mapLocalTrack(t)));
}

export async function loadLocalArtistAlbums(name: string): Promise<UnifiedAlbum[]> {
  try {
    const data = await apiFetch<{ items: AlbumDto[] }>(`/artists/${encodeURIComponent(name)}/albums`);
    return data.items.map(mapArtistAlbum);
  } catch {
    const data = await apiFetch<{ items: AlbumDto[] }>('/albums');
    const key = normalizeArtistName(name);
    return data.items
      .filter(
        (album) =>
          normalizeArtistName(album.artist) === key ||
          splitArtists(album.artist).some((part) => normalizeArtistName(part) === key),
      )
      .map(mapArtistAlbum);
  }
}

function mapArtistAlbum(a: AlbumDto): UnifiedAlbum {
  const q = a.coverUrl?.includes('?') ? a.coverUrl.slice(a.coverUrl.indexOf('?')) : '';
  return {
    source: 'local',
    id: a.id,
    title: a.title,
    artist: a.artist,
    year: a.year ?? undefined,
    type: a.type ?? undefined,
    trackCount: a.trackCount,
    coverUrl: a.coverUrl ? apiMediaUrl(`/albums/${a.id}/cover${q}`) : undefined,
  };
}

function durationClose(a?: number | null, b?: number | null): boolean {
  if (!a || !b) return true;
  return Math.abs(a - b) <= 8000;
}

function sameLocalTrack(a: UnifiedTrack, b: UnifiedTrack): boolean {
  if (a.id === b.id) return true;
  const ha = a.contentHash?.toLowerCase();
  const hb = b.contentHash?.toLowerCase();
  if (ha && hb && ha === hb) return true;
  return (
    normalizeArtistName(a.title) === normalizeArtistName(b.title) &&
    normalizeArtistName(a.artist) === normalizeArtistName(b.artist) &&
    durationClose(a.durationMs, b.durationMs)
  );
}

function rankLocalTrack(t: UnifiedTrack): number {
  return (t.coverUrl ? 4 : 0) + (t.availability === 'cached' || t.availability === 'online' ? 1 : 0);
}

function dedupeLocalTracks(tracks: UnifiedTrack[]): UnifiedTrack[] {
  const out: UnifiedTrack[] = [];
  for (const track of tracks) {
    const idx = out.findIndex((item) => sameLocalTrack(item, track));
    if (idx < 0) {
      out.push(track);
      continue;
    }
    if (rankLocalTrack(track) > rankLocalTrack(out[idx])) out[idx] = track;
  }
  return out;
}
