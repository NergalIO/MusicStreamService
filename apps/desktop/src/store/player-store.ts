import type { UnifiedTrack, WaveBatch, WaveSettings } from '@mss/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface QueueItem extends UnifiedTrack {
  streamUrl?: string;
  /** Unique per queue entry, so the same track can appear twice. */
  uid: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayContext {
  type: 'album' | 'playlist' | 'artist' | 'search' | 'wave' | 'likes' | 'chart' | 'library' | 'history' | 'downloads' | 'other';
  title?: string;
  path?: string;
}

export interface RadioState {
  sessionId: string;
  batchId: string;
  settings: WaveSettings;
}

export type Transition = 'cut' | 'crossfade';

const HISTORY_LIMIT = 200;

type TrackInput = UnifiedTrack & { streamUrl?: string; uid?: string };

export function toQueueItem(track: TrackInput): QueueItem {
  return { ...track, uid: crypto.randomUUID() };
}

export function trackKey(t: Pick<UnifiedTrack, 'source' | 'id'>): string {
  return `${t.source}:${t.id}`;
}

function identity(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function shuffled(n: number, first: number): number[] {
  const rest = identity(n).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < n ? [first, ...rest] : rest;
}

interface PlayerState {
  queue: QueueItem[];
  order: number[];
  position: number;
  upNext: QueueItem[];
  current: QueueItem | null;
  context: PlayContext | null;
  history: QueueItem[];
  shuffle: boolean;
  repeat: RepeatMode;
  radio: RadioState | null;
  volume: number;
  muted: boolean;
  /** Bumped every time a track must (re)start; the controller reacts to it. */
  playId: number;
  transition: Transition;
  /** С какой секунды начать следующий запуск (продолжение после перезапуска или повтор после ошибки). */
  startAt: number;
  /** Последняя сохранённая позиция текущего трека, переживает перезапуск приложения. */
  resumeAt: number;

  playList: (items: TrackInput[], startIndex?: number, context?: PlayContext | null) => void;
  playTrack: (track: TrackInput, context?: PlayContext | null) => void;
  playNext: (tracks: TrackInput | TrackInput[]) => void;
  addToQueue: (tracks: TrackInput | TrackInput[]) => void;
  removeFromUpNext: (uid: string) => void;
  removeUpcoming: (uid: string) => void;
  moveUpcoming: (from: number, to: number) => void;
  clearUpcoming: () => void;
  jumpToUpcoming: (index: number) => void;
  next: (auto?: boolean) => boolean;
  prev: () => boolean;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  startRadio: (batch: WaveBatch, settings: WaveSettings) => void;
  appendRadio: (batch: WaveBatch) => void;
  stopRadio: () => void;
  pushHistory: (track: QueueItem) => void;
  clearHistory: () => void;
  setVolume: (v: number) => void;
  setMuted: (muted: boolean) => void;
  replay: (startAt?: number) => void;
}

export function upcomingTracks(s: Pick<PlayerState, 'upNext' | 'order' | 'position' | 'queue'>): QueueItem[] {
  return [...s.upNext, ...s.order.slice(s.position + 1).map((i) => s.queue[i])].filter(Boolean);
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      order: [],
      position: -1,
      upNext: [],
      current: null,
      context: null,
      history: [],
      shuffle: false,
      repeat: 'off',
      radio: null,
      volume: 0.8,
      muted: false,
      playId: 0,
      transition: 'cut',
      startAt: 0,
      resumeAt: 0,

      playList: (items, startIndex = 0, context = null) => {
        const queue = items.map(toQueueItem);
        if (!queue.length) return;
        const start = Math.max(0, Math.min(queue.length - 1, startIndex));
        const order = get().shuffle ? shuffled(queue.length, start) : identity(queue.length);
        const position = order.indexOf(start);
        set((s) => ({
          queue,
          order,
          position,
          current: queue[start],
          context,
          radio: null,
          playId: s.playId + 1,
          transition: 'cut',
        }));
      },

      playTrack: (track, context = null) => get().playList([track], 0, context),

      playNext: (tracks) => {
        const items = (Array.isArray(tracks) ? tracks : [tracks]).map(toQueueItem);
        if (!get().current) return get().playList(items);
        set((s) => ({ upNext: [...items, ...s.upNext] }));
      },

      addToQueue: (tracks) => {
        const items = (Array.isArray(tracks) ? tracks : [tracks]).map(toQueueItem);
        if (!get().current) return get().playList(items);
        set((s) => ({ upNext: [...s.upNext, ...items] }));
      },

      removeFromUpNext: (uid) => set((s) => ({ upNext: s.upNext.filter((t) => t.uid !== uid) })),

      removeUpcoming: (uid) => {
        const s = get();
        if (s.upNext.some((t) => t.uid === uid)) return s.removeFromUpNext(uid);
        const queueIndex = s.queue.findIndex((t) => t.uid === uid);
        if (queueIndex < 0) return;
        set({ order: s.order.filter((i, pos) => pos <= s.position || i !== queueIndex) });
      },

      moveUpcoming: (from, to) => {
        const s = get();
        const upcoming = upcomingTracks(s);
        if (from === to || from < 0 || to < 0 || from >= upcoming.length || to >= upcoming.length) return;
        const [moved] = upcoming.splice(from, 1);
        upcoming.splice(to, 0, moved);
        const queue = [...s.queue, ...s.upNext];
        const byUid = new Map(queue.map((t, i) => [t.uid, i]));
        set({
          queue,
          upNext: [],
          order: [...s.order.slice(0, s.position + 1), ...upcoming.map((t) => byUid.get(t.uid)!)],
        });
      },

      clearUpcoming: () => set((s) => ({ upNext: [], order: s.order.slice(0, s.position + 1) })),

      jumpToUpcoming: (index) => {
        const s = get();
        if (index < s.upNext.length) {
          const track = s.upNext[index];
          set((st) => ({
            upNext: st.upNext.slice(index + 1),
            current: track,
            playId: st.playId + 1,
            transition: 'cut',
          }));
          return;
        }
        const position = s.position + 1 + (index - s.upNext.length);
        if (position >= s.order.length) return;
        set((st) => ({
          upNext: [],
          position,
          current: st.queue[st.order[position]],
          playId: st.playId + 1,
          transition: 'cut',
        }));
      },

      next: (auto = false) => {
        const s = get();
        const transition: Transition = auto ? 'crossfade' : 'cut';
        if (auto && s.repeat === 'one' && s.current) {
          set({ playId: s.playId + 1, transition: 'cut' });
          return true;
        }
        if (s.upNext.length) {
          const [track, ...rest] = s.upNext;
          set({ upNext: rest, current: track, playId: s.playId + 1, transition });
          return true;
        }
        if (s.position + 1 < s.order.length) {
          const position = s.position + 1;
          set({ position, current: s.queue[s.order[position]], playId: s.playId + 1, transition });
          return true;
        }
        if (s.repeat === 'all' && s.queue.length && !s.radio) {
          const order = s.shuffle ? shuffled(s.queue.length, -1) : identity(s.queue.length);
          set({ order, position: 0, current: s.queue[order[0]], playId: s.playId + 1, transition });
          return true;
        }
        return false;
      },

      prev: () => {
        const s = get();
        const anchor = s.queue[s.order[s.position]];
        if (anchor && s.current && anchor.uid !== s.current.uid) {
          set({ current: anchor, playId: s.playId + 1, transition: 'cut' });
          return true;
        }
        if (s.position <= 0) return false;
        const position = s.position - 1;
        set({ position, current: s.queue[s.order[position]], playId: s.playId + 1, transition: 'cut' });
        return true;
      },

      toggleShuffle: () => {
        const s = get();
        const shuffle = !s.shuffle;
        if (!s.queue.length || s.radio) return set({ shuffle });
        const currentIndex = s.order[s.position] ?? 0;
        if (shuffle) {
          const played = s.order.slice(0, s.position);
          const remaining = s.order.slice(s.position + 1);
          for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
          }
          set({ shuffle, order: [...played, currentIndex, ...remaining] });
        } else {
          set({ shuffle, order: identity(s.queue.length), position: currentIndex });
        }
      },

      // У волны нет конца списка, поэтому для неё только «выкл ↔ повтор трека».
      cycleRepeat: () =>
        set((s) => ({
          repeat: s.radio
            ? s.repeat === 'one' ? 'off' : 'one'
            : s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
        })),

      startRadio: (batch, settings) => {
        const queue = batch.tracks.map(toQueueItem);
        if (!queue.length) return;
        set((s) => ({
          queue,
          order: identity(queue.length),
          position: 0,
          upNext: [],
          current: queue[0],
          context: { type: 'wave', title: settings?.seedTitle ? `Волна: ${settings.seedTitle}` : 'Моя волна', path: '/yandex' },
          radio: { sessionId: batch.sessionId, batchId: batch.batchId, settings },
          repeat: s.repeat === 'all' ? 'off' : s.repeat,
          playId: s.playId + 1,
          transition: 'cut',
        }));
      },

      appendRadio: (batch) => {
        const s = get();
        if (!s.radio) return;
        const known = new Set(s.queue.map(trackKey));
        const fresh = batch.tracks.filter((t) => !known.has(trackKey(t))).map(toQueueItem);
        const start = s.queue.length;
        set({
          queue: [...s.queue, ...fresh],
          order: [...s.order, ...fresh.map((_, i) => start + i)],
          radio: { ...s.radio, batchId: batch.batchId },
        });
      },

      stopRadio: () => set({ radio: null }),

      pushHistory: (track) =>
        set((s) => ({
          history: [track, ...s.history.filter((t) => trackKey(t) !== trackKey(track))].slice(0, HISTORY_LIMIT),
        })),

      clearHistory: () => set({ history: [] }),

      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)), muted: false }),
      setMuted: (muted) => set({ muted }),
      replay: (startAt = 0) => set((s) => ({ playId: s.playId + 1, transition: 'cut', startAt })),
    }),
    {
      name: 'mss-player',
      version: 2,
      migrate: (persisted) => {
        const p = persisted as { volume?: number } | undefined;
        return {
          queue: [],
          order: [],
          position: -1,
          upNext: [],
          current: null,
          context: null,
          history: [],
          shuffle: false,
          repeat: 'off' as RepeatMode,
          volume: p?.volume ?? 0.8,
          muted: false,
          resumeAt: 0,
        };
      },
      partialize: (s) => ({
        queue: s.queue,
        order: s.order,
        position: s.position,
        upNext: s.upNext,
        current: s.current,
        context: s.context,
        history: s.history,
        shuffle: s.shuffle,
        repeat: s.repeat,
        volume: s.volume,
        muted: s.muted,
        resumeAt: s.resumeAt,
      }),
    },
  ),
);
