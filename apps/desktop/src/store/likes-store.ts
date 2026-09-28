import type { UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '@/lib/api';
import { mapLocalTrack, type LocalTrackDto } from '@/lib/sources';

type LikeTarget = Pick<UnifiedTrack, 'source' | 'id' | 'albumId'> & Partial<UnifiedTrack>;

function yandexNumericId(id: string): string {
  return id.split(':')[0];
}

interface LikesState {
  yandex: string[];
  local: string[];
  /** Spotify has no write scope here, so its likes live on this device. */
  spotifyTracks: UnifiedTrack[];
  loaded: boolean;
  isLiked: (track: Pick<UnifiedTrack, 'source' | 'id'>) => boolean;
  sync: (opts: { yandex: boolean }) => Promise<void>;
  toggle: (track: LikeTarget) => Promise<boolean>;
}

export const useLikesStore = create<LikesState>()(
  persist(
    (set, get) => ({
      yandex: [],
      local: [],
      spotifyTracks: [],
      loaded: false,

      isLiked: (track) => {
        const s = get();
        if (track.source === 'yandex') return s.yandex.includes(yandexNumericId(track.id));
        if (track.source === 'local') return s.local.includes(track.id);
        return s.spotifyTracks.some((t) => t.id === track.id);
      },

      sync: async ({ yandex }) => {
        const [y, l] = await Promise.allSettled([
          yandex ? window.electronAPI.yandex.likedTrackIds() : Promise.resolve([] as string[]),
          apiFetch<{ items: LocalTrackDto[] }>('/me/likes').then((r) => r.items.map((t) => t.id)),
        ]);
        set((s) => ({
          yandex: y.status === 'fulfilled' ? y.value.map(yandexNumericId) : s.yandex,
          local: l.status === 'fulfilled' ? l.value : s.local,
          loaded: true,
        }));
      },

      toggle: async (track) => {
        const liked = !get().isLiked(track);
        const snapshot = { yandex: get().yandex, local: get().local, spotifyTracks: get().spotifyTracks };
        const id = track.source === 'yandex' ? yandexNumericId(track.id) : track.id;
        const apply = (list: string[]) => (liked ? [id, ...list.filter((x) => x !== id)] : list.filter((x) => x !== id));

        if (track.source === 'yandex') set((s) => ({ yandex: apply(s.yandex) }));
        else if (track.source === 'local') set((s) => ({ local: apply(s.local) }));
        else {
          set((s) => ({
            spotifyTracks: liked
              ? [track as UnifiedTrack, ...s.spotifyTracks.filter((t) => t.id !== track.id)]
              : s.spotifyTracks.filter((t) => t.id !== track.id),
          }));
          return liked;
        }

        try {
          if (track.source === 'yandex') {
            await window.electronAPI.yandex.setLike({ id: track.id, albumId: track.albumId }, liked);
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
      partialize: (s) => ({ yandex: s.yandex, local: s.local, spotifyTracks: s.spotifyTracks }),
    },
  ),
);

export function useIsLiked(track: Pick<UnifiedTrack, 'source' | 'id'> | null | undefined): boolean {
  return useLikesStore((s) => {
    if (!track) return false;
    if (track.source === 'yandex') return s.yandex.includes(yandexNumericId(track.id));
    if (track.source === 'local') return s.local.includes(track.id);
    return s.spotifyTracks.some((t) => t.id === track.id);
  });
}

export async function loadLocalLikedTracks(): Promise<UnifiedTrack[]> {
  const { items } = await apiFetch<{ items: LocalTrackDto[] }>('/me/likes');
  return items.map((t) => mapLocalTrack(t));
}
