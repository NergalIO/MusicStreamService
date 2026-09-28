import type { BrowserWindow } from 'electron';

export type RelayEventPayload =
  | { phase: 'start'; sessionId: string; trackId: string; title: string }
  | { phase: 'uploading'; sessionId: string }
  | { phase: 'done'; sessionId: string; title: string }
  | { phase: 'failed'; sessionId: string; title: string; error: string; needFile?: boolean };

let getWindows: (() => BrowserWindow[]) | null = null;
let accessToken: string | null = null;

export function registerRelayBridge(opts: { getWindows: () => BrowserWindow[] }): void {
  getWindows = opts.getWindows;
}

export function setRelayAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRelayAccessToken(): string | null {
  return accessToken;
}

export function emitRelayEvent(payload: RelayEventPayload): void {
  for (const win of getWindows?.() ?? []) {
    if (!win.isDestroyed()) win.webContents.send('relay:event', payload);
  }
}
