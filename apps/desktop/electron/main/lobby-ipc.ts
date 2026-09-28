import { desktopCapturer, ipcMain } from 'electron';
import { setLobbyPresenceContext, type LobbyPresenceContext } from './discord-presence.js';

export type LobbyCaptureSource = {
  sourceId: string;
  chromeMediaSource: 'window' | 'screen';
};

async function pickCaptureSource(): Promise<LobbyCaptureSource | null> {
  const windows = await desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false });
  const self = windows.find((s) => /MusicStream|mss/i.test(s.name));
  if (self?.id) return { sourceId: self.id, chromeMediaSource: 'window' };

  const screens = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false });
  const screen = screens.find((s) => /Entire|Screen|Экран|screen/i.test(s.name)) ?? screens[0];
  if (screen?.id) return { sourceId: screen.id, chromeMediaSource: 'screen' };

  const anyWindow = windows[0];
  if (anyWindow?.id) return { sourceId: anyWindow.id, chromeMediaSource: 'window' };
  return null;
}

export function registerLobbyIpc(): void {
  ipcMain.handle('lobby:setPresence', (_e, ctx: LobbyPresenceContext) => {
    setLobbyPresenceContext(ctx);
  });

  ipcMain.handle('lobby:captureWindowAudio', async (): Promise<LobbyCaptureSource | null> => {
    return pickCaptureSource();
  });
}
