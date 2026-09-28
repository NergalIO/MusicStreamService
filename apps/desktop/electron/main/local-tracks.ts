import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, dialog } from 'electron';

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
  durationMs: number | null;
  sizeBytes: number;
  originalFilename: string;
}

type Index = Record<string, LocalTrackEntry>;

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
  const stat = await fs.stat(resolved);
  const originalFilename = path.basename(resolved);
  const { title, artist } = tagsFromFilename(originalFilename);
  const contentHash = await hashFile(resolved);
  return {
    path: resolved,
    contentHash,
    title,
    artist,
    album: null,
    durationMs: null,
    sizeBytes: stat.size,
    originalFilename,
  };
}

export async function pickAudioFiles(): Promise<string[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma', 'aiff', 'ape', 'wv', 'webm'] }],
  });
  if (canceled) return [];
  return filePaths;
}

export async function bindLocalTrack(trackId: string, entry: LocalTrackEntry): Promise<void> {
  const idx = await loadIndex();
  idx[trackId] = { path: path.resolve(entry.path), contentHash: entry.contentHash.toLowerCase() };
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
