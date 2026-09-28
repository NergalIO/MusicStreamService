import { create } from 'zustand';

interface SleepState {
  /** Момент (ms), когда музыка затихнет, или null. */
  endsAt: number | null;
  /** Остановиться, когда закончится текущий трек. */
  afterTrack: boolean;
  start: (minutes: number) => void;
  stopAfterTrack: () => void;
  cancel: () => void;
}

export const useSleepStore = create<SleepState>()((set) => ({
  endsAt: null,
  afterTrack: false,
  start: (minutes) => set({ endsAt: Date.now() + minutes * 60_000, afterTrack: false }),
  stopAfterTrack: () => set({ endsAt: null, afterTrack: true }),
  cancel: () => set({ endsAt: null, afterTrack: false }),
}));

export const SLEEP_OPTIONS = [15, 30, 45, 60, 90] as const;

export function formatSleepLeft(endsAt: number, now = Date.now()): string {
  const total = Math.max(0, Math.round((endsAt - now) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m}:${String(s).padStart(2, '0')}`;
}
