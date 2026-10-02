import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPOTIFY_PAGE_BRIDGE_VERSION = 6;

const CONNECT_DEVICE_RE = /(https:\/\/[^/]+)\/connect-state\/v1\/devices\/(hobs_[0-9a-f]{16,})/;

export interface SpotifyConnectDevice {
  origin: string;
  id: string;
  url: string;
}

export function parseConnectDeviceUrl(url: string): SpotifyConnectDevice | null {
  const m = String(url).match(CONNECT_DEVICE_RE);
  if (!m) return null;
  return { origin: m[1], id: m[2], url: m[0] };
}

/** Свой плеер первым: чужие hobs_ из пикера не должны перебивать быстрый старт. */
export function preferOwnDeviceUrls(seen: string[], ownUrl: string | null | undefined): string[] {
  const unique: string[] = [];
  const add = (url: string) => {
    if (!url || unique.includes(url)) return;
    unique.push(url);
  };
  if (ownUrl) add(ownUrl);
  for (const url of seen) add(url);
  return unique;
}

function loadBridge(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  try {
    return readFileSync(join(dir, 'spotify-page-bridge.inject.js'), 'utf8');
  } catch {
    return readFileSync(join(dir, '../src/spotify-page-bridge.inject.js'), 'utf8');
  }
}

export const SPOTIFY_PAGE_BRIDGE = loadBridge();
