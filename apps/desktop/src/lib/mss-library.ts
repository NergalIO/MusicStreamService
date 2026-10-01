import type { AlbumDetailDto, AlbumDto, AlbumWithTracks, ExternalTrackSnapshot, UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { audioContentType, rememberCloudUrls } from '@/lib/cloud-urls';
import { formatTrackCount } from '@/lib/format';
import { queryClient } from '@/lib/query-client';
import type { LocalTrackDto } from '@/lib/sources';
import { useAlbumLikesStore } from '@/store/album-likes-store';
import { downloadKey, useDownloadsStore } from '@/store/downloads-store';
import type { MssPlaylist } from '@/lib/queries';

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function refreshPlaylists(playlistId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ['playlists'] });
  if (playlistId) void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
}

export async function createPlaylist(name: string): Promise<MssPlaylist> {
  const playlist = await apiFetch<MssPlaylist>('/playlists', { method: 'POST', ...json({ name }) });
  refreshPlaylists();
  return playlist;
}

export interface PlaylistPatch {
  name?: string;
  description?: string | null;
  author?: string | null;
}

export async function updatePlaylist(id: string, patch: PlaylistPatch): Promise<MssPlaylist> {
  const playlist = await apiFetch<MssPlaylist>(`/playlists/${id}`, { method: 'PATCH', ...json(patch) });
  refreshPlaylists(id);
  return playlist;
}

const COVER_SIZE = 1200;

/** Центрированный квадрат не больше 1200px в JPEG: обложки плейлистов квадратные, а фото с телефона весят мегабайты. */
export async function prepareCover(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, COVER_SIZE);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Не удалось обработать изображение');
  return blob;
}

export async function setPlaylistCover(id: string, image: Blob): Promise<MssPlaylist> {
  const form = new FormData();
  form.append('file', image, 'cover.jpg');
  const playlist = await apiFetch<MssPlaylist>(`/playlists/${id}/cover`, { method: 'PUT', body: form });
  refreshPlaylists(id);
  return playlist;
}

export async function removePlaylistCover(id: string): Promise<MssPlaylist> {
  const playlist = await apiFetch<MssPlaylist>(`/playlists/${id}/cover`, { method: 'DELETE' });
  refreshPlaylists(id);
  return playlist;
}

export async function deletePlaylist(id: string): Promise<void> {
  await apiFetch(`/playlists/${id}`, { method: 'DELETE' });
  queryClient.removeQueries({ queryKey: ['playlist', id] });
  refreshPlaylists();
}

type PlaylistEntryInput =
  | { trackId: string }
  | { source: 'yandex' | 'spotify' | 'vk'; externalId: string; snapshot: ExternalTrackSnapshot };

const isHttp = (url?: string) => !!url && /^https?:\/\//.test(url);

/** Для внешних треков на сервер уходят только метаданные — токены и ссылки на поток остаются на клиенте. */
export function toPlaylistEntry(track: UnifiedTrack): PlaylistEntryInput | null {
  if (track.source === 'local') return { trackId: track.id };
  if (track.source !== 'yandex' && track.source !== 'spotify' && track.source !== 'vk') return null;
  return {
    source: track.source,
    externalId: track.id.slice(0, 100),
    snapshot: {
      title: track.title,
      artist: track.artist,
      artists: track.artists?.slice(0, 20),
      album: track.album,
      albumId: track.albumId,
      durationMs: track.durationMs ? Math.round(track.durationMs) : undefined,
      coverUrl: isHttp(track.coverUrl) ? track.coverUrl : undefined,
      explicit: track.explicit,
    },
  };
}

