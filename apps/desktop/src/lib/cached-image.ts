/** Обложки грузятся через кеш на диске в main-процессе; вне Electron — напрямую. */
export function cachedImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!window.electronAPI || !/^https:\/\//i.test(url)) return url;
  return `mss-stream://img/?u=${encodeURIComponent(url)}`;
}
