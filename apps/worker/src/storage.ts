import fs from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromRoot } from './env.js';

const backend = process.env.STORAGE_BACKEND ?? 'local';
const localRoot = fromRoot(process.env.LOCAL_STORAGE_PATH ?? './data/object-store');

const s3 =
  backend === 's3'
    ? new S3Client({
        region: 'us-east-1',
        endpoint: `http://${process.env.MINIO_ENDPOINT ?? 'localhost'}:${process.env.MINIO_PORT ?? 9000}`,
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
