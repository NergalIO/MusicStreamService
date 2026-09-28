import type {
  ArtistRef,
  UnifiedAlbum,
  UnifiedArtist,
  UnifiedPlaylist,
  UnifiedTrack,
} from '@mss/shared';

export interface YTrack {
  id: number | string;
  realId?: string;
  title: string;
  version?: string;
  durationMs?: number;
  available?: boolean;
  contentWarning?: string;
  artists?: { id?: number | string; name: string }[];
  albums?: YAlbum[];
  coverUri?: string;
  ogImage?: string;
  /** EBU R128: integrated loudness (i, LUFS) and true peak (tp). */
  r128?: { i?: number; tp?: number };
}

export interface YAlbum {
  id: number | string;
  title: string;
  version?: string;
  year?: number;
  coverUri?: string;
  ogImage?: string;
  trackCount?: number;
  type?: string;
  metaType?: string;
  genre?: string;
  artists?: { id?: number | string; name: string }[];
  labels?: ({ name: string } | string)[];
  volumes?: YTrack[][];
}

export interface YArtist {
  id: number | string;
  name: string;
  genres?: string[];
  cover?: { uri?: string };
  ogImage?: string;
  counts?: { tracks?: number };
  likesCount?: number;
}

export interface YPlaylist {
  uid?: number;
  kind: number | string;
  title: string;
  description?: string;
  trackCount?: number;
  owner?: { uid?: number; login?: string; name?: string };
  cover?: { uri?: string; itemsUri?: string[] };
  ogImage?: string;
  tracks?: { id: number | string; albumId?: number | string; track?: YTrack }[];
}

export function yandexImage(uri: string | undefined, size = '400x400'): string | undefined {
  if (!uri) return undefined;
  const withSize = uri.replace('%%', size);
  return withSize.startsWith('http') ? withSize : `https://${withSize}`;
}

function artistRefs(list?: { id?: number | string; name: string }[]): ArtistRef[] {
  return (list ?? []).map((a) => ({ id: String(a.id ?? ''), name: a.name }));
}

function withVersion(title: string, version?: string): string {
  return version ? `${title} (${version})` : title;
}

export function mapTrack(t: YTrack): UnifiedTrack {
  const available = t.available !== false;
  const album = t.albums?.[0];
  const artists = artistRefs(t.artists);
  return {
    source: 'yandex',
    id: String(t.id),
    title: withVersion(t.title, t.version),
    artist: artists.map((a) => a.name).join(', '),
    artists,
    album: album?.title,
    albumId: album ? String(album.id) : undefined,
    durationMs: t.durationMs,
    coverUrl: yandexImage(album?.coverUri ?? t.coverUri ?? t.ogImage, '400x400'),
    explicit: t.contentWarning === 'explicit',
    playable: available,
    unplayableReason: available ? undefined : 'Трек недоступен в Яндекс Музыке',
    loudnessLufs: typeof t.r128?.i === 'number' ? t.r128.i : undefined,
  };
}

export function mapAlbum(a: YAlbum): UnifiedAlbum {
  const artists = artistRefs(a.artists);
  return {
    source: 'yandex',
    id: String(a.id),
    title: withVersion(a.title, a.version),
    artist: artists.map((x) => x.name).join(', '),
    artists,
    year: a.year,
    coverUrl: yandexImage(a.coverUri ?? a.ogImage, '600x600'),
    trackCount: a.trackCount,
    type: a.type ?? (a.trackCount && a.trackCount <= 3 ? 'single' : 'album'),
    genre: a.genre,
  };
}

export function mapArtist(a: YArtist): UnifiedArtist {
  return {
    source: 'yandex',
    id: String(a.id),
    name: a.name,
    imageUrl: yandexImage(a.cover?.uri ?? a.ogImage, '600x600'),
    genres: a.genres,
    trackCount: a.counts?.tracks,
    followers: a.likesCount,
  };
}

export function mapPlaylist(p: YPlaylist): UnifiedPlaylist {
  const ownerUid = p.owner?.uid ?? p.uid;
  const coverUri = p.cover?.uri ?? p.cover?.itemsUri?.[0] ?? p.ogImage;
  return {
    source: 'yandex',
    id: `${ownerUid}:${p.kind}`,
    title: p.title,
    owner: p.owner?.name ?? p.owner?.login,
    description: p.description,
    coverUrl: yandexImage(coverUri, '600x600'),
    trackCount: p.trackCount,
  };
}

/** Id трека без `:albumId`. У загруженных пользователем (UGC) треков это UUID, а не число. */
export function trackBaseId(trackId: string): string {
  return String(trackId).split(':')[0];
}

export function isCatalogTrackId(trackId: string): boolean {
  return /^\d+$/.test(trackBaseId(trackId));
}

/** Формат `id:albumId`, который ждут rotor и play-audio. */
export function trackKey(track: Pick<UnifiedTrack, 'id' | 'albumId'>): string {
  return track.albumId ? `${trackBaseId(track.id)}:${track.albumId}` : trackBaseId(track.id);
}
