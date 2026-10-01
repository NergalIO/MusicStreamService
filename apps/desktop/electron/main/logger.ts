import { app, ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(OAuth|Bearer)\s+[\w.~+/=-]+/gi, '$1 ***'],
  [/\by0_[\w-]{10,}/g, 'y0_***'],
  [/((?:access|refresh|id)_?token|client_secret|authorization|password)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1$2***'],
];

export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') return maskSecrets(value);
  if (value instanceof Error) {
    const copy = new Error(maskSecrets(value.message));
    copy.name = value.name;
    copy.stack = value.stack ? maskSecrets(value.stack) : undefined;
    return copy;
  }
  if (value && typeof value === 'object') {
    try {
      return maskSecrets(JSON.stringify(value));
    } catch {
      return '[object]';
    }
  }
  return value;
}

export function initLogging(): void {
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.console.level = process.env.ELECTRON_RENDERER_URL ? 'debug' : 'warn';
  log.hooks.push((message) => ({ ...message, data: message.data.map(maskValue) }));
  Object.assign(console, log.functions);
  log.errorHandler.startCatching({ showDialog: false });

  const renderer = log.scope('renderer');
  ipcMain.on('log:write', (_e, level: LogLevel, parts: unknown[]) => {
    const fn = renderer[level] ?? renderer.info;
    fn(...(Array.isArray(parts) ? parts : [parts]));
  });
  ipcMain.on('log:session', (_e, level: string, category: string, message: string) => {
    sessionEvent(level, category, message);
  });
  ipcMain.handle('app:openLogs', async () => {
    await shell.openPath(logsDir());
  });
  process.on('uncaughtException', (err) => {
    sessionEvent('error', 'crash', `${err.name}: ${err.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    sessionEvent('error', 'crash', text);
  });
  log.info(`MSS started, logs in ${logsDir()}`);
  try {
    sessionEvent('info', 'app', `start ${app.getVersion()}`);
  } catch {
    sessionEvent('info', 'app', 'start');
  }
}

export function logsDir(): string {
  return path.dirname(log.transports.file.getFile().path);
}

const SESSION_RING = 2_000;
const SESSION_FILE_MAX = 1 * 1024 * 1024;
const sessionRing: string[] = [];

function sessionPaths(): { current: string; prev: string } {
  const dir = logsDir();
  return {
    current: path.join(dir, 'session.log'),
    prev: path.join(dir, 'session.prev.log'),
  };
}

export function sessionEvent(level: string, category: string, message: string): void {
  const line = `${new Date().toISOString()} ${String(level).toUpperCase()} [${category}] ${maskSecrets(String(message ?? ''))}`;
  sessionRing.push(line);
  if (sessionRing.length > SESSION_RING) sessionRing.shift();
  try {
    const { current, prev } = sessionPaths();
    fs.appendFileSync(current, `${line}\n`);
    const bytes = fs.statSync(current).size;
    if (bytes >= SESSION_FILE_MAX) {
      if (fs.existsSync(prev)) fs.unlinkSync(prev);
      fs.renameSync(current, prev);
    }
  } catch {
    /* каталог логов ещё не готов — кольцо в памяти остаётся */
  }
}

export function sessionTranscript(): string {
  try {
    const { current, prev } = sessionPaths();
    const parts: string[] = [];
    if (fs.existsSync(prev)) parts.push(fs.readFileSync(prev, 'utf8').trimEnd());
    if (fs.existsSync(current)) parts.push(fs.readFileSync(current, 'utf8').trimEnd());
    if (parts.some((p) => p.length > 0)) return parts.join('\n');
  } catch {
    /* читаем кольцо */
  }
  return sessionRing.length ? sessionRing.join('\n') : '(событий нет)';
}

export { log };
