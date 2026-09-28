import { BrowserWindow, session as electronSession } from 'electron';
import { parseKateOAuthRedirect } from '@mss/stream-connectors';
import { log } from './logger.js';

const PARTITION = 'vk-android-sms';
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible()) ?? BrowserWindow.getAllWindows()[0];
}

function looksLikeVkOAuthResult(url: string): boolean {
  if (parseKateOAuthRedirect(url)) return true;
  try {
    const parsed = new URL(url);
    if (!/oauth\.vk\.(com|ru)$/i.test(parsed.hostname) || !parsed.pathname.includes('blank.html')) return false;
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    return !!(hash.get('error') || parsed.searchParams.get('error'));
  } catch {
    return false;
  }
}

/**
 * VK ID официального Android-клиента: SMS разрешён.
 * Токен Kate из этого окна не берём — его обменивают через processAuthCode.
 */
export function openKateOAuthWindow(url: string, signal?: AbortSignal): Promise<string> {
  const ses = electronSession.fromPartition(PARTITION);
  ses.setUserAgent(ANDROID_CHROME_UA);

  const parent = parentWindow();
  const win = new BrowserWindow({
    width: 420,
    height: 740,
    parent,
    modal: !!parent,
    autoHideMenuBar: true,
    show: false,
    title: 'Вход во VK',
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
      if (!win.isDestroyed()) win.close();
    };
    const onAbort = () => finish(() => reject(new Error('Отменено')));
    const accept = (nextUrl: string) => {
      if (!looksLikeVkOAuthResult(nextUrl)) return false;
      finish(() => resolve(nextUrl));
      return true;
    };
    const inspect = (nextUrl: string) => {
      if (accept(nextUrl) || win.isDestroyed()) return;
      if (!/oauth\.vk\.(com|ru)\/blank\.html/i.test(nextUrl)) return;
      void win.webContents
        .executeJavaScript('String(location.href)')
        .then((href: unknown) => {
          if (typeof href === 'string') accept(href);
        })
        .catch(() => {
          /* страница уже закрыта */
        });
    };

    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-redirect', (event, nextUrl) => {
      if (accept(nextUrl)) event.preventDefault();
    });
    win.webContents.on('will-navigate', (event, nextUrl) => {
      if (accept(nextUrl)) event.preventDefault();
    });
    win.webContents.on('did-navigate', (_event, nextUrl) => {
      inspect(nextUrl);
    });
    win.webContents.on('did-navigate-in-page', (_event, nextUrl) => {
      inspect(nextUrl);
    });
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return;
      void win.webContents
        .executeJavaScript('String(location.href)')
        .then((href: unknown) => {
          if (typeof href === 'string') inspect(href);
        })
        .catch(() => {
          /* ignore */
        });
    });
    win.on('closed', () => {
      finish(() => reject(new Error('Отменено')));
    });

    void ses
      .clearStorageData({ storages: ['cookies', 'localstorage', 'cachestorage'] })
      .catch(() => undefined)
      .finally(() => {
        if (settled || win.isDestroyed()) return;
        void win.loadURL(url).catch((err: unknown) => {
          log.error('[vk-oauth] load failed', err);
          finish(() => reject(err instanceof Error ? err : new Error('Не удалось открыть страницу VK')));
        });
      });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
  });
}
