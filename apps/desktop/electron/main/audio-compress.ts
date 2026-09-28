import { spawn } from 'node:child_process';

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
let available: Promise<boolean> | null = null;

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderr.trim()}`));
    });
  });
}

export function isFfmpegAvailable(): Promise<boolean> {
  available ??= run(['-hide_banner', '-version']).then(
    () => true,
    () => false,
  );
  return available;
}

/**
 * Сжимать есть смысл только lossless или заметно более «толстые» файлы:
 * перекодирование MP3 320 → AAC 256 почти не экономит место, но теряет качество.
 */
export function shouldCompress(codec: string, bitrate: number | undefined, kbps: number): boolean {
  if (!kbps) return false;
  if (codec.includes('flac')) return true;
  return !!bitrate && bitrate > kbps + 32;
}

/** Перекодирует в AAC (.m4a), сохраняя теги и встроенную обложку исходного файла. */
export async function compressToAac(input: string, output: string, kbps: number): Promise<void> {
  await run([
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-i',
    input,
    '-map',
    '0:a:0',
    '-map',
    '0:v:0?',
    '-map_metadata',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    `${kbps}k`,
    '-c:v',
    'copy',
    '-disposition:v:0',
    'attached_pic',
    '-movflags',
    '+faststart',
    '-f',
    'ipod',
    output,
  ]);
}
