import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, dialog } from 'electron';
import { parseFile } from 'music-metadata';
import { embeddedCoverToJpeg } from './cover-from-audio.js';

export interface LocalTrackEntry {
  path: string;
  contentHash: string;
}

export interface PreparedLocalFile {
  path: string;
  contentHash: string;
  title: string;
  artist: string;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  trackNo: number | null;
  discNo: number | null;
  durationMs: number | null;
  sizeBytes: number;
  originalFilename: string;
  /** JPEG для загрузки на API, если в файле была embedded-обложка. */
  coverJpeg?: Buffer;
  /** Содержимое .lrc / .txt рядом с файлом. */
  lyrics?: { format: 'lrc' | 'txt'; text: string };
}

export interface LocalAudioTags {
  title: string;
  artist: string;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  trackNo: number | null;
  discNo: number | null;
}

export interface UploadAlbumSource {
  title: string;
  files: string[];
  coverPath: string | null;
}

export interface ExpandedUploadSources {
  files: string[];
  albums: UploadAlbumSource[];
}

type Index = Record<string, LocalTrackEntry>;

const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma', 'aiff', 'ape', 'wv', 'webm'];
const COVER_FILES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'folder.jpg', 'folder.png', 'front.jpg', 'album.jpg', 'albumart.jpg'];

const INDEX_FILE = () => path.join(app.getPath('userData'), 'local-tracks.json');

let index: Index | null = null;

async function loadIndex(): Promise<Index> {
  if (index) return index;
  try {
    const raw = await fs.readFile(INDEX_FILE(), 'utf8');
    index = JSON.parse(raw) as Index;
  } catch {
    index = {};
  }
  return index!;
}

async function saveIndex(): Promise<void> {
  if (!index) return;
  await fs.writeFile(INDEX_FILE(), JSON.stringify(index, null, 2), 'utf8');
}

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function tagsFromFilename(filename: string): { title: string; artist: string } {
  const base = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const match = /^(?:\d{1,3}[.\s-]+)?(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { title: base || 'Без названия', artist: 'Неизвестный исполнитель' };
}

export async function prepareLocalFile(filePath: string): Promise<PreparedLocalFile> {
  const resolved = path.resolve(filePath);
  assertAudioPath(resolved);
  preparedPaths.add(resolved);
  const stat = await fs.stat(resolved);
  const originalFilename = path.basename(resolved);
  const fromName = tagsFromFilename(originalFilename);

  const [contentHash, meta] = await Promise.all([
    hashFile(resolved),
    parseFile(resolved).catch(() => null),
  ]);

  const title = meta?.common.title?.trim() || fromName.title;
  const artist =
    meta?.common.artist?.trim() || meta?.common.artists?.map((a: string) => a.trim()).filter(Boolean).join(', ') || fromName.artist;
  const album = meta?.common.album?.trim() || null;
  const durationMs = meta?.format.duration != null ? Math.round(meta.format.duration * 1000) : null;

  let coverJpeg: Buffer | undefined;
  const picture = meta?.common.picture?.[0];
  if (picture?.data?.length) {
    const jpeg = await embeddedCoverToJpeg(Buffer.from(picture.data));
    if (jpeg?.length) coverJpeg = jpeg;
  }

  return {
    path: resolved,
    contentHash,
    title,
    artist,
    album,
    albumArtist: meta?.common.albumartist?.trim() || null,
    year: yearFromMeta(meta?.common.year, meta?.common.date),
    trackNo: meta?.common.track?.no ?? trackNoFromFilename(originalFilename),
    discNo: meta?.common.disk?.no ?? null,
    durationMs,
    sizeBytes: stat.size,
    originalFilename,
    coverJpeg,
    lyrics: await readSidecarLyricsFile(resolved),
  };
}

function yearFromMeta(year?: number, date?: string): number | null {
  if (year && year >= 1000 && year <= 2100) return year;
  const fromDate = date?.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!fromDate) return null;
  const n = Number(fromDate);
  return n >= 1000 && n <= 2100 ? n : null;
}

