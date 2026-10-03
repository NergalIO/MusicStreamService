import { BrowserWindow, ipcMain } from 'electron';
import { advanceTrackEnd, emptyTrackEndWatch, type TrackEndWatch } from '@mss/stream-connectors';
import { log } from './logger.js';
import {
  ensureSpotifyPageBridge,
  getSpotifyInjectorSession,
  isSpotifyWebAudible,
  setSpotifyControlled,
  setSpotifyWebMuted,
} from './spotify-session.js';
import type { PlaybackSnapshot } from '@mss/stream-connectors';

const POLL_WATCHDOG_MS = 4000;
const END_EARLY_MS = 900;
const MISMATCH_FAIL_MS = 1500;

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
  trackId: string | null;
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

let expectedTrackId: string | null = null;
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
let fadeTimer: ReturnType<typeof setInterval> | null = null;
/** When Spotify plays a different non-ad track than expected. */
let mismatchSince: number | null = null;

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

function isAdSnapshot(s: PlaybackSnapshot): boolean {
  const uri = s.uri ?? '';
  if (uri.includes(':ad:') || uri.includes(':episode:') && /spotify:ad/i.test(uri)) return true;
  const title = (s.title ?? '').toLowerCase();
  return /advertisement|реклам|spotify ad/.test(title);
}

function snapshotToConnectState(s: PlaybackSnapshot): SpotifyConnectState {
  const ad = isAdSnapshot(s);
  const trackId = s.id;
  const ours = expectedTrackId && trackId === expectedTrackId;
  return {
    trackId: (ours || ad) && expectedTrackId ? expectedTrackId : null,
    playing: s.isPlaying,
    positionMs: s.positionMs,
    durationMs: s.durationMs ?? 0,
    ad,
    adTitle: ad ? s.title || 'Реклама' : null,
    audible: isSpotifyWebAudible(),
  };
}

function emitConnectState(s: PlaybackSnapshot): SpotifyConnectState {
  const payload = snapshotToConnectState(s);
  send('spotify-connect:state', payload);
  return payload;
}

