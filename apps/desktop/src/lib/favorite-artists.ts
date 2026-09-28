import type { UnifiedArtist, UnifiedTrack } from '@mss/shared';
import { normalizeArtistName, splitArtists, type ArtistGroup } from '@/lib/artists';
import { plural } from '@/lib/format';

export interface FavoriteArtistGroup extends ArtistGroup {
  /** Сколько любимых треков этого исполнителя во всех выбранных источниках. */
  likedTracks: number;
  /** Лайкнут или отслеживается в самом сервисе, а не только встречается в любимых треках. */
  followed: boolean;
}

/**
 * Любимые исполнители: отмеченные в сервисах (Яндекс, Spotify) плюс те, чьи треки
 * лежат в «Мне нравится». Сверху — отмеченные и те, у кого больше любимых треков.
 */
export function favoriteArtistGroups(followed: UnifiedArtist[], likedTracks: UnifiedTrack[]): FavoriteArtistGroup[] {
  const groups = new Map<string, FavoriteArtistGroup>();
  const touch = (artist: UnifiedArtist): FavoriteArtistGroup => {
    const key = normalizeArtistName(artist.name);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: artist.name, genres: [], refs: {}, likedTracks: 0, followed: false };
      groups.set(key, g);
    }
    if (!g.refs[artist.source] || artist.imageUrl) g.refs[artist.source] = { ...g.refs[artist.source], ...artist };
    g.imageUrl ??= artist.imageUrl;
    for (const genre of artist.genres ?? []) if (!g.genres.includes(genre)) g.genres.push(genre);
    return g;
  };

  for (const a of followed) touch(a).followed = true;

  for (const track of likedTracks) {
    const refs =
      track.artists?.length && track.source !== 'local'
        ? track.artists.map((a) => ({ id: a.id || a.name, name: a.name }))
        : splitArtists(track.artist).map((name) => ({ id: name, name }));
    const seen = new Set<string>();
    for (const ref of refs) {
      const key = normalizeArtistName(ref.name);
      if (!ref.name || seen.has(key)) continue;
      seen.add(key);
      touch({ source: track.source, id: ref.id, name: ref.name }).likedTracks += 1;
    }
  }

  return [...groups.values()].sort(
    (a, b) => Number(b.followed) - Number(a.followed) || b.likedTracks - a.likedTracks || a.name.localeCompare(b.name),
  );
}

export function favoriteArtistSubtitle(g: FavoriteArtistGroup): string {
  if (g.likedTracks) return `${g.likedTracks} ${plural(g.likedTracks, 'любимый трек', 'любимых трека', 'любимых треков')}`;
  return g.followed ? 'В подписках' : 'Исполнитель';
}
