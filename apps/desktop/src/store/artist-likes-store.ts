import type { LikedArtistDto, UnifiedArtist } from '@mss/shared';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch, currentAccessToken } from '@/lib/api';
import { localArtistLikeId, normalizeArtistName } from '@/lib/artists';

function keyOf(artist: Pick<UnifiedArtist, 'source' | 'id'>): string {
  return `${artist.source}:${artist.id}`;
}

function fromDto(a: LikedArtistDto): UnifiedArtist {
  return {
    source: a.source,
    id: a.id,
    name: a.name,
    imageUrl: a.imageUrl ?? undefined,
    genres: a.genres,
    trackCount: a.trackCount,
  };
}

function snapshot(artist: UnifiedArtist) {
  return {
    source: artist.source,
    id: artist.source === 'local' ? localArtistLikeId(artist.name) : artist.id,
    name: artist.name.trim() || 'Исполнитель',
    imageUrl: artist.imageUrl?.slice(0, 2000),
    genres: artist.genres?.slice(0, 20),
    trackCount: artist.trackCount,
  };
}

function matches(stored: UnifiedArtist, artist: Pick<UnifiedArtist, 'source' | 'id' | 'name'>): boolean {
  if (stored.source !== artist.source) return false;
  if (stored.id === artist.id) return true;
  return normalizeArtistName(stored.name) === normalizeArtistName(artist.name);
}

interface ArtistLikesState {
  items: UnifiedArtist[];
  loaded: boolean;
  isLiked: (artist: Pick<UnifiedArtist, 'source' | 'id' | 'name'>) => boolean;
  sync: () => Promise<void>;
  toggle: (artist: UnifiedArtist) => Promise<boolean>;
}

export const useArtistLikesStore = create<ArtistLikesState>()(
  persist(
    (set, get) => ({
      items: [],
      loaded: false,

      isLiked: (artist) => get().items.some((a) => matches(a, artist)),

      sync: async () => {
        if (!currentAccessToken()) {
          set({ loaded: true });
          return;
        }
        try {
          const { items } = await apiFetch<{ items: LikedArtistDto[] }>('/me/liked-artists');
          set({ items: items.map(fromDto), loaded: true });
        } catch {
          set({ loaded: true });
        }
      },

      toggle: async (artist) => {
        const liked = !get().isLiked(artist);
        const prev = get().items;
        const body = snapshot(artist);
        const next: UnifiedArtist = { ...artist, id: body.id, name: body.name };
        set({
          items: liked
            ? [next, ...prev.filter((a) => keyOf(a) !== keyOf(next) && !matches(a, next))]
            : prev.filter((a) => !matches(a, next)),
        });
        try {
          if (liked) {
            await apiFetch('/likes/artists', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
          } else {
            await apiFetch(`/likes/artists/${next.source}/${encodeURIComponent(next.id)}`, { method: 'DELETE' });
          }
          return liked;
        } catch (e) {
          set({ items: prev });
          toast.error(e instanceof Error ? e.message : 'Не удалось сохранить лайк исполнителя');
          return !liked;
        }
      },
    }),
    {
      name: 'mss-artist-likes',
      partialize: (s) => ({ items: s.items }),
    },
  ),
);

export function useIsArtistLiked(artist: Pick<UnifiedArtist, 'source' | 'id' | 'name'> | null | undefined): boolean {
  return useArtistLikesStore((s) => (artist ? s.isLiked(artist) : false));
}
