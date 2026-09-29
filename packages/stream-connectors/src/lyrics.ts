import type { LyricsLine } from '@mss/shared';

export function parseLrc(lrc: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
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
