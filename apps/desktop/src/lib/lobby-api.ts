import type { LobbyDto, LobbyPlaybackState, LobbyQueueItemDto, LobbyWsEvent, UnifiedTrack } from '@mss/shared';
import { apiFetch, currentAccessToken } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';

function wsHttpBase(): string {
  if (import.meta.env.DEV) {
    const v = import.meta.env.VITE_API_PUBLIC_URL as string | undefined;
    if (v?.trim()) return v.trim().replace(/\/$/, '');
    return 'http://127.0.0.1:3001';
  }
  return getApiBaseUrl();
}

export function lobbyWsUrl(lobbyId: string): string {
  const http = wsHttpBase();
  const wsBase = http.replace(/^http/, 'ws');
  const token = currentAccessToken();
  return `${wsBase}/ws/lobby/${encodeURIComponent(lobbyId)}?token=${encodeURIComponent(token ?? '')}`;
}

export function createLobby(opts?: { title?: string; maxMembers?: number }): Promise<LobbyDto> {
  return apiFetch('/lobbies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  });
}

export function joinLobby(inviteCode: string): Promise<LobbyDto> {
  return apiFetch('/lobbies/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode: inviteCode.trim().toUpperCase() }),
  });
}

export function fetchLobby(id: string): Promise<LobbyDto> {
  return apiFetch(`/lobbies/${id}`);
}

export function leaveLobby(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/lobbies/${id}/leave`, { method: 'POST' });
}

export function closeLobby(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/lobbies/${id}`, { method: 'DELETE' });
}

export function suggestTrack(lobbyId: string, track: UnifiedTrack): Promise<LobbyQueueItemDto> {
  return apiFetch(`/lobbies/${lobbyId}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track }),
  });
}

export function acceptSuggestion(lobbyId: string, itemId: string): Promise<LobbyQueueItemDto[]> {
  return apiFetch(`/lobbies/${lobbyId}/queue/${itemId}/accept`, { method: 'POST' });
}

export function rejectSuggestion(lobbyId: string, itemId: string): Promise<LobbyQueueItemDto[]> {
  return apiFetch(`/lobbies/${lobbyId}/queue/${itemId}/reject`, { method: 'POST' });
}

export function postLobbyPlayback(
  lobbyId: string,
  body: {
    action: 'play' | 'pause' | 'skip' | 'seek';
    track?: UnifiedTrack;
    positionMs?: number;
  },
): Promise<LobbyPlaybackState> {
  return apiFetch(`/lobbies/${lobbyId}/playback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export type LobbyWsHandler = (event: LobbyWsEvent) => void;

export class LobbyWsClient {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private onEvent: LobbyWsHandler;
  private onBinary: ((chunk: ArrayBuffer) => void) | null = null;

  constructor(onEvent: LobbyWsHandler) {
    this.onEvent = onEvent;
  }

  setBinaryHandler(handler: ((chunk: ArrayBuffer) => void) | null): void {
    this.onBinary = handler;
  }

  connect(lobbyId: string): void {
    this.disconnect();
    const url = lobbyWsUrl(lobbyId);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(ev.data);
        if (buf[0] === 0x01 && this.onBinary) {
          this.onBinary(ev.data.slice(1));
        }
        return;
      }
      try {
        const msg = JSON.parse(String(ev.data)) as LobbyWsEvent;
        this.onEvent(msg);
      } catch {
        /* ignore */
      }
    };

    ws.onopen = () => {
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    };

    ws.onclose = () => {
      this.onEvent({ type: 'error', message: 'Соединение с лобби закрыто' });
    };
  }

  sendAudioChunk(chunk: ArrayBuffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const prefixed = new Uint8Array(chunk.byteLength + 1);
    prefixed[0] = 0x01;
    prefixed.set(new Uint8Array(chunk), 1);
    this.ws.send(prefixed.buffer);
  }

  disconnect(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}
