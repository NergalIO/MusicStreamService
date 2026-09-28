import { apiUrl } from './api-base.js';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

export interface RegisterPending {
  needsVerification: true;
  email: string;
}

export class EmailNotVerifiedError extends Error {
  readonly email: string;

  constructor(email: string, message: string) {
    super(message);
    this.name = 'EmailNotVerifiedError';
    this.email = email;
  }
}

function parseErrorMessage(text: string, fallback: string): string {
  try {
    const j = JSON.parse(text) as { message?: string };
    return j.message ?? fallback;
  } catch {
    return text || fallback;
  }
}

export async function postAuthJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 403) {
      try {
        const j = JSON.parse(text) as { code?: string; email?: string; message?: string };
        if (j.code === 'EMAIL_NOT_VERIFIED' && j.email) {
          throw new EmailNotVerifiedError(j.email, j.message ?? 'Подтвердите email');
        }
      } catch (e) {
        if (e instanceof EmailNotVerifiedError) throw e;
      }
    }
    throw new Error(parseErrorMessage(text, res.statusText));
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function completeLogin(session: AuthSession): Promise<void> {
  saveSession(session);
  const deviceId = await window.electronAPI.getDeviceId();
  await apiFetch('/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, name: 'Desktop' }),
  });
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let presenceToken: string | null = null;

export function loadSession(): AuthSession | null {
  const raw = localStorage.getItem('mss_session');
  if (!raw) return null;
  const s = JSON.parse(raw) as AuthSession;
  accessToken = s.accessToken;
  refreshToken = s.refreshToken;
  syncPresence();
  return s;
}

function syncPresence(): void {
  const token = accessToken;
  if (!token || !window.electronAPI?.presence) return;
  if (token === presenceToken) return;
  presenceToken = token;
  void window.electronAPI.presence.connect(token);
}

export function saveSession(s: AuthSession): void {
  accessToken = s.accessToken;
  refreshToken = s.refreshToken;
  localStorage.setItem('mss_session', JSON.stringify(s));
  syncPresence();
}

export function clearSession(): void {
  accessToken = null;
  refreshToken = null;
  presenceToken = null;
  localStorage.removeItem('mss_session');
  void window.electronAPI?.presence?.disconnect();
}

export function currentAccessToken(): string | null {
  return accessToken;
}

export async function refreshAccess(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { accessToken: string };
  accessToken = data.accessToken;
  const session = loadSession();
  if (session) saveSession({ ...session, accessToken: data.accessToken });
  return true;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let res = await fetch(apiUrl(path), { ...init, headers });
  if (res.status === 401 && refreshToken) {
    const ok = await refreshAccess();
    if (ok) {
      headers.set('Authorization', `Bearer ${accessToken}`);
      res = await fetch(apiUrl(path), { ...init, headers });
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
