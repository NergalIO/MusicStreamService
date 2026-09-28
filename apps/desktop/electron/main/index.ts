import dotenv from 'dotenv';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { repairChromiumDiskCache } from './cache-repair.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotenvFiles(): void {
  const candidates = [
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(__dirname, '../../../.env'),
    path.join(path.dirname(process.execPath), '.env'),
  ];
  if (!app.isPackaged) {
    candidates.push(path.resolve(app.getAppPath(), '../../.env'));
    candidates.push(path.resolve(app.getAppPath(), '../../../.env'));
  }
  try {
    candidates.push(path.join(app.getPath('userData'), '.env'));
  } catch {
    /* before ready */
  }
  for (const p of candidates) dotenv.config({ path: p });
}

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { initLogging } from './logger.js';
import { getAppSettings, launchedHidden, registerAppSettingsIpc } from './app-settings.js';
import { initConnectors } from './connectors.js';
import { initCrashReporter, registerCrashIpc } from './crash-reporter.js';
import { attachDeepLinkWindow, extractDeepLink, handleDeepLink, initDeepLinks } from './deep-links.js';
import { disposeDiscordPresence, initDiscordPresence } from './discord-presence.js';
import { disposeGlobalShortcuts, initGlobalShortcuts } from './global-shortcuts.js';
import { registerDownloadsIpc } from './downloads.js';
import { registerConnectorIpc } from './ipc-connectors.js';
import { disposeMedia, initMedia, showTrayHint } from './media.js';
import { initUpdater } from './updater.js';
import {
  decryptMssToTemp,
  initOfflineStore,
  listOffline,
  removeOffline,
  saveOffline,
} from './offline-store.js';
import { initLocalTracks, registerLocalTracksIpc } from './local-tracks-ipc.js';
import { handleRendererProtocol, registerRendererScheme, rendererLoadUrl } from './renderer-protocol.js';
import { fileStreamUrl, handleStreamProtocol, registerStreamScheme } from './stream-protocol.js';
import { loadBounds, persistBounds } from './window-bounds.js';
import { attachWindowState, registerWindowControls } from './window-controls.js';

initLogging();
initCrashReporter();
registerStreamScheme();
registerRendererScheme();

let mainWindow: BrowserWindow | null = null;

function preloadPath(): string {
  const candidates = [
    path.join(__dirname, '../preload/index.mjs'),
    path.join(__dirname, '../preload/index.js'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

function resourcePath(name: string): string | undefined {
  const candidates = [path.join(__dirname, '../../resources', name), path.join(app.getAppPath(), 'resources', name)];
  return candidates.find((p) => fs.existsSync(p));
}

function appIconPath(): string | undefined {
  return resourcePath(process.platform === 'win32' ? 'icon.ico' : 'icon.png') ?? resourcePath('icon.png');
}

function getDeviceId(): string {
  const file = path.join(app.getPath('userData'), 'device.json');
  if (fs.existsSync(file)) {
    const { deviceId } = JSON.parse(fs.readFileSync(file, 'utf8')) as { deviceId: string };
    return deviceId;
  }
  const deviceId = randomUUID();
  fs.writeFileSync(file, JSON.stringify({ deviceId }));
  return deviceId;
}

function createRendererWindow(
  options: Electron.BrowserWindowConstructorOptions,
  query?: Record<string, string>,
): BrowserWindow {
  const icon = appIconPath();
  const win = new BrowserWindow({
    backgroundColor: '#0b0b0f',
    ...(icon ? { icon } : {}),
    ...options,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const search = query ? `?${new URLSearchParams(query)}` : '';
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${search}`);
  } else {
    win.loadURL(rendererLoadUrl(query));
  }
  return win;
}

const MAIN_MIN = { width: 1000, height: 660 };
const MAIN_FILE = 'main-window.json';
let quitting = false;

function createMainWindow(hidden = false): BrowserWindow {
  const saved = loadBounds(MAIN_FILE, { min: MAIN_MIN });
  const win = createRendererWindow({
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1360, height: 860 }),
    minWidth: MAIN_MIN.width,
    minHeight: MAIN_MIN.height,
    title: 'MusicStreamService',
    frame: false,
    show: false,
  });
  if (saved?.maximized) win.maximize();
  if (!hidden) win.once('ready-to-show', () => win.show());
  attachWindowState(win);
  persistBounds(win, MAIN_FILE);
  win.on('close', (e) => {
    if (quitting || !getAppSettings().closeToTray) return;
    e.preventDefault();
    win.hide();
    showTrayHint();
  });
  win.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
  return win;
}

export function showMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerAppIpc(): void {
  ipcMain.handle('app:getDeviceId', () => getDeviceId());

  ipcMain.handle('offline:list', () => listOffline());
  ipcMain.handle('offline:remove', (_e, trackId: string) => removeOffline(trackId));
  ipcMain.handle('offline:save', (_e, trackId: string, buffer: ArrayBuffer) => {
    const filePath = path.join(app.getPath('userData'), 'offline', `${trackId}.mss`);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    saveOffline(trackId, filePath);
    return filePath;
  });
  ipcMain.handle('offline:resolvePlayUrl', (_e, trackId: string, userId: string) => {
    const row = listOffline().find((r) => r.trackId === trackId);
    if (!row) throw new Error('Not offline');
    const { blobPath } = decryptMssToTemp(row.path, userId, getDeviceId());
    return fileStreamUrl(blobPath);
  });
}

if (process.platform === 'win32') app.setAppUserModelId('com.mss.desktop');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    showMainWindow();
    const url = extractDeepLink(argv);
    if (url) handleDeepLink(url);
  });
  initDeepLinks(() => mainWindow);
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  loadDotenvFiles();
  await repairChromiumDiskCache();
  initOfflineStore();
  await initLocalTracks();
  initConnectors();
  handleStreamProtocol();
  handleRendererProtocol();

  registerAppIpc();
  registerLocalTracksIpc();
  registerConnectorIpc();
  registerDownloadsIpc();
  registerWindowControls();
  registerAppSettingsIpc();
  registerCrashIpc();

  mainWindow = createMainWindow(launchedHidden());
  attachDeepLinkWindow(mainWindow);
  initMedia({
    getMainWindow: () => mainWindow,
    createRendererWindow,
    trayIconPath: (dark) => resourcePath(dark ? 'tray.ico' : 'tray-light.ico') ?? appIconPath(),
    resourcePath,
  });
  initGlobalShortcuts(() => mainWindow);
  initUpdater(() => mainWindow);
  initDiscordPresence();

  app.on('activate', () => showMainWindow());
});

app.on('before-quit', () => {
  quitting = true;
  disposeDiscordPresence();
  disposeMedia();
});

app.on('will-quit', () => disposeGlobalShortcuts());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
