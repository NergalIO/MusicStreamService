import { ipcMain } from 'electron';
import {
  bindLocalTrack,
  initLocalTrackIndex,
  pickAudioFiles,
  prepareLocalFile,
  resolveLocalTrackPath,
} from './local-tracks.js';
import { connectPresenceWs, disconnectPresenceWs, fulfillRelayUpload } from './presence-ws.js';
import { setRelayAccessToken } from './relay-bridge.js';
import { fileStreamUrl } from './stream-protocol.js';

export function registerLocalTracksIpc(): void {
  ipcMain.handle('localTracks:pickFiles', () => pickAudioFiles());
  ipcMain.handle('localTracks:prepare', (_e, filePath: string) => prepareLocalFile(filePath));
  ipcMain.handle('localTracks:bind', (_e, trackId: string, path: string, contentHash: string) =>
    bindLocalTrack(trackId, { path, contentHash }),
  );
  ipcMain.handle('localTracks:resolvePath', (_e, trackId: string) => resolveLocalTrackPath(trackId));
  ipcMain.handle('localTracks:resolvePlayUrl', async (_e, trackId: string) => {
    const p = await resolveLocalTrackPath(trackId);
    if (!p) return null;
    return fileStreamUrl(p);
  });
  ipcMain.handle('presence:connect', (_e, accessToken: string) => {
    setRelayAccessToken(accessToken);
    connectPresenceWs(accessToken);
  });
  ipcMain.handle('presence:updateAccessToken', (_e, accessToken: string) => {
    setRelayAccessToken(accessToken);
  });
  ipcMain.handle('presence:disconnect', () => {
    setRelayAccessToken(null);
    disconnectPresenceWs();
  });
  ipcMain.handle('relay:provideFile', (_e, sessionId: string) => fulfillRelayUpload(sessionId, true));
}

export async function initLocalTracks(): Promise<void> {
  await initLocalTrackIndex();
}
