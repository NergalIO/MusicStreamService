import type { UnifiedTrack, WaveSettings } from '@mss/shared';
import { toast } from 'sonner';
import { getAudioEngine } from '@/hooks/useAudioEngine';
import { undoableToast } from '@/lib/undo';
import { useLikesStore } from '@/store/likes-store';
import { upcomingTracks, usePlayerStore, type PlayContext } from '@/store/player-store';
import { useSleepStore } from '@/store/sleep-store';

let waveLoading: Promise<boolean> | null = null;

function ipcMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export async function startWave(settings: WaveSettings = {}): Promise<void> {
  try {
    const batch = await window.electronAPI.yandex.waveStart(settings);
    if (!batch.tracks.length) throw new Error('Волна не вернула треков');
    usePlayerStore.getState().startRadio(batch, settings);
  } catch (e) {
    toast.error(`Не удалось запустить волну: ${ipcMessage(e)}`);
  }
}

/** Fetches the next rotor batch; resolves true if new tracks were appended. */
export function loadMoreWave(): Promise<boolean> {
  if (waveLoading) return waveLoading;
  const { radio, queue, position, order } = usePlayerStore.getState();
  if (!radio) return Promise.resolve(false);
  const played = order
    .slice(0, position + 1)
    .map((i) => queue[i])
    .filter((t) => t?.source === 'yandex')
    .slice(-10)
    .map((t) => (t.albumId ? `${t.id}:${t.albumId}` : t.id));
  waveLoading = window.electronAPI.yandex
    .waveMore(radio.sessionId, played)
    .then((batch) => {
      const before = usePlayerStore.getState().queue.length;
      usePlayerStore.getState().appendRadio(batch);
      return usePlayerStore.getState().queue.length > before;
    })
    .catch((e) => {
      console.error('wave more failed', e);
      return false;
    })
    .finally(() => {
      waveLoading = null;
    });
  return waveLoading;
}

export async function playNextTrack(auto = false): Promise<boolean> {
  if (auto && useSleepStore.getState().afterTrack) return false;
  const store = usePlayerStore.getState();
  if (store.next(auto)) return true;
  if (store.radio && (await loadMoreWave())) return usePlayerStore.getState().next(auto);
  return false;
}

export function skipNext(): void {
  void playNextTrack(false);
}

export function skipPrev(): void {
  const engine = getAudioEngine();
  if (engine.getCurrentTime() > 3) {
    engine.seek(0);
    return;
  }
  if (!usePlayerStore.getState().prev()) engine.seek(0);
}

export function togglePlay(): void {
  const engine = getAudioEngine();
  const { current, replay, resumeAt } = usePlayerStore.getState();
  if (!current) return;
  if (!engine.currentUrl) {
    replay(resumeAt);
    return;
  }
  if (engine.paused) void engine.resumePlayback().catch((e) => toast.error(ipcMessage(e)));
  else engine.pause();
}

export function seekTo(seconds: number): void {
  getAudioEngine().seek(seconds);
}

export function seekBy(seconds: number): void {
  const engine = getAudioEngine();
  if (!engine.currentUrl) return;
  engine.seek(Math.max(0, engine.getCurrentTime() + seconds));
}

export function changeVolumeBy(delta: number): void {
  const store = usePlayerStore.getState();
  store.setVolume(Math.min(1, Math.max(0, Math.round((store.volume + delta) * 100) / 100)));
}

export async function toggleLike(track: UnifiedTrack | null | undefined, opts?: { quiet?: boolean }): Promise<void> {
  if (!track) return;
  const wasLiked = useLikesStore.getState().isLiked(track);
  const liked = await useLikesStore.getState().toggle(track);
  if (!opts?.quiet && liked !== wasLiked) {
    undoableToast(liked ? 'В «Мне нравится»' : 'Убрано из «Мне нравится»', {
      undo: () => void toggleLike(track, { quiet: true }),
    });
  }
  const { radio } = usePlayerStore.getState();
  if (radio && liked && track.source === 'yandex') {
    void window.electronAPI.yandex.waveFeedback(radio.sessionId, radio.batchId, 'like', track).catch(() => undefined);
  }
}

export async function dislikeCurrent(): Promise<void> {
  const { current, radio } = usePlayerStore.getState();
  if (!current || current.source !== 'yandex') return;
  try {
    await window.electronAPI.yandex.dislike(current);
    if (radio) void window.electronAPI.yandex.waveFeedback(radio.sessionId, radio.batchId, 'dislike', current);
    toast('Больше не будем предлагать этот трек');
    skipNext();
  } catch (e) {
    toast.error(ipcMessage(e));
  }
}

/** "Слушать" plays in order, "Перемешать" turns shuffle on and starts from a random track. */
export function playCollection(
  tracks: (UnifiedTrack & { streamUrl?: string })[],
  context: PlayContext | null,
  shuffle = false,
): void {
  const playable = tracks.filter((t) => t.playable);
  if (!playable.length) {
    toast.error('Нет доступных для воспроизведения треков');
    return;
  }
  usePlayerStore.setState({ shuffle });
  const start = shuffle ? Math.floor(Math.random() * playable.length) : 0;
  usePlayerStore.getState().playList(playable, start, context);
}

export function needsMoreWave(): boolean {
  const s = usePlayerStore.getState();
  return !!s.radio && upcomingTracks(s).length <= 2;
}
