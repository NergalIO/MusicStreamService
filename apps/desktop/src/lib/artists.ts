import type { SourceId, UnifiedArtist, UnifiedTrack } from '@mss/shared';
import { apiFetch } from '@/lib/api';
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

/** URL задаёт одного провайдера — не подбираем второй каталог по совпадению имени. */
export function shouldSkipExternalArtistLookup(
  source: (typeof EXTERNAL_SOURCES)[number],
  ids: { spotify: string | null; yandex: string | null },
): boolean {
  if (ids.spotify && !ids.yandex && source === 'yandex') return true;
  if (ids.yandex && !ids.spotify && source === 'spotify') return true;
  return false;
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
  return data.items.map((t) => mapLocalTrack(t));
}
