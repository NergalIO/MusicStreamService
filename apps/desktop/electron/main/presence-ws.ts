import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import WebSocket from 'ws';
import { getAppSettings } from './app-settings.js';
import { bindLocalTrack, prepareLocalFile, resolveLocalTrackPath } from './local-tracks.js';
import { emitRelayEvent, getRelayAccessToken } from './relay-bridge.js';

function resolveApiBase(): string {
  const fromSettings = getAppSettings().apiPublicUrl?.trim();
  if (fromSettings) return fromSettings.replace(/\/$/, '');
  const fromEnv = process.env.API_PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://127.0.0.1:3001';
}

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let wsAccessToken: string | null = null;

interface RelayUploadMessage {
  type: 'relay_upload';
  sessionId: string;
  trackId: string;
  title: string;
  uploadUrl: string;
  token: string;
}

const pendingRelays = new Map<string, RelayUploadMessage>();
const relayInFlight = new Set<string>();

async function pickAudioFileForTrack(title: string): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Укажите файл для «${title}»`,
    message: 'MSS нужен исходный аудioфайл, чтобы другой пользователь мог послушать трек.',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma', 'aiff', 'ape', 'wv', 'webm'] }],
  });
  if (canceled || !filePaths[0]) return null;
  return filePaths[0];
}

async function resolveRelayFilePath(trackId: string, title: string, interactive: boolean): Promise<string> {
  const existing = await resolveLocalTrackPath(trackId);
  if (existing) return existing;

  if (!interactive) {
    throw new Error('need_file');
  }

  const picked = await pickAudioFileForTrack(title);
  if (!picked) throw new Error('need_file');

  const prepared = await prepareLocalFile(picked);
  await bindLocalTrack(trackId, { path: prepared.path, contentHash: prepared.contentHash });
  return prepared.path;
}

async function uploadRelayFile(msg: RelayUploadMessage, filePath: string, bearer: string): Promise<void> {
  const blob = await openAsBlob(filePath);
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));

  const res = await fetch(msg.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'X-Relay-Token': msg.token,
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Relay upload failed ${res.status}`);
  }
}

export async function fulfillRelayUpload(sessionId: string, interactive: boolean): Promise<void> {
  const msg = pendingRelays.get(sessionId);
  if (!msg) throw new Error('Запрос устарел — попросите слушателя снова открыть трек');

  const bearer = getRelayAccessToken();
  if (!bearer) throw new Error('Войдите в аккаунт MSS');

  if (relayInFlight.has(sessionId)) return;
  relayInFlight.add(sessionId);

  emitRelayEvent({
    phase: 'start',
    sessionId: msg.sessionId,
    trackId: msg.trackId,
    title: msg.title,
  });
  emitRelayEvent({ phase: 'uploading', sessionId: msg.sessionId });

  try {
    const filePath = await resolveRelayFilePath(msg.trackId, msg.title, interactive);
    await uploadRelayFile(msg, filePath, bearer);
    emitRelayEvent({ phase: 'done', sessionId: msg.sessionId, title: msg.title });
    pendingRelays.delete(sessionId);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const needFile = raw === 'need_file';
    const error = needFile
      ? 'Укажите файл на этом компьютере — без него другие не смогут слушать'
      : raw;
    emitRelayEvent({
      phase: 'failed',
      sessionId: msg.sessionId,
      title: msg.title,
      error,
      needFile,
    });
    if (!needFile) pendingRelays.delete(sessionId);
    throw e;
  } finally {
    relayInFlight.delete(sessionId);
  }
}

function handleMessage(raw: WebSocket.RawData): void {
  try {
    const msg = JSON.parse(String(raw)) as RelayUploadMessage & { type: string };
    if (msg.type !== 'relay_upload') return;

    pendingRelays.set(msg.sessionId, msg);
    void fulfillRelayUpload(msg.sessionId, true).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function connectPresenceWs(token: string): void {
  if (
    wsAccessToken === token &&
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  disconnectPresenceWs();
  wsAccessToken = token;

  const httpBase = resolveApiBase();
  const url = `${httpBase.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  socket = ws;

  ws.on('error', () => {
    /* сеть/API недоступны — не считаем необработанной ошибкой */
  });

  ws.on('open', () => {
    if (socket !== ws) return;
    pingTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 30_000);
  });

  ws.on('message', (data) => {
    handleMessage(data);
  });

  ws.on('close', () => {
    if (socket !== ws) return;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    socket = null;
  });
}

export function disconnectPresenceWs(): void {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  const ws = socket;
  socket = null;
  wsAccessToken = null;
  if (!ws) return;

  ws.removeAllListeners();
  if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
  else if (ws.readyState === WebSocket.OPEN) ws.close(1000);
}