function handleSnapshot(s: PlaybackSnapshot, allowEnded = true): number {
  const ad = isAdSnapshot(s);
  const foreign =
    !starting &&
    !!expectedTrackId &&
    !ad &&
    s.isPlaying &&
    !!s.id &&
    s.id !== expectedTrackId;

  if (foreign) {
    if (mismatchSince == null) mismatchSince = Date.now();
    else if (Date.now() - mismatchSince >= MISMATCH_FAIL_MS) {
      mismatchSince = null;
      log.warn('spotify playing foreign track', s.id, 'expected', expectedTrackId);
      void getSpotifyInjectorSession()
        .command('pause')
        .catch(() => undefined);
      emitEnded();
      emitConnectState(s);
      return POLL_WATCHDOG_MS;
    }
  } else {
    mismatchSince = null;
  }

  if (allowEnded && expectedTrackId) {
    const payload = snapshotToConnectState(s);
    const next = advanceTrackEnd(
      endWatch,
      {
        playing: payload.playing,
        ad: payload.ad,
        title: s.title ?? '',
        trackId: payload.trackId ?? s.id,
        positionMs: payload.positionMs,
        durationMs: payload.durationMs,
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

async function poll(): Promise<void> {
  pollTimer = null;
  if (!active) return;
  try {
    const snapshot = await getSpotifyInjectorSession().getState();
    handleSnapshot(snapshot, !starting);
  } catch (e) {
    log.warn('spotify player poll failed', e instanceof Error ? e.message : e);
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

function mapDevices(devices: { id: string; name: string; isActive: boolean; type: string }[]): SpotifyDevice[] {
  const localRe = /this web browser|этот веб-браузер|этот браузер|this computer|этот компьютер|web player|веб-плеер/i;
  return devices.map((d) => ({
    name: d.name,
    active: d.isActive,
    local: localRe.test(d.name) || d.type === 'Computer',
  }));
}

function publishDevices(status: SpotifyDeviceStatus): SpotifyDeviceStatus {
  lastDevices = status;
  send('spotify-connect:device', { remoteName: status.remoteName, devices: status.devices });
  return status;
}

async function readDevices(): Promise<SpotifyDeviceStatus> {
  try {
    const result = await getSpotifyInjectorSession().getDevices();
    if (!result.ok || !result.devices?.length) return lastDevices;
    const devices = mapDevices(result.devices);
    const activeRemote = devices.find((d) => d.active && !d.local);
    const remoteName = activeRemote && !isSpotifyWebAudible() ? activeRemote.name : null;
    return publishDevices({ remoteName, devices });
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

async function play(trackId: string, positionMs = 0, albumId?: string): Promise<SpotifyPlayResult | undefined> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(trackId)) throw new Error('Некорректный id трека Spotify');
  const seq = ++playSeq;
  active = true;
  starting = true;
  mismatchSince = null;
  setSpotifyControlled(true);
  expectedTrackId = trackId;
  endedFor = null;
  endWatch = emptyTrackEndWatch();
  try {
    await ensureSpotifyPageBridge();
    const session = getSpotifyInjectorSession();
    const playResult = await session.command('play', {
      uri: `spotify:track:${trackId}`,
      positionMs,
      albumId,
    });
    if (seq !== playSeq) return;
    if (!playResult.ok) {
      const status = await readDevices();
      if (status.remoteName) {
        schedulePoll(POLL_WATCHDOG_MS);
        return {
          trackId: null,
          ad: false,
          adTitle: null,
          playing: false,
          positionMs,
          durationMs: 0,
          remoteDevice: status.remoteName,
        };
      }
      if (playResult.error === 'track_unavailable') throw new Error('Этот трек недоступен в Spotify');
      throw new Error(playResult.error ?? 'Не удалось запустить трек');
    }
    await new Promise((r) => setTimeout(r, 400));
    const snapshot = await session.getState();
    if (seq !== playSeq) return;
    const ad = isAdSnapshot(snapshot);
    if (!ad && snapshot.id !== trackId) {
      await session.command('pause').catch(() => undefined);
      throw new Error('Этот трек недоступен в Spotify');
    }
    const sent = emitConnectState(snapshot);
    schedulePoll(POLL_WATCHDOG_MS);
    const status = await readDevices();
    const remote = status.remoteName && !isSpotifyWebAudible() ? status.remoteName : null;
    return remoteAfterPlay(
      {
        trackId: ad ? trackId : snapshot.id,
        ad: sent.ad,
        adTitle: sent.adTitle,
        playing: sent.playing && (ad || snapshot.id === trackId),
        positionMs: sent.positionMs,
        durationMs: sent.durationMs,
        remoteDevice: null,
      },
      remote,
    );
  } catch (e) {
    if (seq !== playSeq) return;
    const status = await readDevices();
    if (status.remoteName) {
      schedulePoll(POLL_WATCHDOG_MS);
      return {
        trackId: null,
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
  await getSpotifyInjectorSession().command(playing ? 'resume' : 'pause');
  schedulePoll(400);
}

async function seek(positionMs: number): Promise<void> {
  await getSpotifyInjectorSession().command('seek', { positionMs });
  schedulePoll(400);
}

async function deviceStatus(): Promise<SpotifyDeviceStatus> {
  return withDevicePage(() => readDevices());
}

async function selectDevice(name: string): Promise<SpotifyDeviceStatus> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Устройство Spotify не найдено');
  return withDevicePage(async () => {
    const listed = await getSpotifyInjectorSession().getDevices();
    if (!listed.ok || !listed.devices) throw new Error('Устройства Spotify недоступны');
    const match = listed.devices.find((d) => d.name === trimmed);
    if (!match) throw new Error('Устройство Spotify не найдено');
    const localRe = /this web browser|этот веб-браузер|web player|веб-плеер/i;
    const isLocal = localRe.test(match.name);
    if (!isLocal) {
      const transfer = await getSpotifyInjectorSession().transferPlayback(match.id, true);
      if (!transfer.ok) throw new Error(transfer.error ?? 'Не удалось переключить устройство');
    }
    const devices = mapDevices(listed.devices);
    const remoteName = isLocal ? null : match.name;
    return publishDevices({ remoteName, devices, selectedLocal: isLocal });
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
    await getSpotifyInjectorSession().command('setVolume', { level: clamp01(next.percent / 100) });
    if (next.muted) await getSpotifyInjectorSession().command('setMute', { muted: true });
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
  if (fadeTimer) clearInterval(fadeTimer);
  if (ms <= 0) {
    await getSpotifyInjectorSession().command('setVolume', { level: to });
    return;
  }
  const started = Date.now();
  fadeTimer = setInterval(() => {
    const elapsed = Date.now() - started;
    const t = Math.min(1, elapsed / ms);
    const level = from + (to - from) * t;
    void getSpotifyInjectorSession().command('setVolume', { level });
    if (t >= 1 && fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }, 50);
  await new Promise((r) => setTimeout(r, ms + 60));
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

function setEndLead(ms: number): void {
  endLeadMs = Number.isFinite(ms) ? Math.max(0, Math.min(5000, Math.round(ms))) : END_EARLY_MS;
}

async function stop(): Promise<void> {
  const wasActive = active;
  playSeq++;
  active = false;
  starting = false;
  expectedTrackId = null;
  endedFor = null;
  mismatchSince = null;
  endWatch = emptyTrackEndWatch();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pendingVolume = null;
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  setSpotifyControlled(false);
  if (!wasActive) return;
  await getSpotifyInjectorSession().command('pause').catch(() => undefined);
}

export function registerSpotifyConnectIpc(): void {
  ipcMain.handle('spotify-connect:play', (_e, trackId: string, positionMs?: number, albumId?: string) =>
    play(trackId, positionMs, albumId),
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
