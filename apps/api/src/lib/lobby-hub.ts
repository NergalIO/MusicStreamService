import type { WebSocket } from 'ws';
import type { LobbyPlaybackState, LobbyWsEvent } from '@mss/shared';
import { redis } from './redis.js';

const AUDIO_PREFIX = 0x01;

interface LobbySocket {
  ws: WebSocket;
  userId: string;
  role: 'host' | 'guest';
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
  room.set(userId, { ws, userId, role });
}

export function unregisterLobbySocket(lobbyId: string, userId: string, ws?: WebSocket): boolean {
  const room = rooms.get(lobbyId);
  if (!room) return false;
  const current = room.get(userId);
  if (ws && current && current.ws !== ws) return false;
  room.delete(userId);
  if (!room.size) rooms.delete(lobbyId);
  return true;
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

/** Host audio: prefix 0x01 + WebM chunk → all guests. */
export function broadcastLobbyAudio(lobbyId: string, hostUserId: string, chunk: Buffer): void {
  const room = rooms.get(lobbyId);
  if (!room) return;
  const host = room.get(hostUserId);
  if (!host || host.role !== 'host') return;
  const payload = Buffer.alloc(chunk.length + 1);
  payload[0] = AUDIO_PREFIX;
  chunk.copy(payload, 1);
  for (const [uid, s] of room) {
    if (uid === hostUserId || s.role !== 'guest') continue;
    if (s.ws.readyState === s.ws.OPEN) s.ws.send(payload);
  }
}

export function isLobbyAudioMessage(data: Buffer): boolean {
  return data.length > 1 && data[0] === AUDIO_PREFIX;
}

export function stripAudioPrefix(data: Buffer): Buffer {
  return data.subarray(1);
}

export function sendLobbyError(ws: WebSocket, message: string): void {
  sendJson(ws, { type: 'error', message });
}

export function lobbyRoomSize(lobbyId: string): number {
  return rooms.get(lobbyId)?.size ?? 0;
}
