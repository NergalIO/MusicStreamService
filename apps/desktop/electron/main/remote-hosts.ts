import net from 'node:net';
import { getAppSettings } from './app-settings.js';

/**
 * Протокол mss-stream доступен из страницы renderer, поэтому proxy и img — это чужой вход
 * в сеть приложения. Пускаем только по https и только к хостам сервисов, которыми пользуемся.
 */
const ALLOWED_SUFFIXES = [
  'yandex.net',
  'yandex.ru',
  'yandex.com',
  'yandexcloud.net',
  'mds.yandex.net',
  'vk.com',
  'vk.ru',
  'vk-cdn.net',
  'vkuser.net',
  'vkuservideo.net',
  'userapi.com',
  'mycdn.me',
  'scdn.co',
  'spotifycdn.com',
  'spotify.com',
  'sndcdn.com',
  'ytimg.com',
  'googleusercontent.com',
  'storage.beget.cloud',
  'beget.cloud',
];

function configuredApiOrigin(): URL | null {
  const candidates = [process.env.API_PUBLIC_URL, process.env.VITE_API_PUBLIC_URL, getAppSettings().apiPublicUrl];
  for (const raw of candidates) {
    const s = raw?.trim();
    if (!s) continue;
    try {
      return new URL(s.includes('://') ? s : `https://${s}`);
    } catch {
      /* next */
    }
  }
  return null;
}

function sameOrigin(url: URL, api: URL): boolean {
  const urlPort = url.port || (url.protocol === 'https:' ? '443' : '80');
  const apiPort = api.port || (api.protocol === 'https:' ? '443' : '80');
  return (
    url.protocol === api.protocol &&
    url.hostname.toLowerCase() === api.hostname.toLowerCase() &&
    urlPort === apiPort
  );
}

function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return true;
  const ip = lower.startsWith('[') ? lower.slice(1, -1) : lower;
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (version === 6) {
    return ip === '::1' || /^(fc|fd|fe80)/i.test(ip);
  }
  return false;
}

export function isAllowedRemote(raw: string, { requireHttps = true } = {}): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const api = configuredApiOrigin();
  if (api && sameOrigin(url, api)) return true;
  if (url.protocol !== 'https:' && (requireHttps || url.protocol !== 'http:')) return false;
  const host = url.hostname.toLowerCase();
  if (isPrivateHost(host)) return false;
  return ALLOWED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
