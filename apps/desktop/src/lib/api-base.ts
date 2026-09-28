const STORAGE_KEY = 'mss_api_base_url';

/** Dev: Vite проксирует /api → API_PUBLIC_URL / PUBLIC_BASE_PATH */
const DEV_PROXY_PREFIX = '/api';

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/$/, '');
}

function bakedBase(): string {
  const v = import.meta.env.VITE_API_PUBLIC_URL as string | undefined;
  return v ? normalizeBase(v) : '';
}

/** Базовый URL REST API (без trailing slash). В dev — `/api`. */
export function getApiBaseUrl(): string {
  if (import.meta.env.DEV) return DEV_PROXY_PREFIX;
  const baked = bakedBase();
  if (baked) return baked;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeBase(stored);
  } catch {
    /* ignore */
  }
  return '';
}

export function setApiBaseUrl(url: string): void {
  const n = normalizeBase(url);
  if (!n) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, n);
}

/** Путь API: `/auth/login` → dev `/api/auth/login`, prod `https://host/MusicStreamService/auth/login` */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (import.meta.env.DEV) return `${DEV_PROXY_PREFIX}${p}`;
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error(
      'URL сервера не задан. Укажите его на экране входа или задайте API_PUBLIC_URL при сборке установщика.',
    );
  }
  return `${base}${p}`;
}

/** Медиа-URL (stream, covers): в dev с префиксом /api, в prod — от корня API. */
export function apiMediaUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (import.meta.env.DEV) {
    const suffix = p.startsWith('/api/') ? p.slice(4) : p;
    return `${DEV_PROXY_PREFIX}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  }
  const base = getApiBaseUrl();
  if (!base) return p;
  const suffix = p.startsWith('/api/') ? p.slice(4) : p;
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}
