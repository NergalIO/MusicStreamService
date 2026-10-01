import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
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

async function putFileToUrl(
  e: IpcMainInvokeEvent,
  filePath: string,
  url: string,
  headers: Record<string, string> | undefined,
  progressId?: string,
): Promise<void> {
  const st = await fs.stat(filePath);
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  await new Promise<void>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'PUT',
        headers: { ...(headers ?? {}), 'Content-Length': String(st.size) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(Buffer.concat(chunks).toString('utf8') || `HTTP ${res.statusCode}`));
          } else {
            resolve();
          }
        });
      },
    );
    req.on('error', reject);
    const stream = createReadStream(filePath);
    let sent = 0;
    stream.on('data', (chunk: string | Buffer) => {
      sent += chunk.length;
      if (progressId && !e.sender.isDestroyed()) {
        e.sender.send('localTracks:putProgress', { id: progressId, loaded: sent, total: st.size });
      }
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

export function registerLocalTracksIpc(): void {
  ipcMain.handle('localTracks:pickFiles', () => pickAudioFiles());
  ipcMain.handle('localTracks:prepare', (_e, filePath: string) => prepareLocalFile(filePath));
  ipcMain.handle('localTracks:bind', (_e, trackId: string, path: string, contentHash: string) =>
    bindLocalTrack(trackId, { path, contentHash }),
  );
  ipcMain.handle(
    'localTracks:putToUrl',
    (
      e,
      filePath: string,
      url: string,
      headers: Record<string, string> | undefined,
      progressId: string | undefined,
    ) => putFileToUrl(e, filePath, url, headers, progressId),
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
