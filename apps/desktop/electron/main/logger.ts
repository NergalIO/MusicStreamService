import { ipcMain, shell } from 'electron';
import log from 'electron-log/main';
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
  ipcMain.handle('app:openLogs', async () => {
    await shell.openPath(logsDir());
  });
  log.info(`MSS started, logs in ${logsDir()}`);
}

export function logsDir(): string {
  return path.dirname(log.transports.file.getFile().path);
}

export { log };
