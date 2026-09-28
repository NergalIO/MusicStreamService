import { app } from 'electron';

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

const baked = bakedEnv();

export function clientSecret(key: keyof ClientBuildEnv): string {
  const bakedVal = baked[key]?.trim() ?? '';
  /** В установщике с GitHub CI секреты вшиты в сборку — .env не обязателен. */
  if (app.isPackaged && bakedVal) return bakedVal;

  const direct = process.env[key]?.trim();
  if (direct) return direct;
  if (key === 'YANDEX_CLIENT_ID') {
    const alt = process.env.YANDEX_MUSIC_CLIENT_ID?.trim();
    if (alt) return alt;
  }
  if (key === 'YANDEX_CLIENT_SECRET') {
    const alt = process.env.YANDEX_MUSIC_CLIENT_SECRET?.trim();
    if (alt) return alt;
  }
  return bakedVal;
}
