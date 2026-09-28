import {
  BrowserWindow,
  ipcMain,
  session as electronSession,
  shell,
  WebContentsView,
  type Session,
  type WebContents,
} from 'electron';
import type { PlayerCommand } from '../preload/index.js';
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
    void hasLoginCookie().then((loggedIn) => sendToRenderer('spotify-session:loggedIn', loggedIn));
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
  ses.cookies.on('changed', emitLoggedIn);
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

function show(): void {
  ensureView();
  visible = true;
  attach();
  view?.webContents.setAudioMuted(false);
  if (!loaded) {
    loaded = true;
    void view?.webContents.loadURL(HOME);
  }
  emitLoggedIn();
}

function hide(): void {
  visible = false;
  void pausePlayback();
  detach();
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

function sendMediaCommand(command: Extract<PlayerCommand, 'toggle' | 'next' | 'prev'>): boolean {
  const wc = view?.webContents;
  if (!visible || !wc || wc.isDestroyed()) return false;
  const selector =
    command === 'toggle'
      ? '[data-testid="control-button-playpause"]'
      : command === 'next'
        ? '[data-testid="control-button-skip-forward"]'
        : '[data-testid="control-button-skip-back"]';
  const keyCode =
    command === 'toggle' ? 'MediaPlayPause' : command === 'next' ? 'MediaNextTrack' : 'MediaPreviousTrack';
  void wc
    .executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.click(); return true; } return false; })()`,
    )
    .then((clicked: unknown) => {
      if (clicked || wc.isDestroyed()) return;
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
    })
    .catch(() => {
      if (wc.isDestroyed()) return;
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
    });
  return true;
}

async function logout(): Promise<void> {
  loaded = false;
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

export function routeSpotifyMediaCommand(command: PlayerCommand): boolean {
  if (command !== 'toggle' && command !== 'next' && command !== 'prev') return false;
  return sendMediaCommand(command);
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
