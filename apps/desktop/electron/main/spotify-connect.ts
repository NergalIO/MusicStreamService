import { BrowserWindow, ipcMain } from 'electron';
import { log } from './logger.js';
import { advanceTrackEnd, emptyTrackEndWatch, type TrackEndWatch } from '@mss/stream-connectors';
import {
  currentSpotifyWebHeaders,
  invalidateSpotifyWebHeaders,
  isSpotifyWebAudible,
  markSpotifyOwnDevice,
  onSpotifyPageMessage,
  setSpotifyControlled,
  setSpotifyWebMuted,
  spotifyConnectDeviceUrls,
  spotifyWebExec,
  spotifyWebHeaders,
} from './spotify-web-session.js';

/**
 * MSS ведёт встроенный веб-плеер Spotify через window.__mss на странице.
 * Публичный Web API отвечает 429 токену веб-плеера, поэтому быстрый старт
 * шлёт команду во внутренний connect-state этого же плеера.
 */

const POLL_WATCHDOG_MS = 4000;
const END_EARLY_MS = 900;

export interface SpotifyConnectState {
  trackId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  ad: boolean;
  adTitle: string | null;
  audible: boolean;
}

export interface SpotifyPlayResult {
  ad: boolean;
  adTitle: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  remoteDevice: string | null;
}

export interface SpotifyDevice {
  name: string;
  active: boolean;
  local: boolean;
}

export interface SpotifyDeviceStatus {
  remoteName: string | null;
  devices: SpotifyDevice[];
  selectedLocal?: boolean;
}

interface PageState {
  ready?: boolean;
  title: string;
  playing: boolean;
  ad: boolean;
  positionMs: number;
  durationMs: number;
  trackTitle?: string;
  trackId?: string | null;
  remoteName?: string | null;
  deviceUrl?: string | null;
  cancelled?: boolean;
  authFailed?: boolean;
  error?: string;
}

interface FastAuth {
  authorization: string;
  clientToken: string;
  appVersion: string;
  devices: string[];
}

let expectedTrackId: string | null = null;
let expectedTitle: string | null = null;
let lastState: PageState | null = null;
let endedFor: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let volumeBusy = false;
let pendingVolume: { percent: number; muted: boolean } | null = null;
let active = false;
let playSeq = 0;
let endLeadMs = END_EARLY_MS;
let starting = false;
let endWatch: TrackEndWatch = emptyTrackEndWatch();
let lastDevices: SpotifyDeviceStatus = { remoteName: null, devices: [] };
let deviceGate: Promise<void> = Promise.resolve();

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function schedulePoll(ms: number): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = active ? setTimeout(() => void poll(), ms) : null;
}

function emitEnded(): void {
  if (!expectedTrackId || endedFor === expectedTrackId) return;
  endedFor = expectedTrackId;
  send('spotify-connect:ended', { trackId: expectedTrackId });
}

function toConnectState(s: PageState): SpotifyConnectState {
  const ours = (expectedTrackId && s.trackId === expectedTrackId) || (!!expectedTitle && s.title === expectedTitle);
  const ad = !!s.ad;
  return {
    trackId: (ours || ad) && expectedTrackId ? expectedTrackId : null,
    playing: s.playing,
    positionMs: s.positionMs,
    durationMs: s.durationMs,
    ad,
    adTitle: ad ? s.title || 'Реклама' : null,
    audible: isSpotifyWebAudible(),
  };
}

function emitConnectState(s: PageState): SpotifyConnectState {
  const payload = toConnectState(s);
  send('spotify-connect:state', payload);
  return payload;
}

function handleState(s: PageState, allowEnded = true): number {
  lastState = s;
  if (allowEnded && expectedTrackId) {
    const sampleTrackId =
      s.trackId || (expectedTitle && s.title === expectedTitle ? expectedTrackId : null);
    const next = advanceTrackEnd(
      endWatch,
      {
        playing: !!s.playing,
        ad: !!s.ad,
        title: s.title || '',
        trackId: sampleTrackId ?? null,
        positionMs: s.positionMs || 0,
        durationMs: s.durationMs || 0,
      },
      expectedTrackId,
      endLeadMs,
    );
    endWatch = next.watch;
    if (next.emitTrackId) emitEnded();
  }
  emitConnectState(s);
  return POLL_WATCHDOG_MS;
}

