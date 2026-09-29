import type { LobbyMemberDto, LobbyWsClientMessage, LobbyWsEvent } from '@mss/shared';
import { getLobbyCaptureStream, restartLobbyBroadcast, subscribeLobbyCaptureStream } from '@/lib/lobby-broadcast';
import type { LobbyWsClient } from '@/lib/lobby-api';
import { isLobbyRtcActive, setLobbyRtcStream } from '@/lib/lobby-listen';
import { log } from '@/lib/logger';
import { useLobbyStore, type LobbyAudioTransport } from '@/store/lobby-store';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const ICE_TIMEOUT_MS = 4_000;

interface PeerSlot {
  pc: RTCPeerConnection;
  timeout: ReturnType<typeof setTimeout> | null;
  pendingIce: RTCIceCandidateInit[];
  remoteSet: boolean;
  userId: string;
}

let client: LobbyWsClient | null = null;
let role: 'host' | 'guest' | null = null;
let hostUserId: string | null = null;
let selfUserId: string | null = null;
let captureUnsub: (() => void) | null = null;
let headerRestartTimer: ReturnType<typeof setTimeout> | null = null;

const hostPeers = new Map<string, PeerSlot>();
const hostPeerGen = new Map<string, number>();
let guestPeer: PeerSlot | null = null;
let guestPeerGen = 0;

function send(msg: LobbyWsClientMessage): void {
  client?.sendJson(msg);
}

function setLocalTransport(transport: LobbyAudioTransport | null): void {
  useLobbyStore.getState().setAudioTransport(transport);
}

function setGuestTransport(userId: string, transport: LobbyAudioTransport): void {
  useLobbyStore.getState().setGuestTransport(userId, transport);
}

function clearGuestTimeout(slot: PeerSlot): void {
  if (slot.timeout) {
    clearTimeout(slot.timeout);
    slot.timeout = null;
  }
}

function isRtcUp(pc: RTCPeerConnection): boolean {
  return (
    pc.connectionState === 'connected' ||
    pc.iceConnectionState === 'connected' ||
    pc.iceConnectionState === 'completed'
  );
}

function isRtcFailed(pc: RTCPeerConnection): boolean {
  return pc.connectionState === 'failed' || pc.iceConnectionState === 'failed' || pc.connectionState === 'closed';
}

async function flushIce(slot: PeerSlot): Promise<void> {
  if (!slot.remoteSet) return;
  const pending = slot.pendingIce.splice(0);
  for (const init of pending) {
    try {
      await slot.pc.addIceCandidate(init);
    } catch {
      /* кандидат устарел после смены PC */
    }
  }
}

function audioTrack(stream: MediaStream | null): MediaStreamTrack | null {
  return stream?.getAudioTracks().find((t) => t.readyState === 'live') ?? stream?.getAudioTracks()[0] ?? null;
}

function applyCaptureToPeer(pc: RTCPeerConnection, stream: MediaStream | null): void {
  const track = audioTrack(stream);
  const sender = pc.getSenders().find((s) => s.track?.kind === 'audio' || !s.track);
  if (track) {
    if (sender) void sender.replaceTrack(track);
    else pc.addTrack(track, stream!);
    return;
  }
  if (sender?.track) void sender.replaceTrack(null);
}

function requestWsHeaderRestart(): void {
  if (!client || headerRestartTimer) return;
  headerRestartTimer = setTimeout(() => {
    headerRestartTimer = null;
    if (client) void restartLobbyBroadcast(client).catch(() => undefined);
  }, 250);
}

function disposeSlot(slot: PeerSlot): void {
  clearGuestTimeout(slot);
  slot.pendingIce.length = 0;
  slot.pc.onicecandidate = null;
  slot.pc.ontrack = null;
  slot.pc.onconnectionstatechange = null;
  slot.pc.oniceconnectionstatechange = null;
  try {
    slot.pc.close();
  } catch {
    /* already closed */
  }
}

function bindPeerEvents(slot: PeerSlot, direction: 'host' | 'guest'): void {
  slot.pc.onicecandidate = (ev) => {
    const toUserId = direction === 'host' ? slot.userId : hostUserId;
    if (!toUserId) return;
    if (!ev.candidate) {
      send({ type: 'webrtc_ice', toUserId, candidate: null });
      return;
    }
    send({
      type: 'webrtc_ice',
      toUserId,
      candidate: ev.candidate.candidate,
      sdpMid: ev.candidate.sdpMid,
      sdpMLineIndex: ev.candidate.sdpMLineIndex,
    });
  };

  const onState = (): void => {
    if (isRtcUp(slot.pc)) {
      clearGuestTimeout(slot);
      if (direction === 'host') {
        setGuestTransport(slot.userId, 'webrtc');
      } else {
        setLocalTransport('webrtc');
        if (hostUserId) send({ type: 'webrtc_state', toUserId: hostUserId, state: 'connected' });
        useLobbyStore.getState().setLive(true);
      }
      return;
    }
    if (isRtcFailed(slot.pc)) {
      if (direction === 'host') failHostPeer(slot.userId);
      else failGuestPeer();
    }
  };
  slot.pc.onconnectionstatechange = onState;
  slot.pc.oniceconnectionstatechange = onState;

  if (direction === 'guest') {
    slot.pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      setLobbyRtcStream(stream);
    };
  }
}

