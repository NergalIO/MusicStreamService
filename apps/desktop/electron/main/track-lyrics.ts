import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { ipcMain } from 'electron';
import type { SourceId, TrackLyrics } from '@mss/shared';
import { fetchSpotifyLyrics, parseLrc } from '@mss/stream-connectors';
import { getYandex } from './connectors.js';
import { downloadPathFor } from './downloads.js';
import { resolveLocalTrackPath } from './local-tracks.js';
import { listOffline } from './offline-store.js';
import { spotifySpclient } from './spotify-pathfinder.js';
import { isSpotifyLoggedIn } from './spotify-web-session.js';

const LYRICS_SOURCES = new Set<SourceId>(['yandex', 'spotify', 'local']);

async function readSidecarLyrics(filePath: string): Promise<TrackLyrics | null> {
  const base = filePath.replace(/\.[^.]+$/, '');
  const lrcPath = `${base}.lrc`;
  try {
    const lrc = await fsPromises.readFile(lrcPath, 'utf8');
    const lines = parseLrc(lrc);
    if (lines.length) return { synced: true, lines };
  } catch {
    /* нет .lrc */
  }
  const txtPath = `${base}.txt`;
  try {
    const text = await fsPromises.readFile(txtPath, 'utf8');
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ timeMs: -1, text: line }));
    if (lines.length) return { synced: false, lines };
  } catch {
    /* нет .txt */
  }
  return null;
}

async function localAudioPath(trackId: string): Promise<string | null> {
  const fromIndex = await resolveLocalTrackPath(trackId);
  if (fromIndex) return fromIndex;
  const downloaded = downloadPathFor('local', trackId);
  if (downloaded) return downloaded;
  const offline = listOffline().find((row) => row.trackId === trackId);
  if (offline?.path && fs.existsSync(offline.path)) return offline.path;
  return null;
}

async function lyricsForLocal(trackId: string): Promise<TrackLyrics | null> {
  const audioPath = await localAudioPath(trackId);
  if (!audioPath) return null;
  return readSidecarLyrics(audioPath);
}

async function lyricsForSource(source: SourceId, trackId: string): Promise<TrackLyrics | null> {
  switch (source) {
    case 'yandex':
      return getYandex().api.lyrics(trackId);
    case 'spotify':
      if (!isSpotifyLoggedIn()) return null;
      return fetchSpotifyLyrics(spotifySpclient, trackId);
    case 'local':
      return lyricsForLocal(trackId);
    default:
      return null;
  }
}

export function registerTrackLyricsIpc(): void {
  ipcMain.handle('lyrics:get', async (_e, source: SourceId, trackId: string) => {
    if (!LYRICS_SOURCES.has(source) || !trackId) return null;
    return lyricsForSource(source, trackId);
  });
}
