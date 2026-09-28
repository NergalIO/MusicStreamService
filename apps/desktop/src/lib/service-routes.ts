export type ServiceScope = 'mss' | 'yandex' | 'spotify' | 'media';

export const MSS_HOME = '/mss';
export const YANDEX_HOME = '/yandex';
export const SPOTIFY_HOME = '/spotify';
export const MEDIA_HOME = '/media/library/likes';

export function libraryPath(scope: ServiceScope, tab: string): string {
  return `/${scope}/library/${tab}`;
}

export function searchPath(scope: ServiceScope, q?: string): string {
  const base = `/${scope}/search`;
  if (!q?.trim()) return base;
  return `${base}?q=${encodeURIComponent(q.trim())}`;
}

export function scopeFromPathname(pathname: string): ServiceScope {
  if (pathname.startsWith('/yandex')) return 'yandex';
  if (pathname.startsWith('/spotify')) return 'spotify';
  if (pathname.startsWith('/mss')) return 'mss';
  if (pathname.startsWith('/media')) return 'media';
  return 'media';
}
