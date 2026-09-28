import { ipcMain } from 'electron';
import {
  bindLocalTrack,
  initLocalTrackIndex,
  pickAudioFiles,
  prepareLocalFile,
  resolveLocalTrackPath,
} from './local-tracks.js';
import { connectPresenceWs, disconnectPresenceWs } from './presence-ws.js';
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
    connectPresenceWs(accessToken);
  });
  ipcMain.handle('presence:disconnect', () => {
    disconnectPresenceWs();
  });
}

export async function initLocalTracks(): Promise<void> {
  await initLocalTrackIndex();
}
