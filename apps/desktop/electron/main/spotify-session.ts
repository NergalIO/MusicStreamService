import {
  emptyAuthResult,
  installBridgeSource,
  isPathfinderUrl,
  parseLoginBody,
  rememberPathfinderRequest,
  SpotifyInjectorSession,
  urlLooksLikeCaptcha,
  type AuthResult,
  type SpotifyCapturedState,
} from '@mss/stream-connectors';
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

function isSpotifySessionCookie(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'sp_dc' || n.endsWith('-sp_dc');
}

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
const captchaPopupIds = new Set<number>();

let loggedInCached = false;
let controlled = false;

const captured: SpotifyCapturedState = {
  accessToken: null,
  clientToken: null,
  connectionId: null,
  appVersion: null,
};

let injectorSession: SpotifyInjectorSession | null = null;

function getSession(): SpotifyInjectorSession {
  if (!injectorSession) {
    injectorSession = new SpotifyInjectorSession(
      {
        evaluate: async <T>(expression: string) => {
          const wc = ensureLoaded().webContents;
          await waitWebContentsIdle(wc);
          if (wc.isDestroyed()) throw new Error('Веб-плеер Spotify не запущен');
          const url = wc.getURL();
          if (url.startsWith(HOME) || url.startsWith('https://open.spotify.com')) {
            await injectBridge(wc);
          }
          return (await wc.executeJavaScript(expression, true)) as T;
        },
        getUrl: () => {
          const wc = view?.webContents;
          return wc && !wc.isDestroyed() ? wc.getURL() : '';
        },
        loadURL: async (url: string) => {
          const wc = ensureLoaded().webContents;
          await wc.loadURL(url);
          await waitWebContentsIdle(wc);
        },
        getCookieNames: async () => {
          if (!ses) return [];
          const cookies = await ses.cookies.get({ url: HOME });
          return cookies.map((c) => c.name);
        },
        typeText: async (text: string, opts?: { selectAll?: boolean }) => {
          const wc = ensureLoaded().webContents;
          if (wc.isDestroyed()) throw new Error('Веб-плеер Spotify не запущен');
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.focus();
          wc.focus();
          if (opts?.selectAll !== false) {
            const modifier = process.platform === 'darwin' ? 'meta' : 'control';
            wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [modifier] });
            wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [modifier] });
          }
          for (const ch of text) {
            wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
            wc.sendInputEvent({ type: 'char', keyCode: ch });
            wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
            await new Promise<void>((resolve) => setTimeout(resolve, 40));
          }
        },
        focusPage: async () => {
          const wc = ensureLoaded().webContents;
          if (wc.isDestroyed()) throw new Error('Веб-плеер Spotify не запущен');
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.focus();
          wc.focus();
        },
        hasCaptchaPopup: async () => captchaPopupOpen(),
      },
      captured,
    );
  }
  return injectorSession;
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
      host === 'login.live.com' ||
      host.endsWith('.arkoselabs.com') ||
      host.endsWith('.funcaptcha.com') ||
      host.endsWith('.hcaptcha.com') ||
      host === 'challenges.cloudflare.com' ||
      host === 'challenge.spotify.com'
    );
  } catch {
    return false;
  }
}

function captchaPopupOpen(): boolean {
  return captchaPopupIds.size > 0;
}

function trackCaptchaWindow(wc: WebContents): void {
  const sync = () => {
    if (wc.isDestroyed()) {
      captchaPopupIds.delete(wc.id);
      return;
    }
    if (urlLooksLikeCaptcha(wc.getURL())) captchaPopupIds.add(wc.id);
    else captchaPopupIds.delete(wc.id);
  };
  wc.on('did-navigate', sync);
  wc.on('did-navigate-in-page', sync);
  wc.on('did-finish-load', sync);
  wc.on('destroyed', () => captchaPopupIds.delete(wc.id));
  sync();
}

