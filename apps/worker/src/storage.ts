import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromRoot } from './env.js';

const backend = process.env.STORAGE_BACKEND ?? 'local';
const localRoot = fromRoot(process.env.LOCAL_STORAGE_PATH ?? './data/object-store');
const useSsl = process.env.MINIO_USE_SSL === 'true';
const host = process.env.MINIO_ENDPOINT ?? 'localhost';
const port = Number(process.env.MINIO_PORT ?? 9000);
const region = process.env.MINIO_REGION ?? 'us-east-1';

function endpointUrl(): string {
  const scheme = useSsl ? 'https' : 'http';
  if ((useSsl && port === 443) || (!useSsl && port === 80)) return `${scheme}://${host}`;
  return `${scheme}://${host}:${port}`;
}

const s3 =
  backend === 's3'
    ? new S3Client({
        region,
        endpoint: endpointUrl(),
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio',
          secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio12345',
        },
      })
    : null;

/** Копирует объект хранилища во временный файл, чтобы отдать его ffmpeg. */
export async function downloadObject(bucket: string, key: string, target: string): Promise<void> {
  if (backend === 'local') {
    await fs.copyFile(path.join(localRoot, bucket, key), target);
    return;
  }
  const res = await s3!.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  await fs.writeFile(target, bytes);
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  if (backend === 'local') {
    const file = path.join(localRoot, bucket, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    return;
  }
  await s3!.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  if (backend === 'local') {
    await fs.rm(path.join(localRoot, bucket, key), { force: true });
    return;
  }
  await s3!.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
