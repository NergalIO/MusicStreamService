import { BrowserWindow, ipcMain } from 'electron';
import { log } from './logger.js';
import {
  currentSpotifyWebHeaders,
  isSpotifyWebAudible,
  onSpotifyPageMessage,
  setSpotifyControlled,
  setSpotifyWebMuted,
  spotifyConnectDeviceUrls,
  spotifyWebExec,
} from './spotify-web-session.js';

/**
 * MSS ведёт встроенный веб-плеер Spotify через его же интерфейс: страница трека + кнопки,
 * слайдеры прогресса и громкости. Публичный Web API отвечает 429 токену веб-плеера, поэтому
 * быстрый старт (тестовая функция) шлёт команду во внутренний connect-state, как сам веб-плеер.
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
  remoteName?: string | null;
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

/**
 * Шлёт состояние плеера в main сразу при изменении нижней панели (console.debug с префиксом `__mss:state:`),
 * чтобы пауза/запуск отражались в MSS без ожидания опроса. Ставится один раз на страницу.
 */
const STATE_OBSERVER = `
  (function(){
    if (window.__mssObserver) return;
    const pick = () => document.querySelector('[data-testid="now-playing-bar"]') || document.querySelector('footer');
    let last = '';
    let queued = false;
    const push = () => {
      queued = false;
      const s = readState();
      const key = JSON.stringify(s);
      if (key === last) return;
      last = key;
      console.debug('__mss:state:' + key);
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      setTimeout(push, 16);
    };
    let bar = null;
    const obs = new MutationObserver(schedule);
    const attach = () => {
      const next = pick();
      if (!next || next === bar) return;
      obs.disconnect();
      bar = next;
      obs.observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'value', 'max'] });
      schedule();
    };
    window.__mssObserver = obs;
    attach();
    const timer = setInterval(attach, 1000);
    window.addEventListener('pagehide', () => {
      clearInterval(timer);
      obs.disconnect();
      window.__mssObserver = null;
    }, { once: true });
  })();
`;

interface FastAuth {
  authorization: string;
  clientToken: string;
  appVersion: string;
  devices: string[];
}

/**
 * Быстрый старт: команда «play» в Spotify Connect от этого веб-плеера самому себе — тот же канал,
 * которым веб-плеер управляет устройствами. false — что-то не сошлось, дальше работает обычный путь.
 */
const FAST_PLAY = `
  const fastPlay = async (auth, trackId, positionMs) => {
    const devices = [];
    const add = (url) => {
      const m = String(url).match(/(https:\\/\\/[^\\/]+)\\/connect-state\\/v1\\/devices\\/(hobs_[0-9a-f]{16,})/);
      if (!m) return;
      const i = devices.findIndex((d) => d.id === m[2]);
      if (i >= 0) devices.splice(i, 1);
      devices.push({ origin: m[1], id: m[2] });
    };
    (auth.devices || []).forEach(add);
    performance.getEntriesByType('resource').forEach((e) => add(e.name));
    const dev = devices[devices.length - 1];
    if (!dev) return false;
    const before = readState();
    const uri = 'spotify:track:' + trackId;
    const res = await fetch(dev.origin + '/connect-state/v1/player/command/from/' + dev.id + '/to/' + dev.id, {
      method: 'POST',
      headers: {
        authorization: auth.authorization,
        'client-token': auth.clientToken,
        'spotify-app-version': auth.appVersion,
        'app-platform': 'WebPlayer',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        command: {
          context: { uri, url: 'context://' + uri, metadata: {} },
          play_origin: { feature_identifier: 'harmony', feature_version: auth.appVersion || '' },
          options: { skip_to: { track_uri: uri }, seek_to: positionMs, player_options_override: {} },
          logging_params: { command_id: Math.random().toString(16).slice(2) + Date.now().toString(16) },
          endpoint: 'play',
        },
      }),
    });
    if (!res.ok) return false;
    for (let t = 0; t < 5000; t += 80) {
      const s = readState();
      const restarted = s.positionMs < positionMs + 3000 && (!before.playing || before.positionMs > positionMs + 3000);
      if (!s.ad && s.playing && (s.title !== before.title || restarted)) return true;
      await sleep(80);
    }
    return false;
  };
`;

