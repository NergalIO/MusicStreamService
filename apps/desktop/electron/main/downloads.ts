import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DownloadProgress, DownloadRecord, Quality, UnifiedTrack } from '@mss/shared';
import { compressToAac, isFfmpegAvailable, shouldCompress } from './audio-compress.js';
import { flacMp4ToTaggedFlac, tagFlac, tagMp3, type AudioTags, type CoverImage } from './audio-tags.js';
import { connectorRegistry } from './connectors.js';
import { materializeVkMp3, parseVkStreamTarget } from './vk-hls.js';

const MAX_PARALLEL = 3;
const PROGRESS_INTERVAL_MS = 250;

interface DownloadsState {
  dir?: string;
  items: Record<string, DownloadRecord>;
}

let state: DownloadsState | null = null;
const inFlight = new Map<string, Promise<DownloadRecord>>();
const waiting: (() => void)[] = [];
let running = 0;
const cancelled = new Set<string>();
const abortControllers = new Map<string, AbortController>();

export class DownloadCancelledError extends Error {
  constructor() {
    super('DOWNLOAD_CANCELLED');
    this.name = 'DownloadCancelledError';
  }
}

function throwIfCancelled(key: string): void {
  if (cancelled.has(key)) throw new DownloadCancelledError();
}

export function cancelDownload(key: string): void {
  cancelled.add(key);
  abortControllers.get(key)?.abort();
}

export function cancelAllDownloads(): void {
  for (const key of inFlight.keys()) cancelDownload(key);
}

function stateFile(): string {
  return path.join(app.getPath('userData'), 'downloads.json');
}

function load(): DownloadsState {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as DownloadsState;
  } catch {
    state = { items: {} };
  }
  return state;
}

