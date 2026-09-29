import { BrowserWindow, ipcMain } from 'electron';
import { log } from './logger.js';
import { isSpotifyWebAudible, setSpotifyControlled, setSpotifyWebMuted, spotifyWebExec } from './spotify-web-session.js';

/**
 * MSS ведёт встроенный веб-плеер Spotify через его же интерфейс: страница трека + кнопки,
 * слайдеры прогресса и громкости. Web API / Connect здесь не нужны — они отвечают 429 токену веб-плеера.
 */

const POLL_PLAYING_MS = 1000;
const POLL_NEAR_END_MS = 250;
const POLL_PAUSED_MS = 3000;
/** Заканчиваем трек сами, пока Spotify не включил автоплей-рекомендацию. */
const END_EARLY_MS = 900;

export interface SpotifyConnectState {
  trackId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  ad: boolean;
  adTitle: string | null;
}

export interface SpotifyPlayResult {
  ad: boolean;
  adTitle: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** Активное устройство Spotify Connect, если это не веб-плеер. */
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

interface DomState {
  ready: boolean;
  title: string;
  playing: boolean;
  ad: boolean;
  positionMs: number;
  durationMs: number;
  trackTitle?: string;
}

const DOM_HELPERS = `
  const q = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isPauseLabel = (el) => /pause|пауз/i.test(el?.getAttribute('aria-label') || '');
  const AD_TITLE = /advertisement|реклама|advertencia|publicit[eé]|werbung|annuncio/i;
  const isAd = () => {
    if (q('[data-testid="ad-skip-button"], [data-testid="ad-cta-button"], [data-testid="preview-ad"], [data-testid="ad-banner"]')) return true;
    const title = (q('[data-testid="context-item-info-title"]')?.textContent || '').trim();
    const sub = (q('[data-testid="context-item-info-subtitles"]')?.textContent || '').trim();
    if (AD_TITLE.test(title) || AD_TITLE.test(sub)) return true;
    return AD_TITLE.test(q('[data-testid="now-playing-widget"]')?.getAttribute('aria-label') || '');
  };
  const parseClock = (t) => (t || '').trim().split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0) * 1000;
  const bumpVol = () => { window.__mssVolGen = (window.__mssVolGen || 0) + 1; return window.__mssVolGen; };
  const setRange = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const readState = () => {
    const button = q('[data-testid="control-button-playpause"]');
    const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
    return {
      ready: !!button,
      title: (q('[data-testid="context-item-info-title"]')?.textContent || '').trim(),
      playing: isPauseLabel(button),
      ad: isAd(),
      positionMs: parseClock(q('[data-testid="playback-position"]')?.textContent),
      durationMs: Number(progress?.max) || parseClock(q('[data-testid="playback-duration"]')?.textContent),
    };
  };
`;

function playScript(trackId: string, positionMs: number): string {
  return `(async () => {
    ${DOM_HELPERS}
    for (let i = 0; i < 80 && !q('[data-testid="control-button-playpause"]'); i++) await sleep(250);
    if (!q('[data-testid="control-button-playpause"]')) throw new Error('Веб-плеер Spotify не загрузился');
    const path = '/track/${trackId}';
    if (location.pathname !== path) {
      const before = q('main h1')?.textContent || '';
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      for (let i = 0; i < 20 && (q('main h1')?.textContent || '') === before; i++) await sleep(250);
    }
    let button = null;
    let heading = '';
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      heading = (q('main h1')?.textContent || '').trim();
      button = q('main [data-testid="action-bar-row"] [data-testid="play-button"]');
      if (button && heading && location.pathname === path) break;
      button = null;
    }
    if (!button) throw new Error('Не удалось открыть трек в веб-плеере Spotify');
    if (!isPauseLabel(button)) button.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const s = readState();
      if (s.playing && (s.title === heading || s.ad)) break;
    }
    const state = readState();
    if (!state.ad && state.title !== heading) throw new Error('Spotify не запустил трек — проверьте веб-плеер (Spotify → Веб-плеер)');
    state.trackTitle = heading;
    const target = ${Math.round(positionMs)};
    if (!state.ad && Math.abs(state.positionMs - target) > 2000) {
      const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
      if (progress) setRange(progress, target);
      state.positionMs = target;
    }
    return state;
  })()`;
}

const STATE_SCRIPT = `(() => { ${DOM_HELPERS} return readState(); })()`;

function clickPlayPauseScript(wantPlaying: boolean): string {
  return `(() => {
    ${DOM_HELPERS}
    const button = q('[data-testid="control-button-playpause"]');
    if (!button) throw new Error('Веб-плеер Spotify не загрузился');
    if (isPauseLabel(button) !== ${wantPlaying}) button.click();
    return true;
  })()`;
}

function seekScript(positionMs: number): string {
  return `(() => {
    ${DOM_HELPERS}
    const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
    if (!progress) return false;
    setRange(progress, Math.min(${Math.round(positionMs)}, Number(progress.max) || ${Math.round(positionMs)}));
    return true;
  })()`;
}

function volumeScript(fraction: number): string {
  return `(() => {
    ${DOM_HELPERS}
    bumpVol();
    const volume = q('[data-testid="volume-bar"] input[type="range"]');
    if (!volume) return false;
    setRange(volume, ${fraction.toFixed(2)});
    return true;
  })()`;
}

let expectedTrackId: string | null = null;
let expectedTitle: string | null = null;
let lastState: DomState | null = null;
let endedFor: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let volumeBusy = false;
let pendingVolume: { percent: number; muted: boolean } | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let fadeGen = 0;
let active = false;
let playSeq = 0;
let endLeadMs = END_EARLY_MS;

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

function toConnectState(s: DomState): SpotifyConnectState {
  const ours = !!expectedTitle && s.title === expectedTitle;
  const ad = !!s.ad;
  return {
    trackId: (ours || ad) && expectedTrackId ? expectedTrackId : null,
    playing: s.playing,
    positionMs: s.positionMs,
    durationMs: s.durationMs,
    ad,
    adTitle: ad ? s.title || 'Реклама' : null,
  };
}

function emitConnectState(s: DomState): SpotifyConnectState {
  const payload = toConnectState(s);
  send('spotify-connect:state', payload);
  return payload;
}

async function poll(): Promise<void> {
  pollTimer = null;
  if (!active) return;
  let next = POLL_PAUSED_MS;
  try {
    const s = await spotifyWebExec<DomState>(STATE_SCRIPT);
    const prev = lastState;
    lastState = s;
    const ours = !!expectedTitle && s.title === expectedTitle;
    const left = s.durationMs - s.positionMs;
    if (!s.ad) {
      if (ours && s.playing && s.durationMs > 0 && left <= endLeadMs) {
        emitEnded();
      } else if (!ours && prev?.ad && expectedTitle && s.title !== expectedTitle) {
        emitEnded();
      } else if (!ours && prev?.title === expectedTitle && prev.durationMs - prev.positionMs < 5000) {
        emitEnded();
      }
    }
    emitConnectState(s);
    if (s.ad) next = POLL_NEAR_END_MS;
    else if (s.playing) next = left > 0 && left < 4000 ? POLL_NEAR_END_MS : POLL_PLAYING_MS;
  } catch (e) {
    log.warn('spotify web player poll failed', e instanceof Error ? e.message : e);
  }
  schedulePoll(next);
}

const EMPTY_DEVICES: SpotifyDeviceStatus = { remoteName: null, devices: [] };
let lastDevices: SpotifyDeviceStatus = EMPTY_DEVICES;
let pageGate: Promise<void> = Promise.resolve();

function withSpotifyPage<T>(fn: () => Promise<T>): Promise<T> {
  const run = pageGate.then(fn, fn);
  pageGate = run.then(
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

/** Меню «Подключиться к устройству» в веб-плеере. Web API Connect сюда не ходим: токен плеера ловит 429. */
function spotifyDeviceScript(action: 'list' | 'select', targetJson: string): string {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const action = ${JSON.stringify(action)};
    const target = ${targetJson};
    const IDLE = new Set([
      'connect to a device',
      'подключиться к устройству',
      'подключение к устройству',
      'conectar a un dispositivo',
      'connecter à un appareil',
      'mit einem gerät verbinden',
      'connetti a un dispositivo',
      'een apparaat verbinden',
      'połącz z urządzeniem',
      '连接到设备',
      '接続先のデバイス',
    ]);
    const isIdle = (label) => IDLE.has(String(label || '').trim().toLowerCase());
    const isLocal = (name) => {
      const n = String(name || '').toLowerCase();
      return n.includes('this web browser') || n.includes('этот веб-браузер') || n.includes('web player')
        || n.includes('веб-плеер') || n.includes('этот браузер') || n.includes('this computer') || n.includes('этот компьютер');
    };
    const listeningName = (text) => {
      const t = String(text || '').replace(/\\s+/g, ' ').trim();
      const lower = t.toLowerCase();
      const marks = ['listening on ', 'playing on ', 'слушаете на ', 'воспроизводится на ', 'воспроизведение на ', 'играет на '];
      for (const mark of marks) {
        const i = lower.indexOf(mark);
        if (i >= 0) return t.slice(i + mark.length).trim();
      }
      return '';
    };
    const connectButton = () => {
      const direct = document.querySelector('[data-testid="connect-device-picker"], [data-testid="device-picker-icon-button"], [data-testid="control-button-connect"]');
      if (direct) return direct;
      return [...document.querySelectorAll('button')].find((b) => {
        const label = (b.getAttribute('aria-label') || '').trim();
        return isIdle(label) || /устройств|device/i.test(label);
      }) || null;
    };
    const rowActive = (b) => {
      const cls = typeof b.className === 'string' ? b.className : '';
      return b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true'
        || b.getAttribute('aria-pressed') === 'true' || cls.split(/\\s+/).includes('active');
    };
    const rowName = (b) => String(b.innerText || b.getAttribute('aria-label') || '')
      .split('\\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    const parseRoot = (root) => {
      const opener = connectButton();
      const buttons = [...root.querySelectorAll('[data-testid="device-picker-item"], button, [role="menuitemcheckbox"], [role="menuitem"], [role="option"]')];
      const devices = [];
      const seen = new Set();
      for (const b of buttons) {
        if (b === opener) continue;
        const name = rowName(b);
        if (!name || name.length > 80 || isIdle(name) || seen.has(name)) continue;
        seen.add(name);
        devices.push({ name, active: rowActive(b), local: isLocal(name), el: b });
      }
      return devices;
    };
    const findMenu = () => {
      const roots = [...document.querySelectorAll('[role="menu"], [role="dialog"], [data-testid="device-picker"], [data-testid*="device-picker"]')];
      return roots.find((root) => parseRoot(root).length > 0) || null;
    };
    const btn = connectButton();
    const wasOpen = !!btn && btn.getAttribute('aria-expanded') === 'true';
    if (btn && !wasOpen) btn.click();
    let menu = null;
    for (let i = 0; i < 25; i++) {
      menu = findMenu();
      if (menu) break;
      await sleep(80);
    }
    const rows = menu ? parseRoot(menu) : [];
    const closeMenu = async () => {
      if (!btn) return;
      if (btn.getAttribute('aria-expanded') === 'true') btn.click();
      await sleep(40);
    };
    if (action === 'select') {
      const row = rows.find((d) => d.name === target) || rows.find((d) => target && d.name.includes(target));
      if (!row) {
        await closeMenu();
        throw new Error('Устройство Spotify не найдено');
      }
      row.el.click();
      await sleep(200);
      if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
      return {
        remoteName: row.local ? null : row.name,
        selectedLocal: !!row.local,
        devices: rows.map(({ name, active, local }) => ({ name, active: name === row.name, local })),
      };
    }
    await closeMenu();
    let remoteName = null;
    const activeRemote = rows.find((d) => d.active && !d.local);
    if (activeRemote) remoteName = activeRemote.name;
    else if (!rows.some((d) => d.active && d.local)) {
      const label = (btn && btn.getAttribute('aria-label')) || '';
      const fromLabel = listeningName(label);
      if (fromLabel && !isLocal(fromLabel)) remoteName = fromLabel;
      else if (label && !isIdle(label) && !isLocal(label)) remoteName = label.trim();
      if (!remoteName) {
        const bars = [...document.querySelectorAll('[class*="connectBar"], [data-testid*="connect-bar"]')];
        for (const bar of bars) {
          const name = listeningName(bar.textContent || '');
          if (name && !isLocal(name)) { remoteName = name; break; }
        }
      }
    }
    return { remoteName, devices: rows.map(({ name, active, local }) => ({ name, active, local })) };
  })()`;
}

async function readDevices(): Promise<SpotifyDeviceStatus> {
  try {
    const status = await spotifyWebExec<SpotifyDeviceStatus>(spotifyDeviceScript('list', '""'));
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

async function remoteAfterPlay(fallback: SpotifyPlayResult): Promise<SpotifyPlayResult> {
  if (!isSpotifyWebAudible()) await new Promise((r) => setTimeout(r, 900));
  const status = await readDevices();
  if (!status.remoteName) return { ...fallback, remoteDevice: null };
  return { ...fallback, playing: false, remoteDevice: status.remoteName };
}

async function play(trackId: string, positionMs = 0): Promise<SpotifyPlayResult | undefined> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(trackId)) throw new Error('Некорректный id трека Spotify');
  return withSpotifyPage(async () => {
    const seq = ++playSeq;
    active = true;
    setSpotifyControlled(true);
    expectedTrackId = trackId;
    expectedTitle = null;
    endedFor = null;
    lastState = null;
    try {
      const state = await spotifyWebExec<DomState>(playScript(trackId, positionMs));
      if (seq !== playSeq) return;
      expectedTitle = state.trackTitle || state.title;
      lastState = state;
      const sent = emitConnectState(state);
      schedulePoll(state.ad ? 250 : 600);
      return remoteAfterPlay({
        ad: sent.ad,
        adTitle: sent.adTitle,
        playing: sent.playing,
        positionMs: sent.positionMs,
        durationMs: sent.durationMs,
        remoteDevice: null,
      });
    } catch (e) {
      if (seq !== playSeq) return;
      const status = await readDevices();
      if (status.remoteName) {
        schedulePoll(600);
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
    }
  });
}

async function setPlaying(playing: boolean): Promise<void> {
  await withSpotifyPage(async () => {
    if (playing) {
      active = true;
      setSpotifyControlled(true);
    }
    await spotifyWebExec(clickPlayPauseScript(playing));
    schedulePoll(400);
  });
}

async function seek(positionMs: number): Promise<void> {
  await withSpotifyPage(async () => {
    await spotifyWebExec(seekScript(positionMs));
    schedulePoll(400);
  });
}

async function deviceStatus(): Promise<SpotifyDeviceStatus> {
  return withSpotifyPage(() => readDevices());
}

async function selectDevice(name: string): Promise<SpotifyDeviceStatus> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Устройство Spotify не найдено');
  return withSpotifyPage(async () => {
    const status = await spotifyWebExec<SpotifyDeviceStatus>(spotifyDeviceScript('select', JSON.stringify(trimmed)));
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

function cancelFade(): void {
  fadeGen += 1;
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

function setVolume(percent: number, muted: boolean): void {
  cancelFade();
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
    await spotifyWebExec(volumeScript(clamp01(next.percent / 100)));
  } catch (e) {
    log.warn('spotify volume failed', e instanceof Error ? e.message : e);
  } finally {
    volumeBusy = false;
    if (pendingVolume) void flushVolume();
  }
}

async function fadeVolume(fromPercent: number, toPercent: number, durationMs: number): Promise<void> {
  cancelFade();
  const from = clamp01(fromPercent / 100);
  const to = clamp01(toPercent / 100);
  const ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const push = (fraction: number) => {
    pendingVolume = { percent: fraction * 100, muted: false };
    void flushVolume();
  };
  if (ms <= 0) {
    push(to);
    return;
  }
  const gen = fadeGen;
  const start = Date.now();
  push(from);
  await new Promise<void>((resolve) => {
    fadeTimer = setInterval(() => {
      if (gen !== fadeGen) {
        resolve();
        return;
      }
      const t = Math.min(1, (Date.now() - start) / ms);
      push(from + (to - from) * t);
      if (t >= 1) {
        if (fadeTimer) clearInterval(fadeTimer);
        fadeTimer = null;
        resolve();
      }
    }, 50);
  });
}

function setEndLead(ms: number): void {
  endLeadMs = Number.isFinite(ms) ? Math.max(0, Math.min(5000, Math.round(ms))) : END_EARLY_MS;
}

/** MSS переключился на другой источник или очистил очередь. */
async function stop(): Promise<void> {
  const wasActive = active;
  playSeq++;
  active = false;
  expectedTrackId = null;
  expectedTitle = null;
  lastState = null;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pendingVolume = null;
  cancelFade();
  setSpotifyControlled(false);
  if (wasActive) {
    await spotifyWebExec('window.__mssVolGen = (window.__mssVolGen || 0) + 1').catch(() => undefined);
    await spotifyWebExec(clickPlayPauseScript(false)).catch(() => undefined);
  }
}

export function registerSpotifyConnectIpc(): void {
  ipcMain.handle('spotify-connect:play', (_e, trackId: string, positionMs?: number) => play(trackId, positionMs));
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
