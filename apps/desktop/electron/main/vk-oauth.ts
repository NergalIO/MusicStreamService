import { BrowserWindow, session as electronSession } from 'electron';
import { parseKateOAuthRedirect } from '@mss/stream-connectors';
import { log } from './logger.js';

const PARTITION = 'persist:vk-web-login';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const LOGIN_URL = 'https://m.vk.com/login';
const DIRECT_AUTH_APPS = new Set(['2685278', '2274003', '3140623']);

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible()) ?? BrowserWindow.getAllWindows()[0];
}

function isDirectAuthAuthorize(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^oauth\.vk\.(com|ru)$/i.test(parsed.hostname) || !parsed.pathname.includes('authorize')) return false;
    const id = parsed.searchParams.get('client_id');
    return !!id && DIRECT_AUTH_APPS.has(id);
  } catch {
    return false;
  }
}

function looksLikeVkOAuthResult(url: string): boolean {
  if (parseKateOAuthRedirect(url)) return true;
  try {
    const parsed = new URL(url);
    if (!/oauth\.vk\.(com|ru)$/i.test(parsed.hostname) || !parsed.pathname.includes('blank.html')) return false;
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const err = hash.get('error') || parsed.searchParams.get('error');
    if (!err) return false;
    const desc = hash.get('error_description') || parsed.searchParams.get('error_description') || '';
    if (/direct auth|incorrect app/i.test(desc)) return false;
    return true;
  } catch {
    return false;
  }
}

function splitStart(url: string): { start: string; confirm?: string } {
  try {
    const parsed = new URL(url);
    if (/^m\.vk\.(com|ru)$/i.test(parsed.hostname) && parsed.pathname.includes('login')) {
      return { start: url, confirm: parsed.searchParams.get('to') ?? undefined };
    }
    if (isDirectAuthAuthorize(url)) {
      return { start: LOGIN_URL };
    }
    if (/^(qr|id)\.vk\.(ru|com)$/i.test(parsed.hostname) || /oauth\.vk\.(com|ru)$/i.test(parsed.hostname)) {
      return { start: `${LOGIN_URL}?to=${encodeURIComponent(url)}`, confirm: url };
    }
    return { start: url };
  } catch {
    return { start: LOGIN_URL };
  }
}

function tokenToRedirect(token: string): string {
  return `https://oauth.vk.com/blank.html#access_token=${encodeURIComponent(token)}`;
}

/**
 * SMS: сначала официальный m.vk.com/login (номер и код), не oauth.vk.com/authorize
 * с Kate/Android — для них VK отдаёт JSON «direct auth».
 */
export function openKateOAuthWindow(url: string, signal?: AbortSignal): Promise<string> {
  const { start, confirm } = splitStart(url);
  const ses = electronSession.fromPartition(PARTITION);
  ses.setUserAgent(CHROME_UA);

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
    let openedConfirm = false;
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
    const blockAuthorize = (nextUrl: string, event?: { preventDefault: () => void }) => {
      if (!isDirectAuthAuthorize(nextUrl)) return false;
      event?.preventDefault();
      if (!win.isDestroyed()) void win.loadURL('https://m.vk.com/');
      return true;
    };
    const scrapeToken = async (href: string): Promise<string | null> => {
      if (win.isDestroyed()) return null;
      try {
        const host = new URL(href).hostname;
        if (/id\.vk\.(com|ru)$/i.test(host) || /oauth\.vk\.(com|ru)$/i.test(host) || /qr\.vk\.(ru|com)$/i.test(host)) {
          return null;
        }
        if (!/^(m\.)?vk\.(com|ru)$/i.test(host)) return null;
      } catch {
        return null;
      }
      try {
        const token = (await win.webContents.executeJavaScript(`(() => {
          const html = document.documentElement.innerHTML;
          const m = html.match(/"(?:apiPrefetchToken|access_token|accessToken)"\\s*:\\s*"(vk1\\.[^"]+)"/);
          return m ? m[1] : null;
        })()`)) as unknown;
        return typeof token === 'string' && token.startsWith('vk1.') ? token : null;
      } catch {
        return null;
      }
    };
    const onLoaded = async (href: string) => {
      if (settled || win.isDestroyed()) return;
      if (accept(href)) return;
      try {
        const body = (await win.webContents.executeJavaScript(
          'String(document.body && document.body.innerText || "").slice(0, 800)',
        )) as unknown;
        if (typeof body === 'string' && /direct auth|incorrect app/i.test(body)) {
          void win.loadURL(confirm ? `${LOGIN_URL}?to=${encodeURIComponent(confirm)}` : LOGIN_URL);
          return;
        }
      } catch {
        /* ignore */
      }
      const token = await scrapeToken(href);
      if (token) {
        finish(() => resolve(tokenToRedirect(token)));
        return;
      }
      let host = '';
      try {
        host = new URL(href).hostname;
      } catch {
        return;
      }
      if (
        confirm &&
        !openedConfirm &&
        /^(m\.)?vk\.(com|ru)$/i.test(host) &&
        !/\/login/i.test(href)
      ) {
        openedConfirm = true;
        void win.loadURL(confirm);
      }
    };

    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-redirect', (event, nextUrl) => {
      if (blockAuthorize(nextUrl, event)) return;
      if (accept(nextUrl)) event.preventDefault();
    });
    win.webContents.on('will-navigate', (event, nextUrl) => {
      if (blockAuthorize(nextUrl, event)) return;
      if (accept(nextUrl)) event.preventDefault();
    });
    win.webContents.on('did-navigate', (_event, nextUrl) => {
      void onLoaded(nextUrl);
    });
    win.webContents.on('did-navigate-in-page', (_event, nextUrl) => {
      void onLoaded(nextUrl);
    });
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return;
      void win.webContents
        .executeJavaScript('String(location.href)')
        .then((href: unknown) => {
          if (typeof href === 'string') void onLoaded(href);
        })
        .catch(() => {
          /* ignore */
        });
    });
    win.on('closed', () => {
      finish(() => reject(new Error('Отменено')));
    });

    void win.loadURL(start).catch((err: unknown) => {
      log.error('[vk-oauth] load failed', err);
      finish(() => reject(err instanceof Error ? err : new Error('Не удалось открыть страницу VK')));
    });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
  });
}
