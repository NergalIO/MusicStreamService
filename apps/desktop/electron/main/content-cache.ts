import { app, ipcMain, net } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getAppSettings, updateAppSettings } from './app-settings.js';
import { log } from './logger.js';

type Kind = 'album' | 'lyrics' | 'img';

export const CACHE_LIMITS_MB = [200, 500, 1000, 2000] as const;
const DEFAULT_LIMIT_MB = 500;

function root(): string {
  return path.join(app.getPath('userData'), 'content-cache');
}

function fileFor(kind: Kind, key: string): string {
  const hash = createHash('sha1').update(key).digest('hex');
  return path.join(root(), kind, hash);
}

export function cacheLimitMb(): number {
  return getAppSettings().cacheLimitMb ?? DEFAULT_LIMIT_MB;
}

function touch(file: string): void {
  const now = new Date();
  fsp.utimes(file, now, now).catch(() => {});
}

export async function readCachedJson<T>(kind: Exclude<Kind, 'img'>, key: string): Promise<T | null> {
  const file = `${fileFor(kind, key)}.json`;
  try {
    const value = JSON.parse(await fsp.readFile(file, 'utf8')) as T;
    touch(file);
    return value;
  } catch {
    return null;
  }
}

export async function writeCachedJson(kind: Exclude<Kind, 'img'>, key: string, value: unknown): Promise<void> {
  const file = `${fileFor(kind, key)}.json`;
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(value));
    scheduleTrim();
  } catch (e) {
    log.warn('content cache write failed', e instanceof Error ? e.message : String(e));
  }
}

const inflightImages = new Map<string, Promise<{ body: Buffer; type: string } | null>>();

/** Картинка из кеша на диске; при промахе скачивается и сохраняется. Тип хранится рядом в `.type`. */
export async function cachedImage(url: string): Promise<{ body: Buffer; type: string } | null> {
  const file = fileFor('img', url);
  try {
    const [body, type] = await Promise.all([fsp.readFile(file), fsp.readFile(`${file}.type`, 'utf8').catch(() => 'image/jpeg')]);
    touch(file);
    return { body, type };
  } catch {
    /* промах */
  }
  const pending = inflightImages.get(url);
  if (pending) return pending;
  const task = (async () => {
    const res = await net.fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const body = Buffer.from(await res.arrayBuffer());
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, body);
      await fsp.writeFile(`${file}.type`, type);
      scheduleTrim();
    } catch {
      /* не сохранили — картинку всё равно отдаём */
    }
    return { body, type };
  })().finally(() => inflightImages.delete(url));
  inflightImages.set(url, task);
  return task;
}

async function listFiles(): Promise<{ file: string; size: number; mtime: number }[]> {
  const out: { file: string; size: number; mtime: number }[] = [];
  for (const kind of ['album', 'lyrics', 'img'] as const) {
    const dir = path.join(root(), kind);
    let names: string[] = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const st = await fsp.stat(file);
        out.push({ file, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* удалён параллельно */
      }
    }
  }
  return out;
}

export async function cacheSizeBytes(): Promise<number> {
  return (await listFiles()).reduce((sum, f) => sum + f.size, 0);
}

let trimTimer: NodeJS.Timeout | null = null;

function scheduleTrim(): void {
  if (trimTimer) return;
  trimTimer = setTimeout(() => {
    trimTimer = null;
    void trimCache();
  }, 5_000);
}

/** Удаляет давно не открытые записи, пока кеш не уложится в лимит. */
export async function trimCache(): Promise<void> {
  const limit = cacheLimitMb() * 1024 * 1024;
  const files = await listFiles();
  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= limit) return;
  files.sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    if (total <= limit) break;
    if (f.file.endsWith('.type')) continue;
    for (const victim of [f.file, `${f.file}.type`]) {
      try {
        const size = victim === f.file ? f.size : (await fsp.stat(victim)).size;
        await fsp.rm(victim, { force: true });
        total -= size;
      } catch {
        /* нет файла */
      }
    }
  }
}

export async function clearCache(): Promise<void> {
  inflightImages.clear();
  await fsp.rm(root(), { recursive: true, force: true });
}

export function registerContentCacheIpc(): void {
  if (!fs.existsSync(root())) fs.mkdirSync(root(), { recursive: true });
  ipcMain.handle('cache:stats', async () => ({ bytes: await cacheSizeBytes(), limitMb: cacheLimitMb() }));
  ipcMain.handle('cache:clear', async () => {
    await clearCache();
    return { bytes: 0, limitMb: cacheLimitMb() };
  });
  ipcMain.handle('cache:setLimit', async (_e, mb: number) => {
    if (CACHE_LIMITS_MB.includes(mb as (typeof CACHE_LIMITS_MB)[number])) {
      updateAppSettings({ cacheLimitMb: mb });
      await trimCache();
    }
    return { bytes: await cacheSizeBytes(), limitMb: cacheLimitMb() };
  });
  void trimCache();
}
