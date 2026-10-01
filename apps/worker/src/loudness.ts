import { runProcess } from './run-process.js';

/** Интегральная громкость по EBU R128 (LUFS) или null, если ffmpeg не смог её посчитать. */
export async function measureLoudness(ffmpeg: string, file: string): Promise<number | null> {
  const log = await runProcess(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-map',
    '0:a:0',
    '-af',
    'ebur128=framelog=quiet',
    '-f',
    'null',
    '-',
  ], { timeoutMs: 15 * 60 * 1000 });
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const match = /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(summary);
  const value = match ? Number(match[1]) : NaN;
  // −70 LUFS — порог тишины у ebur128: такой результат означает, что звука нет.
  return Number.isFinite(value) && value > -70 ? value : null;
}
