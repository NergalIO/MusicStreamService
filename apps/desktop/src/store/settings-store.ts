import type { Quality } from '@mss/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Битрейт AAC для сжатия скачанных треков, `off` — сохранять оригинал. */
export type DownloadCompression = 'off' | '256' | '192' | '128';

export function compressionKbps(value: DownloadCompression): number {
  return value === 'off' ? 0 : Number(value);
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type ThemeMode = 'dark' | 'light' | 'system';
/** id пресета из `ACCENTS` или `cover` — цвет обложки текущего трека. */
export type AccentId = string;

interface SettingsState {
  theme: ThemeMode;
  accent: AccentId;
  sidebarCollapsed: boolean;
  /** Приветственный экран пройден или пропущен. */
  onboarded: boolean;
  quality: Quality;
  downloadQuality: Quality;
  downloadCompression: DownloadCompression;
  crossfade: number;
  notifications: boolean;
  eqBands: number[];
  eqEnabled: boolean;
  /** Выравнивать громкость треков до −14 LUFS. */
  normalize: boolean;
  playbackRate: number;
  /** deviceId из enumerateDevices(); пустая строка — устройство Windows по умолчанию. */
  outputDeviceId: string;
  visualizer: boolean;
  miniVisualizer: boolean;
  setQuality: (quality: Quality) => void;
  setDownloadQuality: (quality: Quality) => void;
  setDownloadCompression: (value: DownloadCompression) => void;
  setCrossfade: (seconds: number) => void;
  setNotifications: (on: boolean) => void;
  setEq: (bands: number[], enabled?: boolean) => void;
  setNormalize: (on: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setOutputDeviceId: (id: string) => void;
  setVisualizer: (on: boolean) => void;
  setMiniVisualizer: (on: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: AccentId) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setOnboarded: (done: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      accent: 'violet',
      sidebarCollapsed: false,
      onboarded: false,
      quality: 'high',
      downloadQuality: 'lossless',
      downloadCompression: '256',
      crossfade: 0,
      notifications: true,
      eqBands: [0, 0, 0, 0, 0, 0, 0, 0],
      eqEnabled: true,
      normalize: true,
      playbackRate: 1,
      outputDeviceId: '',
      visualizer: true,
      miniVisualizer: false,
      setQuality: (quality) => set({ quality }),
      setDownloadQuality: (downloadQuality) => set({ downloadQuality }),
      setDownloadCompression: (downloadCompression) => set({ downloadCompression }),
      setCrossfade: (crossfade) => set({ crossfade: Math.max(0, Math.min(12, crossfade)) }),
      setNotifications: (notifications) => set({ notifications }),
      setEq: (eqBands, enabled) => set((s) => ({ eqBands, eqEnabled: enabled ?? s.eqEnabled })),
      setNormalize: (normalize) => set({ normalize }),
      setPlaybackRate: (playbackRate) => set({ playbackRate: Math.max(0.5, Math.min(2, playbackRate)) }),
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setVisualizer: (visualizer) => set({ visualizer }),
      setMiniVisualizer: (miniVisualizer) => set({ miniVisualizer }),
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setOnboarded: (onboarded) => set({ onboarded }),
    }),
    {
      name: 'mss-settings',
      version: 1,
      // Сохранённые настройки до версии 1 — это уже настроенное приложение, приветствие ему не нужно.
      migrate: (state, version) => (version < 1 ? { ...(state as object), onboarded: true } : state) as SettingsState,
    },
  ),
);

const TARGET_LUFS = -14;
/** Типичная громкость стримингового мастера — для треков, у которых источник не прислал замер. */
const ASSUMED_LUFS = -9;

/** Поправка громкости трека в дБ; вверх не больше +4, чтобы тихие записи не клиппировали. */
export function normalizationGainDb(loudnessLufs: number | undefined): number {
  if (!useSettingsStore.getState().normalize) return 0;
  const lufs = loudnessLufs ?? ASSUMED_LUFS;
  return Math.max(-12, Math.min(4, TARGET_LUFS - lufs));
}
