import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import type { LyricsSidecar, TrackLyrics } from '@mss/shared';
import { lyricsToSidecar } from '@mss/shared';
import { parseLrc } from '@mss/stream-connectors';

function sidecarPaths(audioPath: string): { lrc: string; txt: string } {
  const base = audioPath.replace(/\.[^.]+$/, '');
  return { lrc: `${base}.lrc`, txt: `${base}.txt` };
}

export async function readSidecarLyrics(filePath: string): Promise<TrackLyrics | null> {
  const { lrc, txt } = sidecarPaths(filePath);
  try {
    const text = await fsPromises.readFile(lrc, 'utf8');
    const lines = parseLrc(text);
    if (lines.length) return { synced: true, lines };
  } catch {
    /* нет .lrc */
  }
  try {
    const text = await fsPromises.readFile(txt, 'utf8');
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

export async function writeSidecarLyrics(audioPath: string, lyrics?: LyricsSidecar | null): Promise<void> {
  const sidecar = lyrics?.text.trim() ? lyrics : null;
  if (!sidecar) return;
  const { lrc, txt } = sidecarPaths(audioPath);
  const target = sidecar.format === 'lrc' ? lrc : txt;
  const other = sidecar.format === 'lrc' ? txt : lrc;
  await fsPromises.writeFile(target, sidecar.text, 'utf8');
  await fsPromises.rm(other, { force: true });
}

export async function writeSidecarFromLyrics(audioPath: string, lyrics: TrackLyrics | null): Promise<void> {
  await writeSidecarLyrics(audioPath, lyricsToSidecar(lyrics));
}

export function removeSidecarLyrics(audioPath: string): void {
  const { lrc, txt } = sidecarPaths(audioPath);
  fs.rmSync(lrc, { force: true });
  fs.rmSync(txt, { force: true });
}

export async function moveSidecarLyrics(fromAudio: string, toAudio: string): Promise<void> {
  if (fromAudio.replace(/\.[^.]+$/, '') === toAudio.replace(/\.[^.]+$/, '')) return;
  const from = sidecarPaths(fromAudio);
  const to = sidecarPaths(toAudio);
  for (const ext of ['lrc', 'txt'] as const) {
    try {
      await fsPromises.rename(from[ext], to[ext]);
    } catch {
      /* нет файла */
    }
  }
}
