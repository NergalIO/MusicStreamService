import { app, BrowserWindow, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';
import { log } from './logger.js';

const { autoUpdater } = electronUpdater;

export type UpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloaded' | 'error' | 'dev';
  version?: string;
  message?: string;
};

export function initUpdater(getMainWindow: () => BrowserWindow | null): void {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.env.MSS_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MSS_UPDATE_URL });
  }

  const send = (payload: UpdateStatus) => {
    getMainWindow()?.webContents.send('update:status', payload);
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', (info) => send({ state: 'not-available', version: info.version }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => {
    log.warn('updater', err.message);
    send({ state: 'error', message: err.message });
  });

  ipcMain.handle('update:check', async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return { state: 'dev' };
    try {
      const result = await autoUpdater.checkForUpdates();
      return { state: 'checking', version: result?.updateInfo.version };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('updater check failed', message);
      return { state: 'error', message };
    }
  });
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  if (app.isPackaged) {
    setTimeout(() => void autoUpdater.checkForUpdates().catch((e) => log.warn('updater', e)), 8_000);
  }
}
