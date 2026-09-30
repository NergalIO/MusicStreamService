import { app, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { cachedImage } from './content-cache.js';
import { isDownloadedFile } from './downloads.js';
import { isRegisteredLocalPath } from './local-tracks.js';
import { serveVkAudio } from './vk-hls.js';

export const STREAM_SCHEME = 'mss-stream';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

const MIME: Record<string, string> = {
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

/** Вызывать до app.whenReady(). */
export function registerStreamScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: STREAM_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

function isInside(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function serveFile(filePath: string, rangeHeader: string | null): Response {
  const resolved = path.resolve(filePath);
  const roots = [app.getPath('temp'), app.getPath('userData')];
  const allowed =
    roots.some((root) => isInside(resolved, path.resolve(root))) ||
    isDownloadedFile(resolved) ||
    isRegisteredLocalPath(resolved);
  if (!allowed || !fs.existsSync(resolved)) {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }
  const size = fs.statSync(resolved).size;
  const type = MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream';
  const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;

  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    const body = Readable.toWeb(fs.createReadStream(resolved, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }
  const body = Readable.toWeb(fs.createReadStream(resolved)) as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) },
  });
}

async function proxyRemote(target: string, rangeHeader: string | null): Promise<Response> {
  if (!/^https?:\/\//i.test(target)) return new Response('Bad target', { status: 400, headers: CORS_HEADERS });
  const upstream = await net.fetch(target, { headers: rangeHeader ? { Range: rangeHeader } : {} });
  const headers = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

async function serveImage(target: string): Promise<Response> {
  if (!/^https:\/\//i.test(target)) return new Response('Bad target', { status: 400, headers: CORS_HEADERS });
  const image = await cachedImage(target);
  if (!image) return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  return new Response(new Uint8Array(image.body), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': image.type, 'Cache-Control': 'max-age=31536000, immutable' },
  });
}

/**
 * mss-stream://img/?u=<url> — обложка из кеша на диске (при промахе скачивается);
 * mss-stream://proxy/?u=<url> — удалённый поток с CORS-заголовками (иначе Web Audio выдаёт тишину);
 * mss-stream://file/?p=<path> — локальный файл из temp/userData или папки загрузок с поддержкой Range;
 * mss-stream://vk/?u=<m3u8> — HLS VK, расшифровка и MPEG-TS → MP3.
 */
export function handleStreamProtocol(): void {
  protocol.handle(STREAM_SCHEME, async (request) => {
    const url = new URL(request.url);
    const range = request.headers.get('range');
    try {
      if (url.hostname === 'proxy') return await proxyRemote(url.searchParams.get('u') ?? '', range);
      if (url.hostname === 'file') return serveFile(url.searchParams.get('p') ?? '', range);
      if (url.hostname === 'vk') return await serveVkAudio(url.searchParams.get('u') ?? '', range);
      if (url.hostname === 'img') return await serveImage(url.searchParams.get('u') ?? '');
    } catch (e) {
      return new Response(e instanceof Error ? e.message : 'Stream error', { status: 502, headers: CORS_HEADERS });
    }
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  });
}

export function fileStreamUrl(filePath: string): string {
  return `${STREAM_SCHEME}://file/?p=${encodeURIComponent(filePath)}`;
}
