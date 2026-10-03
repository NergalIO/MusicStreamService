export type PlaybackSource = "player" | "dom";

export type RepeatMode = "off" | "context" | "track";

export type PlayUriKind = "track" | "album" | "playlist" | "artist" | "episode" | "show";

export const UNAVAILABLE = "Unavailable" as const;
export type UnavailableStatus = typeof UNAVAILABLE;
export type ShuffleValue = boolean | UnavailableStatus;
export type RepeatValue = RepeatMode | UnavailableStatus;

export interface PlaybackSnapshot {
  ready: boolean;
  uri: string | null;
  id: string | null;
  title: string | null;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  positionMs: number;
  isPlaying: boolean;
  liked: boolean | null;
  volume: number | null;
  shuffle: ShuffleValue;
  repeat: RepeatValue;
  muted: boolean | null;
  sampledAt: number;
  source: PlaybackSource;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}

export interface SearchHit {
  type: "track" | "album" | "playlist" | "artist";
  uri: string;
  id: string;
  title: string;
  subtitle: string;
}

export interface LyricsLine {
  startTimeMs: number;
  words: string;
}

export interface ConnectDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volume: number | null;
}

export interface LikeStatusResult extends CommandResult {
  liked?: boolean;
  uri?: string;
}

export interface SearchApiResult extends CommandResult {
  results?: SearchHit[];
}

export interface LyricsApiResult extends CommandResult {
  syncType?: string;
  lines?: LyricsLine[];
}

export interface DevicesApiResult extends CommandResult {
  devices?: ConnectDevice[];
}

export type AuthStep = "email" | "password" | "code" | "done";

export interface AuthSnapshot {
  loggedIn: boolean;
  hasPremium: boolean;
  email: string | null;
  accessToken: string | null;
  expiresAt: number | null;
  tokenType: "Bearer" | null;
  clientToken: string | null;
}

export interface AuthResult extends AuthSnapshot {
  ok: boolean;
  error?: string;
  step: AuthStep;
  codeRequired: boolean;
  captcha?: boolean;
}

export type CommandName =
  | "pause"
  | "resume"
  | "next"
  | "previous"
  | "play"
  | "setVolume"
  | "seek"
  | "setShuffle"
  | "setRepeat"
  | "setMute"
  | "queue";

export interface CommandArgs {
  uri?: string;
  offsetUri?: string;
  albumId?: string;
  positionMs?: number;
  level?: number;
  enabled?: boolean;
  mode?: RepeatMode;
  muted?: boolean;
}

export interface HealthStatus {
  ok: boolean;
  tab: boolean;
  bridge: boolean;
  url: string | null;
}

export interface PlayerMethodsDump {
  found: boolean;
  methods: string[];
  chunks: string[];
  hasRequire: boolean;
  cacheSize: number;
}

export interface PlaybackDebugDump {
  mediaSession: string | null;
  positionClock: string | null;
  durationClock: string | null;
  playPauseLabel: string | null;
  progress: { testid: string | null; now: string | null; max: string | null } | null;
  playerKeys: string[];
  stateSummary: Record<string, string>;
  liveSummary: Record<string, string>;
  livePosition: number | null;
  livePaused: boolean | null;
}

export interface DomDebugDump {
  title: string;
  widgetAria: string | null;
  testids: string[];
  hrefs: string[];
  sliders: { testid: string | null; now: string | null; max: string | null }[];
  hasPlayer: boolean;
  hasRequire: boolean;
  treeTrack: {
    uri: string | null;
    title: string | null;
    artists: string[];
    album: string | null;
  } | null;
}
