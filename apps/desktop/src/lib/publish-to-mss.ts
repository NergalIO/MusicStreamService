import type { AlbumWithTracks, UnifiedAlbum, UnifiedTrack } from '@mss/shared';
import { isMssTrackId, publishAlbumToMss, publishTracksToMss as uploadOwnedTracks } from '@/lib/mss-library';
import { canDownload, downloadKey, useDownloadsStore } from '@/store/downloads-store';
import { enqueuePublishFiles } from '@/store/uploads-store';

type PublishFileMeta = {
  path: string;
  title: string;
  artist: string;
  album?: string | null;
};

function asPublishFile(track: UnifiedTrack, path: string, albumTitle?: string): PublishFileMeta {
  return {
    path,
    title: track.title.trim() || 'Трек',
    artist: track.artist.trim() || 'Неизвестный исполнитель',
    album: albumTitle ?? track.album,
  };
}

async function collectFiles(tracks: UnifiedTrack[], albumTitle?: string): Promise<PublishFileMeta[]> {
  const downloads = useDownloadsStore.getState();
  const missing = tracks.filter((t) => !downloads.items[downloadKey(t)] && canDownload(t));
  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(missing.slice(i, i + CONCURRENCY).map((t) => downloads.download(t, { silent: true })));
  }
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = useDownloadsStore.getState();
    const waiting = tracks.some((t) => !state.items[downloadKey(t)] && !!state.active[downloadKey(t)]);
    if (!waiting) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const files: PublishFileMeta[] = [];
  for (const track of tracks) {
    const path =
      useDownloadsStore.getState().items[downloadKey(track)]?.path ??
      (track.source === 'local' && isMssTrackId(track.id)
        ? await window.electronAPI?.localTracks?.resolvePath?.(track.id)
        : null);
    if (path) files.push(asPublishFile(track, path, albumTitle));
  }
  return files.filter((f, i, all) => all.findIndex((x) => x.path === f.path) === i);
}

/** Локальные треки — догрузка в облако; остальные — скачать при необходимости и зарегистрировать в MSS. */
export async function publishTracksToMss(tracks: UnifiedTrack[]): Promise<{ uploaded: number }> {
  const local = tracks.filter((t) => t.source === 'local' && isMssTrackId(t.id));
  const rest = tracks.filter((t) => !(t.source === 'local' && isMssTrackId(t.id)));
  let uploaded = 0;
  if (local.length) {
    try {
      uploaded += (await uploadOwnedTracks(local)).uploaded;
    } catch (e) {
      if (!(e instanceof Error && /Нет локальных файлов/.test(e.message))) throw e;
    }
  }
  const needFiles = [...(uploaded === 0 ? local : []), ...rest];
  const files = await collectFiles(needFiles);
  if (files.length) {
    enqueuePublishFiles(files);
    uploaded += files.length;
  }
  if (!uploaded) throw new Error('Нет файлов для отправки на сервер MSS');
  return { uploaded };
}

export async function publishAlbumToMssCollection(
  album: UnifiedAlbum,
  tracks: UnifiedTrack[],
): Promise<{ uploaded: number; createdAlbum: boolean; albumId?: string }> {
  if (album.source === 'local' && isMssTrackId(album.id)) {
    return publishAlbumToMss({ ...album, tracks } as AlbumWithTracks);
  }
  const files = await collectFiles(tracks, album.title);
  if (!files.length) throw new Error('Нет файлов для отправки на сервер MSS');
  enqueuePublishFiles(files, { title: album.title, artist: album.artist, year: album.year ?? null, coverUrl: album.coverUrl });
  return { uploaded: files.length, createdAlbum: true };
}
