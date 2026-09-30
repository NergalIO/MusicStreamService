import type { AlbumWithTracks, SourceId } from '@mss/shared';
import { supportsAlbumPage } from '@/lib/links';

export interface AlbumAlternative {
  source: SourceId;
  id: string;
  title: string;
  coverUrl?: string;
  trackCount?: number;
}

const ALBUM_SOURCES: SourceId[] = ['yandex', 'spotify'];

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+[-–—]\s+.*\b(remaster\w*|deluxe|edition|version|expanded|anniversary)\b.*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Один и тот же релиз: названия совпадают без пометок вроде «(Deluxe)», исполнитель пересекается. */
export function sameAlbum(title: string, artist: string, targetTitle: string, targetArtist: string): boolean {
  const t = normTitle(title);
  if (!t || t !== normTitle(targetTitle)) return false;
  const a = normName(artist);
  const b = normName(targetArtist);
  if (!a || !b) return true;
  return a.includes(b) || b.includes(a);
}

export function albumMatchKey(album: Pick<AlbumWithTracks, 'title' | 'artist'>): string {
  return `${normTitle(album.title)}|${normName(album.artist)}`;
}

/** Ищет этот же альбом на других площадках через поиск треков: у найденных треков есть `albumId`. */
export async function findAlbumAlternatives(album: AlbumWithTracks): Promise<AlbumAlternative[]> {
  const artist = album.artists?.[0]?.name ?? album.artist.split(/,|&/)[0].trim();
  const query = `${artist} ${album.title}`.trim();
  const self: AlbumAlternative = {
    source: album.source,
    id: album.id,
    title: album.title,
    coverUrl: album.coverUrl,
    trackCount: album.trackCount ?? album.tracks.length,
  };
  const others = await Promise.all(
    ALBUM_SOURCES.filter((s) => s !== album.source && supportsAlbumPage(s)).map(async (source): Promise<AlbumAlternative | null> => {
      const tracks = await window.electronAPI.connectors.search(source, query, 25).catch(() => []);
      const counts = new Map<string, { hits: number; title: string; coverUrl?: string }>();
      for (const t of tracks) {
        if (!t.albumId || !t.album) continue;
        const trackArtist = t.artists?.map((a) => a.name).join(', ') || t.artist;
        if (!sameAlbum(t.album, trackArtist, album.title, artist)) continue;
        const cur = counts.get(t.albumId);
        counts.set(t.albumId, { hits: (cur?.hits ?? 0) + 1, title: t.album, coverUrl: cur?.coverUrl ?? t.coverUrl });
      }
      const best = [...counts.entries()].sort((a, b) => b[1].hits - a[1].hits)[0];
      return best ? { source, id: best[0], title: best[1].title, coverUrl: best[1].coverUrl } : null;
    }),
  );
  const found = others.filter((x): x is AlbumAlternative => !!x);
  return [self, ...found].sort((a, b) => ALBUM_SOURCES.indexOf(a.source) - ALBUM_SOURCES.indexOf(b.source));
}