function sendToRenderer(channel: string, payload?: unknown): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function watchPlayerRequests(target: Session): void {
  target.webRequest.onBeforeRequest({ urls: ['https://api-partner.spotify.com/pathfinder/*'] }, (details, callback) => {
    if (isPathfinderUrl(details.url) && details.uploadData?.length) {
      const chunks = details.uploadData
        .map((part) => (part.bytes ? Buffer.from(part.bytes).toString('utf8') : ''))
        .filter(Boolean);
      if (chunks.length) {
        rememberPathfinderRequest(getSession().hashCacheRef, details.url, chunks.join(''));
        getSession().rememberPathfinder(details.url, chunks.join(''));
      }
    }
    callback({});
  });
  target.webRequest.onBeforeSendHeaders({ urls: ['https://*.spotify.com/*'] }, (details, callback) => {
    const headers = details.requestHeaders ?? {};
    getSession().ingestRequestHeaders(headers as Record<string, string>);
    callback({ requestHeaders: headers });
  });
}

async function hasLoginCookie(): Promise<boolean> {
  if (!ses) return false;
  try {
    const cookies = await ses.cookies.get({ url: HOME });
    return cookies.some((c) => isSpotifySessionCookie(c.name) && c.value.length > 0);
  } catch {
    return false;
  }
}

function publishLoggedIn(loggedIn: boolean): void {
  if (loggedIn !== loggedInCached && !loggedIn) {
    captured.accessToken = null;
    captured.clientToken = null;
  }
  if (loggedIn === loggedInCached) return;
  loggedInCached = loggedIn;
  sendToRenderer('spotify-session:loggedIn', loggedIn);
}

export function markSpotifySessionExpired(): void {
  captured.accessToken = null;
  captured.clientToken = null;
  publishLoggedIn(false);
}

export async function syncSpotifyAuthState(): Promise<boolean> {
  if (!(await hasLoginCookie())) {
    publishLoggedIn(false);
    return false;
  }
  try {
    const auth = await getSession().getAuth();
    publishLoggedIn(auth.loggedIn);
    return auth.loggedIn;
  } catch {
    publishLoggedIn(false);
    return false;
  }
}

function emitLoggedIn(): void {
  if (loginDebounce) clearTimeout(loginDebounce);
  loginDebounce = setTimeout(() => {
    loginDebounce = null;
    void syncSpotifyAuthState();
  }, 400);
}

function applyBounds(bounds: SpotifyViewBounds): void {
  lastBounds = bounds;
  if (!view || !attached) return;
  view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
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
  void syncSpotifyAuthState();
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

async function injectBridge(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  try {
    const ready = await wc.executeJavaScript('!!window.__spotifyBridge', true);
    if (!ready) await wc.executeJavaScript(installBridgeSource(), true);
  } catch (e) {
    log.warn('spotify bridge inject', e instanceof Error ? e.message : e);
  }
}

function configureWebContents(wc: WebContents, opts: { media: boolean }): void {
  if (wiredContents.has(wc) || wc.isDestroyed()) return;
  wiredContents.add(wc);
  wc.setUserAgent(chromeUserAgent());
  wc.setWindowOpenHandler(({ url }) => {
    if (isAuthPopup(url) || urlLooksLikeCaptcha(url) || url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions() };
    }
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    configureWebContents(child.webContents, { media: false });
  });
  trackCaptchaWindow(wc);
  if (!opts.media) return;
  wc.on('media-started-playing', () => {
    sendToRenderer('spotify-session:media', { playing: true });
  });
  wc.on('media-paused', () => {
    sendToRenderer('spotify-session:media', { playing: false });
  });
  wc.on('did-navigate', emitLoggedIn);
  wc.on('did-navigate-in-page', emitLoggedIn);
  wc.on('dom-ready', () => {
    void injectBridge(wc);
  });
  wc.on('did-finish-load', () => {
    void injectBridge(wc);
  });
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
  if (!loggedInCached) await syncSpotifyAuthState();
  if (!loggedInCached) throw new Error('Войдите в Spotify: Настройки → Сервисы или Spotify → Веб-плеер');
}

export async function ensureSpotifyPageBridge(): Promise<void> {
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
  await injectBridge(wc);
}

