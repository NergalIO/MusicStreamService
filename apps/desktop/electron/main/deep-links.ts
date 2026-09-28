import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const SCHEME = 'mss';

let pending: string | null = null;
let getMainWindow: () => BrowserWindow | null = () => null;

function normalize(url: string): string {
  return url.trim().replace(/^"+|"+$/g, '');
}

export function extractDeepLink(argv: string[]): string | null {
  const raw = argv.find((a) => a.toLowerCase().startsWith(`${SCHEME}://`));
  return raw ? normalize(raw) : null;
}

export function registerProtocolClient(): void {
  if (process.defaultApp) {
    const entry = process.argv.find((a, i) => i >= 1 && !a.startsWith('-') && !a.toLowerCase().startsWith(`${SCHEME}://`));
    if (entry) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(entry)]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
}

function send(url: string): void {
  const win = getMainWindow();
  if (!win || win.webContents.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('deep-link', url);
}

export function handleDeepLink(url: string): void {
  pending = normalize(url);
  send(pending);
}

export function attachDeepLinkWindow(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    if (pending) win.webContents.send('deep-link', pending);
  });
}

export function initDeepLinks(getter: () => BrowserWindow | null): void {
  getMainWindow = getter;
  registerProtocolClient();
  const fromArgv = extractDeepLink(process.argv);
  if (fromArgv) pending = fromArgv;
  app.on('open-url', (e, url) => {
    e.preventDefault();
    handleDeepLink(url);
  });
}
