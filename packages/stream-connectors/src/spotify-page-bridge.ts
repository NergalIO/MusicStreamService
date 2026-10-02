import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPOTIFY_PAGE_BRIDGE_VERSION = 9;

const CONNECT_DEVICE_RE = /(https:\/\/[^/]+)\/connect-state\/v1\/devices\/(hobs_[0-9a-f]{16,})/;
const LOCAL_RE =
  /this web browser|этот веб-браузер|этот браузер|this computer|этот компьютер|this device|это устройство/i;
const WEB_PLAYER_RE = /web player|веб-плеер/i;
const PAUSE_RE = /pause|pausar|pausa|pauzeren|pausieren|пауз|приостанов|一時停止|暂停/i;
const CONNECT_ROW_RE =
  /^(?:connect to this device|подключиться к этому устройству|подключить это устройство)[.…]?/i;
const PLAYING_RE =
  /^(?:playing on|listening on|воспроизводится на|воспроизведение на|слушаете на|играет на)\s+/i;

export interface SpotifyConnectDevice {
  origin: string;
  id: string;
  url: string;
}

export function parseConnectDeviceUrl(url: string): SpotifyConnectDevice | null {
  const m = String(url).match(CONNECT_DEVICE_RE);
  if (!m) return null;
  return { origin: m[1], id: m[2], url: m[0] };
}

/** Свой плеер первым: чужие hobs_ из пикера не должны перебивать быстрый старт. */
export function preferOwnDeviceUrls(seen: string[], ownUrl: string | null | undefined): string[] {
  const unique: string[] = [];
  const add = (url: string) => {
    if (!url || unique.includes(url)) return;
    unique.push(url);
  };
  if (ownUrl) add(ownUrl);
  for (const url of seen) add(url);
  return unique;
}

export function pickConnectDevice(
  seen: string[],
  ownUrl?: string | null,
): SpotifyConnectDevice | null {
  for (const url of preferOwnDeviceUrls(seen, ownUrl)) {
    const parsed = parseConnectDeviceUrl(url);
    if (parsed) return parsed;
  }
  return null;
}

export function parseClock(t: string | null | undefined): number {
  return (t || '')
    .trim()
    .split(':')
    .reduce((acc, part) => acc * 60 + (Number(part) || 0), 0) * 1000;
}

/** null — шкалы нет или длительность ещё неизвестна, в max уезжать нельзя. */
export function seekSliderValue(positionMs: number, max: number, durationMs: number): number | null {
  if (!(max > 0) || !(positionMs >= 0)) return null;
  if (max > 1000) return Math.min(positionMs, max);
  if (!(durationMs > 1000)) return null;
  return (Math.min(positionMs, durationMs) / durationMs) * max;
}

export function isPauseAriaLabel(label: string | null | undefined): boolean {
  return PAUSE_RE.test(String(label || ''));
}

export function isLocalDeviceName(name: string, userAgent = ''): boolean {
  const n = String(name || '');
  if (LOCAL_RE.test(n)) return true;
  if (!WEB_PLAYER_RE.test(n)) return false;
  const lower = n.toLowerCase();
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg')) return lower.includes('edge');
  if (ua.includes('firefox')) return lower.includes('firefox');
  if (ua.includes('chrome')) return lower.includes('chrome') && !lower.includes('edge');
  return false;
}

export function remoteNameFromBanner(text: string, userAgent = ''): string | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!PLAYING_RE.test(t)) return null;
  const name = t.replace(PLAYING_RE, '').trim();
  if (name && !isLocalDeviceName(name, userAgent)) return name;
  return null;
}

export function parsePickerRowName(text: string): string {
  const lines = String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !CONNECT_ROW_RE.test(s) && s.length <= 60);
  return lines[0] || '';
}

export function isPickerRowActive(opts: {
  ariaSelected?: boolean | null;
  ariaCurrent?: boolean | null;
  inList?: boolean;
}): boolean {
  if (opts.ariaSelected === true || opts.ariaCurrent === true) return true;
  if (opts.ariaSelected === false || opts.ariaCurrent === false) return false;
  return opts.inList === false;
}

