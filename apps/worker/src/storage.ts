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
const coversBucket = process.env.MINIO_BUCKET_COVERS ?? 'covers';

function envTrim(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function endpointUrl(): string {
  const scheme = useSsl ? 'https' : 'http';
  if ((useSsl && port === 443) || (!useSsl && port === 80)) return `${scheme}://${host}`;
  return `${scheme}://${host}:${port}`;
}

function makeClient(accessKeyId: string, secretAccessKey: string): S3Client {
  return new S3Client({
    region,
    endpoint: endpointUrl(),
    forcePathStyle: true,
    maxAttempts: 2,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const sharedAccess = envTrim('MINIO_ACCESS_KEY') ?? 'minio';
const sharedSecret = envTrim('MINIO_SECRET_KEY') ?? 'minio12345';

const s3Tracks =
  backend === 's3'
    ? makeClient(envTrim('MINIO_ACCESS_KEY_TRACKS') ?? sharedAccess, envTrim('MINIO_SECRET_KEY_TRACKS') ?? sharedSecret)
    : null;
const s3Covers =
  backend === 's3'
    ? makeClient(envTrim('MINIO_ACCESS_KEY_COVERS') ?? sharedAccess, envTrim('MINIO_SECRET_KEY_COVERS') ?? sharedSecret)
    : null;

function clientFor(bucket: string): S3Client {
  const client = bucket === coversBucket ? s3Covers : s3Tracks;
  if (!client) throw new Error('S3 client not configured');
  return client;
}

/** Копирует объект хранилища во временный файл, чтобы отдать его ffmpeg. */
export async function downloadObject(bucket: string, key: string, target: string): Promise<void> {
  if (backend === 'local') {
    await fs.copyFile(path.join(localRoot, bucket, key), target);
    return;
  }
  const res = await clientFor(bucket).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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
  await clientFor(bucket).send(
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
  await clientFor(bucket).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
