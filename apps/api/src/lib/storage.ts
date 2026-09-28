import { config } from '../config.js';
import {
  deleteObjectLocal,
  ensureBucketsLocal,
  getObjectFullLocal,
  putObjectLocal,
} from './local-storage.js';
import {
  deleteObject as deleteObjectS3,
  ensureBuckets as ensureBucketsS3,
  getObjectFull as getObjectFullS3,
  putObject as putObjectS3,
} from './minio.js';

const useLocal = config.storageBackend === 'local';

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

export async function deleteObject(bucket: string, key: string): Promise<void> {
  if (useLocal) return deleteObjectLocal(bucket, key);
  return deleteObjectS3(bucket, key);
}

export async function getObjectFull(bucket: string, key: string): Promise<Buffer> {
  if (useLocal) return getObjectFullLocal(bucket, key);
  return getObjectFullS3(bucket, key);
}
