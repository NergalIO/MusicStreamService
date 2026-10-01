import type { TrackLyrics } from '@mss/shared';

export const LYRICS_MAX_BYTES = 512 * 1024;

export type LyricsFormat = 'lrc' | 'txt';

export function lyricsObjectKey(trackId: string, format: LyricsFormat): string {
  return `tracks/${trackId}/lyrics.${format}`;
}

export function formatFromKey(key: string): LyricsFormat {
  return key.endsWith('.lrc') ? 'lrc' : 'txt';
}

export function parseLrc(lrc: string): TrackLyrics['lines'] {
  const lines: TrackLyrics['lines'] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      lines.push({ timeMs: Math.round((Number(s[1]) * 60 + Number(s[2])) * 1000), text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

export function parseLyricsFile(format: LyricsFormat, text: string): TrackLyrics | null {
  if (format === 'lrc') {
    const lines = parseLrc(text);
    if (!lines.length) return null;
    return { synced: true, lines };
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ timeMs: -1, text: line }));
  if (!lines.length) return null;
  return { synced: false, lines };
}

export function detectLyricsFormat(text: string): LyricsFormat {
  return parseLrc(text).length ? 'lrc' : 'txt';
}
