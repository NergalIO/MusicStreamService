import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BaseWindow, WebContentsView } from 'electron';
import type { SpotifyInjectorSession } from '@mss/stream-connectors';
import { createHarnessSession } from '../src/host.js';
import { startServer, type RunningServer } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_HEIGHT = 148;
const API_PORT = Number(process.env.SPOTIFY_INJECTOR_API ?? 3939);
const SPOTIFY_URL = 'https://open.spotify.com/';

export class ElectronSpotifyApp {
  #mainWindow: BaseWindow | null = null;
  #panelView: WebContentsView | null = null;
  #spotifyView: WebContentsView | null = null;
  #session: SpotifyInjectorSession | null = null;
  #injectBridge: (() => Promise<void>) | null = null;
  #server: RunningServer | null = null;
  #shuttingDown = false;
  #apiStarted = false;

  constructor() {
    app.setName('SpotifyInjector');
    const userData = path.join(app.getPath('appData'), 'SpotifyInjectorElectron');
    fs.mkdirSync(userData, { recursive: true });
    app.setPath('userData', userData);
  }

  async start(): Promise<void> {
    await app.whenReady();
    this.#createWindow();

    app.on('activate', () => {
      if (!this.#mainWindow) this.#createWindow();
    });

    app.on('window-all-closed', () => {
      void this.shutdown();
      if (process.platform !== 'darwin') app.quit();
    });

    app.on('before-quit', () => {
      void this.shutdown();
    });
  }

  async shutdown(): Promise<void> {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    try {
      await this.#server?.close();
    } catch {
      // ignore
    }
    this.#session = null;
    this.#server = null;
  }

  #layout(): void {
    if (!this.#mainWindow || !this.#panelView || !this.#spotifyView) return;
    const { width, height } = this.#mainWindow.getContentBounds();
    const panelH = Math.min(PANEL_HEIGHT, Math.max(120, Math.floor(height * 0.18)));
    this.#panelView.setBounds({ x: 0, y: 0, width, height: panelH });
    this.#spotifyView.setBounds({ x: 0, y: panelH, width, height: Math.max(0, height - panelH) });
  }

  #createWindow(): void {
    this.#mainWindow = new BaseWindow({
      width: 1440,
      height: 960,
      minWidth: 960,
      minHeight: 680,
      title: 'SpotifyInjector',
      backgroundColor: '#121212',
    });

    this.#panelView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.#spotifyView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    this.#mainWindow.contentView.addChildView(this.#panelView);
    this.#mainWindow.contentView.addChildView(this.#spotifyView);
    this.#layout();

    this.#mainWindow.on('resize', () => this.#layout());
    this.#mainWindow.on('closed', () => {
      this.#mainWindow = null;
      this.#panelView = null;
      this.#spotifyView = null;
    });

    void this.#panelView.webContents.loadFile(path.join(__dirname, 'panel.html'));
    void this.#spotifyView.webContents.loadURL(SPOTIFY_URL);

    const harness = createHarnessSession(this.#spotifyView.webContents);
    this.#session = harness.session;
    this.#injectBridge = harness.injectBridge;
    harness.watchRequests();

    this.#spotifyView.webContents.on('dom-ready', () => {
      void this.#injectBridge?.();
    });

    this.#spotifyView.webContents.on('did-finish-load', () => {
      const url = this.#spotifyView?.webContents.getURL() ?? '';
      if (!url.includes('open.spotify.com') && !url.includes('accounts.spotify.com')) return;
      void this.#injectBridge?.();
      void this.#startApi();
    });

    this.#spotifyView.webContents.setWindowOpenHandler(({ url }) => {
      void this.#spotifyView?.webContents.loadURL(url);
      return { action: 'deny' };
    });
  }

  async #startApi(): Promise<void> {
    if (this.#apiStarted || !this.#session) return;
    this.#apiStarted = true;
    try {
      this.#server = await startServer({ port: API_PORT, session: this.#session });
      const api = `http://127.0.0.1:${API_PORT}`;
      this.#panelView?.webContents.send('panel-ready', { api });
      console.log(`API ready: ${api}`);
    } catch (err) {
      this.#apiStarted = false;
      console.error(err instanceof Error ? err.message : String(err));
    }
  }
}

const electronApp = new ElectronSpotifyApp();
void electronApp.start().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
