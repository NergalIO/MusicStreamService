import { Readable } from 'node:stream';
import { config } from '../config.js';
import { localObjectUrl } from './object-access.js';
import {
  deleteObjectLocal,
  ensureBucketsLocal,
  getObjectFullLocal,
  getObjectRangeLocal,
  headObjectLocal,
  putObjectLocal,
  putObjectStreamLocal,
} from './local-storage.js';
import {
  deleteObject as deleteObjectS3,
  ensureBuckets as ensureBucketsS3,
  getObjectFull as getObjectFullS3,
  getObjectRange as getObjectRangeS3,
  headObject as headObjectS3,
  presignGet as presignGetS3,
  presignPut as presignPutS3,
  putObject as putObjectS3,
} from './minio.js';

const useLocal = config.storageBackend === 'local';

export const CLOUD_GET_TTL_SEC = 6 * 24 * 60 * 60;
export const CLOUD_PUT_TTL_SEC = 60 * 60;

export async function ensureBuckets(): Promise<void> {
  if (useLocal) return ensureBucketsLocal();
  return ensureBucketsS3();
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  if (useLocal) return putObjectLocal(bucket, key, body, contentType);
  return putObjectS3(bucket, key, body, contentType);
}

export async function putObjectStream(bucket: string, key: string, body: Readable): Promise<void> {
  if (useLocal) return putObjectStreamLocal(bucket, key, body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  await putObjectS3(bucket, key, Buffer.concat(chunks));
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  if (useLocal) return deleteObjectLocal(bucket, key);
  return deleteObjectS3(bucket, key);
}

export async function getObjectFull(bucket: string, key: string): Promise<Buffer> {
  if (useLocal) return getObjectFullLocal(bucket, key);
  return getObjectFullS3(bucket, key);
}

export async function headObject(bucket: string, key: string): Promise<{ size: number; contentType?: string }> {
  if (useLocal) return headObjectLocal(bucket, key);
  return headObjectS3(bucket, key);
}

export async function getObjectRange(
  bucket: string,
  key: string,
  start: number,
  end: number,
): Promise<{ body: AsyncIterable<Uint8Array>; contentLength: number; totalSize: number; contentType?: string }> {
  if (useLocal) return getObjectRangeLocal(bucket, key, start, end);
  return getObjectRangeS3(bucket, key, start, end);
}

export async function presignPut(bucket: string, key: string, contentType?: string): Promise<string> {
  if (useLocal) return localObjectUrl('PUT', bucket, key, CLOUD_PUT_TTL_SEC);
  return presignPutS3(bucket, key, CLOUD_PUT_TTL_SEC, contentType);
}

export async function presignGet(
  bucket: string,
  key: string,
  opts?: { contentDisposition?: string; contentType?: string; expiresIn?: number },
): Promise<string> {
  const ttl = opts?.expiresIn ?? CLOUD_GET_TTL_SEC;
  if (useLocal) return localObjectUrl('GET', bucket, key, ttl);
  return presignGetS3(bucket, key, ttl, opts);
}