export async function addTracksToPlaylist(
  playlist: Pick<MssPlaylist, 'id' | 'name'>,
  tracks: UnifiedTrack[],
  { silent = false }: { silent?: boolean } = {},
): Promise<number> {
  const items = tracks.map(toPlaylistEntry).filter((e): e is PlaylistEntryInput => !!e);
  if (!items.length) return 0;
  try {
    let count = 0;
    for (let i = 0; i < items.length; i += 5000) {
      const res = await apiFetch<{ count: number }>(`/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        ...json({ items: items.slice(i, i + 5000) }),
      });
      count += res.count;
    }
    if (!silent) {
      if (tracks.length === 1) toast(count ? `Добавлено в «${playlist.name}»` : `Трек уже есть в «${playlist.name}»`);
      else toast(count ? `В «${playlist.name}» добавлено: ${formatTrackCount(count)}` : `Все треки уже есть в «${playlist.name}»`);
    }
    refreshPlaylists(playlist.id);
    return count;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Не удалось добавить в плейлист');
    return 0;
  }
}

export function addToPlaylist(playlist: Pick<MssPlaylist, 'id' | 'name'>, track: UnifiedTrack): Promise<number> {
  return addTracksToPlaylist(playlist, [track]);
}

export async function removePlaylistEntries(playlistId: string, entryIds: string[]): Promise<void> {
  await Promise.all(entryIds.map((entryId) => apiFetch(`/playlists/${playlistId}/entries/${entryId}`, { method: 'DELETE' })));
  refreshPlaylists(playlistId);
}

export async function reorderPlaylist(playlistId: string, entryIds: string[]): Promise<void> {
  await apiFetch(`/playlists/${playlistId}/tracks/order`, { method: 'PUT', ...json({ entryIds }) });
  refreshPlaylists(playlistId);
}

export interface TrackPatch {
  title?: string;
  artist?: string;
  album?: string | null;
}

function refreshTrackLists(): void {
  for (const key of [['my-uploads'], ['tracks'], ['playlist'], ['mss-likes'], ['my-albums'], ['album']]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

export async function updateTrack(id: string, patch: TrackPatch): Promise<void> {
  await apiFetch(`/tracks/${id}`, { method: 'PATCH', ...json(patch) });
  refreshTrackLists();
}

export async function setTrackCover(id: string, image: Blob): Promise<void> {
  const form = new FormData();
  form.append('file', image, 'cover.jpg');
  await apiFetch(`/tracks/${id}/cover`, { method: 'PUT', body: form });
  refreshTrackLists();
}

export async function deleteUploadedTrack(trackId: string): Promise<void> {
  await apiFetch(`/tracks/${trackId}`, { method: 'DELETE' });
  for (const key of [['my-uploads'], ['tracks'], ['playlists'], ['playlist'], ['mss-likes'], ['my-albums'], ['album']]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

function refreshAlbums(albumId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ['my-albums'] });
  if (albumId) void queryClient.invalidateQueries({ queryKey: ['album', 'local', albumId] });
}

export interface AlbumPatch {
  title?: string;
  artist?: string;
  year?: number | null;
  type?: 'album' | 'single' | 'ep' | 'compilation';
}

export async function createAlbum(body: {
  title: string;
  artist: string;
  year?: number | null;
  type?: 'album' | 'single' | 'ep' | 'compilation';
  trackIds?: string[];
}): Promise<AlbumDetailDto> {
  const album = await apiFetch<AlbumDetailDto>('/albums', { method: 'POST', ...json(body) });
  refreshAlbums(album.id);
  void queryClient.invalidateQueries({ queryKey: ['my-uploads'] });
  return album;
}

export async function updateAlbum(id: string, patch: AlbumPatch): Promise<AlbumDto> {
  const album = await apiFetch<AlbumDto>(`/albums/${id}`, { method: 'PATCH', ...json(patch) });
  refreshAlbums(id);
  return album;
}

export async function setAlbumCover(id: string, image: Blob): Promise<AlbumDto> {
  const form = new FormData();
  form.append('file', image, 'cover.jpg');
  const album = await apiFetch<AlbumDto>(`/albums/${id}/cover`, { method: 'PUT', body: form });
  refreshAlbums(id);
  return album;
}

export async function removeAlbumCover(id: string): Promise<AlbumDto> {
  const album = await apiFetch<AlbumDto>(`/albums/${id}/cover`, { method: 'DELETE' });
  refreshAlbums(id);
  return album;
}

export async function deleteAlbum(id: string): Promise<void> {
  await apiFetch(`/albums/${id}`, { method: 'DELETE' });
  queryClient.removeQueries({ queryKey: ['album', 'local', id] });
  useAlbumLikesStore.getState().drop({ source: 'local', id });
  refreshAlbums();
}

export async function addTracksToAlbum(albumId: string, trackIds: string[]): Promise<number> {
  if (!trackIds.length) return 0;
  const res = await apiFetch<{ count: number }>(`/albums/${albumId}/tracks`, {
    method: 'POST',
    ...json({ trackIds }),
  });
  refreshAlbums(albumId);
  return res.count;
}

export async function removeAlbumTracks(albumId: string, trackIds: string[]): Promise<void> {
  await Promise.all(trackIds.map((trackId) => apiFetch(`/albums/${albumId}/tracks/${trackId}`, { method: 'DELETE' })));
  refreshAlbums(albumId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMssTrackId(id: string): boolean {
  return UUID_RE.test(id);
}

export interface PublishAlbumResult {
  albumId: string;
  uploaded: number;
  createdAlbum: boolean;
}

export interface PublishTracksResult {
  uploaded: number;
}

type CloudUploadRes = {
  skipUpload: boolean;
  alreadyReady: boolean;
  uploadUrl?: string;
  headers?: Record<string, string>;
} & Partial<LocalTrackDto>;

function isUuid(id: string): boolean {
  return isMssTrackId(id);
}

async function albumOnServer(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  try {
    await apiFetch(`/albums/${id}`);
    return true;
  } catch {
    return false;
  }
}

async function uploadTrackFile(trackId: string, filePath: string): Promise<boolean> {
  const api = window.electronAPI?.localTracks;
  if (!api?.putToUrl) throw new Error('Загрузка в облако доступна только в приложении');
  const filename = filePath.replace(/^.*[\\/]/, '') || 'audio';
  const contentType = audioContentType(filename);
  const cloud = await apiFetch<CloudUploadRes>(`/tracks/${trackId}/cloud-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType }),
  });
  if (cloud.skipUpload) {
    rememberCloudUrls(trackId, cloud);
    return false;
  }
  if (!cloud.uploadUrl) throw new Error('Сервер не выдал ссылку загрузки');
  await api.putToUrl(filePath, cloud.uploadUrl, cloud.headers ?? { 'Content-Type': contentType });
  if (!cloud.alreadyReady) {
    const done = await apiFetch<LocalTrackDto>(`/tracks/${trackId}/cloud-complete`, { method: 'POST' });
    rememberCloudUrls(done.id, done);
  } else {
    rememberCloudUrls(trackId, cloud);
  }
  return true;
}

