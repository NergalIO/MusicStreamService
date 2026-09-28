import { toast } from 'sonner';
import type { LobbyDto, LobbyMemberRole, LobbyWsEvent } from '@mss/shared';
import { LobbyWsClient } from '@/lib/lobby-api';
import { startLobbyBroadcast, stopLobbyBroadcast } from '@/lib/lobby-broadcast';
import { appendLobbyAudioChunk, setLobbyListenPaused, startLobbyListen, stopLobbyListen } from '@/lib/lobby-listen';
import { useLobbyStore } from '@/store/lobby-store';
import { notifyLobbyPresence } from '@/lib/lobby-discord';

let client: LobbyWsClient | null = null;

function handleWsEvent(event: LobbyWsEvent): void {
  const store = useLobbyStore.getState();
  switch (event.type) {
    case 'lobby_state':
      store.setLobby(event.lobby, store.role ?? inferRole(event.lobby));
      notifyLobbyPresence(event.lobby, store.role ?? inferRole(event.lobby));
      break;
    case 'playback':
      store.setPlayback(event.playback);
      if (store.role === 'guest') setLobbyListenPaused(event.playback.paused);
      break;
    case 'queue_updated':
      store.setQueue(event.queue);
      break;
    case 'suggestion_new':
      store.patchLobby({ queue: [...(store.lobby?.queue ?? []), event.item] });
      break;
    case 'member_join':
      store.patchLobby({
        members: [...(store.lobby?.members ?? []).filter((m) => m.userId !== event.member.userId), event.member],
      });
      notifyLobbyPresence(store.lobby!, store.role!);
      break;
    case 'member_leave':
      store.patchLobby({
        members: (store.lobby?.members ?? []).filter((m) => m.userId !== event.userId),
      });
      notifyLobbyPresence(store.lobby!, store.role!);
      break;
    case 'lobby_closed':
      toast.info('Лобби закрыто');
      disconnectLobbySession();
      break;
    case 'error':
      toast.error(event.message);
      break;
    case 'pong':
      break;
  }
}

function inferRole(lobby: LobbyDto): LobbyMemberRole {
  const session = JSON.parse(localStorage.getItem('mss_session') ?? '{}') as { user?: { id: string } };
  const uid = session.user?.id;
  if (uid && lobby.hostUserId === uid) return 'host';
  return 'guest';
}

export function connectLobbySession(lobby: LobbyDto, role: LobbyMemberRole): void {
  disconnectLobbySession();
  useLobbyStore.getState().setLobby(lobby, role);
  useLobbyStore.getState().setWsStatus('connecting');

  client = new LobbyWsClient(handleWsEvent);
  if (role === 'guest') {
    client.setBinaryHandler((chunk) => appendLobbyAudioChunk(chunk));
    startLobbyListen();
  }
  useLobbyStore.getState().setWsClient(client);
  client.connect(lobby.id);
  useLobbyStore.getState().setWsStatus('open');

  if (role === 'host') {
    void startLobbyBroadcast(client).catch((e) => {
      toast.error(e instanceof Error ? e.message : 'Не удалось начать трансляцию');
    });
  }
  notifyLobbyPresence(lobby, role);
}

export function disconnectLobbySession(): void {
  stopLobbyBroadcast();
  stopLobbyListen();
  client?.disconnect();
  client = null;
  useLobbyStore.getState().setWsClient(null);
  useLobbyStore.getState().reset();
  notifyLobbyPresence(null, null);
}
