import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron';
import type { PlayerCommand, PlayerProgress, PlayerSnapshot, VolumeChange } from '../preload/index.js';
import { getAppSettings, updateAppSettings } from './app-settings.js';
import { routeSpotifyMediaCommand } from './spotify-web-session.js';
import { loadBounds, persistBounds } from './window-bounds.js';

interface MediaOptions {
  getMainWindow: () => BrowserWindow | null;
  createRendererWindow: (options: Electron.BrowserWindowConstructorOptions, query?: Record<string, string>) => BrowserWindow;
  /** Иконка трея под тему: белая для тёмной панели задач, цветная для светлой. */
  trayIconPath: (dark: boolean) => string | undefined;
  resourcePath: (name: string) => string | undefined;
}

let tray: Tray | null = null;
let miniWindow: BrowserWindow | null = null;
let lastState: PlayerSnapshot = {
  title: '',
  artist: '',
  playing: false,
  hasTrack: false,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  radio: false,
};
let lastProgress: PlayerProgress | null = null;
const stateListeners = new Set<(state: PlayerSnapshot) => void>();
const progressListeners = new Set<(progress: PlayerProgress | null) => void>();

function showMain(opts: MediaOptions): void {
  const win = opts.getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function sendPlayerCommand(opts: Pick<MediaOptions, 'getMainWindow'>, command: PlayerCommand): void {
  if (routeSpotifyMediaCommand(command)) return;
  opts.getMainWindow()?.webContents.send('player:command', command);
}

function sendCommand(opts: MediaOptions, command: PlayerCommand): void {
  if (command === 'show') return showMain(opts);
  sendPlayerCommand(opts, command);
}

const MINI_DEFAULT = { width: 460, height: 112 };
const MINI_MIN = { width: 300, height: 96 };
const MINI_MAX = { width: 720, height: 720 };
const MINI_FILE = 'mini-window.json';

function notifyMiniOpen(opts: MediaOptions): void {
  opts.getMainWindow()?.webContents.send('mini:open', !!miniWindow && !miniWindow.isDestroyed());
}

function toggleMini(opts: MediaOptions): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.close();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const saved = loadBounds(MINI_FILE, { min: MINI_MIN, max: MINI_MAX });
  const bounds = saved
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : {
        ...MINI_DEFAULT,
        x: workArea.x + workArea.width - MINI_DEFAULT.width - 24,
        y: workArea.y + workArea.height - MINI_DEFAULT.height - 24,
      };
  const win = opts.createRendererWindow(
    {
      ...bounds,
      minWidth: MINI_MIN.width,
      minHeight: MINI_MIN.height,
      maxWidth: MINI_MAX.width,
      maxHeight: MINI_MAX.height,
      frame: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      title: 'MSS — мини-плеер',
    },
    { mini: '1' },
  );
  miniWindow = win;
  persistBounds(win, MINI_FILE);

  win.webContents.on('did-finish-load', () => win.webContents.send('player:state', lastState));
  win.on('closed', () => {
    miniWindow = null;
    rebuildTrayMenu(opts);
    notifyMiniOpen(opts);
  });
  rebuildTrayMenu(opts);
  notifyMiniOpen(opts);
}

function sleepMenu(opts: MediaOptions): Electron.MenuItemConstructorOptions {
  const sleep = lastState.sleep;
  const active = !!sleep?.endsAt || !!sleep?.afterTrack;
  const minutesLeft = sleep?.endsAt ? Math.max(1, Math.round((sleep.endsAt - Date.now()) / 60_000)) : 0;
  return {
    label: sleep?.endsAt ? `Таймер сна · ${minutesLeft} мин` : sleep?.afterTrack ? 'Таймер сна · после трека' : 'Таймер сна',
    submenu: [
      ...[15, 30, 45, 60, 90].map((m) => ({
        label: `${m} минут`,
        click: () => sendCommand(opts, `sleep:${m}`),
      })),
      { label: 'До конца трека', click: () => sendCommand(opts, 'sleep:track') },
      { type: 'separator' },
      { label: 'Выключить', enabled: active, click: () => sendCommand(opts, 'sleep:off') },
    ],
  };
}

function rebuildTrayMenu(opts: MediaOptions): void {
  if (!tray) return;
  const nowPlaying = lastState.hasTrack ? `${lastState.title} — ${lastState.artist}` : 'Ничего не играет';
  tray.setToolTip(lastState.hasTrack ? `MSS: ${nowPlaying}` : 'MusicStreamService');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: nowPlaying.length > 60 ? `${nowPlaying.slice(0, 57)}…` : nowPlaying, enabled: false },
      { type: 'separator' },
      {
        label: lastState.playing ? 'Пауза' : 'Играть',
        enabled: lastState.hasTrack,
        click: () => sendCommand(opts, 'toggle'),
      },
      { label: 'Следующий', enabled: lastState.hasTrack, click: () => sendCommand(opts, 'next') },
      { label: 'Предыдущий', enabled: lastState.hasTrack, click: () => sendCommand(opts, 'prev') },
      {
        label: lastState.liked ? 'Убрать из «Мне нравится»' : 'Мне нравится',
        enabled: lastState.hasTrack,
        click: () => sendCommand(opts, 'like'),
      },
      sleepMenu(opts),
      { type: 'separator' },
      { label: miniWindow ? 'Закрыть мини-плеер' : 'Мини-плеер', click: () => toggleMini(opts) },
      { label: 'Открыть MSS', click: () => showMain(opts) },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ]),
  );
}

