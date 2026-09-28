import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { decodeMssPackage, deriveContentKey } from '@mss/mss-format';

const OFFLINE_SECRET = process.env.OFFLINE_HKDF_SECRET ?? 'offline-dev-secret';

interface OfflineIndex {
  tracks: Record<string, { filePath: string; downloadedAt: string }>;
}

function indexPath(): string {
  return path.join(app.getPath('userData'), 'offline-index.json');
}

function readIndex(): OfflineIndex {
  const p = indexPath();
  if (!fs.existsSync(p)) return { tracks: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8')) as OfflineIndex;
}

function writeIndex(index: OfflineIndex): void {
  fs.writeFileSync(indexPath(), JSON.stringify(index, null, 2));
}

export function initOfflineStore(): void {
  const dir = path.join(app.getPath('userData'), 'offline');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(indexPath())) writeIndex({ tracks: {} });
}

export function listOffline(): { trackId: string; path: string }[] {
  const index = readIndex();
  return Object.entries(index.tracks).map(([trackId, v]) => ({
    trackId,
    path: v.filePath,
  }));
}

export function saveOffline(trackId: string, filePath: string): void {
  const index = readIndex();
  index.tracks[trackId] = { filePath, downloadedAt: new Date().toISOString() };
  writeIndex(index);
}

export function removeOffline(trackId: string): void {
  const index = readIndex();
  const row = index.tracks[trackId];
  if (row?.filePath && fs.existsSync(row.filePath)) fs.unlinkSync(row.filePath);
  delete index.tracks[trackId];
  writeIndex(index);
}

function readTrackIdFromMss(data: Buffer): string {
  const h = data.subarray(8, 24).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function decryptMssToTemp(
  mssPath: string,
  userId: string,
  deviceId: string,
): { blobPath: string; trackId: string } {
  const data = fs.readFileSync(mssPath);
  const trackId = readTrackIdFromMss(data);
  const key = deriveContentKey(userId, deviceId, trackId, OFFLINE_SECRET);
  const { payload } = decodeMssPackage(data, deviceId, key, OFFLINE_SECRET);
  const tmp = path.join(app.getPath('temp'), `${trackId}.ogg`);
  fs.writeFileSync(tmp, payload);
  return { blobPath: tmp, trackId };
}
