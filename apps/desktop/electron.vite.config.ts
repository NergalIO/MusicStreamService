import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { loadEnv } from 'vite';

const repoRoot = resolve(__dirname, '../..');
const env = loadEnv('development', repoRoot, '');
const publicBasePath = (env.PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
const apiTarget = env.API_DEV_TARGET ?? 'http://127.0.0.1:3001';

export default defineConfig({
  main: {
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
