import type { UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { mapLocalTrack, type LocalTrackDto } from '@/lib/sources';

type LikeTarget = Pick<UnifiedTrack, 'source' | 'id' | 'albumId'> & Partial<UnifiedTrack>;

function yandexNumericId(id: string): string {
  return id.split(':')[0];
}

function vkAudioKey(id: string): string {
  const parts = id.split('_');
  return parts.length >= 2 ? `${parts[0]}_${parts[1]}` : id;
}

interface LikesState {
  yandex: string[];
  local: string[];
  vk: string[];
  /** Копия на устройстве: запись в библиотеку Spotify может не пройти, лайк при этом не теряется. */
  spotifyTracks: UnifiedTrack[];
  /** Id из «Любимых треков» аккаунта Spotify. */
  spotify: string[];
  loaded: boolean;
  isLiked: (track: Pick<UnifiedTrack, 'source' | 'id'>) => boolean;
  sync: (opts: { yandex: boolean; vk?: boolean; spotify?: boolean }) => Promise<void>;
  toggle: (track: LikeTarget) => Promise<boolean>;
}

export const useLikesStore = create<LikesState>()(
  persist(
    (set, get) => ({
      yandex: [],
      local: [],
      vk: [],
      spotifyTracks: [],
      spotify: [],
      loaded: false,

      isLiked: (track) => {
        const s = get();
        if (track.source === 'yandex') return s.yandex.includes(yandexNumericId(track.id));
        if (track.source === 'local') return s.local.includes(track.id);
        if (track.source === 'vk') return s.vk.includes(vkAudioKey(track.id));
        if (track.source === 'spotify') return s.spotify.includes(track.id) || s.spotifyTracks.some((t) => t.id === track.id);
        return false;
      },

      sync: async ({ yandex, vk, spotify }) => {
        const [y, l, v, sp] = await Promise.allSettled([
          yandex ? window.electronAPI.yandex.likedTrackIds() : Promise.resolve([] as string[]),
          apiFetch<{ items: LocalTrackDto[] }>('/me/likes').then((r) => r.items.map((t) => t.id)),
          vk
            ? window.electronAPI.connectors.savedTracks('vk', 5000).then((tracks) => tracks.map((t) => vkAudioKey(t.id)))
            : Promise.resolve([] as string[]),
          spotify
            ? window.electronAPI.connectors.savedTracks('spotify', 2000).then((tracks) => tracks.map((t) => t.id))
            : Promise.resolve(null),
        ]);
        set((s) => ({
          yandex: y.status === 'fulfilled' ? y.value.map(yandexNumericId) : s.yandex,
          local: l.status === 'fulfilled' ? l.value : s.local,
          vk: v.status === 'fulfilled' ? v.value : s.vk,
          spotify: sp.status === 'fulfilled' && sp.value ? sp.value : s.spotify,
          loaded: true,
        }));
      },

      toggle: async (track) => {
        const liked = !get().isLiked(track);
        const snapshot = {
          yandex: get().yandex,
          local: get().local,
          vk: get().vk,
          spotifyTracks: get().spotifyTracks,
          spotify: get().spotify,
        };
        const id =
          track.source === 'yandex' ? yandexNumericId(track.id) : track.source === 'vk' ? vkAudioKey(track.id) : track.id;
        const apply = (list: string[]) => (liked ? [id, ...list.filter((x) => x !== id)] : list.filter((x) => x !== id));

        if (track.source === 'yandex') set((s) => ({ yandex: apply(s.yandex) }));
        else if (track.source === 'local') set((s) => ({ local: apply(s.local) }));
        else if (track.source === 'vk') set((s) => ({ vk: apply(s.vk) }));
        else if (track.source === 'spotify') {
          set((s) => ({
            spotifyTracks: liked
              ? [track as UnifiedTrack, ...s.spotifyTracks.filter((t) => t.id !== track.id)]
              : s.spotifyTracks.filter((t) => t.id !== track.id),
            spotify: apply(s.spotify),
          }));
          void window.electronAPI?.connectors
            .setSaved('spotify', track as UnifiedTrack, liked)
            .then(() => queryClient.invalidateQueries({ queryKey: ['spotify', 'saved'] }))
            .catch((e) => console.warn('spotify library sync failed', e));
          return liked;
        } else {
          return liked;
        }

        try {
          if (track.source === 'yandex') {
            await window.electronAPI.yandex.setLike({ id: track.id, albumId: track.albumId }, liked);
          } else if (track.source === 'vk') {
            await window.electronAPI.connectors.setSaved('vk', track as UnifiedTrack, liked);
            void queryClient.invalidateQueries({ queryKey: ['vk'] });
          } else {
            await apiFetch(`/tracks/${track.id}/like`, { method: liked ? 'POST' : 'DELETE' });
          }
          return liked;
        } catch (e) {
          set(snapshot);
          toast.error(e instanceof Error ? e.message : 'Не удалось сохранить лайк');
          return !liked;
        }
      },
    }),
    {
      name: 'mss-likes',
      partialize: (s) => ({ yandex: s.yandex, local: s.local, vk: s.vk, spotifyTracks: s.spotifyTracks, spotify: s.spotify }),
    },
  ),
);

export function useIsLiked(track: Pick<UnifiedTrack, 'source' | 'id'> | null | undefined): boolean {
  return useLikesStore((s) => (track ? s.isLiked(track) : false));
}

export async function loadLocalLikedTracks(): Promise<UnifiedTrack[]> {
  const { items } = await apiFetch<{ items: LocalTrackDto[] }>('/me/likes');
  return items.map((t) => mapLocalTrack(t));
}
