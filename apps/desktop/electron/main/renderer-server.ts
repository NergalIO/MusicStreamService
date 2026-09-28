import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

let baseUrl: string | null = null;

function rendererRoot(): string {
  return path.join(__dirname, '../renderer');
}

function isInside(file: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Локальный HTTP — secure context для Spotify Web Playback SDK (надёжнее custom scheme). */
export async function ensureRendererServer(): Promise<string> {
  if (baseUrl) return baseUrl;

  const root = rendererRoot();
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      const rel = (urlPath === '/' ? '/index.html' : urlPath).replace(/^\/+/, '');
      const filePath = path.join(root, rel);
      if (!isInside(filePath, root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

export function rendererPageUrl(query?: Record<string, string>): string {
  if (!baseUrl) throw new Error('ensureRendererServer() must run before opening windows');
  const q = query ? `?${new URLSearchParams(query)}` : '';
  return `${baseUrl}/index.html${q}`;
}
