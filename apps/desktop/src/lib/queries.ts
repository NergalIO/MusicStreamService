import type { PlaylistDto, UnifiedPlaylist, UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { useSpotifyConnected, useVkConnected, useYandexConnected } from '@/lib/connectors';
import { statsTrackToUnified, useShelves } from '@/lib/stats';
import { mapLocalTrack, type LocalTrackDto } from '@/lib/sources';
import { loadLocalLikedTracks } from '@/store/likes-store';
import { usePlayerStore } from '@/store/player-store';

export type MssPlaylist = PlaylistDto;

export function useMssPlaylists() {
  return useQuery({
    queryKey: ['playlists'],
    queryFn: async () => (await apiFetch<{ items: MssPlaylist[] }>('/playlists')).items,
  });
}

export function useMyUploads() {
  return useQuery({
    queryKey: ['my-uploads'],
    queryFn: async () =>
      (await apiFetch<{ items: LocalTrackDto[] }>('/me/uploads')).items.map((t) =>
        mapLocalTrack(t, { ownsLocal: true }),
      ),
    refetchInterval: (query) =>
      query.state.data?.some((t) => t.status === 'processing' || t.status === 'uploading') ? 3000 : false,
  });
}

export function mssPlaylistToUnified(p: MssPlaylist): UnifiedPlaylist {
  return {
    source: 'local',
    id: p.id,
    title: p.name,
    trackCount: p.trackCount,
    owner: p.author ?? 'MSS',
    description: p.description ?? undefined,
    coverUrl: p.coverUrl ?? undefined,
  };
}

export function useYandexPlaylists() {
  const connected = useYandexConnected();
  return useQuery({
    queryKey: ['yandex', 'playlists'],
    queryFn: () => window.electronAPI.yandex.playlists(),
    enabled: connected,
    staleTime: 5 * 60_000,
  });
}

/** Подборка для MSS «Слушать сейчас»: частое из статистики, история, забытое, новые загрузки. */
export function useMssListenNow(limit = 30) {
  const shelves = useShelves();
  const local = useLocalTracks(limit);
  const history = usePlayerStore((s) => s.history);

  const tracks = useMemo(() => {
    const out: UnifiedTrack[] = [];
    const seen = new Set<string>();
    const add = (t: UnifiedTrack) => {
      if (t.playable === false) return;
      const key = `${t.source}:${t.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    for (const t of shelves.data?.frequent ?? []) add(statsTrackToUnified(t));
    for (const t of history) add(t);
    for (const t of shelves.data?.forgotten ?? []) add(statsTrackToUnified(t));
    for (const t of local.data ?? []) add(t);
    return out.slice(0, limit);
  }, [shelves.data, history, local.data, limit]);

  return {
    tracks,
    isLoading: shelves.isLoading && local.isLoading && !tracks.length,
    isError: Boolean(shelves.isError && local.isError && !tracks.length),
    error: shelves.error ?? local.error,
    refetch: () => {
      void shelves.refetch();
      void local.refetch();
    },
  };
}

export function useYandexFeed() {
  const connected = useYandexConnected();
  return useQuery({
    queryKey: ['yandex', 'feed'],
    queryFn: () => window.electronAPI.yandex.feed(),
    enabled: connected,
    staleTime: 10 * 60_000,
  });
}

export function useYandexChart() {
  const connected = useYandexConnected();
  return useQuery({
    queryKey: ['yandex', 'chart'],
    queryFn: () => window.electronAPI.yandex.chart(),
    enabled: connected,
    staleTime: 10 * 60_000,
  });
}

export function useVkPlaylists() {
  const connected = useVkConnected();
  return useQuery({
    queryKey: ['vk', 'playlists'],
    queryFn: () => window.electronAPI.connectors.listPlaylists('vk'),
    enabled: connected,
    staleTime: 5 * 60_000,
  });
}

export function useVkSavedTracks(limit = 2000) {
  const connected = useVkConnected();
  return useQuery({
    queryKey: ['vk', 'saved', limit],
    queryFn: () => window.electronAPI.connectors.savedTracks('vk', limit),
    enabled: connected,
    staleTime: 2 * 60_000,
  });
}

export function useSpotifyPlaylists() {
  const connected = useSpotifyConnected();
  return useQuery({
    queryKey: ['spotify', 'playlists'],
    queryFn: () => window.electronAPI.connectors.listPlaylists('spotify'),
    enabled: connected,
    staleTime: 5 * 60_000,
  });
}

export function useSpotifySavedTracks(limit = 1000) {
  const connected = useSpotifyConnected();
  return useQuery({
    queryKey: ['spotify', 'saved', limit],
    queryFn: () => window.electronAPI.connectors.savedTracks('spotify', limit),
    enabled: connected,
    staleTime: 2 * 60_000,
  });
}

export function useYandexLikedTracks(limit = 1000) {
  const connected = useYandexConnected();
  return useQuery({
    queryKey: ['yandex', 'liked', limit],
    queryFn: () => window.electronAPI.yandex.likedTracks(limit),
    enabled: connected,
    staleTime: 2 * 60_000,
  });
}

export function useSimilarTracks(source: string | undefined, id: string | undefined) {
  const connected = useYandexConnected();
  return useQuery({
    queryKey: ['yandex', 'similar', id],
    queryFn: () => window.electronAPI.yandex.similarTracks(id!),
    enabled: connected && source === 'yandex' && !!id,
    staleTime: 30 * 60_000,
  });
}

export function useLocalLikedTracks() {
  return useQuery({ queryKey: ['mss-likes'], queryFn: loadLocalLikedTracks });
}

export function useLocalTracks(limit = 30) {
  return useQuery({
    queryKey: ['tracks', limit],
    queryFn: async () =>
      (await apiFetch<{ items: LocalTrackDto[] }>(`/tracks?limit=${limit}`)).items.map((t) => mapLocalTrack(t)),
    refetchInterval: (query) =>
      query.state.data?.some((t) => t.status === 'processing' || t.status === 'uploading') ? 3000 : false,
  });
}
