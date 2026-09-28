import { useEffect } from 'react';
import { toast } from 'sonner';
import { applyEqualizer, getAnalyser, getAudioEngine } from '@/hooks/useAudioEngine';
import { useSpotifyConnected, useVkConnected, useYandexConnected } from '@/lib/connectors';
import {
  changeVolumeBy,
  loadMoreWave,
  needsMoreWave,
  playNextTrack,
  seekBy,
  skipNext,
  skipPrev,
  toggleLike,
  togglePlay,
} from '@/lib/player-actions';
import { initListeningSync, recordPlay } from '@/lib/listening';
import { externalUrl } from '@/lib/playlist-io';
import { useSleepStore } from '@/store/sleep-store';
import { invalidateStream, resolveStream } from '@/lib/playback';
import {
  applySpotifyState,
  isActiveSpotifyTrack,
  isSpotifyControlled,
  spotifyPositionSeconds,
  startSpotifyTrack,
  stopSpotifyTrack,
  syncSpotifyVolume,
} from '@/lib/spotify-player';
import { downloadedFileUrl } from '@/store/downloads-store';
import { useLikesStore } from '@/store/likes-store';
import { usePlaybackStore } from '@/store/playback-store';
import { upcomingTracks, usePlayerStore, type QueueItem } from '@/store/player-store';
import { syncLobbyPause, syncLobbyPlay } from '@/lib/lobby-host-sync';
import { isLobbyGuestMirroring, syncLobbyListenVolume, tickLobbyGuestPlayback } from '@/lib/lobby-guest-player';
import { isLobbyGuest } from '@/store/lobby-store';
import { normalizationGainDb, useSettingsStore } from '@/store/settings-store';

const PRELOAD_BEFORE_END = 30;
const MAX_CONSECUTIVE_ERRORS = 3;

interface Session {
  playId: number;
  track: QueueItem;
  played: number;
  lastTime: number;
  finished: boolean;
  retried: boolean;
  preloaded: boolean;
}

let session: Session | null = null;
let consecutiveErrors = 0;
let lastSavedResume = 0;
let lastProgressSent = 0;
const RESUME_SAVE_EVERY = 5;

function saveResumePosition(t: number): void {
  lastSavedResume = t;
  usePlayerStore.setState({ resumeAt: t });
}
const previewWarned = new Set<string>();

function absoluteUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return undefined;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Sends play-audio / rotor feedback for the track that is being left. */
function finalizeSession(): void {
  const s = session;
  session = null;
  if (s) recordPlay(s.track, s.played, s.finished);
  if (!s || s.track.source !== 'yandex' || s.played < 1) return;
  const engine = getAudioEngine();
  const length = (s.track.durationMs ?? 0) / 1000 || engine.getDuration();
  void window.electronAPI?.yandex
    .reportPlay({
      trackId: s.track.id,
      albumId: s.track.albumId,
      trackLengthSeconds: length,
      totalPlayedSeconds: s.played,
      endPositionSeconds: s.finished ? length : s.lastTime,
    })
    .catch(() => undefined);
  const { radio } = usePlayerStore.getState();
  if (radio) {
    void window.electronAPI.yandex
      .waveFeedback(radio.sessionId, radio.batchId, s.finished ? 'trackFinished' : 'skip', s.track, s.played)
      .catch(() => undefined);
  }
}

