import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export interface RelaySession {
  trackId: string;
  holderUserId: string;
  token: string;
  createdAt: number;
  uploadDone: boolean;
  waiters: Array<{ resolve: () => void; reject: (e: Error) => void }>;
}

const sessions = new Map<string, RelaySession>();

export function createRelaySession(trackId: string, holderUserId: string): { sessionId: string; token: string } {
  const sessionId = uuidv4();
  const token = randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    trackId,
    holderUserId,
    token,
    createdAt: Date.now(),
    uploadDone: false,
    waiters: [],
  });
  return { sessionId, token };
}

export function getRelaySession(sessionId: string): RelaySession | undefined {
  return sessions.get(sessionId);
}

export function verifyRelayToken(sessionId: string, token: string): RelaySession | null {
  const s = sessions.get(sessionId);
  if (!s || s.token !== token) return null;
  return s;
}

export function markRelayUploadDone(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.uploadDone = true;
  for (const w of s.waiters) w.resolve();
  s.waiters.length = 0;
  setTimeout(() => sessions.delete(sessionId), 5 * 60_000);
}

export function waitRelayUpload(sessionId: string, timeoutMs: number): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return Promise.reject(new Error('Relay session expired'));
  if (s.uploadDone) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = s.waiters.findIndex((w) => w.resolve === resolve);
      if (idx >= 0) s.waiters.splice(idx, 1);
      reject(new Error('Relay upload timeout'));
    }, timeoutMs);
    s.waiters.push({
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
}
