import fs from 'node:fs';
import { ipcMain } from 'electron';
import type { SourceId, TrackLyrics } from '@mss/shared';
import { fetchSpotifyLyrics } from '@mss/stream-connectors';
import { getYandex } from './connectors.js';
import { readCachedJson, writeCachedJson } from './content-cache.js';
import { downloadPathFor } from './downloads.js';
import { readSidecarLyrics, writeSidecarFromLyrics } from './lyrics-sidecar.js';
import { resolveLocalTrackPath } from './local-tracks.js';
import { listOffline } from './offline-store.js';
import { spotifySpclient } from './spotify-session.js';

const LYRICS_SOURCES = new Set<SourceId>(['yandex', 'spotify', 'local']);

async function localAudioPath(trackId: string): Promise<string | null> {
  const fromIndex = await resolveLocalTrackPath(trackId);
  if (fromIndex) return fromIndex;
  const downloaded = downloadPathFor('local', trackId);
  if (downloaded) return downloaded;
  const offline = listOffline().find((row) => row.trackId === trackId);
  if (offline?.path && fs.existsSync(offline.path)) return offline.path;
  return null;
}

async function lyricsForSource(source: SourceId, trackId: string): Promise<TrackLyrics | null> {
  switch (source) {
    case 'yandex':
      return getYandex().api.lyrics(trackId);
    case 'spotify':
      return fetchSpotifyLyrics(spotifySpclient, trackId);
    case 'local': {
      const audioPath = await localAudioPath(trackId);
      return audioPath ? readSidecarLyrics(audioPath) : null;
    }
    default:
      return null;
  }
}

async function sidecarBesideDownload(source: SourceId, trackId: string): Promise<TrackLyrics | null> {
  const downloaded = downloadPathFor(source, trackId);
  if (!downloaded) return null;
  return readSidecarLyrics(downloaded);
}

export function registerTrackLyricsIpc(): void {
  ipcMain.handle('lyrics:get', async (_e, source: SourceId, trackId: string) => {
    if (!LYRICS_SOURCES.has(source) || !trackId) return null;
    const besideDownload = await sidecarBesideDownload(source, trackId);
    if (besideDownload) return besideDownload;
    if (source === 'local') return lyricsForSource(source, trackId);
    const key = `${source}:${trackId}`;
    const cached = await readCachedJson<TrackLyrics>('lyrics', key);
    if (cached) {
      const downloaded = downloadPathFor(source, trackId);
      if (downloaded) await writeSidecarFromLyrics(downloaded, cached).catch(() => undefined);
      return cached;
    }
    const lyrics = await lyricsForSource(source, trackId);
    if (lyrics?.lines.length) {
      await writeCachedJson('lyrics', key, lyrics);
      const downloaded = downloadPathFor(source, trackId);
      if (downloaded) await writeSidecarFromLyrics(downloaded, lyrics).catch(() => undefined);
    }
    return lyrics;
  });
}
