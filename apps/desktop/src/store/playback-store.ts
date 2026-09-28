import { create } from 'zustand';

/** Runtime-only playback state mirrored from the audio engine. Not persisted. */
interface PlaybackState {
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  preview: boolean;
  codec?: string;
  bitrate?: number;
  error: string | null;
  nowPlayingOpen: boolean;
  nowPlayingTab: NowPlayingTab | null;
  setNowPlaying: (open: boolean, tab?: NowPlayingTab | null) => void;
}

export type NowPlayingTab = 'lyrics' | 'queue' | 'similar';

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  preview: false,
  error: null,
  nowPlayingOpen: false,
  nowPlayingTab: null,
  setNowPlaying: (nowPlayingOpen, tab) =>
    set((s) => ({ nowPlayingOpen, nowPlayingTab: tab === undefined ? s.nowPlayingTab : tab })),
}));
