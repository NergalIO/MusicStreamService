import type { ArtistRef, UnifiedArtist, UnifiedPlaylist, UnifiedTrack } from '@mss/shared';

export interface VkThumb {
  photo_135?: string;
  photo_270?: string;
  photo_300?: string;
  photo_600?: string;
  photo_1200?: string;
}

export interface VkArtist {
  id?: number | string;
  name: string;
}

export interface VkAlbum {
  id?: number;
  title?: string;
  owner_id?: number;
  access_key?: string;
  thumb?: VkThumb;
}

export interface VkAudio {
  id: number;
  owner_id: number;
  artist: string;
  title: string;
  duration: number;
  url?: string;
  access_key?: string;
  content_restricted?: number;
  is_explicit?: number | boolean;
  album?: VkAlbum;
  main_artists?: VkArtist[];
}

export interface VkPlaylist {
  id: number;
  owner_id: number;
  title: string;
  description?: string;
  count?: number;
  access_key?: string;
  photo?: VkThumb;
}

/** Заглушка VK, когда токен не даёт реальный audio API (сторонние клиенты). */
export function isVkAudioStub(a: VkAudio): boolean {
  const title = (a.title ?? '').toLowerCase();
  const artist = (a.artist ?? '').toLowerCase();
  if (title.includes('доступно на vk.com') || title.includes('available on vk.com')) return true;
  if (artist.includes('официальных приложениях') || artist.includes('official vk')) return true;
  if (!a.url && title.includes('vk.com')) return true;
  return false;
}

export function vkAudioKey(id: string): string {
  const parts = id.split('_');
  return parts.length >= 2 ? `${parts[0]}_${parts[1]}` : id;
}

export function vkTrackId(a: VkAudio): string {
  return a.access_key ? `${a.owner_id}_${a.id}_${a.access_key}` : `${a.owner_id}_${a.id}`;
}

export function vkPlaylistId(p: VkPlaylist): string {
  return p.access_key ? `${p.owner_id}_${p.id}_${p.access_key}` : `${p.owner_id}_${p.id}`;
}

export function parseVkAudioId(id: string): { ownerId: number; audioId: number; accessKey?: string } {
  const [owner, audio, ...rest] = id.split('_');
  const accessKey = rest.length ? rest.join('_') : undefined;
  return { ownerId: Number(owner), audioId: Number(audio), accessKey };
}

export function parseVkPlaylistId(id: string): { ownerId: number; playlistId: number; accessKey?: string } {
  const [owner, playlist, ...rest] = id.split('_');
  const accessKey = rest.length ? rest.join('_') : undefined;
  return { ownerId: Number(owner), playlistId: Number(playlist), accessKey };
}

function coverFromThumb(thumb?: VkThumb): string | undefined {
  return thumb?.photo_600 || thumb?.photo_1200 || thumb?.photo_300 || thumb?.photo_270 || thumb?.photo_135;
}

function artistRefs(list?: VkArtist[]): ArtistRef[] {
  return (list ?? [])
    .filter((a) => a.name)
    .map((a) => ({ id: String(a.id ?? a.name), name: a.name }));
}

export function mapVkTrack(a: VkAudio): UnifiedTrack {
  const artists = artistRefs(a.main_artists);
  const restricted = !!a.content_restricted;
  const playable = !restricted && !!a.url;
  return {
    source: 'vk',
    id: vkTrackId(a),
    title: a.title || 'Без названия',
    artist: artists.map((x) => x.name).join(', ') || a.artist || 'Unknown',
    artists: artists.length ? artists : undefined,
    album: a.album?.title,
    albumId: a.album?.id != null ? String(a.album.id) : undefined,
    durationMs: a.duration ? a.duration * 1000 : undefined,
    coverUrl: coverFromThumb(a.album?.thumb),
    explicit: a.is_explicit === true || a.is_explicit === 1,
    playable,
    unplayableReason: playable
      ? undefined
      : restricted
        ? 'Трек недоступен в VK'
        : 'VK не отдал ссылку на трек',
  };
}

export function mapVkPlaylist(p: VkPlaylist): UnifiedPlaylist {
  return {
    source: 'vk',
    id: vkPlaylistId(p),
    title: p.title,
    description: p.description,
    coverUrl: coverFromThumb(p.photo),
    trackCount: p.count,
  };
}

export function unwrapAudio(item: VkAudio | { audio?: VkAudio }): VkAudio | null {
  if ('title' in item && 'owner_id' in item && 'id' in item) return item as VkAudio;
  return item.audio ?? null;
}

export function artistsFromTracks(tracks: VkAudio[], limit: number): UnifiedArtist[] {
  const seen = new Map<string, UnifiedArtist>();
  for (const t of tracks) {
    for (const a of t.main_artists ?? []) {
      const id = String(a.id ?? a.name);
      if (seen.has(id) || !a.name) continue;
      seen.set(id, { source: 'vk', id, name: a.name });
      if (seen.size >= limit) return [...seen.values()];
    }
  }
  return [...seen.values()];
}
