import type { WebSocket } from 'ws';
import { config } from '../config.js';
import { redis } from './redis.js';

const onlineKey = (userId: string) => `mss:online:${userId}`;

/** Активные WS-сессии пользователя (для push relay_upload). */
const sockets = new Map<string, Set<WebSocket>>();

export function registerSocket(userId: string, socket: WebSocket): void {
  let set = sockets.get(userId);
  if (!set) {
    set = new Set();
    sockets.set(userId, set);
  }
  set.add(socket);
  void touchOnline(userId);
  socket.on('close', () => {
    set!.delete(socket);
    if (!set!.size) sockets.delete(userId);
  });
}

export async function touchOnline(userId: string): Promise<void> {
  await redis.set(onlineKey(userId), '1', 'EX', config.presenceTtlSec);
}

export async function isUserOnline(userId: string): Promise<boolean> {
  if (sockets.has(userId)) return true;
  return (await redis.exists(onlineKey(userId))) === 1;
}

export function sendToUser(userId: string, payload: unknown): boolean {
  const set = sockets.get(userId);
  if (!set?.size) return false;
  const raw = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(raw);
  }
  return true;
}
