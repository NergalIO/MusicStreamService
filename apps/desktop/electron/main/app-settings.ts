import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { clientSecret, clientSecretSource } from './client-secrets.js';
import fs from 'node:fs';
import path from 'node:path';

export interface AppSettings {
  /** Крестик прячет окно в трей, музыка продолжает играть. */
  closeToTray: boolean;
  /** При автозапуске с Windows сразу уходить в трей. */
  startMinimized: boolean;
  /** Ctrl+Alt+Space / Ctrl+Alt+← → работают, даже когда MSS не в фокусе. */
  globalShortcuts: boolean;
  discordPresence: boolean;
  /** Большая картинка — обложка трека (если доступна по https). */
  discordShowCover: boolean;
  /** Кнопка «Открыть трек» для Яндекс / Spotify. */
  discordShowButton: boolean;
  /** Показывать статус на паузе; иначе скрывать. */
  discordShowOnPause: boolean;
  /** Application ID из Discord Developer Portal (legacy; предпочтительно userClientSecrets). */
  discordClientId?: string;
  /** Переопределение Client ID / secret из настроек (приоритет над .env и сборкой). */
  userClientSecrets?: Partial<
    Record<'SPOTIFY_CLIENT_ID' | 'DISCORD_CLIENT_ID' | 'YANDEX_CLIENT_ID' | 'YANDEX_CLIENT_SECRET', string>
  >;
  /** Свой OAuth Яндекс (иначе встроенный Music Android). */
  yandexCustomOAuth?: boolean;
  trayHintShown: boolean;
  /** REST API (как API_PUBLIC_URL на сервере), для presence и fallback без bake в сборке */
  apiPublicUrl?: string;
  /** Лимит кеша обложек, альбомов и текстов на диске. */
  cacheLimitMb?: number;
}

export interface SystemSettings extends AppSettings {
  openAtLogin: boolean;
  /** Client ID берётся из .env, настройки вручную не нужны. */
  discordClientIdFromEnv: boolean;
}

const DEFAULTS: AppSettings = {
  closeToTray: true,
  startMinimized: true,
  globalShortcuts: false,
  discordPresence: false,
  discordShowCover: true,
  discordShowButton: true,
  discordShowOnPause: true,
  trayHintShown: false,
};

export const HIDDEN_ARG = '--hidden';

let cache: AppSettings | null = null;
const listeners = new Set<(next: AppSettings, prev: AppSettings) => void>();

function file(): string {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

export function resolveDiscordClientId(): string {
  const env = clientSecret('DISCORD_CLIENT_ID');
  if (env) return env;
  return getAppSettings().discordClientId?.trim() ?? '';
}

export function getAppSettings(): AppSettings {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<AppSettings>) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const prev = getAppSettings();
  const next = { ...prev, ...patch };
  cache = next;
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  listeners.forEach((l) => l(next, prev));
  return next;
}

export function onAppSettingsChange(listener: (next: AppSettings, prev: AppSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** В dev-режиме Electron запускается как `electron <папка приложения>`, её тоже нужно передать. */
function loginItemArgs(): string[] {
  return app.isPackaged ? [HIDDEN_ARG] : [app.getAppPath(), HIDDEN_ARG];
}

function openAtLogin(): boolean {
  return app.getLoginItemSettings({ args: loginItemArgs() }).openAtLogin;
}

export function launchedHidden(): boolean {
  return process.argv.includes(HIDDEN_ARG) && getAppSettings().startMinimized;
}

function systemSettings(): SystemSettings {
  return {
    ...getAppSettings(),
    openAtLogin: openAtLogin(),
    discordClientIdFromEnv: clientSecretSource('DISCORD_CLIENT_ID') === 'env' || clientSecretSource('DISCORD_CLIENT_ID') === 'baked',
  };
}

export function registerAppSettingsIpc(): void {
  ipcMain.handle('system:getSettings', () => systemSettings());
  ipcMain.handle('system:getClientSecrets', async () => {
    const { clientSecretsView } = await import('./user-client-secrets.js');
    return clientSecretsView();
  });
  ipcMain.handle('system:setClientSecrets', async (_e, patch: Parameters<typeof import('./user-client-secrets.js').setUserClientSecrets>[0]) => {
    const { setUserClientSecrets } = await import('./user-client-secrets.js');
    const { refreshConnectorsFromSecrets } = await import('./connectors.js');
    const view = setUserClientSecrets(patch);
    refreshConnectorsFromSecrets();
    return view;
  });
  ipcMain.handle('system:setSettings', (_e, patch: Partial<SystemSettings>) => {
    const { openAtLogin: login, ...rest } = patch;
    if (login !== undefined) app.setLoginItemSettings({ openAtLogin: login, args: loginItemArgs() });
    if (Object.keys(rest).length) updateAppSettings(rest);
    return systemSettings();
  });
  ipcMain.handle('system:version', () => app.getVersion());
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    if (!/^https:\/\//i.test(url)) return false;
    void shell.openExternal(url);
    return true;
  });
  ipcMain.handle(
    'system:saveTextFile',
    async (e, defaultName: string, content: string, filters: Electron.FileFilter[] = []): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const options: Electron.SaveDialogOptions = {
        defaultPath: path.join(app.getPath('music'), defaultName.replace(/[<>:"/\\|?*]+/g, '_')),
        filters,
      };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      await fs.promises.writeFile(result.filePath, content, 'utf8');
      return result.filePath;
    },
  );
}
