import type { LobbyDto, LobbyMemberRole, LobbyPlaybackState, LobbyQueueItemDto } from '@mss/shared';
import { create } from 'zustand';
import { LobbyWsClient } from '@/lib/lobby-api';

export type LobbyAudioTransport = 'webrtc' | 'ws';

interface LobbyState {
  lobby: LobbyDto | null;
  role: LobbyMemberRole | null;
  wsStatus: 'idle' | 'connecting' | 'open' | 'closed';
  live: boolean;
  wsClient: LobbyWsClient | null;
  /** Как этот клиент слышит DJ: напрямую или через сервер. */
  audioTransport: LobbyAudioTransport | null;
  /** Для DJ: как слышит каждый гость. */
  guestTransports: Record<string, LobbyAudioTransport>;
  setLobby: (lobby: LobbyDto | null, role: LobbyMemberRole | null) => void;
  patchLobby: (patch: Partial<LobbyDto>) => void;
  setPlayback: (playback: LobbyPlaybackState) => void;
  setQueue: (queue: LobbyQueueItemDto[]) => void;
  setWsStatus: (wsStatus: LobbyState['wsStatus']) => void;
  setLive: (live: boolean) => void;
  setWsClient: (wsClient: LobbyWsClient | null) => void;
  setAudioTransport: (audioTransport: LobbyAudioTransport | null) => void;
  setGuestTransport: (userId: string, transport: LobbyAudioTransport) => void;
  clearGuestTransport: (userId: string) => void;
  reset: () => void;
}

export const useLobbyStore = create<LobbyState>()((set) => ({
  lobby: null,
  role: null,
  wsStatus: 'idle',
  live: false,
  wsClient: null,
  audioTransport: null,
  guestTransports: {},
  setLobby: (lobby, role) => set({ lobby, role }),
  patchLobby: (patch) =>
    set((s) => (s.lobby ? { lobby: { ...s.lobby, ...patch } } : {})),
  setPlayback: (playback) =>
    set((s) => (s.lobby ? { lobby: { ...s.lobby, playback } } : {})),
  setQueue: (queue) => set((s) => (s.lobby ? { lobby: { ...s.lobby, queue } } : {})),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setLive: (live) => set({ live }),
  setWsClient: (wsClient) => set({ wsClient }),
  setAudioTransport: (audioTransport) => set({ audioTransport }),
  setGuestTransport: (userId, transport) =>
    set((s) => ({ guestTransports: { ...s.guestTransports, [userId]: transport } })),
  clearGuestTransport: (userId) =>
    set((s) => {
      const { [userId]: _removed, ...rest } = s.guestTransports;
      return { guestTransports: rest };
    }),
  reset: () =>
    set({
      lobby: null,
      role: null,
      wsStatus: 'idle',
      live: false,
      wsClient: null,
      audioTransport: null,
      guestTransports: {},
    }),
}));

export function lobbyRole(): LobbyMemberRole | null {
  return useLobbyStore.getState().role;
}

export function isLobbyGuest(): boolean {
  return useLobbyStore.getState().role === 'guest';
}

export function isLobbyHost(): boolean {
  return useLobbyStore.getState().role === 'host';
}
