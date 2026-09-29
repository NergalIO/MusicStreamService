import { BrowserWindow, session as electronSession, type Session } from 'electron';
import { parseKateOAuthRedirect, VK_KATE_CLIENT_ID, vkWebLoginStart } from '@mss/stream-connectors';
import { log } from './logger.js';

const PARTITION = 'persist:vk-web-login';
const ANDROID_CLIENT_ID = '2274003';
const FALLBACK_STARTS = ['https://vk.com/', 'https://m.vk.com/login', 'https://id.vk.com/', 'https://vk.com/login'];

let activeLogin: BrowserWindow | null = null;

/** Поднять уже открытое окно входа. Повторный loadURL во время загрузки роняет процесс. */
export function showVkLoginWindow(): void {
  const win = activeLogin;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  win.setAlwaysOnTop(false);
}

function chromeUa(): string {
  const chrome = process.versions.chrome || '128.0.0.0';
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  }
  if (process.platform !== 'win32') {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function isDirectAuthAuthorize(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^oauth\.vk\.(com|ru)$/i.test(parsed.hostname) || !parsed.pathname.includes('authorize')) return false;
    const id = parsed.searchParams.get('client_id');
    return !!id && (id === VK_KATE_CLIENT_ID || id === ANDROID_CLIENT_ID || id === '3140623');
  } catch {
    return false;
  }
}

