import {
  BrowserWindow,
  ipcMain,
  session as electronSession,
  shell,
  WebContentsView,
  type Session,
  type WebContents,
} from 'electron';
import { log } from './logger.js';

const PARTITION = 'persist:spotify';
const HOME = 'https://open.spotify.com/';
const SESSION_COOKIES = new Set(['sp_dc', 'sp_key', 'sp_t']);

export interface SpotifyViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

let getMainWindow: () => BrowserWindow | null = () => null;
let ses: Session | null = null;
let view: WebContentsView | null = null;
let attached = false;
let loaded = false;
let visible = false;
let lastBounds: SpotifyViewBounds = { x: 0, y: 0, width: 0, height: 0 };
let loginDebounce: ReturnType<typeof setTimeout> | null = null;
const wiredContents = new WeakSet<WebContents>();

/** Заголовки, с которыми веб-плеер ходит в pathfinder: переиспользуем их для каталога в MSS. */
export interface SpotifyWebHeaders {
  authorization: string;
  clientToken: string;
  appVersion: string;
}

let webHeaders: (SpotifyWebHeaders & { at: number }) | null = null;
let loggedInCached = false;
let controlled = false;
const headerWaiters = new Set<(headers: SpotifyWebHeaders) => void>();
const TOKEN_FRESH_MS = 50 * 60_000;

function header(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function watchPlayerRequests(target: Session): void {
  target.webRequest.onBeforeSendHeaders({ urls: ['https://*.spotify.com/*'] }, (details, callback) => {
    const headers = details.requestHeaders;
    const authorization = header(headers, 'authorization');
    const clientToken = header(headers, 'client-token');
    if (authorization?.startsWith('Bearer ') && clientToken) {
      const next = {
        authorization,
        clientToken,
        appVersion: header(headers, 'spotify-app-version') ?? webHeaders?.appVersion ?? '',
      };
      if (next.authorization !== webHeaders?.authorization || next.clientToken !== webHeaders?.clientToken) {
        webHeaders = { ...next, at: Date.now() };
        for (const resolve of headerWaiters) resolve(next);
        headerWaiters.clear();
      }
    }
    callback({ requestHeaders: headers });
  });
}

function chromeUserAgent(): string {
  const ua = electronSession.defaultSession.getUserAgent();
  const chrome = ua.match(/Chrome\/[\d.]+/)?.[0] ?? 'Chrome/144.0.0.0';
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`;
  }
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`;
}

function allowPlaybackPermissions(target: Session): void {
  const allowed = new Set(['media', 'autoplay', 'mediaKeySystem', 'display-capture', 'fullscreen']);
  target.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
}

function isAuthPopup(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'accounts.spotify.com' ||
      host.endsWith('.spotify.com') ||
      host === 'accounts.google.com' ||
      host.endsWith('.google.com') ||
      host === 'appleid.apple.com' ||
      host.endsWith('.apple.com') ||
      host.endsWith('.facebook.com') ||
      host.endsWith('.facebook.net') ||
      host.endsWith('.microsoftonline.com') ||
      host === 'login.live.com'
    );
  } catch {
    return false;
  }
}

function sendToRenderer(channel: string, payload?: unknown): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

async function hasLoginCookie(): Promise<boolean> {
  if (!ses) return false;
  try {
    const cookies = await ses.cookies.get({ url: 'https://open.spotify.com/' });
    return cookies.some((c) => SESSION_COOKIES.has(c.name) && c.value.length > 0);
  } catch {
    return false;
  }
}

function emitLoggedIn(): void {
  if (loginDebounce) clearTimeout(loginDebounce);
  loginDebounce = setTimeout(() => {
    loginDebounce = null;
    void hasLoginCookie().then((loggedIn) => {
      if (loggedIn !== loggedInCached && !loggedIn) webHeaders = null;
      loggedInCached = loggedIn;
      sendToRenderer('spotify-session:loggedIn', loggedIn);
    });
  }, 400);
}

function applyBounds(bounds: SpotifyViewBounds): void {
  lastBounds = bounds;
  if (!view || !attached) return;
  const width = Math.max(0, Math.round(bounds.width));
  const height = Math.max(0, Math.round(bounds.height));
  view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width,
    height,
  });
}

function attach(): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed() || !view || attached) return;
  win.contentView.addChildView(view);
  attached = true;
  applyBounds(lastBounds);
}

function detach(): void {
  const win = getMainWindow();
  if (!view || !attached) return;
  if (win && !win.isDestroyed()) {
    try {
      win.contentView.removeChildView(view);
    } catch {
      /* already removed */
    }
  }
  attached = false;
}

function ensureSession(): Session {
  if (ses) return ses;
  ses = electronSession.fromPartition(PARTITION);
  ses.setUserAgent(chromeUserAgent());
  allowPlaybackPermissions(ses);
  watchPlayerRequests(ses);
  ses.cookies.on('changed', emitLoggedIn);
  void hasLoginCookie().then((loggedIn) => {
    loggedInCached = loggedIn;
  });
  return ses;
}

function popupWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: 520,
    height: 740,
    autoHideMenuBar: true,
    webPreferences: {
      session: ensureSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

function configureWebContents(wc: WebContents, opts: { media: boolean }): void {
  if (wiredContents.has(wc) || wc.isDestroyed()) return;
  wiredContents.add(wc);
  wc.setUserAgent(chromeUserAgent());
  wc.setWindowOpenHandler(({ url }) => {
    if (isAuthPopup(url) || url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: popupWindowOptions(),
      };
    }
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    configureWebContents(child.webContents, { media: false });
  });
  if (!opts.media) return;
  wc.on('media-started-playing', () => {
    sendToRenderer('spotify-session:media', { playing: true });
  });
  wc.on('media-paused', () => {
    sendToRenderer('spotify-session:media', { playing: false });
  });
  wc.on('did-navigate', emitLoggedIn);
  wc.on('did-navigate-in-page', emitLoggedIn);
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    log.warn(`Spotify web session failed to load (${code}): ${desc} ${url}`);
  });
}

