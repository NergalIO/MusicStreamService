import { desktopCapturer, ipcMain } from 'electron';
import { setLobbyPresenceContext, type LobbyPresenceContext } from './discord-presence.js';

export function registerLobbyIpc(): void {
  ipcMain.handle('lobby:setPresence', (_e, ctx: LobbyPresenceContext) => {
    setLobbyPresenceContext(ctx);
  });

  ipcMain.handle('lobby:captureWindowAudio', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false });
    const self = sources.find((s) => /MusicStream|mss/i.test(s.name));
    const sourceId = self?.id ?? sources[0]?.id;
    if (!sourceId) return null;
    return { sourceId, chromeMediaSource: 'desktop' as const };
  });

}