function onPageMessage(message: string): void {
  if (!active) return;
  if (message.startsWith('__mss:ended:')) {
    if (!starting) emitEnded();
    return;
  }
  if (!expectedTrackId || !message.startsWith('__mss:state:')) return;
  try {
    handleState(JSON.parse(message.slice('__mss:state:'.length)) as PageState, !starting);
  } catch {
    /* ignore malformed page payload */
  }
}

async function poll(): Promise<void> {
  pollTimer = null;
  if (!active) return;
  try {
    handleState(await spotifyWebExec<PageState>('window.__mss.state()'), !starting);
  } catch (e) {
    log.warn('spotify web player poll failed', e instanceof Error ? e.message : e);
  }
  schedulePoll(starting ? 400 : POLL_WATCHDOG_MS);
}

function withDevicePage<T>(fn: () => Promise<T>): Promise<T> {
  const run = deviceGate.then(fn, fn);
  deviceGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function publishDevices(status: SpotifyDeviceStatus): SpotifyDeviceStatus {
  lastDevices = status;
  send('spotify-connect:device', { remoteName: status.remoteName, devices: status.devices });
  return status;
}

async function readDevices(action: 'list' | 'peek' = 'list'): Promise<SpotifyDeviceStatus> {
  try {
    const status = await spotifyWebExec<SpotifyDeviceStatus>(`window.__mss.devices(${JSON.stringify(action)})`);
    const remoteName = status?.remoteName && !isSpotifyWebAudible() ? status.remoteName : null;
    return publishDevices({
      remoteName,
      devices: Array.isArray(status?.devices) ? status.devices : [],
    });
  } catch (e) {
    log.warn('spotify devices', e instanceof Error ? e.message : e);
    return lastDevices;
  }
}

function remoteAfterPlay(fallback: SpotifyPlayResult, remoteName: string | null | undefined): SpotifyPlayResult {
  const remote = remoteName && !isSpotifyWebAudible() ? remoteName : null;
  publishDevices({ ...lastDevices, remoteName: remote });
  if (!remote) return { ...fallback, remoteDevice: null };
  return { ...fallback, playing: false, remoteDevice: remote };
}

function fastAuth(fast: boolean): FastAuth | null {
  const headers = fast ? currentSpotifyWebHeaders() : null;
  return headers ? { ...headers, devices: spotifyConnectDeviceUrls() } : null;
}

function playCall(trackId: string, positionMs: number, auth: FastAuth | null): Promise<PageState> {
  return spotifyWebExec<PageState>(
    `window.__mss.play(${JSON.stringify(trackId)}, ${Math.round(positionMs)}, ${JSON.stringify(auth)})`,
  );
}

async function playOnce(trackId: string, positionMs: number, fast: boolean, retried: boolean): Promise<PageState> {
  const state = await playCall(trackId, positionMs, fastAuth(fast));
  if (state?.authFailed && fast && !retried) {
    invalidateSpotifyWebHeaders();
    await spotifyWebHeaders().catch(() => undefined);
    return playCall(trackId, positionMs, fastAuth(true));
  }
  return state;
}

async function play(trackId: string, positionMs = 0, fast = false): Promise<SpotifyPlayResult | undefined> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(trackId)) throw new Error('Некорректный id трека Spotify');
  const seq = ++playSeq;
  active = true;
  starting = true;
  setSpotifyControlled(true);
  expectedTrackId = trackId;
  expectedTitle = null;
  endedFor = null;
  endWatch = emptyTrackEndWatch();
  lastState = null;
  try {
    const state = await playOnce(trackId, positionMs, fast, false);
    if (seq !== playSeq) return;
    if (state?.cancelled) return;
    if (state?.deviceUrl) markSpotifyOwnDevice(state.deviceUrl);
    if (state?.error && !state.remoteName && !state.ad) throw new Error(state.error);
    if (state.playing || state.ad) {
      expectedTitle = state.trackTitle || state.title;
    }
    lastState = state;
    const sent = emitConnectState(state);
    if (state.playing && !state.remoteName && isSpotifyWebAudible()) {
      markSpotifyOwnDevice(state.deviceUrl ?? spotifyConnectDeviceUrls()[0]);
    }
    schedulePoll(POLL_WATCHDOG_MS);
    return remoteAfterPlay(
      {
        ad: sent.ad,
        adTitle: sent.adTitle,
        playing: sent.playing,
        positionMs: sent.positionMs,
        durationMs: sent.durationMs,
        remoteDevice: null,
      },
      state.remoteName,
    );
  } catch (e) {
    if (seq !== playSeq) return;
    const status = await readDevices('peek');
    if (status.remoteName) {
      schedulePoll(POLL_WATCHDOG_MS);
      return {
        ad: false,
        adTitle: null,
        playing: false,
        positionMs,
        durationMs: 0,
        remoteDevice: status.remoteName,
      };
    }
    throw e;
  } finally {
    if (seq === playSeq) starting = false;
  }
}

