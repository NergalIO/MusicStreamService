import type { LogLevel } from '../../electron/preload/index';

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Пишет в общий лог приложения (файл в папке логов main-процесса). */
export function log(level: LogLevel, ...parts: unknown[]): void {
  window.electronAPI?.system?.log(level, parts.map(describe));
}

export function sessionEvent(level: 'info' | 'warn' | 'error', category: string, message: string): void {
  window.electronAPI?.system?.session(level, category, message);
}

let installed = false;

export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    log('error', 'window.onerror', e.error ?? e.message);
    sessionEvent('error', 'crash', describe(e.error ?? e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    log('error', 'unhandledrejection', e.reason);
    sessionEvent('error', 'crash', describe(e.reason));
  });
}
