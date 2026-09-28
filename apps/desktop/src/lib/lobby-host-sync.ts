import type { QueueItem } from '@/store/player-store';
import { ensureLobbyBroadcast } from '@/lib/lobby-broadcast';
import { postLobbyPlayback } from '@/lib/lobby-api';
import { isLobbyHost } from '@/store/lobby-store';
import { useLobbyStore } from '@/store/lobby-store';

export async function syncLobbyPlay(track: QueueItem, positionMs = 0): Promise<void> {
  if (!isLobbyHost()) return;
  const lobbyId = useLobbyStore.getState().lobby?.id;
  if (!lobbyId) return;
  const ws = useLobbyStore.getState().wsClient;
  if (ws) ensureLobbyBroadcast(ws);
  try {
    await postLobbyPlayback(lobbyId, { action: 'play', track, positionMs });
  } catch {
    /* optional */
  }
}

export async function syncLobbyPause(positionMs: number): Promise<void> {
  if (!isLobbyHost()) return;
  const lobbyId = useLobbyStore.getState().lobby?.id;
  if (!lobbyId) return;
  try {
    await postLobbyPlayback(lobbyId, { action: 'pause', positionMs });
  } catch {
    /* optional */
  }
}

export async function syncLobbySeek(positionMs: number): Promise<void> {
  if (!isLobbyHost()) return;
  const lobbyId = useLobbyStore.getState().lobby?.id;
  if (!lobbyId) return;
  try {
    await postLobbyPlayback(lobbyId, { action: 'seek', positionMs });
  } catch {
    /* optional */
  }
}