async function localFilePath(track: UnifiedTrack): Promise<string | null> {
  if (track.source !== 'local' || !isUuid(track.id)) return null;
  const api = window.electronAPI?.localTracks;
  const fromIndex = api?.resolvePath ? await api.resolvePath(track.id) : null;
  return fromIndex ?? useDownloadsStore.getState().items[downloadKey(track)]?.path ?? null;
}

async function uploadLocalFiles(tracks: UnifiedTrack[]): Promise<{ uploaded: number; files: number }> {
  const seen = new Set<string>();
  let uploaded = 0;
  let files = 0;
  for (const track of tracks) {
    if (track.source !== 'local' || !isUuid(track.id) || seen.has(track.id)) continue;
    seen.add(track.id);
    const filePath = await localFilePath(track);
    if (!filePath) continue;
    files += 1;
    if (await uploadTrackFile(track.id, filePath)) uploaded += 1;
  }
  return { uploaded, files };
}

export async function publishTracksToMss(tracks: UnifiedTrack[]): Promise<PublishTracksResult> {
  const local = tracks.filter((t) => t.source === 'local' && isUuid(t.id));
  if (!local.length) throw new Error('Нет локальных файлов для отправки на сервер MSS');
  const result = await uploadLocalFiles(local);
  if (result.files === 0) throw new Error('Нет локальных файлов для отправки на сервер MSS');
  void queryClient.invalidateQueries({ queryKey: ['my-uploads'] });
  void queryClient.invalidateQueries({ queryKey: ['tracks'] });
  return { uploaded: result.uploaded };
}

export async function publishAlbumToMss(album: AlbumWithTracks): Promise<PublishAlbumResult> {
  const { uploaded } = await uploadLocalFiles(album.tracks);
  const trackIds = album.tracks.filter((t) => t.source === 'local' && isUuid(t.id)).map((t) => t.id);
  if (await albumOnServer(album.id)) {
    refreshAlbums(album.id);
    return { albumId: album.id, uploaded, createdAlbum: false };
  }
  if (!trackIds.length) throw new Error('Нет локальных файлов для отправки на сервер MSS');
  const created = await createAlbum({
    title: album.title.trim() || 'Альбом',
    artist: album.artist.trim() || 'Неизвестный исполнитель',
    year: album.year,
    trackIds,
  });
  return { albumId: created.id, uploaded, createdAlbum: true };
}
