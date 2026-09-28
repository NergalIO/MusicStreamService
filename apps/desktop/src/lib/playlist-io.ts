import type { UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { formatTrackCount } from '@/lib/format';
import { addTracksToPlaylist, createPlaylist, updatePlaylist } from '@/lib/mss-library';
import { downloadKey, useDownloadsStore } from '@/store/downloads-store';

export function externalUrl(track: UnifiedTrack): string | null {
  if (track.source === 'yandex') {
    return track.albumId
      ? `https://music.yandex.ru/album/${track.albumId}/track/${track.id}`
      : `https://music.yandex.ru/track/${track.id}`;
  }
  if (track.source === 'spotify') return `https://open.spotify.com/track/${track.id}`;
  return null;
}

/** Скачанный файл, если есть; иначе ссылка на трек (для MSS — на поток сервера, для сервисов — на их страницу). */
function trackLocation(track: UnifiedTrack & { streamUrl?: string }): string | null {
  const downloaded = useDownloadsStore.getState().items[downloadKey(track)];
  if (downloaded) return downloaded.path;
  if (track.source === 'local') return new URL(track.streamUrl ?? `/api/stream/${track.id}`, location.href).href;
  return externalUrl(track);
}

export function buildM3u8(name: string, tracks: UnifiedTrack[]): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
  for (const t of tracks) {
    const loc = trackLocation(t);
    if (!loc) continue;
    const seconds = t.durationMs ? Math.round(t.durationMs / 1000) : -1;
    lines.push(`#EXTINF:${seconds},${t.artist} - ${t.title}`.replace(/[\r\n]+/g, ' '));
    if (t.album) lines.push(`#EXTALB:${t.album}`.replace(/[\r\n]+/g, ' '));
    lines.push(loc);
  }
  return `${lines.join('\n')}\n`;
}

export async function exportM3u8(name: string, tracks: UnifiedTrack[]): Promise<void> {
  if (!tracks.length) {
    toast.error('В плейлисте нет треков');
    return;
  }
  try {
    const saved = await window.electronAPI.system.saveTextFile(`${name}.m3u8`, buildM3u8(name, tracks), [
      { name: 'Плейлист M3U8', extensions: ['m3u8'] },
    ]);
    if (saved) toast(`Плейлист сохранён: ${saved}`);
  } catch (e) {
    toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Копирует внешний плейлист в новый плейлист MSS: на сервер уходят только метаданные треков. */
export async function importToMss(
  source: { title: string; description?: string; owner?: string },
  tracks: UnifiedTrack[],
): Promise<string | null> {
  if (!tracks.length) {
    toast.error('В плейлисте нет треков');
    return null;
  }
  const pending = toast.loading(`Импортируем «${source.title}»…`);
  try {
    const playlist = await createPlaylist(source.title.slice(0, 200));
    if (source.description || source.owner) {
      await updatePlaylist(playlist.id, {
        description: source.description?.slice(0, 2000) || undefined,
        author: source.owner?.slice(0, 200) || undefined,
      });
    }
    const count = await addTracksToPlaylist(playlist, tracks, { silent: true });
    toast.success(`Импортировано ${formatTrackCount(count)} в «${playlist.name}»`, { id: pending });
    return playlist.id;
  } catch (e) {
    toast.error(`Импорт не удался: ${e instanceof Error ? e.message : String(e)}`, { id: pending });
    return null;
  }
}
