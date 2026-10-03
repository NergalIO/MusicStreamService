import type { UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { usePlaybackStore } from '@/store/playback-store';
import { usePlayerStore } from '@/store/player-store';
import { useSettingsStore } from '@/store/settings-store';

/**
 * Треки Spotify звучат во встроенном веб-плеере (Widevine), а MSS управляет им через DOM.
 * Здесь — состояние «сейчас играет Spotify», интерполяция позиции и затухание громкости.
 */
let activeTrackId: string | null = null;
let anchor = { positionMs: 0, at: 0, playing: false };
let tick: ReturnType<typeof setInterval> | null = null;
let fadingOut = false;
let fadeToken = 0;
let hold: { until: number; playing?: boolean; positionMs?: number } | null = null;
let lastMovedPos = 0;
let lastMovedAt = 0;
let stalled = false;
let foreignAudibleSince: number | null = null;

const HOLD_MS = 1500;
const STALL_MS = 4000;
const PAUSE_GUARD_MS = 3500;
const ANCHOR_SLACK_MS = 2000;

let ignorePauseUntil = 0;

export function armSpotifyPauseGuard(ms = PAUSE_GUARD_MS): void {
  ignorePauseUntil = Date.now() + ms;
}

export function shouldIgnoreSpotifyExternalPause(): boolean {
  return Date.now() < ignorePauseUntil || usePlaybackStore.getState().loading;
}

export function ipcMessage(e: unknown): string {
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

function holdLocal(patch: { playing?: boolean; positionMs?: number }): void {
  hold = { until: Date.now() + HOLD_MS, ...patch };
}

function syncMediaPosition(position: number, duration: number): void {
  if (!('mediaSession' in navigator) || !duration || !Number.isFinite(duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(0, position), duration),
      playbackRate: 1,
    });
  } catch {
    /* invalid state during track switch */
  }
}

function startTick(): void {
  if (tick) return;
  tick = setInterval(() => {
    if (!activeTrackId || !anchor.playing || stalled) return;
    const duration = usePlaybackStore.getState().duration;
    const t = spotifyPositionSeconds();
    usePlaybackStore.setState({ currentTime: duration ? Math.min(t, duration) : t });
    syncMediaPosition(t, duration);
    maybeStartSpotifyFadeOut(duration, t);
  }, 250);
}

function markPositionMoved(positionMs: number): void {
  lastMovedPos = positionMs;
  lastMovedAt = Date.now();
  if (stalled) {
    stalled = false;
    usePlaybackStore.setState({ loading: false });
  }
}

function stopTick(): void {
  if (tick) clearInterval(tick);
  tick = null;
}

function setAnchor(positionMs: number, playing: boolean): void {
  anchor = { positionMs, at: Date.now(), playing };
}

function userVolumePercent(): number {
  return usePlayerStore.getState().volume * 100;
}

function nextFadeToken(): number {
  fadeToken += 1;
  return fadeToken;
}

function fadeSpotifyVolume(fromPercent: number, toPercent: number, durationMs: number): Promise<void> {
  const token = nextFadeToken();
  return window.electronAPI.spotifyConnect.fadeVolume(fromPercent, toPercent, durationMs).finally(() => {
    if (fadeToken === token) fadingOut = false;
  });
}

function restoreSpotifyVolume(): void {
  nextFadeToken();
  if (!activeTrackId) return;
  const { volume, muted } = usePlayerStore.getState();
  void window.electronAPI.spotifyConnect.setVolume(volume * 100, muted);
}

function maybeStartSpotifyFadeOut(duration: number, t: number): void {
  if (fadingOut || usePlaybackStore.getState().ad) return;
  const crossfade = useSettingsStore.getState().crossfade;
  if (!crossfade || !duration || duration < crossfade * 3) return;
  if (duration - t > crossfade) return;
  const { volume, muted } = usePlayerStore.getState();
  // Затухать нечему: флаг не ставим, иначе он остался бы взведённым до следующего трека.
  if (muted || volume <= 0) return;
  fadingOut = true;
  void fadeSpotifyVolume(volume * 100, 0, crossfade * 1000);
}

