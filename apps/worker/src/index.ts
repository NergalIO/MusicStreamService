import './env.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'bullmq';
import { measureLoudness } from './loudness.js';
import { downloadObject, putObject } from './storage.js';
import { runProcess } from './run-process.js';
import pg from 'pg';
import { parseFile } from 'music-metadata';
import { startCacheExpireLoop } from './cache-expire.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://mss:mss@localhost:5432/mss';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const bitrate = Number(process.env.TRANSCODE_BITRATE_KBPS ?? 112);
const pool = new pg.Pool({ connectionString: databaseUrl });

const bucket = process.env.MINIO_BUCKET_TRACKS ?? 'tracks';
const coversBucket = process.env.MINIO_BUCKET_COVERS ?? 'covers';

interface TranscodeJob {
  trackId: string;
  inputPath?: string;
  originalKey?: string;
  fallback?: { title: string; artist: string };
}

function lyricsFromMetadata(meta: { common?: { lyrics?: unknown } } | null): { format: 'lrc' | 'txt'; text: string } | null {
  const raw = meta?.common?.lyrics;
  const items = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) return { format: 'txt', text: item.trim() };
    if (!item || typeof item !== 'object') continue;
    const rec = item as { text?: unknown; syncText?: unknown };
    if (Array.isArray(rec.syncText) && rec.syncText.length) {
      const lines: string[] = [];
      for (const row of rec.syncText) {
        if (!row || typeof row !== 'object') continue;
        const text = String((row as { text?: string }).text ?? '').trim();
        const t = Number((row as { timestamp?: number; time?: number }).timestamp ?? (row as { time?: number }).time);
        if (!text) continue;
        if (!Number.isFinite(t) || t < 0) {
          lines.push(text);
          continue;
        }
        const sec = t > 10_000 ? t / 1000 : t;
        const mm = Math.floor(sec / 60);
        const ss = (sec % 60).toFixed(2).padStart(5, '0');
        lines.push(`[${String(mm).padStart(2, '0')}:${ss}]${text}`);
      }
      if (lines.length) return { format: lines[0].startsWith('[') ? 'lrc' : 'txt', text: lines.join('\n') };
    }
    if (typeof rec.text === 'string' && rec.text.trim()) return { format: 'txt', text: rec.text.trim() };
  }
  return null;
}

async function processJob({ trackId, inputPath, originalKey, fallback }: TranscodeJob) {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mss-transcode-'));
  const sourcePath = originalKey ? path.join(workRoot, 'original') : inputPath;
  if (!sourcePath) throw new Error('Нет исходного файла для транскода');
  if (originalKey) await downloadObject(bucket, originalKey, sourcePath);

  const outDir = path.join(workRoot, `out-${trackId}`);
  await fs.mkdir(outDir, { recursive: true });
  const masterPath = path.join(outDir, 'master.ogg');

  const meta = await parseFile(sourcePath).catch(() => null);

  await runProcess(ffmpeg, [
    '-y',
    '-i',
    sourcePath,
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'libopus',
    '-b:a',
    `${bitrate}k`,
    '-f',
    'ogg',
    masterPath,
  ]);

  const title = meta?.common.title?.trim() || fallback?.title || 'Без названия';
  const artist =
    meta?.common.artist?.trim() || meta?.common.artists?.join(', ') || fallback?.artist || 'Неизвестный исполнитель';
  const album = meta?.common.album?.trim() || null;
  const duration = meta?.format.duration ?? (await parseFile(masterPath)).format.duration;
  const durationMs = duration ? Math.round(duration * 1000) : null;

  const loudness = await measureLoudness(ffmpeg, masterPath).catch((e) => {
    console.warn('Loudness measurement failed', trackId, e);
    return null;
  });

  const masterBuf = await fs.readFile(masterPath);
  const storageKey = `tracks/${trackId}/master.ogg`;
  await putObject(bucket, storageKey, masterBuf, 'audio/ogg');

  let coverKey: string | null = null;
  const picture = meta?.common.picture?.[0];
  if (picture) {
    coverKey = `covers/${trackId}.jpg`;
    await putObject(coversBucket, coverKey, Buffer.from(picture.data), picture.format);
  }

  let lyricsKey: string | null = null;
  const embedded = lyricsFromMetadata(meta);
  if (embedded) {
    lyricsKey = `tracks/${trackId}/lyrics.${embedded.format}`;
    await putObject(bucket, lyricsKey, Buffer.from(embedded.text, 'utf8'), 'text/plain; charset=utf-8');
  }

  await pool.query(
    `UPDATE tracks SET
      title = $1, artist = $2, album = $3, duration_ms = $4,
      status = 'ready', codec = 'opus', bitrate_kbps = $5,
      mime_type = 'audio/ogg', storage_key_master = $6,
      cover_storage_key = COALESCE($7, cover_storage_key), loudness_lufs = $8,
      cache_expires_at = NULL,
      storage_key_lyrics = COALESCE(storage_key_lyrics, $10)
    WHERE id = $9`,
    [title, artist, album, durationMs, bitrate, storageKey, coverKey, loudness, trackId, lyricsKey],
  );

  if (inputPath && !originalKey) await fs.unlink(inputPath).catch(() => {});
  await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
}

const worker = new Worker(
  'track.transcode',
  async (job) => {
    await processJob(job.data as TranscodeJob);
  },
  { connection: { url: redisUrl } },
);

worker.on('failed', async (job, err) => {
  console.error('Job failed', job?.id, err);
  const data = job?.data as Partial<TranscodeJob> | undefined;
  if (data?.trackId) {
    await pool.query(`UPDATE tracks SET status = 'failed' WHERE id = $1`, [data.trackId]);
  }
  if (data?.inputPath) await fs.unlink(data.inputPath).catch(() => {});
});

/** Досчитывает громкость треков, загруженных до появления нормализации. */
async function backfillLoudness(): Promise<void> {
  const { rows } = await pool.query<{ id: string; storage_key_master: string }>(
    `SELECT id, storage_key_master FROM tracks
     WHERE status = 'ready' AND loudness_lufs IS NULL AND storage_key_master IS NOT NULL
     ORDER BY created_at DESC LIMIT 1000`,
  );
  if (!rows.length) return;
  console.log(`Measuring loudness for ${rows.length} existing tracks`);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mss-loudness-'));
  let done = 0;
  for (const row of rows) {
    const file = path.join(tmpDir, `${row.id}.ogg`);
    try {
      await downloadObject(bucket, row.storage_key_master, file);
      const lufs = await measureLoudness(ffmpeg, file);
      // −99 помечает «измерить не удалось», чтобы не пытаться снова на каждом старте.
      await pool.query(`UPDATE tracks SET loudness_lufs = $1 WHERE id = $2`, [lufs ?? -99, row.id]);
      done += 1;
    } catch (e) {
      console.warn('Loudness backfill failed', row.id, e instanceof Error ? e.message : e);
    } finally {
      await fs.unlink(file).catch(() => {});
    }
  }
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  console.log(`Loudness measured for ${done}/${rows.length} tracks`);
}

console.log('Transcode worker running');
void backfillLoudness().catch((e) => console.warn('Loudness backfill stopped', e));
startCacheExpireLoop();
