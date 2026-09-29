import { toast } from 'sonner';
import type { LobbyDto, LobbyMemberRole, LobbyWsEvent } from '@mss/shared';
import { currentUserId } from '@/lib/api';
import { leaveLobby, LobbyWsClient } from '@/lib/lobby-api';
import { startLobbyBroadcast, stopLobbyBroadcast } from '@/lib/lobby-broadcast';
import {
  applyLobbyGuestPlayback,
  beginLobbyGuestPlayerMirror,
  endLobbyGuestPlayerMirror,
} from '@/lib/lobby-guest-player';
import { appendLobbyAudioChunk, setLobbyListenPaused, startLobbyListen, stopLobbyListen } from '@/lib/lobby-listen';
import {
  bindLobbyWebrtc,
  dropWebrtcPeer,
  ensureHostWebrtcGuest,
  handleLobbyWebrtcEvent,
  stopLobbyWebrtc,
  syncHostWebrtcGuests,
} from '@/lib/lobby-webrtc';
import { useLobbyStore } from '@/store/lobby-store';
import { notifyLobbyPresence } from '@/lib/lobby-discord';
import { forgetActiveLobby, rememberActiveLobby } from '@/lib/lobby-route';

let client: LobbyWsClient | null = null;

function handleWsEvent(event: LobbyWsEvent): void {
  const store = useLobbyStore.getState();
  switch (event.type) {
    case 'lobby_state': {
      const role = store.role ?? inferRole(event.lobby);
      store.setLobby(event.lobby, role);
      notifyLobbyPresence(event.lobby, role);
      if (role === 'guest') applyLobbyGuestPlayback(event.lobby.playback);
      if (client) {
        const selfId = currentUserId();
        if (selfId) bindLobbyWebrtc({ client, role, hostUserId: event.lobby.hostUserId, selfUserId: selfId });
        if (role === 'host') syncHostWebrtcGuests(event.lobby.members);
      }
      break;
    }
    case 'playback':
      store.setPlayback(event.playback);
      if (store.role === 'guest') {
        setLobbyListenPaused(event.playback.paused);
        applyLobbyGuestPlayback(event.playback);
      }
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
    case 'listener_ready':
      // Захват не рестартуем: новый гость получает отдельный PeerConnection.
      if (store.role === 'host') ensureHostWebrtcGuest(event.userId);
      break;
    case 'member_leave':
      dropWebrtcPeer(event.userId);
      store.patchLobby({
        members: (store.lobby?.members ?? []).filter((m) => m.userId !== event.userId),
      });
      notifyLobbyPresence(store.lobby!, store.role!);
      break;
    case 'webrtc_offer':
    case 'webrtc_answer':
    case 'webrtc_ice':
    case 'webrtc_state':
      handleLobbyWebrtcEvent(event);
      break;
    case 'lobby_closed':
      toast.info('Лобби закрыто');
      disconnectLobbySession();
      break;
    case 'error':
      toast.error(event.message);
      break;
    case 'ping':
    case 'pong':
      break;
  }
}

function inferRole(lobby: LobbyDto): LobbyMemberRole {
  const uid = currentUserId();
  if (uid && lobby.hostUserId === uid) return 'host';
  return 'guest';
}

export function enterLobbySession(lobby: LobbyDto): void {
  connectLobbySession(lobby, inferRole(lobby));
}

export function connectLobbySession(lobby: LobbyDto, role: LobbyMemberRole): void {
  disconnectLobbySession();
  useLobbyStore.getState().setLobby(lobby, role);
  rememberActiveLobby(lobby.id);
  useLobbyStore.getState().setWsStatus('connecting');

  client = new LobbyWsClient(handleWsEvent, {
    onOpen: () => {
      useLobbyStore.getState().setWsStatus('open');
      const selfId = currentUserId();
      if (selfId && client) {
        bindLobbyWebrtc({ client, role, hostUserId: lobby.hostUserId, selfUserId: selfId });
      }
      if (role === 'host' && client) {
        void startLobbyBroadcast(client)
          .then(() => {
            const members = useLobbyStore.getState().lobby?.members ?? lobby.members;
            syncHostWebrtcGuests(members);
          })
          .catch((e) => {
            toast.error(e instanceof Error ? e.message : 'Не удалось начать трансляцию');
          });
      }
    },
  });
  if (role === 'guest') {
    client.setBinaryHandler((chunk) => {
      appendLobbyAudioChunk(chunk);
      useLobbyStore.getState().setLive(true);
    });
    startLobbyListen();
    beginLobbyGuestPlayerMirror(lobby.playback);
  }
  useLobbyStore.getState().setWsClient(client);
  client.connect(lobby.id);
  notifyLobbyPresence(lobby, role);
}

export async function leaveCurrentLobby(): Promise<void> {
  const id = useLobbyStore.getState().lobby?.id;
  if (id) {
    try {
      await leaveLobby(id);
    } catch {
      /* комната уже закрыта */
    }
  }
  disconnectLobbySession();
}

export function disconnectLobbySession(): void {
  endLobbyGuestPlayerMirror();
  stopLobbyWebrtc();
  stopLobbyBroadcast();
  stopLobbyListen();
  client?.disconnect();
  client = null;
  useLobbyStore.getState().setWsClient(null);
  useLobbyStore.getState().reset();
  forgetActiveLobby();
  notifyLobbyPresence(null, null);
}