function notifyTrack(track: QueueItem): void {
  if (!useSettingsStore.getState().notifications) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    new Notification(track.title, { body: track.artist, icon: absoluteUrl(track.coverUrl), silent: true });
  } catch {
    /* notifications unavailable */
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

function publishProgress(): void {
  const engine = getAudioEngine();
  const { current } = usePlayerStore.getState();
  if (!current) {
    window.electronAPI?.player.publishProgress(null);
    return;
  }
  const { currentTime, duration, playing } = usePlaybackStore.getState();
  const position = isSpotifyControlled() ? currentTime : engine.currentUrl ? engine.getCurrentTime() : currentTime;
  const dur = engine.getDuration() || duration;
  window.electronAPI?.player.publishProgress({
    position,
    duration: dur,
    playing,
  });
}

function runSleepCommand(cmd: string): void {
  const sleep = useSleepStore.getState();
  if (cmd === 'sleep:off') {
    sleep.cancel();
    toast('Таймер сна выключен');
  } else if (cmd === 'sleep:track') {
    sleep.stopAfterTrack();
    toast('Музыка остановится после этого трека');
  } else {
    const minutes = Number(cmd.slice('sleep:'.length));
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    sleep.start(minutes);
    toast(`Таймер сна: ${minutes} мин`);
  }
}

function publishSnapshot(): void {
  const { current, volume, muted, shuffle, repeat, radio } = usePlayerStore.getState();
  const { playing } = usePlaybackStore.getState();
  const { endsAt, afterTrack } = useSleepStore.getState();
  window.electronAPI?.player.publishState({
    title: current?.title ?? 'Ничего не играет',
    artist: current?.artist ?? '',
    album: current?.album,
    coverUrl: absoluteUrl(current?.coverUrl),
    externalUrl: current ? externalUrl(current) ?? undefined : undefined,
    playing,
    liked: current ? useLikesStore.getState().isLiked(current) : false,
    hasTrack: !!current,
    volume,
    muted,
    shuffle,
    repeat,
    radio: !!radio,
    sleep: { endsAt, afterTrack },
  });
  publishProgress();
}

async function startCurrent(playId: number): Promise<void> {
  const { current, transition, startAt } = usePlayerStore.getState();
  if (!current) return;
  if (isLobbyGuest()) {
    usePlaybackStore.setState({ loading: false, playing: false });
    return;
  }
  const engine = getAudioEngine();
  const { quality, crossfade } = useSettingsStore.getState();
  usePlayerStore.setState({ startAt: 0, resumeAt: startAt });
  lastSavedResume = startAt;

  finalizeSession();
  session = { playId, track: current, played: 0, lastTime: startAt, finished: false, retried: false, preloaded: false };
  usePlaybackStore.setState({ loading: true, error: null, currentTime: startAt, duration: (current.durationMs ?? 0) / 1000 });
  updateMediaSession(current);
  publishSnapshot();

  try {
    if (!current.playable) throw new Error(current.unplayableReason ?? 'Трек недоступен');
    if (current.source === 'spotify' && !downloadedFileUrl(current)) {
      engine.stop();
      await startSpotifyTrack(current, startAt);
      if (usePlayerStore.getState().playId !== playId) return;
      consecutiveErrors = 0;
      usePlayerStore.getState().pushHistory(current);
      notifyTrack(current);
      publishSnapshot();
      return;
    }
    stopSpotifyTrack();
    const stream = await resolveStream(current, quality);
    if (usePlayerStore.getState().playId !== playId) return;
    usePlaybackStore.setState({ preview: stream.preview, codec: stream.codec, bitrate: stream.bitrate });
    void window.electronAPI?.spotifySession.pause();
    if (stream.preview && !previewWarned.has(current.id)) {
      previewWarned.add(current.id);
      toast.warning('Играет 30-секундный фрагмент', {
        description:
          current.source === 'yandex'
            ? 'Яндекс не выдал полный трек. Проверьте Плюс или войдите заново в Настройках.'
            : 'Полный трек доступен только с Premium-подпиской сервиса.',
      });
    }
    await engine.play(stream.url, {
      crossfade: transition === 'crossfade' ? crossfade : 0,
      startAt,
      gainDb: normalizationGainDb(current.loudnessLufs),
    });
    if (usePlayerStore.getState().playId !== playId) return;
    consecutiveErrors = 0;
    void syncLobbyPlay(current, Math.round(startAt * 1000));
    usePlayerStore.getState().pushHistory(current);
    notifyTrack(current);
    const { radio } = usePlayerStore.getState();
    if (radio && current.source === 'yandex') {
      void window.electronAPI.yandex
        .waveFeedback(radio.sessionId, radio.batchId, 'trackStarted', current)
        .catch(() => undefined);
    }
    if (needsMoreWave()) void loadMoreWave();
  } catch (e) {
    if (usePlayerStore.getState().playId !== playId) return;
    if (current.source === 'spotify') stopSpotifyTrack();
    handlePlaybackFailure(errorMessage(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), transition === 'crossfade');
  } finally {
    if (usePlayerStore.getState().playId === playId) usePlaybackStore.setState({ loading: false });
  }
}

function handlePlaybackFailure(message: string, autoAdvance: boolean): void {
  if (/AbortError|interrupted by a new load/i.test(message)) return;
  consecutiveErrors += 1;
  usePlaybackStore.setState({ error: message, loading: false, playing: false });
  toast.error(message || 'Не удалось воспроизвести трек');
  const { upNext, order, position, radio } = usePlayerStore.getState();
  const hasNext = upNext.length > 0 || position + 1 < order.length || !!radio;
  if ((autoAdvance || hasNext) && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
    setTimeout(() => void playNextTrack(true), 1200);
  }
}

async function preloadNext(): Promise<void> {
  if (isLobbyGuest()) return;
  const state = usePlayerStore.getState();
  const next = state.repeat === 'one' ? state.current : upcomingTracks(state)[0];
  if (!next || !next.playable || next.source === 'spotify') return;
  try {
    const stream = await resolveStream(next, useSettingsStore.getState().quality);
    if (stream.url) getAudioEngine().preload(stream.url);
  } catch {
    /* resolved again when it actually starts */
  }
}

export function usePlayerController(): void {
  const yandexConnected = useYandexConnected();
  const vkConnected = useVkConnected();
  const spotifyConnected = useSpotifyConnected();

  useEffect(() => {
    const engine = getAudioEngine();
    const sync = () => {
      const s = usePlayerStore.getState();
      if (isLobbyGuestMirroring()) {
        syncLobbyListenVolume();
        return;
      }
      engine.setVolume(s.volume);
      engine.setMuted(s.muted);
      syncSpotifyVolume(s.volume, s.muted);
    };
    sync();
    engine.setCrossfade(useSettingsStore.getState().crossfade);
    const restored = usePlayerStore.getState();
    if (!engine.currentUrl && restored.current) {
      lastSavedResume = restored.resumeAt;
      usePlaybackStore.setState({ currentTime: restored.resumeAt, duration: (restored.current.durationMs ?? 0) / 1000 });
    }

    const unsubs = [
      usePlayerStore.subscribe((s, prev) => {
        if (s.volume !== prev.volume || s.muted !== prev.muted) {
          sync();
          publishSnapshot();
        } else if (s.shuffle !== prev.shuffle || s.repeat !== prev.repeat || !s.radio !== !prev.radio) {
          publishSnapshot();
        }
        if (s.playId !== prev.playId) void startCurrent(s.playId);
        if (s.current?.uid !== prev.current?.uid && !s.current) {
          engine.stop();
          stopSpotifyTrack();
          updateMediaSession(null);
          publishSnapshot();
        }
      }),
      useSettingsStore.subscribe((s, prev) => {
        if (s.crossfade !== prev.crossfade) engine.setCrossfade(s.crossfade);
        if (s.eqBands !== prev.eqBands || s.eqEnabled !== prev.eqEnabled) {
          applyEqualizer({ bands: s.eqBands, enabled: s.eqEnabled });
        }
        if (s.normalize !== prev.normalize) {
          engine.setTrackGain(normalizationGainDb(usePlayerStore.getState().current?.loudnessLufs));
        }
        if (s.playbackRate !== prev.playbackRate) engine.setPlaybackRate(s.playbackRate);
        if (s.outputDeviceId !== prev.outputDeviceId) void engine.setOutputDevice(s.outputDeviceId);
      }),
      useLikesStore.subscribe(() => publishSnapshot()),
      useSleepStore.subscribe(() => publishSnapshot()),

      engine.on('play', () => {
        if (isSpotifyControlled()) return;
        usePlaybackStore.setState({ playing: true });
        publishSnapshot();
      }),
      engine.on('pause', () => {
        if (isSpotifyControlled()) return;
        usePlaybackStore.setState({ playing: false });
        publishSnapshot();
      }),
      engine.on('waiting', () => {
        if (!isSpotifyControlled()) usePlaybackStore.setState({ loading: true });
      }),
      engine.on('playing', () => {
        if (!isSpotifyControlled()) usePlaybackStore.setState({ loading: false, playing: true });
      }),
      engine.on('durationchange', () => {
        const d = engine.getDuration();
        if (d && !isSpotifyControlled()) usePlaybackStore.setState({ duration: d });
      }),
      engine.on('timeupdate', () => {
        if (isSpotifyControlled()) return;
        const t = engine.getCurrentTime();
        const d = engine.getDuration();
        usePlaybackStore.setState({ currentTime: t, buffered: engine.getBufferedEnd(), ...(d ? { duration: d } : {}) });
        if (Math.abs(t - lastSavedResume) >= RESUME_SAVE_EVERY) saveResumePosition(t);
        const now = Date.now();
        if (now - lastProgressSent >= 1000) {
          lastProgressSent = now;
          publishProgress();
        }
        if (session) {
          const delta = t - session.lastTime;
          if (delta > 0 && delta < 1.5) session.played += delta;
          session.lastTime = t;
          if (!session.preloaded && d && d - t < PRELOAD_BEFORE_END) {
            session.preloaded = true;
            void preloadNext();
          }
        }
        if ('mediaSession' in navigator && d && Number.isFinite(d)) {
          try {
            navigator.mediaSession.setPositionState({
              duration: d,
              position: Math.min(t, d),
              playbackRate: engine.getPlaybackRate(),
            });
          } catch {
            /* invalid state during track switch */
          }
        }
      }),
      engine.on('nearend', () => {
        if (isSpotifyControlled() || usePlayerStore.getState().repeat === 'one') return;
        if (session) session.finished = true;
        void playNextTrack(true);
      }),
      engine.on('ended', () => {
        if (isSpotifyControlled()) return;
        if (session) session.finished = true;
        void playNextTrack(true).then((advanced) => {
          if (!advanced) {
            finalizeSession();
            usePlaybackStore.setState({ playing: false });
            if (useSleepStore.getState().afterTrack) {
              useSleepStore.getState().cancel();
              toast('Таймер сна: воспроизведение остановлено');
            }
          }
        });
      }),
      engine.on('error', (e) => {
        const s = session;
        if (!s || isSpotifyControlled()) return;
        if (!s.retried && s.track.source !== 'local') {
          s.retried = true;
          invalidateStream(s.track, useSettingsStore.getState().quality);
          usePlayerStore.getState().replay(s.lastTime);
          return;
        }
        handlePlaybackFailure(`Ошибка потока: ${e.error?.message || 'код ' + (e.error?.code ?? '?')}`, true);
      }),
    ];

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => togglePlay());
      ms.setActionHandler('pause', () => togglePlay());
      ms.setActionHandler('nexttrack', () => skipNext());
      ms.setActionHandler('previoustrack', () => skipPrev());
      ms.setActionHandler('seekto', (d) => {
        if (d.seekTime === undefined) return;
        engine.seek(d.seekTime);
      });
      updateMediaSession(usePlayerStore.getState().current);
    }

    const offCommand = window.electronAPI?.player.onCommand((cmd) => {
      if (cmd === 'toggle') togglePlay();
      else if (cmd === 'next') skipNext();
      else if (cmd === 'prev') skipPrev();
      else if (cmd === 'like') void toggleLike(usePlayerStore.getState().current);
      else if (cmd === 'shuffle' && !usePlayerStore.getState().radio) usePlayerStore.getState().toggleShuffle();
      else if (cmd === 'repeat') usePlayerStore.getState().cycleRepeat();
      else if (cmd === 'seekForward') seekBy(10);
      else if (cmd === 'seekBack') seekBy(-10);
      else if (cmd === 'volumeUp') changeVolumeBy(0.05);
      else if (cmd === 'volumeDown') changeVolumeBy(-0.05);
      else if (cmd.startsWith('sleep:')) runSleepCommand(cmd);
    });

    const offSpotifyMedia = window.electronAPI?.spotifySession?.onMedia(({ playing }) => {
      if (!playing) return;
      if (!engine.paused) engine.pause();
    });

    const offSpotifyState = window.electronAPI?.spotifyConnect?.onState((state) => {
      const wasPlaying = usePlaybackStore.getState().playing;
      if (!applySpotifyState(state)) return;
      const t = state.positionMs / 1000;
      if (session && session.track.source === 'spotify') {
        const delta = t - session.lastTime;
        if (delta > 0 && delta < 3) session.played += delta;
        session.lastTime = t;
      }
      if (Math.abs(t - lastSavedResume) >= RESUME_SAVE_EVERY) saveResumePosition(t);
      if (wasPlaying !== state.playing) publishSnapshot();
      else publishProgress();
    });

    const offSpotifyEnded = window.electronAPI?.spotifyConnect?.onEnded(({ trackId }) => {
      if (!isActiveSpotifyTrack(trackId)) return;
      if (usePlayerStore.getState().repeat === 'one') {
        usePlayerStore.getState().replay(0);
        return;
      }
      if (session) session.finished = true;
      void playNextTrack(true).then((advanced) => {
        if (advanced) return;
        finalizeSession();
        stopSpotifyTrack();
        usePlaybackStore.setState({ playing: false, currentTime: 0 });
        publishSnapshot();
        if (useSleepStore.getState().afterTrack) {
          useSleepStore.getState().cancel();
          toast('Таймер сна: воспроизведение остановлено');
        }
      });
    });

    const sleepTimer = setInterval(() => {
      const { endsAt } = useSleepStore.getState();
      if (!endsAt || Date.now() < endsAt) return;
      useSleepStore.getState().cancel();
      void window.electronAPI?.spotifySession.pause();
      void engine.fadeOutAndPause(8).then(() => toast('Таймер сна: воспроизведение остановлено'));
    }, 1000);

    // Спектр для мини-плеера шлём, только пока он открыт и визуализатор там включён.
    let spectrumTimer: ReturnType<typeof setInterval> | null = null;
    const bands = new Float32Array(24);
    const stopSpectrum = () => {
      if (spectrumTimer) clearInterval(spectrumTimer);
      spectrumTimer = null;
    };
    const syncSpectrum = (miniOpen: boolean) => {
      stopSpectrum();
      if (!miniOpen || !useSettingsStore.getState().miniVisualizer) return;
      spectrumTimer = setInterval(() => {
        if (engine.paused) return;
        if (getAnalyser()?.getBands(bands)) {
          window.electronAPI.player.publishSpectrum(Array.from(bands, (v) => Math.round(v * 255)));
        }
      }, 40);
    };
    let miniOpen = false;
    const offMini = window.electronAPI?.player.onMiniOpenChange((open) => {
      miniOpen = open;
      syncSpectrum(open);
    });
    const offMiniVis = useSettingsStore.subscribe((s, prev) => {
      if (s.miniVisualizer !== prev.miniVisualizer) syncSpectrum(miniOpen);
    });
    const offVolume = window.electronAPI?.player.onVolumeChange(({ volume, muted }) => {
      const store = usePlayerStore.getState();
      if (volume !== undefined) store.setVolume(volume);
      if (muted !== undefined) store.setMuted(muted);
    });

    const onUnload = () => {
      if (isSpotifyControlled()) saveResumePosition(spotifyPositionSeconds());
      else if (engine.currentUrl) saveResumePosition(engine.getCurrentTime());
      finalizeSession();
    };
    window.addEventListener('beforeunload', onUnload);
    const offListeningSync = initListeningSync();

    publishSnapshot();

    const guestUiTimer = setInterval(() => {
      if (!isLobbyGuestMirroring()) return;
      tickLobbyGuestPlayback();
      publishSnapshot();
      const now = Date.now();
      if (now - lastProgressSent >= 1000) {
        lastProgressSent = now;
        publishProgress();
      }
    }, 250);

    return () => {
      clearInterval(guestUiTimer);
      offListeningSync();
      unsubs.forEach((u) => u());
      offCommand?.();
      offSpotifyMedia?.();
      offSpotifyState?.();
      offSpotifyEnded?.();
      offVolume?.();
      offMini?.();
      offMiniVis();
      stopSpectrum();
      clearInterval(sleepTimer);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  useEffect(() => {
    void useLikesStore.getState().sync({ yandex: yandexConnected, vk: vkConnected, spotify: spotifyConnected });
  }, [yandexConnected, vkConnected, spotifyConnected]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      return usePlaybackStore.subscribe((s, prev) => {
        if (s.playing !== prev.playing) navigator.mediaSession.playbackState = s.playing ? 'playing' : 'paused';
      });
    }
  }, []);
}