async function setPlaying(playing: boolean): Promise<void> {
  if (playing) {
    active = true;
    setSpotifyControlled(true);
  }
  await spotifyWebExec(playing ? 'window.__mss.resume()' : 'window.__mss.pause()');
  schedulePoll(400);
}

async function seek(positionMs: number): Promise<void> {
  await spotifyWebExec(`window.__mss.seek(${Math.round(positionMs)})`);
  schedulePoll(400);
}

async function deviceStatus(): Promise<SpotifyDeviceStatus> {
  return withDevicePage(() => readDevices());
}

async function selectDevice(name: string): Promise<SpotifyDeviceStatus> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Устройство Spotify не найдено');
  return withDevicePage(async () => {
    const status = await spotifyWebExec<SpotifyDeviceStatus>(
      `window.__mss.devices("select", ${JSON.stringify(trimmed)})`,
    );
    return publishDevices({
      remoteName: status?.remoteName || null,
      devices: Array.isArray(status?.devices) ? status.devices : [],
      selectedLocal: !!status?.selectedLocal,
    });
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function setVolume(percent: number, muted: boolean): void {
  setSpotifyWebMuted(muted);
  pendingVolume = { percent, muted };
  void flushVolume();
}

async function flushVolume(): Promise<void> {
  if (volumeBusy) return;
  const next = pendingVolume;
  if (!next) return;
  pendingVolume = null;
  volumeBusy = true;
  try {
    await spotifyWebExec(`window.__mss.setVolume(${clamp01(next.percent / 100)})`);
  } catch (e) {
    log.warn('spotify volume failed', e instanceof Error ? e.message : e);
  } finally {
    volumeBusy = false;
    if (pendingVolume) void flushVolume();
  }
}

async function fadeVolume(fromPercent: number, toPercent: number, durationMs: number): Promise<void> {
  setSpotifyWebMuted(false);
  const from = clamp01(fromPercent / 100);
  const to = clamp01(toPercent / 100);
  const ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  await spotifyWebExec(`window.__mss.fadeVolume(${from}, ${to}, ${ms})`);
}

function setEndLead(ms: number): void {
  endLeadMs = Number.isFinite(ms) ? Math.max(0, Math.min(5000, Math.round(ms))) : END_EARLY_MS;
  void spotifyWebExec(`window.__mss.setEndLead(${endLeadMs})`).catch(() => undefined);
}

async function stop(): Promise<void> {
  const wasActive = active;
  playSeq++;
  active = false;
  starting = false;
  expectedTrackId = null;
  expectedTitle = null;
  lastState = null;
  endWatch = emptyTrackEndWatch();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pendingVolume = null;
  setSpotifyControlled(false);
  if (!wasActive) return;
  await spotifyWebExec('window.__mss.cancel()').catch(() => undefined);
  await spotifyWebExec('window.__mss.stop()').catch(() => undefined);
}

export function registerSpotifyConnectIpc(): void {
  onSpotifyPageMessage(onPageMessage);
  ipcMain.handle('spotify-connect:play', (_e, trackId: string, positionMs?: number, fast?: boolean) =>
    play(trackId, positionMs, !!fast),
  );
  ipcMain.handle('spotify-connect:pause', () => setPlaying(false));
  ipcMain.handle('spotify-connect:resume', () => setPlaying(true));
  ipcMain.handle('spotify-connect:seek', (_e, positionMs: number) => seek(positionMs));
  ipcMain.handle('spotify-connect:setVolume', (_e, percent: number, muted: boolean) => setVolume(percent, muted));
  ipcMain.handle('spotify-connect:fadeVolume', (_e, fromPercent: number, toPercent: number, durationMs: number) =>
    fadeVolume(fromPercent, toPercent, durationMs),
  );
  ipcMain.handle('spotify-connect:setEndLead', (_e, ms: number) => setEndLead(ms));
  ipcMain.handle('spotify-connect:stop', () => stop());
  ipcMain.handle('spotify-connect:deviceStatus', () => deviceStatus());
  ipcMain.handle('spotify-connect:selectDevice', (_e, name: string) => selectDevice(name));
}
