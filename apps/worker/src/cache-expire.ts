import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { fromRoot } from './env.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://mss:mss@localhost:5432/mss';
const backend = process.env.STORAGE_BACKEND ?? 'local';
const localRoot = fromRoot(process.env.LOCAL_STORAGE_PATH ?? './data/object-store');
const bucket = process.env.MINIO_BUCKET_TRACKS ?? 'tracks';
const coversBucket = process.env.MINIO_BUCKET_COVERS ?? 'covers';

const pool = new pg.Pool({ connectionString: databaseUrl });

async function deleteLocalObject(bucketName: string, key: string): Promise<void> {
  await fs.rm(path.join(localRoot, bucketName, key), { force: true });
}

export async function expireEphemeralCaches(): Promise<number> {
  const { rows } = await pool.query<{
    id: string;
    storage_key_master: string | null;
    cover_storage_key: string | null;
  }>(
    `SELECT id, storage_key_master, cover_storage_key FROM tracks
     WHERE cache_expires_at IS NOT NULL AND cache_expires_at < NOW()`,
  );
  if (!rows.length) return 0;

  for (const row of rows) {
    try {
      if (backend === 'local') {
        if (row.storage_key_master) await deleteLocalObject(bucket, row.storage_key_master);
        if (row.cover_storage_key) await deleteLocalObject(coversBucket, row.cover_storage_key);
      }
      // S3 cleanup можно добавить позже; relay в dev использует local storage.
    } catch (e) {
      console.warn('Cache expire storage delete failed', row.id, e);
    }
    await pool.query(
      `UPDATE tracks SET
        status = 'registered',
        storage_key_master = NULL,
        cover_storage_key = NULL,
        codec = NULL,
        bitrate_kbps = NULL,
        mime_type = NULL,
        cache_expires_at = NULL
      WHERE id = $1`,
      [row.id],
    );
  }
  console.log(`Expired ephemeral cache for ${rows.length} track(s)`);
  return rows.length;
}

export function startCacheExpireLoop(intervalMs = 15 * 60_000): void {
  const tick = () => void expireEphemeralCaches().catch((e) => console.warn('cache.expire', e));
  tick();
  setInterval(tick, intervalMs);
}