export function matchPickerRow<T extends { name: string; active: boolean }>(
  rows: T[],
  target: string,
): T | undefined {
  const exactInactive = rows.find((d) => !d.active && d.name === target);
  if (exactInactive) return exactInactive;
  const exact = rows.find((d) => d.name === target);
  if (exact) return exact;
  if (!target) return undefined;
  const partial = rows.filter((d) => !d.active && d.name.includes(target));
  return partial.length === 1 ? partial[0] : undefined;
}

export function leftPrevNearEnd(positionMs: number, durationMs: number): boolean {
  return durationMs > 0 && durationMs - positionMs < 5000 && positionMs * 2 > durationMs;
}

export interface TrackEndWatch {
  armed: boolean;
  endedFor: string | null;
  lastTitle: string;
  lastAd: boolean;
  lastNearEnd: boolean;
  lastOurs: boolean;
}

export interface TrackEndSample {
  playing: boolean;
  ad: boolean;
  title: string;
  trackId: string | null;
  positionMs: number;
  durationMs: number;
}

export function emptyTrackEndWatch(): TrackEndWatch {
  return {
    armed: false,
    endedFor: null,
    lastTitle: '',
    lastAd: false,
    lastNearEnd: false,
    lastOurs: false,
  };
}

export function advanceTrackEnd(
  watch: TrackEndWatch,
  sample: TrackEndSample,
  expectedTrackId: string | null,
  endLeadMs: number,
  seeking = false,
): { watch: TrackEndWatch; emitTrackId: string | null } {
  const ours = !!(
    expectedTrackId &&
    (sample.trackId === expectedTrackId || (!sample.trackId && !!sample.title && sample.title === watch.lastTitle && watch.lastOurs))
  );
  if (seeking) {
    return {
      watch: {
        ...watch,
        armed: false,
        lastTitle: sample.title,
        lastAd: sample.ad,
        lastNearEnd: false,
        lastOurs: ours,
      },
      emitTrackId: null,
    };
  }
  const left = sample.durationMs - sample.positionMs;
  let armed = watch.armed;
  if (ours && sample.durationMs > 0 && left > endLeadMs && sample.playing && !sample.ad) armed = true;

  let emitTrackId: string | null = null;
  let endedFor = watch.endedFor;
  if (armed && !sample.ad && expectedTrackId && endedFor !== expectedTrackId) {
    const near = sample.durationMs > 0 && left <= endLeadMs;
    if (ours && sample.playing && near) emitTrackId = expectedTrackId;
    else if (!ours && watch.lastAd && sample.title && sample.title !== watch.lastTitle) {
      emitTrackId = expectedTrackId;
    } else if (!ours && watch.lastOurs && watch.lastNearEnd) emitTrackId = expectedTrackId;
  }
  if (emitTrackId) endedFor = emitTrackId;

  return {
    watch: {
      armed,
      endedFor,
      lastTitle: sample.title,
      lastAd: sample.ad,
      lastNearEnd: leftPrevNearEnd(sample.positionMs, sample.durationMs),
      lastOurs: ours,
    },
    emitTrackId,
  };
}

export function fastPlayConfirmed(
  state: { playing: boolean; ad: boolean; title: string; trackId: string | null },
  beforeTitle: string,
  trackId: string,
  pathname = '',
): boolean {
  if (state.ad) return true;
  if (!state.playing) return false;
  if (state.trackId === trackId) return true;
  if (pathname.includes(trackId)) return true;
  return !!(state.title && beforeTitle && state.title !== beforeTitle);
}

function loadBridge(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  try {
    return readFileSync(join(dir, 'spotify-page-bridge.inject.js'), 'utf8');
  } catch {
    return readFileSync(join(dir, '../src/spotify-page-bridge.inject.js'), 'utf8');
  }
}

export const SPOTIFY_PAGE_BRIDGE = loadBridge();
