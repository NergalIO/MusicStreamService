import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
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

export async function putObjectStreamLocal(bucket: string, key: string, body: Readable): Promise<void> {
  const file = objectPath(bucket, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await pipeline(body, (await import('node:fs')).createWriteStream(file));
}

export async function deleteObjectLocal(bucket: string, key: string): Promise<void> {
  const file = objectPath(bucket, key);
  await fs.rm(file, { force: true });
  await fs.rmdir(path.dirname(file)).catch(() => {});
}

export async function getObjectFullLocal(bucket: string, key: string): Promise<Buffer> {
  return fs.readFile(objectPath(bucket, key));
}

export async function headObjectLocal(bucket: string, key: string): Promise<{ size: number }> {
  const st = await fs.stat(objectPath(bucket, key));
  return { size: st.size };
}

export async function getObjectRangeLocal(
  bucket: string,
  key: string,
  start: number,
  end: number,
): Promise<{ body: AsyncIterable<Uint8Array>; contentLength: number; totalSize: number }> {
  const file = objectPath(bucket, key);
  const st = await fs.stat(file);
  const total = st.size;
  const from = Math.max(0, Math.min(start, total));
  const to = Math.max(from, Math.min(end, total - 1));
  const stream = createReadStream(file, { start: from, end: to });
  return {
    body: stream as unknown as AsyncIterable<Uint8Array>,
    contentLength: total === 0 ? 0 : to - from + 1,
    totalSize: total,
  };
}