async function waitWebContentsIdle(wc: WebContents, timeoutMs = 30_000): Promise<void> {
  if (wc.isDestroyed()) throw new Error('Веб-плеер Spotify не запущен');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!wc.isLoading()) {
      try {
        const ready = await wc.executeJavaScript('document.readyState', true);
        if (ready === 'complete' || ready === 'interactive') return;
      } catch {
        /* navigation in progress */
      }
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        wc.removeListener('did-stop-loading', finish);
        wc.removeListener('did-finish-load', finish);
        resolve();
      };
      wc.once('did-stop-loading', finish);
      wc.once('did-finish-load', finish);
      setTimeout(finish, 300);
    });
  }
  if (!wc.isLoading()) return;
  throw new Error('Веб-плеер Spotify не загрузился');
}

export async function spotifyPageExec<T>(script: string): Promise<T> {
  ensureSession();
  const wc = ensureLoaded().webContents;
  await waitWebContentsIdle(wc);
  if (wc.getURL().startsWith(HOME)) await ensureSpotifyPageBridge();
  if (wc.isDestroyed()) throw new Error('Веб-плеер Spotify не запущен');
  return (await wc.executeJavaScript(script, true)) as T;
}

export async function spotifyWebExec<T>(script: string): Promise<T> {
  await requireLogin();
  return spotifyPageExec<T>(script);
}

export function setSpotifyControlled(active: boolean): void {
  controlled = active;
  if (active) {
    ensureLoaded();
    view?.webContents.setAudioMuted(false);
  }
}

export function isSpotifyWebAudible(): boolean {
  const wc = view?.webContents;
  return !!wc && !wc.isDestroyed() && wc.isCurrentlyAudible();
}

export function setSpotifyWebMuted(muted: boolean): void {
  const wc = view?.webContents;
  if (wc && !wc.isDestroyed()) wc.setAudioMuted(muted);
}

export async function spotifyWebLogout(): Promise<void> {
  await logout();
}

async function pausePlayback(): Promise<void> {
  try {
    await getSession().command('pause');
  } catch {
    /* page not ready */
  }
  const wc = view?.webContents;
  if (wc && !wc.isDestroyed()) wc.setAudioMuted(true);
}

async function logout(): Promise<void> {
  loaded = false;
  captured.accessToken = null;
  captured.clientToken = null;
  captured.connectionId = null;
  publishLoggedIn(false);
  const target = ensureSession();
  await target.clearStorageData();
  if (view && !view.webContents.isDestroyed()) {
    void view.webContents.loadURL(HOME);
    loaded = true;
  }
  emitLoggedIn();
}

export async function spotifyAuthStatus(): Promise<AuthResult> {
  await ensureSpotifyPageBridge();
  await syncSpotifyAuthState();
  return getSession().getAuth();
}

export async function spotifyLogin(body: unknown): Promise<AuthResult> {
  const parsed = parseLoginBody(body);
  if ('error' in parsed) return { ...emptyAuthResult(), ok: false, error: parsed.error };
  ensureSession();
  ensureLoaded();
  const result = await getSession().login(parsed);
  await syncSpotifyAuthState();
  return result;
}

export async function spotifyPathfinder(operationName: string, variables: Record<string, unknown>): Promise<unknown> {
  await requireLogin();
  await ensureSpotifyPageBridge();
  return getSession().pathfinderQuery(operationName, variables);
}

export async function spotifySpclient(path: string): Promise<unknown> {
  await requireLogin();
  await ensureSpotifyPageBridge();
  return getSession().spclientGet(path);
}

export function getSpotifyInjectorSession(): SpotifyInjectorSession {
  return getSession();
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
  ipcMain.handle('spotify-session:loggedIn', () => syncSpotifyAuthState());
  ipcMain.handle('spotify-session:auth', () => spotifyAuthStatus());
  ipcMain.handle('spotify-session:login', (_e, body: unknown) => spotifyLogin(body));

  const win = getter();
  if (win && !win.isDestroyed()) bindWindow(win);
}
