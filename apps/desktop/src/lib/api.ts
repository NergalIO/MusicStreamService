const API_BASE = '/api';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
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
  const res = await fetch(`${API_BASE}/auth/refresh`, {
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
  let res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && refreshToken) {
    const ok = await refreshAccess();
    if (ok) {
      headers.set('Authorization', `Bearer ${accessToken}`);
      res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