function persist(): void {
  fs.writeFileSync(stateFile(), JSON.stringify(load(), null, 2));
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

export function downloadsDir(): string {
  return load().dir ?? path.join(app.getPath('music'), 'MusicStream');
}

export function downloadKey(track: Pick<UnifiedTrack, 'source' | 'id'>): string {
  return `${track.source}:${String(track.id).split(':')[0]}`;
}

export function downloadPathFor(source: UnifiedTrack['source'], trackId: string): string | null {
  const key = `${source}:${String(trackId).split(':')[0]}`;
  const record = load().items[key];
  if (!record?.path || !fs.existsSync(record.path)) return null;
  return record.path;
}

/** Файлы из индекса загрузок можно отдавать через mss-stream://file, даже если папка вне userData. */
export function isDownloadedFile(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return Object.values(load().items).some((r) => path.resolve(r.path) === resolved);
}

function listDownloads(): DownloadRecord[] {
  const s = load();
  const missing = Object.keys(s.items).filter((k) => !fs.existsSync(s.items[k].path));
  if (missing.length) {
    for (const k of missing) delete s.items[k];
    persist();
  }
  return Object.values(s.items).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function sanitize(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return clean.slice(0, 150) || 'track';
}

function uniquePath(dir: string, base: string, ext: string): string {
  let candidate = path.join(dir, `${base}${ext}`);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

async function fetchWithProgress(url: string, key: string, signal: AbortSignal): Promise<Buffer> {
  throwIfCancelled(key);
  const res = await net.fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Хранилище ответило ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastSent = 0;
  for (;;) {
    throwIfCancelled(key);
    if (signal.aborted) throw new DownloadCancelledError();
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (Date.now() - lastSent > PROGRESS_INTERVAL_MS) {
      lastSent = Date.now();
      broadcast('downloads:progress', { key, received, total } satisfies DownloadProgress);
    }
  }
  return Buffer.concat(chunks);
}

async function fetchCover(url?: string): Promise<CoverImage | undefined> {
  if (!url) return undefined;
  try {
    const res = await net.fetch(url.replace(/\d+x\d+$/, '1000x1000'));
    if (!res.ok) return undefined;
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { data: Buffer.from(await res.arrayBuffer()), mime };
  } catch {
    return undefined;
  }
}

function encodeFile(
  codec: string,
  audio: Buffer,
  tags: AudioTags,
  cover?: CoverImage,
): { data: Buffer; ext: string; codec: string } {
  switch (codec) {
    case 'flac-mp4':
      return { data: flacMp4ToTaggedFlac(audio, tags, cover), ext: '.flac', codec: 'flac' };
    case 'flac':
      return { data: tagFlac(audio, tags, cover), ext: '.flac', codec };
    case 'mp3':
      return { data: tagMp3(audio, tags, cover), ext: '.mp3', codec };
    case 'aac-mp4':
    case 'he-aac-mp4':
      return { data: audio, ext: '.m4a', codec };
    default:
      return { data: audio, ext: '.aac', codec };
  }
}

interface SavedFile {
  path: string;
  codec: string;
  bitrate?: number;
  size: number;
}

async function compressInto(input: string, dir: string, base: string, kbps: number): Promise<SavedFile> {
  const target = uniquePath(dir, base, '.m4a');
  const tmp = `${target}.part`;
  try {
    await compressToAac(input, tmp, kbps);
    await fs.promises.rename(tmp, target);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  return { path: target, codec: 'aac', bitrate: kbps, size: (await fs.promises.stat(target)).size };
}

async function saveFile(
  file: { data: Buffer; ext: string; codec: string },
  base: string,
  bitrate: number | undefined,
  compressKbps: number,
): Promise<SavedFile> {
  const dir = downloadsDir();
  await fs.promises.mkdir(dir, { recursive: true });

  if (shouldCompress(file.codec, bitrate, compressKbps) && (await isFfmpegAvailable())) {
    const source = path.join(os.tmpdir(), `mss-dl-${process.pid}-${Date.now()}${file.ext}`);
    await fs.promises.writeFile(source, file.data);
    try {
      return await compressInto(source, dir, base, compressKbps);
    } catch (e) {
      console.warn('[downloads] compression failed, keeping original:', e);
    } finally {
      await fs.promises.rm(source, { force: true });
    }
  }

  const target = uniquePath(dir, base, file.ext);
  const tmp = `${target}.part`;
  await fs.promises.writeFile(tmp, file.data);
  await fs.promises.rename(tmp, target);
  return { path: target, codec: file.codec, bitrate, size: file.data.length };
}

function matchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s(feat|ft)\.?\s.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Поток Spotify зашифрован Widevine и файлом не отдаётся — скачиваем тот же трек
 * из подключённой Яндекс Музыки или VK, сверяя название, исполнителя и длительность.
 */
async function findDownloadableCopy(track: UnifiedTrack): Promise<UnifiedTrack> {
  const title = matchKey(track.title);
  const mainArtist = track.artists?.[0]?.name ?? track.artist.split(',')[0] ?? '';
  const artist = matchKey(mainArtist);
  const sources = ['yandex', 'vk'].filter((id) => connectorRegistry.get(id)?.getAuthStatus() === 'connected');
  if (!sources.length) {
    throw new Error('Spotify не отдаёт файлы — подключите Яндекс Музыку или VK, и трек скачается оттуда');
  }
  const plainTitle = track.title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '');
  for (const id of sources) {
    const found = await connectorRegistry
      .get(id)!
      .search(`${mainArtist} ${plainTitle}`, 10)
      .catch(() => [] as UnifiedTrack[]);
    const match = found.find((t) => {
      if (!t.playable || matchKey(t.title) !== title) return false;
      if (!matchKey(t.artist).includes(artist)) return false;
      return !track.durationMs || !t.durationMs || Math.abs(t.durationMs - track.durationMs) <= 5000;
    });
    if (match) return match;
  }
  throw new Error('Не нашли этот трек в Яндекс Музыке и VK — Spotify не отдаёт файлы для скачивания');
}

async function performDownload(track: UnifiedTrack, quality: Quality, compressKbps: number): Promise<DownloadRecord> {
  const key = downloadKey(track);
  throwIfCancelled(key);
  const controller = new AbortController();
  abortControllers.set(key, controller);
  try {
    const source = track.source === 'spotify' ? await findDownloadableCopy(track) : track;
    throwIfCancelled(key);
    const connector = connectorRegistry.get(source.source);
    if (!connector) throw new Error(`Источник ${source.source} не подключён`);

    const handle = await connector.resolvePlayback(source, { quality });
    throwIfCancelled(key);
    if (handle.kind !== 'mediaUrl') throw new Error('Этот источник не отдаёт файлы для загрузки');
    if (handle.preview) throw new Error('Доступно только превью — для загрузки нужна подписка');

    broadcast('downloads:progress', { key, received: 0, total: 0 } satisfies DownloadProgress);
    const vkTarget = parseVkStreamTarget(handle.url) ?? (/m3u8(\?|$)/i.test(handle.url) ? handle.url : null);
    const [audio, cover] = await Promise.all([
      vkTarget
        ? materializeVkMp3(vkTarget, (received, total) => {
            broadcast('downloads:progress', { key, received, total } satisfies DownloadProgress);
          })
        : fetchWithProgress(handle.url, key, controller.signal),
      fetchCover(track.coverUrl),
    ]);
    throwIfCancelled(key);
    const tags: AudioTags = { title: track.title, artist: track.artist, album: track.album };
    const file = encodeFile(handle.codec ?? 'mp3', audio, tags, cover);
    const saved = await saveFile(file, sanitize(`${track.artist} - ${track.title}`), handle.bitrate || undefined, compressKbps);
    throwIfCancelled(key);

    const record: DownloadRecord = {
      key,
      ...saved,
      downloadedAt: new Date().toISOString(),
      track,
    };
    load().items[key] = record;
    persist();
    broadcast('downloads:changed');
    return record;
  } catch (e) {
    if (e instanceof DownloadCancelledError || (e instanceof Error && e.name === 'AbortError')) {
      throw new DownloadCancelledError();
    }
    throw e;
  } finally {
    abortControllers.delete(key);
    cancelled.delete(key);
  }
}

function startDownload(track: UnifiedTrack, quality: Quality, compressKbps: number): Promise<DownloadRecord> {
  const key = downloadKey(track);
  const existing = load().items[key];
  if (existing && fs.existsSync(existing.path)) return Promise.resolve(existing);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = withSlot(async () => {
    throwIfCancelled(key);
    return performDownload(track, quality, compressKbps);
  })
    .catch((e) => {
      if (e instanceof DownloadCancelledError) cancelled.delete(key);
      throw e;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

export interface CompressResult {
  compressed: number;
  failed: number;
  savedBytes: number;
}

async function compressExisting(kbps: number): Promise<CompressResult> {
  if (!(await isFfmpegAvailable())) throw new Error('Не найден ffmpeg — установите его и добавьте в PATH');
  const records = listDownloads().filter((r) => !inFlight.has(r.key) && shouldCompress(r.codec, r.bitrate, kbps));
  const result: CompressResult = { compressed: 0, failed: 0, savedBytes: 0 };
  await Promise.all(
    records.map((record) =>
      withSlot(async () => {
        try {
          const base = path.basename(record.path, path.extname(record.path));
          const saved = await compressInto(record.path, path.dirname(record.path), base, kbps);
          const current = load().items[record.key];
          if (!current || current.path !== record.path) {
            await fs.promises.rm(saved.path, { force: true });
            return;
          }
          load().items[record.key] = { ...current, ...saved };
          persist();
          await fs.promises.rm(record.path, { force: true }).catch(() => {});
          result.compressed++;
          result.savedBytes += Math.max(0, record.size - saved.size);
          broadcast('downloads:changed');
        } catch (e) {
          console.warn('[downloads] compress failed', record.path, e);
          result.failed++;
        }
      }),
    ),
  );
  return result;
}

function removeDownload(key: string): void {
  const s = load();
  const record = s.items[key];
  if (!record) return;
  fs.rmSync(record.path, { force: true });
  delete s.items[key];
  persist();
  broadcast('downloads:changed');
}

export function registerDownloadsIpc(): void {
  ipcMain.handle('downloads:list', () => listDownloads());
  ipcMain.handle('downloads:start', (_e, track: UnifiedTrack, quality: Quality, compressKbps: number) =>
    startDownload(track, quality, compressKbps || 0),
  );
  ipcMain.handle('downloads:compressAll', (_e, kbps: number) => compressExisting(kbps));
  ipcMain.handle('downloads:ffmpegAvailable', () => isFfmpegAvailable());
  ipcMain.handle('downloads:remove', (_e, key: string) => removeDownload(key));
  ipcMain.handle('downloads:cancel', (_e, key: string) => cancelDownload(key));
  ipcMain.handle('downloads:cancelAll', () => cancelAllDownloads());
  ipcMain.handle('downloads:reveal', (_e, key: string) => {
    const record = load().items[key];
    if (record) shell.showItemInFolder(record.path);
  });
  ipcMain.handle('downloads:getDir', () => downloadsDir());
  ipcMain.handle('downloads:openDir', async () => {
    const dir = downloadsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });
  ipcMain.handle('downloads:chooseDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Папка для скачанных треков',
      defaultPath: downloadsDir(),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    load().dir = result.filePaths[0];
    persist();
    return result.filePaths[0];
  });
}
