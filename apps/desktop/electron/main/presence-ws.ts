import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { getAppSettings } from './app-settings.js';
import { toastMain } from './toast.js';
import { resolveLocalTrackPath } from './local-tracks.js';

function resolveApiBase(): string {
  const fromSettings = getAppSettings().apiPublicUrl?.trim();
  if (fromSettings) return fromSettings.replace(/\/$/, '');
  const fromEnv = process.env.API_PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://127.0.0.1:3001';
}

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let accessToken: string | null = null;

interface RelayUploadMessage {
  type: 'relay_upload';
  sessionId: string;
  trackId: string;
  title: string;
  uploadUrl: string;
  token: string;
}

async function uploadRelayFile(msg: RelayUploadMessage, token: string): Promise<void> {
  const filePath = await resolveLocalTrackPath(msg.trackId);
  if (!filePath) throw new Error('Локальный файл не найден');

  const buf = await fs.promises.readFile(filePath);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));

  const res = await fetch(msg.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Relay-Token': msg.token,
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Relay upload failed ${res.status}`);
  }
}

function handleMessage(raw: WebSocket.RawData, token: string): void {
  try {
    const msg = JSON.parse(String(raw)) as RelayUploadMessage & { type: string };
    if (msg.type === 'relay_upload') {
      toastMain(`Сервер запрашивает трек «${msg.title}» для другого пользователя`);
      void uploadRelayFile(msg, token).catch((e) => {
        console.warn('relay upload failed', e);
        toastMain(e instanceof Error ? e.message : 'Не удалось отдать трек');
      });
    }
  } catch {
    /* ignore */
  }
}

export function connectPresenceWs(token: string): void {
  if (
    accessToken === token &&
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  disconnectPresenceWs();
  accessToken = token;

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
    if (accessToken) handleMessage(data, accessToken);
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
  accessToken = null;
  if (!ws) return;

  ws.removeAllListeners();
  if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
  else if (ws.readyState === WebSocket.OPEN) ws.close(1000);
}
