import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { log } from './logger.js';

export type UpdateStatus = {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'
    | 'dev';
  version?: string;
  currentVersion?: string;
  message?: string;
  downloadUrl?: string;
  progress?: number;
};

type GhRelease = {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
};

let pendingDownloadUrl: string | null = null;
let pendingVersion: string | null = null;
let installInFlight = false;
let lastStatus: UpdateStatus = { state: 'idle' };

function currentVersion(): string {
  return normalizeVersion(app.getVersion());
}

function withMeta(status: UpdateStatus): UpdateStatus {
  return { ...status, currentVersion: currentVersion() };
}

function githubRepo(): string {
  const env = process.env.MSS_GITHUB_REPO?.trim();
  if (env) return env;
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      build?: { publish?: { owner?: string; repo?: string } };
    };
    const owner = pkg.build?.publish?.owner;
    const repo = pkg.build?.publish?.repo;
    if (owner && repo) return `${owner}/${repo}`;
  } catch {
    /* ignore */
  }
  return 'NergalIO/MusicStreamService';
}

function exeAssetName(): string {
  return process.env.RELEASE_WINDOWS_FILE ?? 'MusicStreamService-setup.exe';
}

function normalizeVersion(v: string): string {
  return v.replace(/^v/i, '').trim();
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'MusicStreamService-Desktop',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
  });
}

async function checkGitHubRelease(): Promise<UpdateStatus> {
  const repo = githubRepo();
  const current = currentVersion();
  const release = await fetchJson<GhRelease>(`https://api.github.com/repos/${repo}/releases/latest`);
  const latest = normalizeVersion(release.tag_name);
  const asset = release.assets.find((a) => a.name === exeAssetName());
  if (!asset) {
    return withMeta({ state: 'error', message: `Нет файла установщика в последнем релизе` });
  }
  pendingDownloadUrl = asset.browser_download_url;
  pendingVersion = latest;
  if (latest !== current) {
    return withMeta({ state: 'available', version: latest, downloadUrl: asset.browser_download_url });
  }
  return withMeta({ state: 'not-available', version: latest });
}

function bootstrapUpdatePath(): string | null {
  const root = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'MusicStreamService')
    : null;
  if (!root) return null;
  const ps1 = path.join(root, 'bootstrap', 'install-windows.ps1');
  if (fs.existsSync(ps1)) return ps1;
  return null;
}

const INSTALLER_ARGS = ['/S', '--updated', '/CLOSEAPPLICATIONS'];

function launchInstaller(exePath: string): void {
  spawn(exePath, INSTALLER_ARGS, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function downloadFile(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const fail = (err: unknown) => {
      file.close();
      fs.unlink(dest, () => undefined);
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    https
      .get(url, { headers: { 'User-Agent': 'MusicStreamService-Desktop' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, () => undefined);
          downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          fail(new Error(`Download ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', fail);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function initUpdater(getMainWindow: () => BrowserWindow | null): void {
  lastStatus = withMeta({ state: 'idle' });
  const send = (payload: UpdateStatus) => {
    lastStatus = withMeta(payload);
    getMainWindow()?.webContents.send('update:status', lastStatus);
  };

  ipcMain.handle('update:status', (): UpdateStatus => withMeta(lastStatus));

  ipcMain.handle('update:check', async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return withMeta({ state: 'dev' });
    send({ state: 'checking' });
    try {
      const status = await checkGitHubRelease();
      send(status);
      return status;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('updater check failed', message);
      const err = withMeta({ state: 'error', message });
      send(err);
      return err;
    }
  });

  ipcMain.handle('update:install', async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return withMeta({ state: 'dev' });
    if (installInFlight) {
      return withMeta({
        state: 'installing',
        version: pendingVersion ?? undefined,
        message: 'Закрываем приложение и запускаем установщик…',
      });
    }
    installInFlight = true;

    const quitAfterInstaller = async (version?: string) => {
      const status = withMeta({
        state: 'installing',
        version,
        message: 'Закрываем приложение и запускаем установщик. MusicStream откроется снова.',
      });
      send(status);
      await delay(700);
      app.quit();
      return status;
    };

    const bootstrap = bootstrapUpdatePath();
    if (bootstrap) {
      spawn(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          bootstrap,
          '-Update',
          '-RunInstaller',
          '-Quiet',
        ],
        { detached: true, stdio: 'ignore', windowsHide: true },
      ).unref();
      return quitAfterInstaller(pendingVersion ?? undefined);
    }

    const url = pendingDownloadUrl;
    if (!url) {
      installInFlight = false;
      const err = withMeta({ state: 'error', message: 'Сначала проверьте обновления' });
      send(err);
      return err;
    }

    const dest = path.join(app.getPath('temp'), exeAssetName());
    const version = pendingVersion ?? undefined;
    try {
      send({ state: 'downloading', version, progress: 0 });
      let lastPercent = -1;
      await downloadFile(url, dest, (received, total) => {
        const progress = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        if (progress === lastPercent) return;
        lastPercent = progress;
        send({ state: 'downloading', version, progress });
      });
      send({ state: 'downloaded', version, progress: 100 });
      launchInstaller(dest);
      return quitAfterInstaller(version);
    } catch (e) {
      installInFlight = false;
      const message = e instanceof Error ? e.message : String(e);
      const err = withMeta({ state: 'error', version, message });
      send(err);
      return err;
    }
  });

  if (app.isPackaged) {
    setTimeout(() => {
      void checkGitHubRelease()
        .then((s) => {
          if (s.state === 'available') send(s);
        })
        .catch((e) => log.warn('updater', e));
    }, 8_000);
  }
}