function ensureView(): WebContentsView {
  if (view) return view;
  view = new WebContentsView({
    webPreferences: {
      session: ensureSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#000000');
  configureWebContents(view.webContents, { media: true });
  return view;
}

function ensureLoaded(): WebContentsView {
  const v = ensureView();
  if (!loaded) {
    loaded = true;
    void v.webContents.loadURL(HOME);
  }
  return v;
}

function show(): void {
  ensureLoaded();
  visible = true;
  attach();
  view?.webContents.setAudioMuted(false);
  emitLoggedIn();
}

function hide(): void {
  visible = false;
  if (!controlled) void pausePlayback();
  detach();
}

export function isSpotifyLoggedIn(): boolean {
  return loggedInCached;
}

async function requireLogin(): Promise<void> {
  ensureSession();
  loggedInCached = await hasLoginCookie();
  if (!loggedInCached) throw new Error('Войдите в Spotify: боковая панель → Spotify → Веб-плеер');
}

/** Ждёт заголовки веб-плеера; при необходимости грузит open.spotify.com в фоне (view не прикрепляется к окну). */
export async function spotifyWebHeaders(timeoutMs = 25_000): Promise<SpotifyWebHeaders> {
  await requireLogin();
  if (webHeaders && Date.now() - webHeaders.at < TOKEN_FRESH_MS) return webHeaders;
  ensureLoaded();
  const stale = webHeaders;
  return new Promise<SpotifyWebHeaders>((resolve, reject) => {
    const timer = setTimeout(() => {
      headerWaiters.delete(onHeaders);
      if (stale) resolve(stale);
      else reject(new Error('Веб-плеер Spotify не ответил — откройте Spotify → Веб-плеер и проверьте вход'));
    }, timeoutMs);
    const onHeaders = (h: SpotifyWebHeaders) => {
      clearTimeout(timer);
      resolve(h);
    };
    headerWaiters.add(onHeaders);
  });
}

/** Токен отклонён: перезагружаем плеер (если он не играет), чтобы он выдал свежий. */
export function invalidateSpotifyWebHeaders(): void {
  webHeaders = null;
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed() || wc.isCurrentlyAudible()) return;
  wc.reload();
}

/** Выполняет JS в странице веб-плеера с user gesture — иначе Chromium не даст запустить звук. */
export async function spotifyWebExec<T>(script: string): Promise<T> {
  await requireLogin();
  const wc = ensureLoaded().webContents;
  if (wc.isLoading()) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 20_000);
      wc.once('did-stop-loading', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return (await wc.executeJavaScript(script, true)) as T;
}

/** Пока MSS ведёт воспроизведение через Connect, уход со страницы Spotify не ставит плеер на паузу. */
export function setSpotifyControlled(active: boolean): void {
  controlled = active;
  if (active) {
    ensureLoaded();
    view?.webContents.setAudioMuted(false);
  }
}

export function setSpotifyWebMuted(muted: boolean): void {
  const wc = view?.webContents;
  if (wc && !wc.isDestroyed()) wc.setAudioMuted(muted);
}

export async function spotifyWebLogout(): Promise<void> {
  await logout();
}

async function pausePlayback(): Promise<void> {
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  try {
    await wc.executeJavaScript(`(() => {
      const btn = document.querySelector('[data-testid="control-button-playpause"]');
      if (!btn) return;
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('pause') || label.includes('пауз')) btn.click();
    })();`);
  } catch {
    /* page not ready */
  }
  wc.setAudioMuted(true);
}

async function logout(): Promise<void> {
  loaded = false;
  webHeaders = null;
  loggedInCached = false;
  const target = ensureSession();
  await target.clearStorageData();
  if (view && !view.webContents.isDestroyed()) {
    void view.webContents.loadURL(HOME);
    loaded = true;
  }
  emitLoggedIn();
}

export function isSpotifyWebSessionVisible(): boolean {
  return visible;
}

function bindWindow(win: BrowserWindow): void {
  const relayout = () => {
    if (visible) applyBounds(lastBounds);
  };
  win.on('resize', relayout);
  win.on('maximize', relayout);
  win.on('unmaximize', relayout);
  win.on('enter-full-screen', relayout);
  win.on('leave-full-screen', relayout);
  win.on('closed', () => {
    hide();
  });
}

export function initSpotifyWebSession(getter: () => BrowserWindow | null): void {
  getMainWindow = getter;
  ensureSession();

  ipcMain.handle('spotify-session:show', () => {
    show();
  });
  ipcMain.handle('spotify-session:hide', () => {
    hide();
  });
  ipcMain.handle('spotify-session:setBounds', (_e, bounds: SpotifyViewBounds) => {
    if (!bounds || typeof bounds.width !== 'number') return;
    applyBounds(bounds);
  });
  ipcMain.handle('spotify-session:pause', () => pausePlayback());
  ipcMain.handle('spotify-session:logout', () => logout());
  ipcMain.handle('spotify-session:loggedIn', () => hasLoginCookie());

  const win = getter();
  if (win && !win.isDestroyed()) bindWindow(win);
}
