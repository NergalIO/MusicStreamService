import type { WebSocket } from 'ws';
import type { LobbyPlaybackState, LobbyWsEvent } from '@mss/shared';
import { redis } from './redis.js';

const AUDIO_PREFIX = 0x01;
/** Кадр эфира с номером: [0x02][seq uint32 BE][WebM]. По нему считаются потери DJ → сервер. */
const AUDIO_SEQ_PREFIX = 0x02;
const AUDIO_SEQ_HEADER = 5;

const PING_INTERVAL_MS = 5_000;
/** Кадры идут раз в ~300 мс, поэтому окно в 40 кадров — примерно 12 секунд эфира. */
const LOSS_WINDOW_FRAMES = 40;
const LOSS_MIN_FRAMES = 10;

interface AudioStats {
  lastSeq: number | null;
  received: number;
  lost: number;
  lossPct: number | null;
}

interface LobbySocket {
  ws: WebSocket;
  userId: string;
  role: 'host' | 'guest';
  rttMs: number | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  audio: AudioStats;
}

export interface LobbyNetStats {
  hostOnline: boolean;
  hostRttMs: number | null;
  hostLossPct: number | null;
}

const rooms = new Map<string, Map<string, LobbySocket>>();

function playbackKey(lobbyId: string): string {
  return `mss:lobby:${lobbyId}:playback`;
}

export async function getLobbyPlayback(lobbyId: string): Promise<LobbyPlaybackState> {
  const raw = await redis.get(playbackKey(lobbyId));
  if (!raw) {
    return { track: null, paused: true, positionMs: 0, updatedAt: new Date().toISOString() };
  }
  return JSON.parse(raw) as LobbyPlaybackState;
}

export async function setLobbyPlayback(lobbyId: string, playback: LobbyPlaybackState): Promise<void> {
  await redis.set(playbackKey(lobbyId), JSON.stringify(playback), 'EX', 86400);
}

export async function clearLobbyPlayback(lobbyId: string): Promise<void> {
  await redis.del(playbackKey(lobbyId));
}

function sendPing(entry: LobbySocket): void {
  if (entry.ws.readyState !== entry.ws.OPEN) return;
  entry.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
}

export function registerLobbySocket(
  lobbyId: string,
  userId: string,
  role: 'host' | 'guest',
  ws: WebSocket,
): void {
  let room = rooms.get(lobbyId);
  if (!room) {
    room = new Map();
    rooms.set(lobbyId, room);
  }
  const previous = room.get(userId);
  if (previous?.pingTimer) clearInterval(previous.pingTimer);

  const entry: LobbySocket = {
    ws,
    userId,
    role,
    rttMs: null,
    pingTimer: null,
    audio: { lastSeq: null, received: 0, lost: 0, lossPct: null },
  };
  room.set(userId, entry);
  entry.pingTimer = setInterval(() => sendPing(entry), PING_INTERVAL_MS);
  sendPing(entry);
}

export function unregisterLobbySocket(lobbyId: string, userId: string, ws?: WebSocket): boolean {
  const room = rooms.get(lobbyId);
  if (!room) return false;
  const current = room.get(userId);
  if (ws && current && current.ws !== ws) return false;
  if (current?.pingTimer) clearInterval(current.pingTimer);
  room.delete(userId);
  if (!room.size) rooms.delete(lobbyId);
  return true;
}

/** Ответ участника на серверный ping: RTT сглаживается, чтобы карточка не дёргалась. */
export function noteLobbyPong(lobbyId: string, userId: string, sentAt: number | undefined): void {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return;
  const entry = rooms.get(lobbyId)?.get(userId);
  if (!entry) return;
  const rtt = Date.now() - sentAt;
  if (rtt < 0 || rtt > 60_000) return;
  entry.rttMs = entry.rttMs === null ? rtt : Math.round(entry.rttMs * 0.7 + rtt * 0.3);
}

