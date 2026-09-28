import type { HomeShelves, ListeningPeriod, ListeningStats, StatsTopArtist, StatsTopTrack, UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { normalizeArtistName, type ArtistGroup } from '@/lib/artists';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export type StatsRange = { period: ListeningPeriod } | { year: number };

export function useStats(range: StatsRange) {
  const key = 'year' in range ? `y${range.year}` : range.period;
  return useQuery({
    queryKey: ['stats', key],
    queryFn: () => {
      const params = new URLSearchParams({ tz: timeZone() });
      if ('year' in range) params.set('year', String(range.year));
      else params.set('period', range.period);
      return apiFetch<ListeningStats>(`/me/stats?${params}`);
    },
    staleTime: 60_000,
  });
}

export function useShelves() {
  return useQuery({
    queryKey: ['stats', 'shelves'],
    queryFn: () => apiFetch<HomeShelves>('/me/shelves'),
    staleTime: 5 * 60_000,
  });
}

export function statsTrackToUnified(t: StatsTopTrack): UnifiedTrack {
  return {
    source: t.source,
    id: t.trackId,
    title: t.title,
    artist: t.artist,
    artists: t.artists ?? undefined,
    album: t.album ?? undefined,
    albumId: t.albumId ?? undefined,
    durationMs: t.durationMs ?? undefined,
    coverUrl: t.coverUrl ?? undefined,
    playable: true,
  };
}

export function statsArtistGroup(a: StatsTopArtist): ArtistGroup {
  return {
    key: normalizeArtistName(a.name),
    name: a.name,
    imageUrl: a.coverUrl ?? undefined,
    genres: [],
    refs: a.id && a.source !== 'local' ? { [a.source]: { source: a.source, id: a.id, name: a.name } } : {},
  };
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
