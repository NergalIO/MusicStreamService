import { app, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';

const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache'] as const;

/** Chromium иногда пишет Invalid cache (current) size — лечится удалением папок кэша в userData. */
export async function repairChromiumDiskCache(): Promise<void> {
  const userData = app.getPath('userData');
  if (!app.isPackaged) {
    for (const name of CACHE_DIRS) {
      try {
        fs.rmSync(path.join(userData, name), { recursive: true, force: true });
      } catch {
        /* папка занята — clearCache ниже */
      }
    }
  }
  try {
    await session.defaultSession.clearCache();
  } catch (e) {
    log.warn('clearCache failed', e instanceof Error ? e.message : String(e));
  }
}
