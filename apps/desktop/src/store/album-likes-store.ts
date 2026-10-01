import type { LikedAlbumDto, UnifiedAlbum } from '@mss/shared';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch, currentAccessToken } from '@/lib/api';
import { albumCoverUrl } from '@/lib/queries';

function keyOf(album: Pick<UnifiedAlbum, 'source' | 'id'>): string {
  return `${album.source}:${album.id}`;
}

function fromDto(a: LikedAlbumDto): UnifiedAlbum {
  return {
    source: a.source,
    id: a.id,
    title: a.title,
    artist: a.artist,
    artists: a.artists,
    year: a.year ?? undefined,
    type: a.type ?? undefined,
    trackCount: a.trackCount,
    coverUrl: a.source === 'local' && a.coverUrl ? albumCoverUrl(a.id, a.coverUrl) : (a.coverUrl ?? undefined),
    genre: a.genre ?? undefined,
  };
}

function snapshot(album: UnifiedAlbum) {
  const year = album.year && album.year >= 1000 && album.year <= 2100 ? album.year : undefined;
  return {
    source: album.source,
    id: album.id,
    title: album.title.trim() || 'Альбом',
    artist: album.artist.trim() || 'Неизвестный исполнитель',
    year,
    type: album.type,
    coverUrl: album.coverUrl,
    trackCount: album.trackCount,
    genre: album.genre,
    artists: album.artists,
  };
}

interface AlbumLikesState {
  items: UnifiedAlbum[];
  loaded: boolean;
  isLiked: (album: Pick<UnifiedAlbum, 'source' | 'id'>) => boolean;
  sync: () => Promise<void>;
  toggle: (album: UnifiedAlbum) => Promise<boolean>;
  drop: (album: Pick<UnifiedAlbum, 'source' | 'id'>) => void;
}

export const useAlbumLikesStore = create<AlbumLikesState>()(
  persist(
    (set, get) => ({
      items: [],
      loaded: false,

      isLiked: (album) => get().items.some((a) => a.source === album.source && a.id === album.id),

      sync: async () => {
        if (!currentAccessToken()) {
          set({ loaded: true });
          return;
        }
        try {
          const { items } = await apiFetch<{ items: LikedAlbumDto[] }>('/me/liked-albums');
          set({ items: items.map(fromDto), loaded: true });
        } catch {
          set({ loaded: true });
        }
      },

      toggle: async (album) => {
        const liked = !get().isLiked(album);
        const prev = get().items;
        set({
          items: liked
            ? [album, ...prev.filter((a) => keyOf(a) !== keyOf(album))]
            : prev.filter((a) => keyOf(a) !== keyOf(album)),
        });
        try {
          if (liked) {
            await apiFetch('/likes/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot(album)) });
          } else {
            await apiFetch(`/likes/albums/${album.source}/${encodeURIComponent(album.id)}`, { method: 'DELETE' });
          }
          if (album.source === 'yandex') {
            void window.electronAPI?.yandex.setAlbumLike?.(album.id, liked).catch(() => undefined);
          }
          return liked;
        } catch (e) {
          set({ items: prev });
          toast.error(e instanceof Error ? e.message : 'Не удалось сохранить лайк альбома');
          return !liked;
        }
      },

      drop: (album) => set((s) => ({ items: s.items.filter((a) => keyOf(a) !== keyOf(album)) })),
    }),
    {
      name: 'mss-album-likes',
      partialize: (s) => ({ items: s.items }),
    },
  ),
);

export function useIsAlbumLiked(album: Pick<UnifiedAlbum, 'source' | 'id'> | null | undefined): boolean {
  return useAlbumLikesStore((s) => (album ? s.isLiked(album) : false));
}