function playScript(trackId: string, positionMs: number, fast: FastAuth | null): string {
  return `(async () => {
    ${DOM_HELPERS}
    ${DEVICE_HELPERS}
    ${STATE_OBSERVER}
    const tick = 80;
    const waitFor = async (ms, ok) => {
      for (let t = 0; t < ms; t += tick) {
        if (ok()) return true;
        await sleep(tick);
      }
      return !!ok();
    };
    await waitFor(20000, () => q('[data-testid="control-button-playpause"]'));
    if (!q('[data-testid="control-button-playpause"]')) throw new Error('Веб-плеер Spotify не загрузился');
    const target = ${Math.round(positionMs)};
    const fast = ${JSON.stringify(fast)};
    ${FAST_PLAY}
    if (fast && await fastPlay(fast, ${JSON.stringify(trackId)}, target).catch(() => false)) {
      const state = readState();
      state.trackTitle = state.title;
      state.remoteName = remoteFromBar();
      return state;
    }
    const path = '/track/${trackId}';
    if (location.pathname !== path) {
      const before = q('main h1')?.textContent || '';
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      await waitFor(5000, () => (q('main h1')?.textContent || '') !== before);
    }
    let button = null;
    let heading = '';
    await waitFor(20000, () => {
      heading = (q('main h1')?.textContent || '').trim();
      button = q('main [data-testid="action-bar-row"] [data-testid="play-button"]');
      return !!(button && heading && location.pathname === path);
    });
    if (!button || location.pathname !== path) throw new Error('Не удалось открыть трек в веб-плеере Spotify');
    if (!(await transferHere())) {
      throw new Error('Spotify играет на устройстве «' + (remoteFromBar() || 'другом') + '» — выберите MSS в списке устройств');
    }
    if (!isPauseLabel(button)) button.click();
    await waitFor(10000, () => {
      const s = readState();
      return s.playing && (s.title === heading || s.ad);
    });
    const state = readState();
    if (!state.ad && state.title !== heading) throw new Error('Spotify не запустил трек — проверьте веб-плеер (Spotify → Веб-плеер)');
    state.trackTitle = heading;
    if (!state.ad && Math.abs(state.positionMs - target) > 2000) {
      const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
      if (progress) setRange(progress, target);
      state.positionMs = target;
    }
    state.remoteName = remoteFromBar();
    return state;
  })()`;
}

const STATE_SCRIPT = `(() => { ${DOM_HELPERS} return readState(); })()`;

function clickPlayPauseScript(wantPlaying: boolean): string {
  return `(() => {
    ${DOM_HELPERS}
    ${STATE_OBSERVER}
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

/** Разбирает состояние страницы (из опроса или от наблюдателя) и возвращает, через сколько опросить снова. */
function handleState(s: DomState): number {
  const prev = lastState;
  lastState = s;
  const ours = !!expectedTitle && s.title === expectedTitle;
  const left = s.durationMs - s.positionMs;
  // Сразу после запуска в панели ещё прошлый трек у своего конца: ловим конец только после того,
  // как наш трек увидели играющим не у конца.
  if (ours && s.durationMs > 0 && left > endLeadMs) armed = true;
  if (!s.ad && armed && !starting) {
    if (ours && s.playing && s.durationMs > 0 && left <= endLeadMs) {
      emitEnded();
    } else if (!ours && prev?.ad && expectedTitle && s.title !== expectedTitle) {
      emitEnded();
    } else if (!ours && prev && prev.title === expectedTitle && leftPrevNearEnd(prev)) {
      emitEnded();
    }
  }
  emitConnectState(s);
  if (s.ad) return POLL_NEAR_END_MS;
  if (s.playing) return left > 0 && left < 4000 ? POLL_NEAR_END_MS : POLL_PLAYING_MS;
  return POLL_PAUSED_MS;
}

/** У короткого трека «меньше 5 с до конца» верно с самого начала, поэтому смотрим ещё и на долю трека. */
function leftPrevNearEnd(prev: DomState): boolean {
  if (!(prev.durationMs > 0)) return false;
  return prev.durationMs - prev.positionMs < 5000 && prev.positionMs * 2 > prev.durationMs;
}

let starting = false;
let armed = false;

function onPageMessage(message: string): void {
  if (!active || starting || !expectedTitle || !message.startsWith('__mss:state:')) return;
  let s: DomState;
  try {
    s = JSON.parse(message.slice('__mss:state:'.length)) as DomState;
  } catch {
    return;
  }
  const next = handleState(s);
  if (next === POLL_NEAR_END_MS) schedulePoll(next);
}

async function poll(): Promise<void> {
  pollTimer = null;
  if (!active) return;
  // Пока идёт запуск, состояние страницы относится к прошлому треку.
  if (starting) {
    schedulePoll(POLL_NEAR_END_MS);
    return;
  }
  let next = POLL_PAUSED_MS;
  try {
    next = handleState(await spotifyWebExec<DomState>(STATE_SCRIPT));
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

/**
 * Панель устройств веб-плеера. «This web browser» — это мы; «Playing on …» в нижней панели — чужое устройство.
 * Имя «Web Player (Chrome)» носят и другие встроенные плееры (телефон, второй ПК), поэтому по нему себя не узнаём.
 */
const DEVICE_HELPERS = `
  const dSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LOCAL_RE = /this web browser|этот веб-браузер|этот браузер|this computer|этот компьютер|this device|это устройство/i;
  const PLAYING_RE = /^(?:playing on|listening on|воспроизводится на|воспроизведение на|слушаете на|играет на)\\s+/i;
  const CONNECT_ROW_RE = /^(?:connect to this device|подключиться к этому устройству|подключить это устройство)[.…]?/i;
  const isLocalName = (n) => LOCAL_RE.test(String(n || ''));
  const remoteFromBar = () => {
    const bar = document.querySelector('[data-testid="now-playing-bar"]') || document.querySelector('footer');
    if (!bar) return null;
    for (const el of bar.querySelectorAll('button, a, span, div')) {
      if (el.childElementCount > 4) continue;
      const t = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!PLAYING_RE.test(t)) continue;
      const name = t.replace(PLAYING_RE, '').trim();
      if (name && !isLocalName(name)) return name;
    }
    return null;
  };
  const connectBtn = () =>
    document.querySelector('[data-testid="connect-device-picker"], [data-testid="device-picker-icon-button"], [data-testid="control-button-connect"]')
    || [...document.querySelectorAll('[data-testid="now-playing-bar"] button, footer button')]
      .find((b) => /connect|device|устройств/i.test(b.getAttribute('aria-label') || '')) || null;
  const pickerRows = () => [...document.querySelectorAll('[data-testid="device-picker-row-sidepanel"], [data-testid="device-picker-item"]')];
  const openPicker = async () => {
    if (pickerRows().length) return true;
    const b = connectBtn();
    if (!b) return false;
    b.click();
    for (let i = 0; i < 30 && !pickerRows().length; i++) await dSleep(100);
    return pickerRows().length > 0;
  };
  const closePicker = async () => {
    if (!pickerRows().length) return;
    const close = document.querySelector('[data-testid="PanelHeader_CloseButton"] button, [data-testid="PanelHeader_CloseButton"]');
    if (close) close.click(); else connectBtn()?.click();
    for (let i = 0; i < 20 && pickerRows().length; i++) await dSleep(100);
  };
  const readPicker = () => {
    const out = [];
    const seen = new Set();
    for (const row of pickerRows()) {
      const titled = row.querySelector('[data-testid="list-row-title"]')?.textContent;
      const lines = String(titled || row.innerText || '').split('\\n').map((s) => s.trim()).filter((s) => s && !CONNECT_ROW_RE.test(s));
      const name = lines[lines.length - 1] || '';
      if (!name || name.length > 60) continue;
      const inList = !!row.closest('ul, [role="list"]');
      const key = name + (inList ? '|list' : '|current');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, active: !inList, local: isLocalName(name), el: row.querySelector('[role="button"]') || row });
    }
    return out;
  };
  const transferHere = async () => {
    if (!remoteFromBar()) return true;
    if (!(await openPicker())) return false;
    const here = readPicker().find((d) => d.local && !d.active);
    if (here) {
      here.el.click();
      for (let i = 0; i < 24 && remoteFromBar(); i++) await dSleep(250);
    }
    await closePicker();
    return !remoteFromBar();
  };
