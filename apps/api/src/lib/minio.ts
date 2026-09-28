import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';

const endpoint = `${config.minio.useSsl ? 'https' : 'http'}://${config.minio.endpoint}:${config.minio.port}`;

export const s3 = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.minio.accessKey,
    secretAccessKey: config.minio.secretKey,
  },
});

export async function ensureBuckets(): Promise<void> {
  for (const bucket of [config.minio.bucketTracks, config.minio.bucketCovers]) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
}

export async function putObject(bucket: string, key: string, body: Buffer, contentType?: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getObjectRange(
  bucket: string,
  key: string,
  start: number,
  end: number,
): Promise<{ body: AsyncIterable<Uint8Array>; contentLength: number; totalSize: number }> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${start}-${end}`,
    }),
  );
  const total = Number(res.ContentRange?.split('/')[1] ?? res.ContentLength ?? 0);
  const len = end - start + 1;
  return {
    body: res.Body as AsyncIterable<Uint8Array>,
    contentLength: len,
    totalSize: total,
  };
}

export async function getObjectFull(bucket: string, key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