function isVkHost(host: string): boolean {
  return /^(?:(?:m|id|login|oauth|qr)\.)?vk\.(com|ru)$/i.test(host);
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

function tokensToRedirect(tokens: {
  access_token?: string;
  silent_token?: string;
  uuid?: string;
  user_id?: number;
}): string {
  const hash = new URLSearchParams();
  if (tokens.access_token) hash.set('access_token', tokens.access_token);
  if (tokens.silent_token) hash.set('silent_token', tokens.silent_token);
  if (tokens.uuid) hash.set('uuid', tokens.uuid);
  if (tokens.user_id) hash.set('user_id', String(tokens.user_id));
  return `https://oauth.vk.com/blank.html#${hash.toString()}`;
}

function looksLoggedIn(href: string): boolean {
  try {
    const parsed = new URL(href);
    if (!isVkHost(parsed.hostname)) return false;
    if (/oauth\.vk\./i.test(parsed.hostname) || /qr\.vk\./i.test(parsed.hostname)) return false;
    return !/\/login/i.test(parsed.pathname) && !/\/auth/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function tokensFromConnectInternal(
  ses: Session,
  appId: string,
): Promise<{ access_token?: string; silent_token?: string; uuid?: string; user_id?: number } | null> {
  for (const domain of ['vk.ru', 'vk.com']) {
    const tokens = await tokensFromConnectInternalAt(ses, appId, domain);
    if (tokens) return tokens;
  }
  return null;
}

async function tokensFromConnectInternalAt(
  ses: Session,
  appId: string,
  domain: string,
): Promise<{ access_token?: string; silent_token?: string; uuid?: string; user_id?: number } | null> {
  try {
    const res = await ses.fetch(`https://login.${domain}/?act=connect_internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: `https://id.${domain}`,
        Referer: `https://id.${domain}/`,
        'X-Origin': `https://id.${domain}`,
      },
      body: new URLSearchParams({
        app_id: appId,
        oauth_version: '1',
        version: '1',
      }).toString(),
    });
    const json = (await res.json()) as Record<string, unknown>;
    const nested = json.data && typeof json.data === 'object' ? (json.data as Record<string, unknown>) : json;
    const access = typeof nested.access_token === 'string' ? nested.access_token : undefined;
    const silent = typeof nested.silent_token === 'string' ? nested.silent_token : undefined;
    if (!access && !silent) return null;
    const uuid =
      typeof nested.uuid === 'string'
        ? nested.uuid
        : typeof nested.silent_token_uuid === 'string'
          ? nested.silent_token_uuid
          : undefined;
    return {
      access_token: access,
      silent_token: silent,
      uuid,
      user_id: typeof nested.user_id === 'number' ? nested.user_id : undefined,
    };
  } catch (err) {
    log.warn(`[vk-oauth] connect_internal (${domain}) failed`, err);
    return null;
  }
}

/**
 * SMS: официальный id.vk.com (номер и код), не oauth.vk.com/authorize
 * с Kate/Android — для них VK отдаёт JSON «direct auth».
 * Не грузим m.vk.com/login?to=qr.vk.ru — Electron отвечает ERR_FAILED.
 */
export function openKateOAuthWindow(url: string, signal?: AbortSignal): Promise<string> {
  const { start, confirm } = vkWebLoginStart(url);
  const ua = chromeUa();
  const ses = electronSession.fromPartition(PARTITION);
  ses.setUserAgent(ua);

  const win = new BrowserWindow({
    width: 420,
    height: 740,
    autoHideMenuBar: true,
    show: true,
    title: 'Вход во VK',
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  activeLogin = win;
  win.on('closed', () => {
    if (activeLogin === win) activeLogin = null;
  });
  win.webContents.setUserAgent(ua);
  win.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let openedConfirm = false;
    let extracting = false;
    let extractAgain = false;
    const tried = new Set<string>([start]);
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
    const acceptTokens = (tokens: { access_token?: string; silent_token?: string; uuid?: string; user_id?: number } | null) => {
      if (!tokens?.access_token && !tokens?.silent_token) return false;
      finish(() => resolve(tokensToRedirect(tokens)));
      return true;
    };
    let navGen = 0;
    let navChain: Promise<void> = Promise.resolve();
    const navigate = (nextUrl: string, opts?: { fallback?: boolean }) => {
      const gen = ++navGen;
      navChain = navChain.then(
        () =>
          new Promise<void>((done) => {
            const start = () => {
              if (settled || win.isDestroyed() || gen !== navGen) {
                done();
                return;
              }
              void win.loadURL(nextUrl, { userAgent: ua }).then(
                () => done(),
                (err: unknown) => {
                  done();
                  if (settled || win.isDestroyed() || gen !== navGen) return;
                  log.error('[vk-oauth] load failed', err);
                  if (!opts?.fallback) return;
                  const fallback = FALLBACK_STARTS.find((candidate) => !tried.has(candidate));
                  if (!fallback) {
                    if (!win.isVisible()) win.show();
                    return;
                  }
                  tried.add(fallback);
                  setTimeout(() => navigate(fallback, { fallback: true }), 50);
                },
              );
            };
            if (win.isDestroyed()) {
              done();
              return;
            }
            if (win.webContents.isLoading()) {
              let released = false;
              const release = () => {
                if (released) return;
                released = true;
                done();
              };
              win.webContents.once('did-stop-loading', () => {
                setTimeout(() => {
                  if (released) return;
                  start();
                }, 50);
              });
              win.once('closed', release);
              win.webContents.stop();
              return;
            }
            start();
          }),
      );
    };
    const blockAuthorize = (nextUrl: string, event?: { preventDefault: () => void }) => {
      if (!isDirectAuthAuthorize(nextUrl)) return false;
      event?.preventDefault();
      navigate('https://vk.com/', { fallback: true });
      return true;
    };
    const scrapeToken = async (href: string): Promise<{ access_token?: string; silent_token?: string; uuid?: string } | null> => {
      if (win.isDestroyed()) return null;
      try {
        const host = new URL(href).hostname;
        if (/oauth\.vk\.(com|ru)$/i.test(host) || /qr\.vk\.(ru|com)$/i.test(host)) return null;
        if (!isVkHost(host)) return null;
      } catch {
        return null;
      }
      try {
        const found = (await win.webContents.executeJavaScript(`(() => {
          const html = document.documentElement.innerHTML;
          const access = html.match(/"(?:apiPrefetchToken|access_token|accessToken)"\\s*:\\s*"(vk1\\.[^"]+)"/);
          const silent = html.match(/"(?:silent_token|silentToken)"\\s*:\\s*"([^"]{16,})"/);
          const uuid = html.match(/"(?:silent_token_uuid|uuid)"\\s*:\\s*"([0-9a-f-]{16,})"/i);
          if (!access && !silent) return null;
          return {
            access_token: access ? access[1] : undefined,
            silent_token: silent ? silent[1] : undefined,
            uuid: uuid ? uuid[1] : undefined,
          };
        })()`)) as unknown;
        if (!found || typeof found !== 'object') return null;
        const rec = found as { access_token?: string; silent_token?: string; uuid?: string };
        if (rec.access_token || rec.silent_token) return rec;
        return null;
      } catch {
        return null;
      }
    };
    const extractSessionToken = async () => {
      if (settled || win.isDestroyed()) return;
      if (extracting) {
        extractAgain = true;
        return;
      }
      extracting = true;
      try {
        do {
          extractAgain = false;
          const kate = await tokensFromConnectInternal(ses, VK_KATE_CLIENT_ID);
          if (acceptTokens(kate)) return;
          const android = await tokensFromConnectInternal(ses, ANDROID_CLIENT_ID);
          if (acceptTokens(android)) return;
        } while (extractAgain && !settled && !win.isDestroyed());
      } finally {
        extracting = false;
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
          navigate('https://id.vk.com/', { fallback: true });
          return;
        }
      } catch {
        /* ignore */
      }
      if (acceptTokens(await scrapeToken(href))) return;
      try {
        const hostNow = new URL(href).hostname;
        if (isVkHost(hostNow) && !/oauth\.vk\./i.test(hostNow) && !/qr\.vk\./i.test(hostNow)) {
          await extractSessionToken();
          if (settled) return;
        }
      } catch {
        /* ignore */
      }
      let host = '';
      try {
        host = new URL(href).hostname;
      } catch {
        return;
      }
      if (confirm && !openedConfirm && looksLoggedIn(href) && !/qr\.vk\./i.test(host)) {
        openedConfirm = true;
        navigate(confirm);
      }
    };

    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }

    win.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      try {
        if (isVkHost(new URL(popupUrl).hostname) || popupUrl === 'about:blank') {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 420,
              height: 740,
              autoHideMenuBar: true,
              parent: win,
              webPreferences: {
                partition: PARTITION,
                sandbox: false,
                contextIsolation: true,
                nodeIntegration: false,
              },
            },
          };
        }
      } catch {
        /* deny */
      }
      return { action: 'deny' };
    });
    win.webContents.on('did-create-window', (child) => {
      child.setMenuBarVisibility(false);
      child.webContents.setUserAgent(ua);
      child.webContents.on('will-redirect', (_event, nextUrl) => {
        accept(nextUrl);
      });
      child.webContents.on('did-navigate', (_event, nextUrl) => {
        void onLoaded(nextUrl);
      });
    });
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
    win.webContents.on('did-fail-load', (_event, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || settled || win.isDestroyed()) return;
      log.error('[vk-oauth] did-fail-load', code, desc, failedUrl);
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

    navigate(start, { fallback: true });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
  });
}
