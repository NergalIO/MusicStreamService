import { net } from 'electron';
import { parseByteRange } from './byte-range.js';
import {
  decodeSegment,
  parseM3u8,
  VK_HEADERS,
  type HlsSegment,
} from '@mss/stream-connectors';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

const MAX_CACHE = 5;
const PARALLEL = 4;

interface AssembleJob {
  url: string;
  buffer: Buffer;
  done: boolean;
  error: Error | null;
  waiters: Array<() => void>;
  lastAccess: number;
}

const jobs = new Map<string, AssembleJob>();
const completed = new Map<string, { buffer: Buffer; at: number }>();

function notify(job: AssembleJob): void {
  const waiters = job.waiters.splice(0);
  for (const w of waiters) w();
}

function waitFor(job: AssembleJob): Promise<void> {
  if (job.done || job.error) return Promise.resolve();
  return new Promise((resolve) => job.waiters.push(resolve));
}

async function fetchBuffer(url: string, headers?: Record<string, string>): Promise<Buffer> {
  const res = await net.fetch(url, { headers: { ...VK_HEADERS, ...headers } });
  if (!res.ok) throw new Error(`VK CDN ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const buf = await fetchBuffer(url);
  return buf.toString('utf8');
}

const keyCache = new Map<string, Buffer>();

async function keyFor(segment: HlsSegment): Promise<{ key: Buffer; iv: Buffer } | null> {
  if (segment.key?.method !== 'AES-128' || !segment.key.uri) return null;
  let key = keyCache.get(segment.key.uri);
  if (!key) {
    key = await fetchBuffer(segment.key.uri);
    keyCache.set(segment.key.uri, key.subarray(0, 16));
    key = keyCache.get(segment.key.uri)!;
    if (keyCache.size > 32) {
      const first = keyCache.keys().next().value;
      if (first) keyCache.delete(first);
    }
  }
  return { key, iv: segment.key.iv! };
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

function rememberCompleted(url: string, buffer: Buffer): void {
  completed.set(url, { buffer, at: Date.now() });
  while (completed.size > MAX_CACHE) {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of completed) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldest = k;
      }
    }
    if (oldest) completed.delete(oldest);
  }
}

async function runAssemble(job: AssembleJob): Promise<void> {
  try {
    const playlistText = await fetchText(job.url);
    const playlist = parseM3u8(playlistText, job.url);
    if (!playlist.segments.length) throw new Error('VK: пустой HLS-плейлист');

    const decoded = await mapPool(playlist.segments, PARALLEL, async (seg) => {
      const data = await fetchBuffer(seg.url);
      const aes = await keyFor(seg);
      return decodeSegment(data, aes?.key ?? null, aes?.iv ?? null);
    });

    const parts: Buffer[] = [];
    for (const part of decoded) {
      if (!part.length) continue;
      parts.push(part);
      job.buffer = Buffer.concat([job.buffer, part]);
      job.lastAccess = Date.now();
      notify(job);
    }
    if (!parts.length) throw new Error('VK: не удалось собрать аудио из HLS');
    job.done = true;
    rememberCompleted(job.url, job.buffer);
  } catch (e) {
    job.error = e instanceof Error ? e : new Error(String(e));
    job.done = true;
  } finally {
    notify(job);
    jobs.delete(job.url);
  }
}

function getJob(url: string): AssembleJob {
  const hit = completed.get(url);
  if (hit) {
    hit.at = Date.now();
    return { url, buffer: hit.buffer, done: true, error: null, waiters: [], lastAccess: hit.at };
  }
  const existing = jobs.get(url);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }
  const job: AssembleJob = { url, buffer: Buffer.alloc(0), done: false, error: null, waiters: [], lastAccess: Date.now() };
  jobs.set(url, job);
  void runAssemble(job);
  return job;
}

async function waitUntil(job: AssembleJob, bytes: number): Promise<void> {
  while (!job.error && !job.done && job.buffer.length < bytes) await waitFor(job);
  if (job.error) throw job.error;
}

function rangeResponse(buffer: Buffer, rangeHeader: string | null): Response {
  const size = buffer.length;
  const range = parseByteRange(rangeHeader, size);
  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
  };
  if (!range) {
    headers['Content-Length'] = String(size);
    return new Response(new Uint8Array(buffer), { status: 200, headers });
  }
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...CORS, 'Content-Range': `bytes */${size}` } });
  }
  const { start, end } = range;
  headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  headers['Content-Length'] = String(end - start + 1);
  return new Response(new Uint8Array(buffer.subarray(start, end + 1)), { status: 206, headers });
}

function progressiveResponse(job: AssembleJob): Response {
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!job.error && !job.done && offset >= job.buffer.length) await waitFor(job);
        if (job.error) {
          controller.error(job.error);
          return;
        }
        if (offset >= job.buffer.length) {
          controller.close();
          return;
        }
        const chunk = job.buffer.subarray(offset, offset + 64 * 1024);
        offset += chunk.length;
        controller.enqueue(new Uint8Array(chunk));
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'audio/mpeg' },
  });
}

export async function serveVkAudio(target: string, rangeHeader: string | null): Promise<Response> {
  if (!/^https?:\/\//i.test(target)) {
    return new Response('Bad target', { status: 400, headers: CORS });
  }
  try {
    if (!/m3u8(\?|$)/i.test(target)) {
      const buf = await fetchBuffer(target);
      return rangeResponse(buf, rangeHeader);
    }
    const job = getJob(target);
    if (rangeHeader) {
      // Воспроизведение с начала не должно ждать сборки всего файла — отдаём поток по мере загрузки.
      if (!job.done && /^bytes=0-/.test(rangeHeader.trim())) {
        await waitUntil(job, 1);
        if (!job.done) return progressiveResponse(job);
      }
      // Для перемотки нужен точный общий размер, поэтому здесь дожидаемся конца сборки.
      await waitUntil(job, Number.MAX_SAFE_INTEGER);
      return rangeResponse(job.buffer, rangeHeader);
    }
    if (job.done) return rangeResponse(job.buffer, null);
    await waitUntil(job, 1);
    if (job.done) return rangeResponse(job.buffer, null);
    return progressiveResponse(job);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'VK stream error', { status: 502, headers: CORS });
  }
}

export async function materializeVkMp3(
  target: string,
  onProgress?: (received: number, total: number) => void,
): Promise<Buffer> {
  if (!/m3u8(\?|$)/i.test(target)) {
    const buf = await fetchBuffer(target);
    onProgress?.(buf.length, buf.length);
    return buf;
  }
  const job = getJob(target);
  while (!job.done) {
    await waitFor(job);
    onProgress?.(job.buffer.length, 0);
    if (job.error) throw job.error;
  }
  if (job.error) throw job.error;
  onProgress?.(job.buffer.length, job.buffer.length);
  return job.buffer;
}

export function parseVkStreamTarget(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mss-stream:' || parsed.hostname !== 'vk') return null;
    return parsed.searchParams.get('u');
  } catch {
    return null;
  }
}