function trayImage(opts: MediaOptions): Electron.NativeImage {
  const file = opts.trayIconPath(nativeTheme.shouldUseDarkColors);
  return file ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
}

const thumbIcons = new Map<string, Electron.NativeImage>();

function thumbIcon(opts: MediaOptions, name: string): Electron.NativeImage {
  let icon = thumbIcons.get(name);
  if (!icon) {
    const file = opts.resourcePath(`thumbar/${name}.png`);
    icon = file ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
    thumbIcons.set(name, icon);
  }
  return icon;
}

/** Кнопки «назад / играть / вперёд» на миниатюре окна в панели задач Windows. */
function updateThumbar(opts: MediaOptions): void {
  const win = opts.getMainWindow();
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const flags: Electron.ThumbarButton['flags'] = lastState.hasTrack ? [] : ['disabled'];
  win.setThumbarButtons([
    { tooltip: 'Предыдущий', icon: thumbIcon(opts, 'prev'), flags, click: () => sendCommand(opts, 'prev') },
    {
      tooltip: lastState.playing ? 'Пауза' : 'Играть',
      icon: thumbIcon(opts, lastState.playing ? 'pause' : 'play'),
      flags,
      click: () => sendCommand(opts, 'toggle'),
    },
    { tooltip: 'Следующий', icon: thumbIcon(opts, 'next'), flags, click: () => sendCommand(opts, 'next') },
  ]);
}

function updateTaskbarProgress(opts: MediaOptions): void {
  const win = opts.getMainWindow();
  if (!win || win.isDestroyed()) return;
  const p = lastProgress;
  if (!p || !lastState.hasTrack || !p.duration) {
    win.setProgressBar(-1);
    return;
  }
  win.setProgressBar(Math.min(1, p.position / p.duration), { mode: p.playing ? 'normal' : 'paused' });
}

export function initMedia(opts: MediaOptions): void {
  tray = new Tray(trayImage(opts));
  tray.on('click', () => showMain(opts));
  rebuildTrayMenu(opts);
  nativeTheme.on('updated', () => tray?.setImage(trayImage(opts)));

  const main = opts.getMainWindow();
  main?.once('ready-to-show', () => updateThumbar(opts));
  // Кнопки миниатюры сбрасываются, когда окно прячут в трей.
  main?.on('show', () => updateThumbar(opts));

  ipcMain.on('player:state', (_e, state: PlayerSnapshot) => {
    const buttonsChanged = state.playing !== lastState.playing || state.hasTrack !== lastState.hasTrack;
    lastState = state;
    rebuildTrayMenu(opts);
    if (buttonsChanged) updateThumbar(opts);
    updateTaskbarProgress(opts);
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('player:state', state);
    stateListeners.forEach((l) => l(state));
  });
  ipcMain.on('player:progress', (_e, progress: PlayerProgress | null) => {
    lastProgress = progress;
    updateTaskbarProgress(opts);
    progressListeners.forEach((l) => l(progress));
  });
  ipcMain.on('player:spectrum', (_e, bands: number[]) => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('player:spectrum', bands);
  });
  ipcMain.on('player:command', (_e, command: PlayerCommand) => sendCommand(opts, command));
  ipcMain.on('player:volume', (_e, change: VolumeChange) => opts.getMainWindow()?.webContents.send('player:volume', change));
  ipcMain.on('window:toggleMini', () => toggleMini(opts));
  ipcMain.on('window:closeMini', () => miniWindow?.close());
}

/** Один раз объясняет, куда делось окно после закрытия крестиком. */
export function showTrayHint(): void {
  if (!tray || getAppSettings().trayHintShown || process.platform !== 'win32') return;
  tray.displayBalloon({
    title: 'MSS продолжает играть',
    content: 'Приложение свёрнуто в трей. Выйти можно через меню значка; поведение крестика меняется в настройках.',
    iconType: 'info',
  });
  updateAppSettings({ trayHintShown: true });
}

export function getLastPlayerState(): PlayerSnapshot {
  return lastState;
}

export function getLastProgress(): PlayerProgress | null {
  return lastProgress;
}

export function onPlayerState(listener: (state: PlayerSnapshot) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function onPlayerProgress(listener: (progress: PlayerProgress | null) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function disposeMedia(): void {
  tray?.destroy();
  tray = null;
}