function trackNoFromFilename(filename: string): number | null {
  const m = /^(\d{1,3})[.\s_-]+/.exec(filename);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

function tagsFromMeta(
  filename: string,
  meta: Awaited<ReturnType<typeof parseFile>> | null,
): LocalAudioTags {
  const fromName = tagsFromFilename(filename);
  return {
    title: meta?.common.title?.trim() || fromName.title,
    artist:
      meta?.common.artist?.trim() || meta?.common.artists?.map((a: string) => a.trim()).filter(Boolean).join(', ') || fromName.artist,
    album: meta?.common.album?.trim() || null,
    albumArtist: meta?.common.albumartist?.trim() || null,
    year: yearFromMeta(meta?.common.year, meta?.common.date),
    trackNo: meta?.common.track?.no ?? trackNoFromFilename(filename),
    discNo: meta?.common.disk?.no ?? null,
  };
}

export async function readLocalTags(filePath: string): Promise<LocalAudioTags> {
  const resolved = path.resolve(filePath);
  assertAudioPath(resolved);
  preparedPaths.add(resolved);
  const meta = await parseFile(resolved).catch(() => null);
  return tagsFromMeta(path.basename(resolved), meta);
}

function isAudioFilename(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase());
}

function naturalPath(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function collectAudio(dir: string, depth: number, acc: string[]): Promise<void> {
  if (depth < 0) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectAudio(full, depth - 1, acc);
    else if (entry.isFile() && isAudioFilename(entry.name)) acc.push(full);
  }
}

async function findFolderCover(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir).catch(() => []);
  const lower = new Map(entries.map((name) => [name.toLowerCase(), name]));
  for (const name of COVER_FILES) {
    const hit = lower.get(name);
    if (hit) return path.join(dir, hit);
  }
  return null;
}

export async function readCoverJpeg(filePath: string): Promise<Buffer | null> {
  const resolved = path.resolve(filePath);
  const data = await fs.readFile(resolved).catch(() => null);
  if (!data?.length) return null;
  return embeddedCoverToJpeg(data);
}

export async function pickAlbumFolder(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Папка альбома',
  });
  if (canceled || !filePaths[0]) return null;
  return filePaths[0];
}

export async function expandUploadSources(paths: string[]): Promise<ExpandedUploadSources> {
  const files: string[] = [];
  const albums: UploadAlbumSource[] = [];
  for (const raw of paths) {
    const resolved = path.resolve(raw);
    const st = await fs.stat(resolved).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      const audio: string[] = [];
      await collectAudio(resolved, 3, audio);
      audio.sort(naturalPath);
      for (const file of audio) preparedPaths.add(path.resolve(file));
      if (audio.length) {
        albums.push({
          title: path.basename(resolved),
          files: audio,
          coverPath: await findFolderCover(resolved),
        });
      }
    } else if (st.isFile() && isAudioFilename(resolved)) {
      preparedPaths.add(resolved);
      files.push(resolved);
    }
  }
  return { files, albums };
}

export async function readSidecarLyricsFile(
  audioPath: string,
): Promise<{ format: 'lrc' | 'txt'; text: string } | undefined> {
  const base = audioPath.replace(/\.[^.]+$/, '');
  try {
    const text = await fs.readFile(`${base}.lrc`, 'utf8');
    if (text.trim()) return { format: 'lrc', text };
  } catch {
    /* нет .lrc */
  }
  try {
    const text = await fs.readFile(`${base}.txt`, 'utf8');
    if (text.trim()) return { format: 'txt', text };
  } catch {
    /* нет .txt */
  }
  return undefined;
}

/**
 * Привязанный файл можно читать через mss-stream://file, поэтому путь из renderer проверяем:
 * расширение должно быть аудийным, а привязать можно только то, что перед этим разобрали.
 */
const preparedPaths = new Set<string>();

function assertAudioPath(resolved: string): void {
  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(ext)) throw new Error('Поддерживаются только аудиофайлы');
}

export async function pickAudioFiles(): Promise<string[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
  });
  if (canceled) return [];
  for (const file of filePaths) preparedPaths.add(path.resolve(file));
  return filePaths;
}

export async function bindLocalTrack(trackId: string, entry: LocalTrackEntry): Promise<void> {
  const resolved = path.resolve(entry.path);
  assertAudioPath(resolved);
  if (!preparedPaths.has(resolved)) throw new Error('Файл не выбирался в этом сеансе');
  const idx = await loadIndex();
  idx[trackId] = { path: resolved, contentHash: entry.contentHash.toLowerCase() };
  await saveIndex();
}

export async function resolveLocalTrackPath(trackId: string): Promise<string | null> {
  const idx = await loadIndex();
  const row = idx[trackId];
  if (!row) return null;
  try {
    await fs.access(row.path);
    return row.path;
  } catch {
    return null;
  }
}

export function isRegisteredLocalPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const idx = index ?? {};
  return Object.values(idx).some((e) => path.resolve(e.path) === resolved);
}

export async function initLocalTrackIndex(): Promise<void> {
  await loadIndex();
}