function noteAudioFrame(stats: AudioStats, seq: number): void {
  if (stats.lastSeq !== null) {
    if (seq <= stats.lastSeq) {
      // Реконнект или перезапуск записи: нумерация с нуля, прежняя статистика неприменима.
      stats.received = 0;
      stats.lost = 0;
      stats.lossPct = null;
    } else {
      stats.lost += seq - stats.lastSeq - 1;
    }
  }
  stats.lastSeq = seq;
  stats.received += 1;

  const total = stats.received + stats.lost;
  if (total < LOSS_MIN_FRAMES) return;
  stats.lossPct = Math.round((stats.lost / total) * 1000) / 10;
  if (total >= LOSS_WINDOW_FRAMES) {
    stats.received = 0;
    stats.lost = 0;
  }
}

export function getLobbyNetStats(lobbyId: string): LobbyNetStats {
  const room = rooms.get(lobbyId);
  if (!room) return { hostOnline: false, hostRttMs: null, hostLossPct: null };
  for (const entry of room.values()) {
    if (entry.role !== 'host') continue;
    const online = entry.ws.readyState === entry.ws.OPEN;
    return {
      hostOnline: online,
      hostRttMs: online ? entry.rttMs : null,
      hostLossPct: online ? entry.audio.lossPct : null,
    };
  }
  return { hostOnline: false, hostRttMs: null, hostLossPct: null };
}

export function getLobbyHostUserId(lobbyId: string): string | null {
  const room = rooms.get(lobbyId);
  if (!room) return null;
  for (const s of room.values()) {
    if (s.role === 'host') return s.userId;
  }
  return null;
}

function sendJson(ws: WebSocket, event: LobbyWsEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

export function broadcastLobbyJson(lobbyId: string, event: LobbyWsEvent, skipUserId?: string): void {
  const room = rooms.get(lobbyId);
  if (!room) return;
  const raw = JSON.stringify(event);
  for (const [uid, s] of room) {
    if (skipUserId && uid === skipUserId) continue;
    if (s.ws.readyState === s.ws.OPEN) s.ws.send(raw);
  }
}

/**
 * Эфир DJ: кадр от хоста (0x01 или 0x02 с номером) уходит гостям всегда как 0x01,
 * чтобы плеер гостя получал ровно байты WebM и не знал о нумерации.
 */
export function broadcastLobbyAudio(
  lobbyId: string,
  hostUserId: string,
  frame: LobbyAudioFrame,
): void {
  const room = rooms.get(lobbyId);
  if (!room) return;
  const host = room.get(hostUserId);
  if (!host || host.role !== 'host') return;
  if (frame.seq !== null) noteAudioFrame(host.audio, frame.seq);

  const payload = Buffer.alloc(frame.chunk.length + 1);
  payload[0] = AUDIO_PREFIX;
  frame.chunk.copy(payload, 1);
  for (const [uid, s] of room) {
    if (uid === hostUserId || s.role !== 'guest') continue;
    if (s.ws.readyState === s.ws.OPEN) s.ws.send(payload);
  }
}

export function isLobbyAudioMessage(data: Buffer): boolean {
  if (data.length > AUDIO_SEQ_HEADER && data[0] === AUDIO_SEQ_PREFIX) return true;
  return data.length > 1 && data[0] === AUDIO_PREFIX;
}

export interface LobbyAudioFrame {
  /** null — клиент старой версии без нумерации: потери по нему не считаются. */
  seq: number | null;
  chunk: Buffer;
}

export function readAudioFrame(data: Buffer): LobbyAudioFrame {
  if (data[0] === AUDIO_SEQ_PREFIX) {
    return { seq: data.readUInt32BE(1), chunk: data.subarray(AUDIO_SEQ_HEADER) };
  }
  return { seq: null, chunk: data.subarray(1) };
}

export function sendLobbyError(ws: WebSocket, message: string): void {
  sendJson(ws, { type: 'error', message });
}

export function lobbyRoomSize(lobbyId: string): number {
  return rooms.get(lobbyId)?.size ?? 0;
}