export async function startSpotifyTrack(
  track: UnifiedTrack,
  startAtSeconds: number,
  options: { fadeIn?: number } = {},
): Promise<void> {
  fadingOut = false;
  stalled = false;
  activeTrackId = track.id;
  armSpotifyPauseGuard();
  setAnchor(startAtSeconds * 1000, false);
  markPositionMoved(startAtSeconds * 1000);
  holdLocal({ playing: true, positionMs: startAtSeconds * 1000 });
  usePlaybackStore.setState({
    preview: false,
    ad: false,
    adTitle: undefined,
    codec: 'spotify',
    bitrate: undefined,
    buffered: 0,
    currentTime: startAtSeconds,
    duration: (track.durationMs ?? 0) / 1000,
    loading: true,
  });
  const { volume, muted } = usePlayerStore.getState();
  const fadeIn = options.fadeIn ?? 0;
  if (fadeIn > 0 && !muted) {
    void window.electronAPI.spotifyConnect.setVolume(0, false);
  } else {
    void window.electronAPI.spotifyConnect.setVolume(volume * 100, muted);
  }
  const started = await window.electronAPI.spotifyConnect.play(
    track.id,
    startAtSeconds * 1000,
    track.albumId ?? undefined,
  );
  if (activeTrackId !== track.id) return;
  if (!started) {
    usePlaybackStore.setState({ playing: false, loading: false });
    return;
  }
  if (started.remoteDevice) {
    setAnchor(started.positionMs || startAtSeconds * 1000, false);
    stalled = false;
    usePlaybackStore.setState({ playing: false, loading: false });
    toast(`Spotify занят устройством «${started.remoteDevice}»`, {
      description: 'Выберите устройство воспроизведения.',
    });
    return;
  }
  if (started?.ad) {
    setAnchor(started.positionMs, started.playing);
    markPositionMoved(started.positionMs);
    holdLocal({ playing: started.playing, positionMs: started.positionMs });
    usePlaybackStore.setState({
      playing: started.playing,
      loading: false,
      ad: true,
      adTitle: started.adTitle ?? 'Реклама',
      currentTime: started.positionMs / 1000,
      duration: started.durationMs / 1000,
    });
  } else {
    const sameTrack = !started.trackId || started.trackId === track.id;
    const confirmed = !!started.playing && sameTrack;
    if (!sameTrack) {
      stopSpotifyTrack();
      usePlaybackStore.setState({ playing: false, loading: false });
      toast.error('Этот трек недоступен в Spotify');
      return;
    }
    setAnchor(startAtSeconds * 1000, confirmed);
    markPositionMoved(startAtSeconds * 1000);
    holdLocal({ playing: confirmed, positionMs: startAtSeconds * 1000 });
    if (confirmed) armSpotifyPauseGuard();
    usePlaybackStore.setState({
      playing: confirmed,
      loading: !confirmed,
      ad: false,
      adTitle: undefined,
    });
    if (confirmed && fadeIn > 0 && !muted) void fadeSpotifyVolume(0, volume * 100, fadeIn * 1000);
  }
  startTick();
}

/** MSS переходит на другой источник, очередь опустела или трек Spotify не стартовал. */
export function stopSpotifyTrack(): void {
  if (!activeTrackId) return;
  activeTrackId = null;
  foreignAudibleSince = null;
  fadingOut = false;
  stalled = false;
  hold = null;
  nextFadeToken();
  stopTick();
  usePlaybackStore.setState({ ad: false, adTitle: undefined, loading: false });
  void window.electronAPI?.spotifyConnect.stop();
}

