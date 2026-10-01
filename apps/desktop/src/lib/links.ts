import type { SourceId, UnifiedAlbum, UnifiedPlaylist, UnifiedTrack } from '@mss/shared';
import { artistPath, splitArtists } from '@/lib/artists';

export interface ArtistLink {
  name: string;
  to: string;
}

export function trackArtistLinks(track: Pick<UnifiedTrack, 'source' | 'artist' | 'artists'>): ArtistLink[] {
  if (track.artists?.length && track.source !== 'local') {
    return track.artists.map((a) => ({
      name: a.name,
      to: artistPath(a.name, { [track.source]: { source: track.source, id: a.id, name: a.name } }),
    }));
  }
  return splitArtists(track.artist).map((name) => ({ name, to: artistPath(name) }));
}

export function supportsAlbumPage(source: SourceId): boolean {
  return source === 'yandex' || source === 'spotify' || source === 'local';
}

export function albumPath(source: SourceId, id: string): string {
  return `/album/${source}/${encodeURIComponent(id)}`;
}

export function trackAlbumPath(track: Pick<UnifiedTrack, 'source' | 'albumId'>): string | null {
  return track.albumId && supportsAlbumPage(track.source) ? albumPath(track.source, track.albumId) : null;
}

export function similarPath(track: Pick<UnifiedTrack, 'source' | 'id' | 'title' | 'artist'>): string {
  const q = new URLSearchParams({ title: `${track.artist} — ${track.title}` });
  return `/similar/${track.source}/${encodeURIComponent(track.id)}?${q}`;
}

/** Ссылка, которую Windows откроет в уже запущенном MSS. */
export function mssTrackUrl(track: Pick<UnifiedTrack, 'source' | 'id'>): string {
  return `mss://track/${track.source}/${encodeURIComponent(track.id)}`;
}

export function mssAlbumUrl(album: Pick<UnifiedAlbum, 'source' | 'id'>): string {
  return `mss://album/${album.source}/${encodeURIComponent(album.id)}`;
}

export function mssPlaylistUrl(playlist: Pick<UnifiedPlaylist, 'source' | 'id'>): string {
  return `mss://playlist/${playlist.source}/${encodeURIComponent(playlist.id)}`;
}

export function albumLink(album: Pick<UnifiedAlbum, 'source' | 'id'>): string {
  return albumPath(album.source, album.id);
}

export function playlistPath(playlist: Pick<UnifiedPlaylist, 'source' | 'id'>): string {
  return playlist.source === 'local'
    ? `/playlists/${playlist.id}`
    : `/playlist/${playlist.source}/${encodeURIComponent(playlist.id)}`;
}
