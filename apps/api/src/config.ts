import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** Корень монорепо: API и воркер запускаются из разных папок, но делят .env, хранилище и папку загрузок. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(ROOT, '.env') });

const fromRoot = (p: string) => path.resolve(ROOT, p);

export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '/') return '';
  let p = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function loadTls(): { cert: Buffer; key: Buffer } | undefined {
  const certPath = process.env.TLS_CERT_PATH?.trim();
  const keyPath = process.env.TLS_KEY_PATH?.trim();
  if (!certPath || !keyPath) return undefined;
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return undefined;
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

const basePath = normalizeBasePath(process.env.PUBLIC_BASE_PATH);
const tls = loadTls();
const publicUrlRaw = (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export const config = {
  root: ROOT,
  port: Number(process.env.API_PORT ?? 3001),
  basePath,
  publicUrl: publicUrlRaw,
  tls,
  httpsEnabled: tls !== undefined,
  publicDir: fromRoot('apps/api/public'),
  releasesDir: fromRoot(process.env.RELEASES_DIR ?? './data/releases'),
  releaseFiles: {
    windows: process.env.RELEASE_WINDOWS_FILE ?? 'MusicStreamService-setup.exe',
    android: process.env.RELEASE_ANDROID_FILE ?? 'mss-android.apk',
  },
  /** owner/repo — для ссылок на GitHub Releases (лендинг) */
  githubRepo: process.env.GITHUB_REPO ?? '',
  githubToken: process.env.GITHUB_TOKEN ?? '',
  githubReleaseExeName: process.env.GITHUB_RELEASE_EXE_NAME ?? 'MusicStreamService-setup.exe',
  githubReleaseApkName: process.env.GITHUB_RELEASE_APK_NAME ?? 'mss-android.apk',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://mss:mss@localhost:5432/mss',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  offlineHkdfSecret: process.env.OFFLINE_HKDF_SECRET ?? 'offline-dev-secret',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  /** local — файлы на диске (без Docker MinIO); s3 — MinIO / совместимое S3 */
  storageBackend: (process.env.STORAGE_BACKEND ?? 'local') as 'local' | 's3',
  localStoragePath: fromRoot(process.env.LOCAL_STORAGE_PATH ?? './data/object-store'),
  minio: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSsl: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? 'minio',
    secretKey: process.env.MINIO_SECRET_KEY ?? 'minio12345',
    bucketTracks: process.env.MINIO_BUCKET_TRACKS ?? 'tracks',
    bucketCovers: process.env.MINIO_BUCKET_COVERS ?? 'covers',
  },
  uploadTmpDir: fromRoot(process.env.UPLOAD_TMP_DIR ?? './tmp/uploads'),
  transcodeBitrateKbps: Number(process.env.TRANSCODE_BITRATE_KBPS ?? 112),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  allowServerUpload: process.env.ALLOW_SERVER_UPLOAD === 'true',
  relayCacheTtlHours: Number(process.env.RELAY_CACHE_TTL_HOURS ?? 48),
  relayWaitMs: Number(process.env.RELAY_WAIT_MS ?? 120_000),
  presenceTtlSec: Number(process.env.PRESENCE_TTL_SEC ?? 90),
};
