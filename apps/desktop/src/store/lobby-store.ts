import type { LobbyDto, LobbyMemberRole, LobbyPlaybackState, LobbyQueueItemDto } from '@mss/shared';
import { create } from 'zustand';
import { LobbyWsClient } from '@/lib/lobby-api';

interface LobbyState {
  lobby: LobbyDto | null;
  role: LobbyMemberRole | null;
  wsStatus: 'idle' | 'connecting' | 'open' | 'closed';
  wsClient: LobbyWsClient | null;
  setLobby: (lobby: LobbyDto | null, role: LobbyMemberRole | null) => void;
  patchLobby: (patch: Partial<LobbyDto>) => void;
  setPlayback: (playback: LobbyPlaybackState) => void;
  setQueue: (queue: LobbyQueueItemDto[]) => void;
  setWsStatus: (wsStatus: LobbyState['wsStatus']) => void;
  setWsClient: (wsClient: LobbyWsClient | null) => void;
  reset: () => void;
}

export const useLobbyStore = create<LobbyState>()((set) => ({
  lobby: null,
  role: null,
  wsStatus: 'idle',
  wsClient: null,
  setLobby: (lobby, role) => set({ lobby, role }),
  patchLobby: (patch) =>
    set((s) => (s.lobby ? { lobby: { ...s.lobby, ...patch } } : {})),
  setPlayback: (playback) =>
    set((s) => (s.lobby ? { lobby: { ...s.lobby, playback } } : {})),
  setQueue: (queue) => set((s) => (s.lobby ? { lobby: { ...s.lobby, queue } } : {})),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setWsClient: (wsClient) => set({ wsClient }),
  reset: () => set({ lobby: null, role: null, wsStatus: 'idle', wsClient: null }),
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
