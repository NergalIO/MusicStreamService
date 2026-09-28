import { app } from 'electron';
import { getAppSettings } from './app-settings.js';

/** Значения из .env (dev) или из __MSS_CLIENT_BUILD_ENV__ (CI / release). */
export type ClientBuildEnv = {
  SPOTIFY_CLIENT_ID: string;
  YANDEX_CLIENT_ID: string;
  YANDEX_CLIENT_SECRET: string;
  DISCORD_CLIENT_ID: string;
};

declare const __MSS_CLIENT_BUILD_ENV__: string;

const EMPTY: ClientBuildEnv = {
  SPOTIFY_CLIENT_ID: '',
  YANDEX_CLIENT_ID: '',
  YANDEX_CLIENT_SECRET: '',
  DISCORD_CLIENT_ID: '',
};

function bakedEnv(): ClientBuildEnv {
  try {
    return { ...EMPTY, ...JSON.parse(__MSS_CLIENT_BUILD_ENV__) } as ClientBuildEnv;
  } catch {
    return EMPTY;
  }
}

export const bakedClientEnv = bakedEnv();

export type UserClientSecretKey = keyof ClientBuildEnv;
export type ClientSecretSource = 'user' | 'env' | 'baked' | 'none';

function envSecret(key: UserClientSecretKey): string {
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  if (key === 'YANDEX_CLIENT_ID') return process.env.YANDEX_MUSIC_CLIENT_ID?.trim() ?? '';
  if (key === 'YANDEX_CLIENT_SECRET') return process.env.YANDEX_MUSIC_CLIENT_SECRET?.trim() ?? '';
  return '';
}

export function userClientSecret(key: UserClientSecretKey): string {
  const s = getAppSettings();
  const fromStore = s.userClientSecrets?.[key]?.trim();
  if (fromStore) return fromStore;
  if (key === 'DISCORD_CLIENT_ID') return s.discordClientId?.trim() ?? '';
  return '';
}

/** Сборка / .env без учёта пользовательских переопределений в настройках. */
export function clientSecretWithoutUser(key: UserClientSecretKey): string {
  const bakedVal = bakedClientEnv[key]?.trim() ?? '';
  if (app.isPackaged && bakedVal) return bakedVal;
  const env = envSecret(key);
  if (env) return env;
  return bakedVal;
}

export function clientSecretSource(key: UserClientSecretKey): ClientSecretSource {
  if (userClientSecret(key)) return 'user';
  if (app.isPackaged && bakedClientEnv[key]?.trim()) return 'baked';
  if (envSecret(key)) return 'env';
  return 'none';
}

export function clientSecret(key: UserClientSecretKey): string {
  const user = userClientSecret(key);
  if (user) return user;
  return clientSecretWithoutUser(key);
}