`;

function spotifyDeviceScript(action: 'list' | 'peek' | 'select', targetJson: string): string {
  return `(async () => {
    ${DEVICE_HELPERS}
    const action = ${JSON.stringify(action)};
    const target = ${targetJson};
    const plain = (list) => list.map(({ name, active, local }) => ({ name, active, local }));
    if (action === 'select') {
      if (!(await openPicker())) throw new Error('Кнопка устройств Spotify не найдена');
      const rows = readPicker();
      const row = rows.find((d) => !d.active && d.name === target)
        || rows.find((d) => !d.active && target && d.name.includes(target))
        || rows.find((d) => d.name === target);
      if (!row) {
        await closePicker();
        throw new Error('Устройство Spotify не найдено');
      }
      if (!row.active) row.el.click();
      for (let i = 0; i < 16; i++) {
        await dSleep(250);
        const r = remoteFromBar();
        if (row.local ? !r : r) break;
      }
      await closePicker();
      const remoteName = remoteFromBar();
      return { remoteName, selectedLocal: row.local && !remoteName, devices: plain(rows) };
    }
    let remoteName = remoteFromBar();
    let rows = [];
    if (action === 'list') {
      const wasOpen = pickerRows().length > 0;
      if (await openPicker()) {
        rows = readPicker();
        if (!wasOpen) await closePicker();
      }
      if (!remoteName) {
        const current = rows.find((d) => d.active && !d.local);
        if (current && rows.some((d) => d.local && !d.active)) remoteName = current.name;
      }
    }
    return { remoteName, devices: plain(rows) };
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

/** Имя чужого устройства берём из строки «Playing on …», которую вернул сценарий запуска, — без открытия панели устройств. */
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

async function play(trackId: string, positionMs = 0, fast = false): Promise<SpotifyPlayResult | undefined> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(trackId)) throw new Error('Некорректный id трека Spotify');
  return withSpotifyPage(async () => {
    const seq = ++playSeq;
    active = true;
    starting = true;
    setSpotifyControlled(true);
    expectedTrackId = trackId;
    expectedTitle = null;
    endedFor = null;
    armed = false;
    lastState = null;
    try {
      const state = await spotifyWebExec<DomState>(playScript(trackId, positionMs, fastAuth(fast)));
      if (seq !== playSeq) return;
      expectedTitle = state.trackTitle || state.title;
      lastState = state;
      const sent = emitConnectState(state);
      schedulePoll(state.ad ? 250 : 600);
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
    } finally {
      if (seq === playSeq) starting = false;
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
  starting = false;
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
