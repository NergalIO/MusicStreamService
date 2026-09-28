import { globalShortcut, type BrowserWindow } from 'electron';
import type { PlayerCommand } from '../preload/index.js';
import { getAppSettings, onAppSettingsChange } from './app-settings.js';
import { log } from './logger.js';
import { sendPlayerCommand } from './media.js';

export const GLOBAL_SHORTCUTS: [accelerator: string, command: PlayerCommand][] = [
  ['Control+Alt+Space', 'toggle'],
  ['Control+Alt+Right', 'next'],
  ['Control+Alt+Left', 'prev'],
  ['Control+Alt+Up', 'volumeUp'],
  ['Control+Alt+Down', 'volumeDown'],
];

function apply(enabled: boolean, getMainWindow: () => BrowserWindow | null): void {
  for (const [accelerator] of GLOBAL_SHORTCUTS) {
    if (globalShortcut.isRegistered(accelerator)) globalShortcut.unregister(accelerator);
  }
  if (!enabled) return;
  for (const [accelerator, command] of GLOBAL_SHORTCUTS) {
    const ok = globalShortcut.register(accelerator, () => sendPlayerCommand({ getMainWindow }, command));
    if (!ok) log.warn(`Global shortcut ${accelerator} is taken by another application`);
  }
}

export function initGlobalShortcuts(getMainWindow: () => BrowserWindow | null): void {
  apply(getAppSettings().globalShortcuts, getMainWindow);
  onAppSettingsChange((next, prev) => {
    if (next.globalShortcuts !== prev.globalShortcuts) apply(next.globalShortcuts, getMainWindow);
  });
}

export function disposeGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}
