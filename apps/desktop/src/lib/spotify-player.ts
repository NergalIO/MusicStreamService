import type { UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { usePlaybackStore } from '@/store/playback-store';
import { usePlayerStore } from '@/store/player-store';

/**
 * Треки Spotify звучат во встроенном веб-плеере (Widevine), а MSS управляет им через Spotify Connect.
 * Здесь — состояние «сейчас играет Spotify» и интерполяция позиции между опросами main-процесса.
 */
let activeTrackId: string | null = null;
let anchor = { positionMs: 0, at: 0, playing: false };
let tick: ReturnType<typeof setInterval> | null = null;

function ipcMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function isSpotifyControlled(): boolean {
  return activeTrackId !== null;
}

export function spotifyPositionSeconds(): number {
  const elapsed = anchor.playing ? Date.now() - anchor.at : 0;
  return (anchor.positionMs + elapsed) / 1000;
}

function startTick(): void {
  if (tick) return;
  tick = setInterval(() => {
    if (!activeTrackId || !anchor.playing) return;
    const duration = usePlaybackStore.getState().duration;
    const t = spotifyPositionSeconds();
    usePlaybackStore.setState({ currentTime: duration ? Math.min(t, duration) : t });
  }, 250);
}

function stopTick(): void {
  if (tick) clearInterval(tick);
  tick = null;
}

function setAnchor(positionMs: number, playing: boolean): void {
  anchor = { positionMs, at: Date.now(), playing };
}

export async function startSpotifyTrack(track: UnifiedTrack, startAtSeconds: number): Promise<void> {
  activeTrackId = track.id;
  setAnchor(startAtSeconds * 1000, false);
  usePlaybackStore.setState({
    preview: false,
    codec: 'spotify',
    bitrate: undefined,
    buffered: 0,
    currentTime: startAtSeconds,
    duration: (track.durationMs ?? 0) / 1000,
  });
  const { volume, muted } = usePlayerStore.getState();
  void window.electronAPI.spotifyConnect.setVolume(volume * 100, muted);
  await window.electronAPI.spotifyConnect.play(track.id, startAtSeconds * 1000);
  if (activeTrackId !== track.id) return;
  setAnchor(startAtSeconds * 1000, true);
  usePlaybackStore.setState({ playing: true });
  startTick();
}

/** MSS переходит на другой источник, очередь опустела или трек Spotify не стартовал. */
export function stopSpotifyTrack(): void {
  if (!activeTrackId) return;
  activeTrackId = null;
  stopTick();
  void window.electronAPI?.spotifyConnect.stop();
}

export function applySpotifyState(state: {
  trackId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
}): boolean {
  if (!activeTrackId || state.trackId !== activeTrackId) return false;
  setAnchor(state.positionMs, state.playing);
  const patch: Partial<ReturnType<typeof usePlaybackStore.getState>> = {
    playing: state.playing,
    loading: false,
    currentTime: state.positionMs / 1000,
  };
  if (state.durationMs) patch.duration = state.durationMs / 1000;
  usePlaybackStore.setState(patch);
  if (state.playing) startTick();
  return true;
}

export function isActiveSpotifyTrack(trackId: string): boolean {
  return activeTrackId === trackId;
}

export function toggleSpotify(): void {
  const playing = usePlaybackStore.getState().playing;
  const position = spotifyPositionSeconds() * 1000;
  setAnchor(position, !playing);
  usePlaybackStore.setState({ playing: !playing });
  const call = playing ? window.electronAPI.spotifyConnect.pause() : window.electronAPI.spotifyConnect.resume();
  call.catch((e) => {
    setAnchor(position, playing);
    usePlaybackStore.setState({ playing });
    toast.error(ipcMessage(e));
  });
}

export function seekSpotify(seconds: number): void {
  const target = Math.max(0, seconds);
  setAnchor(target * 1000, usePlaybackStore.getState().playing);
  usePlaybackStore.setState({ currentTime: target });
  void window.electronAPI.spotifyConnect.seek(target * 1000).catch((e) => toast.error(ipcMessage(e)));
}

export function syncSpotifyVolume(volume: number, muted: boolean): void {
  if (!activeTrackId) return;
  void window.electronAPI.spotifyConnect.setVolume(volume * 100, muted);
}
