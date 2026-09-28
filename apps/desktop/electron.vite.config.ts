import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { loadEnv } from 'vite';

const repoRoot = resolve(__dirname, '../..');
const env = {
  ...loadEnv('development', repoRoot, ''),
  ...loadEnv('production', repoRoot, ''),
  ...process.env,
};
const publicBasePath = (env.PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
const apiTarget = env.API_DEV_TARGET ?? 'http://127.0.0.1:3001';
const apiPublicUrl = (env.API_PUBLIC_URL ?? '').replace(/\/$/, '');

/** CI secrets (process.env) имеют приоритет над .env из loadEnv */
function clientBuildEnv(): Record<string, string> {
  const pick = (key: string, alt?: string) =>
    (process.env[key] ?? (alt ? process.env[alt] : undefined) ?? env[key] ?? env[alt ?? ''] ?? '').trim();
  return {
    SPOTIFY_CLIENT_ID: pick('SPOTIFY_CLIENT_ID'),
    YANDEX_CLIENT_ID: pick('YANDEX_CLIENT_ID', 'YANDEX_MUSIC_CLIENT_ID'),
    YANDEX_CLIENT_SECRET: pick('YANDEX_CLIENT_SECRET', 'YANDEX_MUSIC_CLIENT_SECRET'),
    MSS_YANDEX_CUSTOM_OAUTH: pick('MSS_YANDEX_CUSTOM_OAUTH'),
    DISCORD_CLIENT_ID: pick('DISCORD_CLIENT_ID'),
  };
}

export default defineConfig({
  main: {
    define: {
      __MSS_CLIENT_BUILD_ENV__: JSON.stringify(clientBuildEnv()),
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    define: {
      'import.meta.env.VITE_API_PUBLIC_URL': JSON.stringify(apiPublicUrl),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    plugins: [react()],
    publicDir: resolve(__dirname, 'public'),
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => {
            const rest = p.replace(/^\/api/, '') || '/';
            return publicBasePath ? `${publicBasePath}${rest}` : rest;
          },
        },
      },
    },
  },
});
