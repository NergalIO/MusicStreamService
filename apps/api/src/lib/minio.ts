import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import { s3EndpointUrl } from './s3-endpoint.js';

const endpoint = s3EndpointUrl(config.minio.endpoint, config.minio.port, config.minio.useSsl);

function makeClient(accessKeyId: string, secretAccessKey: string): S3Client {
  return new S3Client({
    region: config.minio.region,
    endpoint,
    forcePathStyle: true,
    maxAttempts: 2,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const s3Tracks = makeClient(config.minio.accessKeyTracks, config.minio.secretKeyTracks);
const s3Covers = makeClient(config.minio.accessKeyCovers, config.minio.secretKeyCovers);

function clientFor(bucket: string): S3Client {
  return bucket === config.minio.bucketCovers ? s3Covers : s3Tracks;
}

export async function ensureBuckets(): Promise<void> {
  const failures: string[] = [];
  for (const bucket of [config.minio.bucketTracks, config.minio.bucketCovers]) {
    try {
      await clientFor(bucket).send(new HeadBucketCommand({ Bucket: bucket }), {
        abortSignal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`«${bucket}»: ${message}`);
    }
  }
  if (failures.length) {
    throw new Error(
      `S3-бакет недоступен (${failures.join('; ')}). Создайте его в панели Beget — CreateBucket через API не поддерживается.`,
    );
  }
}

const TRANSFER_MS = 15 * 60 * 1000;
const QUICK_MS = 30_000;

export async function putObject(bucket: string, key: string, body: Buffer, contentType?: string) {
  await clientFor(bucket).send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
    { abortSignal: AbortSignal.timeout(TRANSFER_MS) },
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await clientFor(bucket).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(QUICK_MS),
  });
}

export async function headObject(bucket: string, key: string): Promise<{ size: number; contentType?: string }> {
  const res = await clientFor(bucket).send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(QUICK_MS),
  });
  return { size: res.ContentLength ?? 0, contentType: res.ContentType };
}

export async function getObjectRange(
  bucket: string,
  key: string,
  start: number,
  end: number,
): Promise<{ body: AsyncIterable<Uint8Array>; contentLength: number; totalSize: number; contentType?: string }> {
  const res = await clientFor(bucket).send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${start}-${end}`,
    }),
    { abortSignal: AbortSignal.timeout(TRANSFER_MS) },
  );
  const total = Number(res.ContentRange?.split('/')[1] ?? res.ContentLength ?? 0);
  const len = Number(res.ContentLength ?? end - start + 1);
  return {
    body: res.Body as AsyncIterable<Uint8Array>,
    contentLength: len,
    totalSize: total,
    contentType: res.ContentType,
  };
}

export async function getObjectFull(bucket: string, key: string): Promise<Buffer> {
  const res = await clientFor(bucket).send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(TRANSFER_MS),
  });
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function presignPut(
  bucket: string,
  key: string,
  expiresIn: number,
  contentType?: string,
): Promise<string> {
  return getSignedUrl(
    clientFor(bucket),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function presignGet(
  bucket: string,
  key: string,
  expiresIn: number,
  opts?: { contentDisposition?: string; contentType?: string },
): Promise<string> {
  return getSignedUrl(
    clientFor(bucket),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: opts?.contentDisposition,
      ResponseContentType: opts?.contentType,
    }),
    { expiresIn },
  );
}
