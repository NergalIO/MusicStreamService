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

/** В release CI подставляется из GitHub Secrets; локально — из корневого .env */
function clientBuildEnv(): Record<string, string> {
  return {
    SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID ?? '',
    YANDEX_CLIENT_ID: env.YANDEX_CLIENT_ID ?? env.YANDEX_MUSIC_CLIENT_ID ?? '',
    YANDEX_CLIENT_SECRET: env.YANDEX_CLIENT_SECRET ?? env.YANDEX_MUSIC_CLIENT_SECRET ?? '',
    DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID ?? '',
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