export function applySpotifyState(state: {
  trackId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  ad: boolean;
  adTitle: string | null;
  audible?: boolean;
}): boolean {
  if (!activeTrackId) return false;
  // Web player audible on a different/unknown track — stop so MSS does not keep the wrong title.
  if (state.trackId !== activeTrackId) {
    if (state.audible && state.playing && !state.ad) {
      if (foreignAudibleSince == null) foreignAudibleSince = Date.now();
      else if (Date.now() - foreignAudibleSince >= 1500) {
        foreignAudibleSince = null;
        stopSpotifyTrack();
        usePlaybackStore.setState({ playing: false, loading: false });
      }
    } else {
      foreignAudibleSince = null;
    }
    return false;
  }
  foreignAudibleSince = null;
  if (state.ad) hold = null;

  if (!state.playing && !state.ad && shouldIgnoreSpotifyExternalPause() && hold?.playing !== false) {
    if (state.audible) {
      setAnchor(state.positionMs || anchor.positionMs, true);
      usePlaybackStore.setState({
        playing: true,
        loading: false,
        duration: state.durationMs ? state.durationMs / 1000 : usePlaybackStore.getState().duration,
      });
    } else if (state.durationMs) {
      usePlaybackStore.setState({ duration: state.durationMs / 1000 });
    }
    return true;
  }

  const now = Date.now();
  if (hold && now < hold.until) {
    const playingOk = hold.playing === undefined || state.playing === hold.playing;
    const positionOk = hold.positionMs === undefined || Math.abs(state.positionMs - hold.positionMs) < 2500;
    if (!playingOk || !positionOk) {
      if (state.durationMs) usePlaybackStore.setState({ duration: state.durationMs / 1000 });
      syncMediaPosition(spotifyPositionSeconds(), state.durationMs / 1000 || usePlaybackStore.getState().duration);
      return true;
    }
    hold = null;
  } else {
    hold = null;
  }

  const nearEnd = state.durationMs > 0 && state.durationMs - state.positionMs < 5000;
  if (!state.playing || state.ad || nearEnd || state.audible) {
    markPositionMoved(state.positionMs);
  } else if (Math.abs(state.positionMs - lastMovedPos) >= 400) {
    markPositionMoved(state.positionMs);
  } else if (now - lastMovedAt >= STALL_MS) {
    stalled = true;
  }

  const playingNow = state.playing && !stalled;
  const interpolated = spotifyPositionSeconds() * 1000;
  const snap = !state.playing || state.ad || Math.abs(state.positionMs - interpolated) >= ANCHOR_SLACK_MS;
  if (snap) {
    setAnchor(state.positionMs, playingNow);
  } else if (anchor.playing !== playingNow) {
    setAnchor(interpolated, playingNow);
  }
  const shownMs = snap ? state.positionMs : interpolated;
  const patch: Partial<ReturnType<typeof usePlaybackStore.getState>> = {
    playing: state.playing,
    loading: stalled,
    currentTime: shownMs / 1000,
    ad: state.ad,
    adTitle: state.ad ? state.adTitle ?? 'Реклама' : undefined,
  };
  if (state.durationMs) patch.duration = state.durationMs / 1000;
  else if (state.ad) patch.duration = 0;
  usePlaybackStore.setState(patch);
  syncMediaPosition(shownMs / 1000, patch.duration ?? usePlaybackStore.getState().duration);
  if (state.playing && !stalled) startTick();
  return true;
}

export function isActiveSpotifyTrack(trackId: string): boolean {
  return activeTrackId === trackId;
}

export function toggleSpotify(): void {
  const playing = usePlaybackStore.getState().playing;
  const position = spotifyPositionSeconds() * 1000;
  fadingOut = false;
  stalled = false;
  restoreSpotifyVolume();
  markPositionMoved(position);
  setAnchor(position, !playing);
  holdLocal({ playing: !playing, positionMs: position });
  if (!playing) armSpotifyPauseGuard();
  usePlaybackStore.setState({ playing: !playing, loading: false });
  const call = playing ? window.electronAPI.spotifyConnect.pause() : window.electronAPI.spotifyConnect.resume();
  call.catch((e) => {
    setAnchor(position, playing);
    usePlaybackStore.setState({ playing });
    toast.error(ipcMessage(e));
  });
}

export function seekSpotify(seconds: number): void {
  if (usePlaybackStore.getState().ad) return;
  const target = Math.max(0, seconds);
  fadingOut = false;
  stalled = false;
  restoreSpotifyVolume();
  markPositionMoved(target * 1000);
  setAnchor(target * 1000, usePlaybackStore.getState().playing);
  holdLocal({ positionMs: target * 1000 });
  usePlaybackStore.setState({ currentTime: target });
  syncMediaPosition(target, usePlaybackStore.getState().duration);
  void window.electronAPI.spotifyConnect.seek(target * 1000).catch((e) => toast.error(ipcMessage(e)));
}

export function syncSpotifyVolume(volume: number, muted: boolean): void {
  if (!activeTrackId) return;
  fadingOut = false;
  nextFadeToken();
  void window.electronAPI.spotifyConnect.setVolume(volume * 100, muted);
}

/** Таймер сна: громкость спадает, затем пауза, слайдер возвращается к сохранённому уровню. */
export async function fadeSpotifyOutAndPause(seconds: number): Promise<void> {
  if (!activeTrackId) return;
  fadingOut = true;
  const { volume, muted } = usePlayerStore.getState();
  if (!muted && volume > 0) {
    await fadeSpotifyVolume(volume * 100, 0, seconds * 1000);
  }
  if (!isSpotifyControlled()) return;
  const position = spotifyPositionSeconds() * 1000;
  setAnchor(position, false);
  holdLocal({ playing: false, positionMs: position });
  usePlaybackStore.setState({ playing: false });
  await window.electronAPI.spotifyConnect.pause().catch((e) => toast.error(ipcMessage(e)));
  void window.electronAPI.spotifyConnect.setVolume(userVolumePercent(), muted);
}
