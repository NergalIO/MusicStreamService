import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Secure origin для renderer (Spotify Web Playback SDK не работает на file://). */
export const RENDERER_SCHEME = 'mss-ui';

export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

function rendererRoot(): string {
  return path.join(__dirname, '../renderer');
}

function isInside(file: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function handleRendererProtocol(): void {
  const root = rendererRoot();

  protocol.handle(RENDERER_SCHEME, async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const rel = pathname.replace(/^\/+/, '');
    const filePath = path.join(root, rel);
    if (!isInside(filePath, root) || !fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
}

export function rendererLoadUrl(query?: Record<string, string>): string {
  const q = query ? `?${new URLSearchParams(query)}` : '';
  return `${RENDERER_SCHEME}://app/index.html${q}`;
}
