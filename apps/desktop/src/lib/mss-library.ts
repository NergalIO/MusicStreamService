import type { ExternalTrackSnapshot, UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { formatTrackCount } from '@/lib/format';
import { queryClient } from '@/lib/query-client';
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
  for (const key of [['my-uploads'], ['tracks'], ['playlist'], ['mss-likes']]) {
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
  for (const key of [['my-uploads'], ['tracks'], ['playlists'], ['playlist'], ['mss-likes']]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}
