import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { log } from './logger.js';

export type UpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloaded' | 'error' | 'dev';
  version?: string;
  message?: string;
  downloadUrl?: string;
};

type GhRelease = {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
};

let pendingDownloadUrl: string | null = null;
let pendingVersion: string | null = null;

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
  const current = normalizeVersion(app.getVersion());
  const release = await fetchJson<GhRelease>(`https://api.github.com/repos/${repo}/releases/latest`);
  const latest = normalizeVersion(release.tag_name);
  const asset = release.assets.find((a) => a.name === exeAssetName());
  if (!asset) {
    return { state: 'error', message: `Нет asset ${exeAssetName()} в последнем релизе` };
  }
  pendingDownloadUrl = asset.browser_download_url;
  pendingVersion = latest;
  if (latest !== current) {
    return { state: 'available', version: latest, downloadUrl: asset.browser_download_url };
  }
  return { state: 'not-available', version: latest };
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

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'MusicStreamService-Desktop' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          downloadFile(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', reject);
  });
}

export function initUpdater(getMainWindow: () => BrowserWindow | null): void {
  const send = (payload: UpdateStatus) => {
    getMainWindow()?.webContents.send('update:status', payload);
  };

  ipcMain.handle('update:check', async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return { state: 'dev' };
    send({ state: 'checking' });
    try {
      const status = await checkGitHubRelease();
      send(status);
      return status;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('updater check failed', message);
      const err = { state: 'error' as const, message };
      send(err);
      return err;
    }
  });

  ipcMain.handle('update:install', async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return { state: 'dev' };
    const bootstrap = bootstrapUpdatePath();
    if (bootstrap) {
      spawn(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bootstrap, '-Update', '-RunInstaller'],
        { detached: true, stdio: 'ignore' },
      ).unref();
      return { state: 'downloaded', message: 'Запущена локальная пересборка через bootstrap' };
    }
    const url = pendingDownloadUrl;
    if (!url) {
      return { state: 'error', message: 'Сначала проверьте обновления' };
    }
    const dest = path.join(app.getPath('temp'), exeAssetName());
    try {
      await downloadFile(url, dest);
      send({ state: 'downloaded', version: pendingVersion ?? undefined });
      await shell.openPath(dest);
      return { state: 'downloaded', version: pendingVersion ?? undefined };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { state: 'error', message };
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
