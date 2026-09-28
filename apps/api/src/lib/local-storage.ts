import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

function objectPath(bucket: string, key: string): string {
  return path.join(config.localStoragePath, bucket, key);
}

export async function ensureBucketsLocal(): Promise<void> {
  for (const bucket of [config.minio.bucketTracks, config.minio.bucketCovers]) {
    await fs.mkdir(path.join(config.localStoragePath, bucket), { recursive: true });
  }
}

export async function putObjectLocal(
  bucket: string,
  key: string,
  body: Buffer,
  _contentType?: string,
): Promise<void> {
  const file = objectPath(bucket, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function deleteObjectLocal(bucket: string, key: string): Promise<void> {
  const file = objectPath(bucket, key);
  await fs.rm(file, { force: true });
  // Папка трека (tracks/<id>/) остаётся пустой; rmdir падает, если в ней ещё что-то есть.
  await fs.rmdir(path.dirname(file)).catch(() => {});
}

export async function getObjectFullLocal(bucket: string, key: string): Promise<Buffer> {
  return fs.readFile(objectPath(bucket, key));
}
