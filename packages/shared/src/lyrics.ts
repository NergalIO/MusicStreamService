import type { TrackLyrics } from './types.js';

export type LyricsSidecar = { format: 'lrc' | 'txt'; text: string };

export function formatLrcStamp(ms: number): string {
  const clamped = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const m = Math.floor(clamped / 60_000);
  const s = (clamped % 60_000) / 1000;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Содержимое .lrc / .txt рядом с аудиофайлом — так текст уезжает вместе со скачанным треком. */
export function lyricsToSidecar(lyrics: TrackLyrics | null | undefined): LyricsSidecar | null {
  if (!lyrics?.lines.some((l) => l.text.trim())) return null;
  if (lyrics.synced && lyrics.lines.some((l) => l.timeMs >= 0)) {
    return {
      format: 'lrc',
      text: lyrics.lines.map((l) => `[${formatLrcStamp(l.timeMs)}]${l.text}`).join('\n'),
    };
  }
  return { format: 'txt', text: lyrics.lines.map((l) => l.text).join('\n') };
}
