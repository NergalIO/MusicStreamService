import type { Quality, UnifiedTrack } from '@mss/shared';
import { loadSession } from '@/lib/api';
import { apiMediaUrl } from '@/lib/api-base';
import { freshCloudPlayUrl } from '@/lib/cloud-urls';
import { downloadedFileUrl } from '@/store/downloads-store';

export interface ResolvedStream {
  url: string;
  preview: boolean;
  codec?: string;
  bitrate?: number;
}

type PlayableTrack = UnifiedTrack & {
  streamUrl?: string;
  cloudPlayUrl?: string;
  cloudUrlExpiresAt?: string;
};

const CACHE_TTL_MS = 90_000;
const cache = new Map<string, { at: number; value: Promise<ResolvedStream> }>();

export function proxyUrl(url: string): string {
  return `mss-stream://proxy/?u=${encodeURIComponent(url)}`;
}

function cacheKey(track: PlayableTrack, quality: Quality): string {
  return `${track.source}:${track.id}:${quality}`;
}

function cleanIpcError(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e);
  return new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
}

async function resolveLocal(track: PlayableTrack): Promise<ResolvedStream> {
  const session = loadSession();
  const offline = await window.electronAPI?.offline.list().catch(() => []);
  if (session?.user.id && offline?.some((o) => o.trackId === track.id)) {
    const url = await window.electronAPI.offline.resolvePlayUrl(track.id, session.user.id);
    return { url, preview: false };
  }
  const localUrl = await window.electronAPI?.localTracks?.resolvePlayUrl(track.id).catch(() => null);
  if (localUrl) return { url: localUrl, preview: false };
  const cloud = freshCloudPlayUrl(track);
  if (cloud) {
    const proxied = (() => {
      try {
        return new URL(cloud).protocol === 'https:' ? proxyUrl(cloud) : cloud;
      } catch {
        return proxyUrl(cloud);
      }
    })();
    return { url: proxied, preview: false };
  }
  return { url: track.streamUrl ?? apiMediaUrl(`/stream/${track.id}`), preview: false };
}

async function resolveExternal(track: PlayableTrack, quality: Quality): Promise<ResolvedStream> {
  if (!window.electronAPI) throw new Error('Внешние источники доступны только в приложении');
  const downloaded = downloadedFileUrl(track);
  if (downloaded) return { url: downloaded, preview: false };
  if (track.source === 'spotify') {
    throw new Error('Spotify играет через встроенный веб-плеер и не отдаёт поток файлом');
  }
  let handle;
  try {
    handle = await window.electronAPI.connectors.resolvePlayback(track.source, track, quality);
  } catch (e) {
    throw cleanIpcError(e);
  }
  switch (handle.kind) {
    case 'mediaUrl': {
      const url = handle.url.startsWith('mss-stream://') ? handle.url : proxyUrl(handle.url);
      return { url, preview: !!handle.preview, codec: handle.codec, bitrate: handle.bitrate };
    }
    case 'spotifySdk':
      throw new Error('Spotify играет через встроенный веб-плеер и не отдаёт поток файлом');
    case 'blobStream':
      return { url: handle.blobUrl, preview: false };
  }
}

/** Resolves a playable URL; external streams go through the mss-stream proxy so Web Audio gets CORS headers. */
export function resolveStream(track: PlayableTrack, quality: Quality): Promise<ResolvedStream> {
  const key = cacheKey(track, quality);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = track.source === 'local' ? resolveLocal(track) : resolveExternal(track, quality);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

export function invalidateStream(track: PlayableTrack, quality: Quality): void {
  cache.delete(cacheKey(track, quality));
}
