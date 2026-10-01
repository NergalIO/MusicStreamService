import { getApiBaseUrl } from './api-base';

/** Наши /covers и /playlists/.../cover отдаёт API; mss-stream://img их режет allowlist'ом чужих CDN. */
function isMssApiMedia(url: string): boolean {
  const base = getApiBaseUrl();
  if (!base || base.startsWith('/')) return false;
  return url === base || url.startsWith(`${base}/`);
}

/** Обложки грузятся через кеш на диске в main-процессе; вне Electron — напрямую. */
export function cachedImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!window.electronAPI || !/^https:\/\//i.test(url) || isMssApiMedia(url)) return url;
  return `mss-stream://img/?u=${encodeURIComponent(url)}`;
}
