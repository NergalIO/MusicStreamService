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

let installed = false;

export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => log('error', 'window.onerror', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => log('error', 'unhandledrejection', e.reason));
}
