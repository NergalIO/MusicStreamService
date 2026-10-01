import { app, BrowserWindow, crashReporter, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, logsDir, maskSecrets, sessionTranscript } from './logger.js';

/** Локальные дампы, без отправки на сервер и без токенов в extra. */
export function initCrashReporter(): void {
  crashReporter.start({
    productName: 'MusicStreamService',
    submitURL: 'https://127.0.0.1/',
    uploadToServer: false,
    compress: true,
    extra: { app: 'mss' },
  });
}

function dumpsDir(): string {
  try {
    return app.getPath('crashDumps');
  } catch {
    return path.join(app.getPath('userData'), 'Crashpad');
  }
}

function listDumps(): string[] {
  const root = dumpsDir();
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(dmp|txt)$/i.test(name)) out.push(full);
      } catch {
        /* недоступный файл пропускаем */
      }
    }
  };
  walk(root);
  return out.sort();
}

function tailLogs(maxChars = 20_000): string {
  try {
    const dir = logsDir();
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.log')).sort();
    const file = files.at(-1);
    if (!file) return '(лог пуст)';
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    return maskSecrets(text.slice(-maxChars));
  } catch {
    return '(не удалось прочитать лог)';
  }
}

export function buildCrashReport(): string {
  const dumps = listDumps();
  const dumpLines = dumps.length
    ? dumps.map((f) => {
        try {
          const st = fs.statSync(f);
          return `${path.basename(f)}  ${st.size} байт  ${st.mtime.toISOString()}`;
        } catch {
          return path.basename(f);
        }
      })
    : ['(дампов нет)'];
  return [
    'MusicStreamService — дамп сессии',
    `Версия: ${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
    `Chrome: ${process.versions.chrome}`,
    `ОС: ${os.type()} ${os.release()} ${os.arch()}`,
    `Время: ${new Date().toISOString()}`,
    '',
    'Токены и пароли в отчёт не входят.',
    '',
    '--- Дампы ---',
    ...dumpLines,
    '',
    '--- Сессия ---',
    sessionTranscript(),
    '',
    '--- Хвост лога ---',
    tailLogs(),
    '',
  ].join('\n');
}

export function registerCrashIpc(): void {
  ipcMain.handle('system:openCrashes', async () => {
    const dir = dumpsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });
  ipcMain.handle('system:exportReport', async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: path.join(app.getPath('documents'), `mss-session-${stamp}.txt`),
          filters: [{ name: 'Текст', extensions: ['txt'] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: path.join(app.getPath('documents'), `mss-session-${stamp}.txt`),
          filters: [{ name: 'Текст', extensions: ['txt'] }],
        });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, buildCrashReport(), 'utf8');
    log.info(`crash report saved to ${result.filePath}`);
    return result.filePath;
  });
}