function armTimeout(slot: PeerSlot, onFire: () => void): void {
  clearGuestTimeout(slot);
  slot.timeout = setTimeout(() => {
    slot.timeout = null;
    if (isRtcUp(slot.pc)) return;
    onFire();
  }, ICE_TIMEOUT_MS);
}

function disposeHostPeer(guestId: string): void {
  const slot = hostPeers.get(guestId);
  if (slot) {
    disposeSlot(slot);
    hostPeers.delete(guestId);
  }
}

function failHostPeer(guestId: string): void {
  disposeHostPeer(guestId);
  setGuestTransport(guestId, 'ws');
  requestWsHeaderRestart();
}

async function createHostPeer(guestId: string): Promise<void> {
  if (!client || role !== 'host') return;
  const gen = (hostPeerGen.get(guestId) ?? 0) + 1;
  hostPeerGen.set(guestId, gen);
  disposeHostPeer(guestId);
  setGuestTransport(guestId, 'ws');

  let stream: MediaStream;
  try {
    stream = await getLobbyCaptureStream();
  } catch (e) {
    log('warn', 'lobby webrtc capture', e);
    setGuestTransport(guestId, 'ws');
    return;
  }
  if (hostPeerGen.get(guestId) !== gen || role !== 'host') return;
  if (!stream.getAudioTracks().length) {
    setGuestTransport(guestId, 'ws');
    return;
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const slot: PeerSlot = { pc, timeout: null, pendingIce: [], remoteSet: false, userId: guestId };
  bindPeerEvents(slot, 'host');
  for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
  hostPeers.set(guestId, slot);

  try {
    const offer = await pc.createOffer();
    if (hostPeerGen.get(guestId) !== gen) {
      disposeSlot(slot);
      if (hostPeers.get(guestId) === slot) hostPeers.delete(guestId);
      return;
    }
    await pc.setLocalDescription(offer);
    if (hostPeerGen.get(guestId) !== gen) {
      disposeSlot(slot);
      if (hostPeers.get(guestId) === slot) hostPeers.delete(guestId);
      return;
    }
    if (!offer.sdp) throw new Error('empty offer');
    send({ type: 'webrtc_offer', toUserId: guestId, sdp: offer.sdp });
    armTimeout(slot, () => failHostPeer(guestId));
  } catch (e) {
    log('warn', 'lobby webrtc offer', e);
    failHostPeer(guestId);
  }
}

function failGuestPeer(): void {
  guestPeerGen += 1;
  if (guestPeer) {
    disposeSlot(guestPeer);
    guestPeer = null;
  }
  if (isLobbyRtcActive()) setLobbyRtcStream(null);
  setLocalTransport('ws');
  if (hostUserId) send({ type: 'webrtc_state', toUserId: hostUserId, state: 'failed' });
}

async function acceptHostOffer(fromUserId: string, sdp: string): Promise<void> {
  if (role !== 'guest' || !hostUserId || fromUserId !== hostUserId) return;
  const gen = ++guestPeerGen;
  if (guestPeer) {
    disposeSlot(guestPeer);
    guestPeer = null;
  }
  setLocalTransport('ws');
  send({ type: 'webrtc_state', toUserId: hostUserId, state: 'connecting' });

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const slot: PeerSlot = { pc, timeout: null, pendingIce: [], remoteSet: false, userId: fromUserId };
  bindPeerEvents(slot, 'guest');
  guestPeer = slot;

  try {
    await pc.setRemoteDescription({ type: 'offer', sdp });
    if (gen !== guestPeerGen) return;
    slot.remoteSet = true;
    await flushIce(slot);
    const answer = await pc.createAnswer();
    if (gen !== guestPeerGen) return;
    await pc.setLocalDescription(answer);
    if (gen !== guestPeerGen) return;
    if (!answer.sdp) throw new Error('empty answer');
    send({ type: 'webrtc_answer', toUserId: hostUserId, sdp: answer.sdp });
    armTimeout(slot, () => failGuestPeer());
  } catch (e) {
    log('warn', 'lobby webrtc answer', e);
    if (gen === guestPeerGen) failGuestPeer();
  }
}

async function applyRemoteIce(slot: PeerSlot | null, event: Extract<LobbyWsEvent, { type: 'webrtc_ice' }>): Promise<void> {
  if (!slot) return;
  const init: RTCIceCandidateInit = {
    candidate: event.candidate ?? undefined,
    sdpMid: event.sdpMid ?? undefined,
    sdpMLineIndex: event.sdpMLineIndex ?? undefined,
  };
  if (!event.candidate) return;
  if (!slot.remoteSet) {
    slot.pendingIce.push(init);
    return;
  }
  try {
    await slot.pc.addIceCandidate(init);
  } catch {
    /* ignore */
  }
}

function onCaptureStream(stream: MediaStream | null): void {
  if (role !== 'host') return;
  for (const slot of hostPeers.values()) applyCaptureToPeer(slot.pc, stream);
}

export function bindLobbyWebrtc(opts: {
  client: LobbyWsClient;
  role: 'host' | 'guest';
  hostUserId: string;
  selfUserId: string;
}): void {
  client = opts.client;
  role = opts.role;
  hostUserId = opts.hostUserId;
  selfUserId = opts.selfUserId;
  if (!captureUnsub) captureUnsub = subscribeLobbyCaptureStream(onCaptureStream);
  if (opts.role === 'guest') setLocalTransport('ws');
}

/** Новый или переподключившийся гость: новый PC, захват не трогаем. */
export function ensureHostWebrtcGuest(guestId: string): void {
  if (role !== 'host' || !guestId || guestId === selfUserId) return;
  void createHostPeer(guestId);
}

export function syncHostWebrtcGuests(members: LobbyMemberDto[]): void {
  if (role !== 'host') return;
  const guests = members.filter((m) => m.role === 'guest' && m.userId !== selfUserId).map((m) => m.userId);
  const live = new Set(guests);
  for (const id of [...hostPeers.keys()]) {
    if (!live.has(id)) {
      hostPeerGen.set(id, (hostPeerGen.get(id) ?? 0) + 1);
      disposeHostPeer(id);
      useLobbyStore.getState().clearGuestTransport(id);
    }
  }
  for (const id of guests) {
    if (!hostPeers.has(id)) void createHostPeer(id);
  }
}

export function dropWebrtcPeer(userId: string): void {
  if (role === 'host') {
    hostPeerGen.set(userId, (hostPeerGen.get(userId) ?? 0) + 1);
    disposeHostPeer(userId);
    useLobbyStore.getState().clearGuestTransport(userId);
    return;
  }
  if (userId === hostUserId) failGuestPeer();
}

export function handleLobbyWebrtcEvent(event: LobbyWsEvent): void {
  switch (event.type) {
    case 'webrtc_offer':
      void acceptHostOffer(event.fromUserId, event.sdp);
      break;
    case 'webrtc_answer':
      if (role !== 'host') break;
      {
        const slot = hostPeers.get(event.fromUserId);
        if (!slot || event.toUserId !== selfUserId) break;
        void slot.pc
          .setRemoteDescription({ type: 'answer', sdp: event.sdp })
          .then(() => {
            slot.remoteSet = true;
            return flushIce(slot);
          })
          .catch((e) => {
            log('warn', 'lobby webrtc remote answer', e);
            failHostPeer(event.fromUserId);
          });
      }
      break;
    case 'webrtc_ice':
      if (role === 'host') void applyRemoteIce(hostPeers.get(event.fromUserId) ?? null, event);
      else if (event.fromUserId === hostUserId) void applyRemoteIce(guestPeer, event);
      break;
    case 'webrtc_state':
      if (role === 'host' && event.state === 'connected') setGuestTransport(event.fromUserId, 'webrtc');
      if (role === 'host' && event.state === 'failed') setGuestTransport(event.fromUserId, 'ws');
      break;
    default:
      break;
  }
}

export function stopLobbyWebrtc(): void {
  if (headerRestartTimer) {
    clearTimeout(headerRestartTimer);
    headerRestartTimer = null;
  }
  guestPeerGen += 1;
  if (guestPeer) {
    disposeSlot(guestPeer);
    guestPeer = null;
  }
  for (const id of [...hostPeers.keys()]) {
    hostPeerGen.set(id, (hostPeerGen.get(id) ?? 0) + 1);
    disposeHostPeer(id);
  }
  hostPeerGen.clear();
  captureUnsub?.();
  captureUnsub = null;
  setLobbyRtcStream(null);
  client = null;
  role = null;
  hostUserId = null;
  selfUserId = null;
  setLocalTransport(null);
}
