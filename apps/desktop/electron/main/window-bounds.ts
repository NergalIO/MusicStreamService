import { app, screen, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface SavedBounds extends Electron.Rectangle {
  maximized?: boolean;
}

interface Limits {
  min: { width: number; height: number };
  max?: { width: number; height: number };
}

function boundsFile(name: string): string {
  return path.join(app.getPath('userData'), name);
}

/** Сохранённые размер и положение окна, если оно по-прежнему попадает на один из мониторов. */
export function loadBounds(name: string, limits: Limits): SavedBounds | null {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(name), 'utf8')) as SavedBounds;
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
    const { workArea } = screen.getDisplayMatching(b);
    const visible =
      b.x < workArea.x + workArea.width - 40 &&
      b.x + b.width > workArea.x + 40 &&
      b.y >= workArea.y - 10 &&
      b.y < workArea.y + workArea.height - 40;
    if (!visible) return null;
    const clamp = (v: number, lo: number, hi = Infinity) => Math.min(hi, Math.max(lo, v));
    return {
      ...b,
      width: clamp(b.width, limits.min.width, limits.max?.width),
      height: clamp(b.height, limits.min.height, limits.max?.height),
    };
  } catch {
    return null;
  }
}

/** Запоминает размер, положение и развёрнутость окна (с задержкой при перетаскивании и сразу при закрытии). */
export function persistBounds(win: BrowserWindow, name: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    if (win.isDestroyed()) return;
    const data: SavedBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      fs.writeFileSync(boundsFile(name), JSON.stringify(data));
    } catch {
      /* not critical */
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    write();
  });
}
