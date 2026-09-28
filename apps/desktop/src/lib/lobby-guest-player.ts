import type { LobbyPlaybackState, UnifiedTrack } from '@mss/shared';
import { ensureLobbyListenAudioEffects, getLobbyListenTiming, setLobbyListenOutput } from '@/lib/lobby-listen';
import { isLobbyGuest, useLobbyStore } from '@/store/lobby-store';
import { usePlaybackStore } from '@/store/playback-store';
import { toQueueItem, usePlayerStore, type PlayContext, type QueueItem } from '@/store/player-store';

let mirroring = false;

function absoluteUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return undefined;
  }
}

function updateMediaSession(track: QueueItem | null): void {
  if (!('mediaSession' in navigator)) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const art = absoluteUrl(track.coverUrl);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? '',
    artwork: art ? [{ src: art, sizes: '400x400' }] : [],
  });
}

function lobbyContext(lobbyId: string): PlayContext {
  return { type: 'other', title: 'Listening party', path: `/lobby/${lobbyId}` };
}

function guestPositionSec(playback: LobbyPlaybackState): number {
  const dur = (playback.track?.durationMs ?? 0) / 1000;
  let sec = playback.positionMs / 1000;
  if (!playback.paused) {
    const updated = Date.parse(playback.updatedAt);
    if (Number.isFinite(updated)) sec += Math.max(0, Date.now() - updated) / 1000;
  }
  if (dur > 0) sec = Math.min(sec, dur);
  return sec;
}

export function isLobbyGuestMirroring(): boolean {
  return mirroring;
}

export function beginLobbyGuestPlayerMirror(playback?: LobbyPlaybackState): void {
  if (!isLobbyGuest()) return;
  mirroring = true;
  ensureLobbyListenAudioEffects();
  syncLobbyListenVolume();
  if (playback) applyLobbyGuestPlayback(playback);
}

export function endLobbyGuestPlayerMirror(): void {
  if (!mirroring) return;
  mirroring = false;
  updateMediaSession(null);
  usePlayerStore.setState({ current: null, context: null });
  usePlaybackStore.setState({
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    preview: false,
    error: null,
  });
}

export function syncLobbyListenVolume(): void {
  if (!mirroring) return;
  const { volume, muted } = usePlayerStore.getState();
  setLobbyListenOutput(volume, muted);
}

export function applyLobbyGuestPlayback(playback: LobbyPlaybackState): void {
  if (!mirroring || !isLobbyGuest()) return;
  const lobbyId = useLobbyStore.getState().lobby?.id;
  if (!lobbyId) return;

  const track = playback.track;
  if (!track) {
    usePlayerStore.setState({ current: null, context: null });
    usePlaybackStore.setState({ playing: false, currentTime: 0, duration: 0, buffered: 0, loading: false });
    updateMediaSession(null);
    return;
  }

  const prev = usePlayerStore.getState().current;
  const sameTrack = prev?.source === track.source && prev.id === track.id;
  const queueTrack: QueueItem = sameTrack && prev
    ? prev
    : toQueueItem({ ...(track as UnifiedTrack), playable: false, unplayableReason: 'Эфир DJ' });

  if (!sameTrack) {
    usePlayerStore.setState({ current: queueTrack, context: lobbyContext(lobbyId) });
    updateMediaSession(queueTrack);
  }

  const dur = (track.durationMs ?? 0) / 1000;
  const listen = getLobbyListenTiming();
  const playing = !playback.paused && !listen.paused;
  usePlaybackStore.setState({
    playing,
    loading: false,
    preview: false,
    error: null,
    duration: dur,
    currentTime: guestPositionSec(playback),
    buffered: dur > 0 ? Math.min(dur, guestPositionSec(playback) + 2) : 0,
  });
}

export function tickLobbyGuestPlayback(): void {
  if (!mirroring || !isLobbyGuest()) return;
  const playback = useLobbyStore.getState().lobby?.playback;
  if (!playback?.track) return;

  const dur = (playback.track.durationMs ?? 0) / 1000;
  const sec = guestPositionSec(playback);
  const listen = getLobbyListenTiming();
  const playing = !playback.paused && !listen.paused;

  usePlaybackStore.setState({
    currentTime: sec,
    duration: dur,
    playing,
    buffered: dur > 0 ? Math.min(dur, sec + 3) : 0,
  });
}
