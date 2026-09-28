export interface AuthUserDto {
  id: string;
  email: string;
}

export interface AuthSessionDto {
  accessToken: string;
  refreshToken: string;
  user: AuthUserDto;
}

export interface RegisterPendingDto {
  needsVerification: true;
  email: string;
}

export type SourceId = 'local' | 'spotify' | 'yandex';

export type TrackStatus = 'processing' | 'ready' | 'failed' | 'registered' | 'cached';

export type TrackAvailability = 'cached' | 'online' | 'unavailable';

/** Качество стрима: lossless — FLAC/MP3 320, high — ~192 kbps, normal — экономный режим. */
export type Quality = 'lossless' | 'high' | 'normal';

export interface PlanFeatures {
  max_offline_tracks: number | null;
  offline_enabled: boolean;
  stream_quality: 'standard' | 'high';
  external_sources_enabled: boolean;
  ads: boolean;
}

export interface TrackDto {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  status: TrackStatus;
  codec: string | null;
  coverUrl: string | null;
  contentHash?: string | null;
  availability?: TrackAvailability;
}

export interface PlaylistDto {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  coverUrl: string | null;
  trackCount: number;
}

export interface ExternalTrackSnapshot {
  title: string;
  artist: string;
  artists?: ArtistRef[];
  album?: string;
  albumId?: string;
  durationMs?: number;
  coverUrl?: string;
  explicit?: boolean;
}

/** Строка плейлиста MSS: либо загруженный трек (поля TrackDto), либо ссылка на трек внешнего сервиса. */
export type PlaylistEntryDto =
  | (TrackDto & { entryId: string; position: number; streamUrl: string | null; loudnessLufs: number | null })
  | {
      entryId: string;
      position: number;
      external: { source: 'yandex' | 'spotify'; id: string; snapshot: ExternalTrackSnapshot };
    };

export type ListeningPeriod = 'week' | 'month' | 'year' | 'all';

export interface StatsTopTrack {
  source: SourceId;
  trackId: string;
  title: string;
  artist: string;
  artists: ArtistRef[] | null;
  album: string | null;
  albumId: string | null;
  coverUrl: string | null;
  durationMs: number | null;
  plays: number;
  minutes: number;
}

export interface StatsTopArtist {
  name: string;
  id: string | null;
  source: SourceId;
  coverUrl: string | null;
  plays: number;
  minutes: number;
}

export interface ListeningStats {
  period: ListeningPeriod;
  /** Календарный год, если статистика запрошена за год (итоги года). */
  year?: number;
  totalMinutes: number;
  totalPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  activeDays: number;
  topTracks: StatsTopTrack[];
  topArtists: StatsTopArtist[];
  /** Минуты по дням (`YYYY-MM-DD`) для недели и месяца, по месяцам (`YYYY-MM`) для года и всего времени. */
  timeline: { bucket: string; minutes: number }[];
  timelineUnit: 'day' | 'month';
  sources: { source: SourceId; minutes: number }[];
  /** Час суток 0..23 с наибольшим числом минут. */
  peakHour: number | null;
}

export interface HomeShelves {
  frequent: StatsTopTrack[];
  forgotten: StatsTopTrack[];
  topArtists: StatsTopArtist[];
}

export interface UserSubscriptionDto {
  planCode: string;
  planName: string;
  status: string;
  endsAt: string | null;
  features: PlanFeatures;
}

export interface ArtistRef {
  id: string;
  name: string;
}

export interface UnifiedTrack {
  source: SourceId;
  id: string;
  title: string;
  artist: string;
  artists?: ArtistRef[];
  album?: string;
  albumId?: string;
  durationMs?: number;
  coverUrl?: string;
  explicit?: boolean;
  playable: boolean;
  unplayableReason?: string;
  /** Integrated loudness (EBU R128), used for volume normalisation. */
  loudnessLufs?: number;
  /** Доступность MSS-трека на сервере (кэш / онлайн-источник / недоступно). */
  availability?: TrackAvailability;
}

export interface UnifiedArtist {
  source: SourceId;
  id: string;
  name: string;
  imageUrl?: string;
  genres?: string[];
  followers?: number;
  trackCount?: number;
}

export interface UnifiedAlbum {
  source: SourceId;
  id: string;
  title: string;
  artist: string;
  artists?: ArtistRef[];
  year?: number;
  coverUrl?: string;
  trackCount?: number;
  /** album | single | compilation | podcast */
  type?: string;
  genre?: string;
}

export interface AlbumWithTracks extends UnifiedAlbum {
  tracks: UnifiedTrack[];
  label?: string;
  durationMs?: number;
}

export interface UnifiedPlaylist {
  source: SourceId;
  /** Для Яндекса — `${ownerUid}:${kind}` */
  id: string;
  title: string;
  owner?: string;
  description?: string;
  coverUrl?: string;
  trackCount?: number;
}

export interface PlaylistWithTracks extends UnifiedPlaylist {
  tracks: UnifiedTrack[];
}

export interface ArtistProfile {
  artist: UnifiedArtist;
  popularTracks: UnifiedTrack[];
  albums: UnifiedAlbum[];
  singles: UnifiedAlbum[];
  similar: UnifiedArtist[];
}

export interface LyricsLine {
  timeMs: number;
  text: string;
}

export interface TrackLyrics {
  synced: boolean;
  lines: LyricsLine[];
  writers?: string[];
}

export interface ExternalAccount {
  uid: string;
  login?: string;
  displayName?: string;
  hasPlus: boolean;
}

export interface DeviceCodePrompt {
  source: SourceId;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

export type FeedItem =
  | { kind: 'playlist'; playlist: UnifiedPlaylist }
  | { kind: 'album'; album: UnifiedAlbum }
  | { kind: 'track'; track: UnifiedTrack };

export interface FeedBlock {
  id: string;
  title: string;
  items: FeedItem[];
}

export interface WaveBatch {
  sessionId: string;
  batchId: string;
  tracks: UnifiedTrack[];
}

export interface WaveSettings {
  /** Сид станции вместо «Моей волны»: `track:<id>`, `artist:<id>`, `album:<id>`. */
  seed?: string;
  /** Подпись для интерфейса, например «Волна по треку X». */
  seedTitle?: string;
  /** favorite | discover | popular */
  diversity?: string;
  /** active | fun | calm | sad */
  moodEnergy?: string;
  /** russian | not-russian | without-words */
  language?: string;
}

export type WaveFeedbackType = 'radioStarted' | 'trackStarted' | 'trackFinished' | 'skip' | 'like' | 'dislike';

export interface PlaybackReport {
  trackId: string;
  albumId?: string;
  trackLengthSeconds: number;
  totalPlayedSeconds: number;
  endPositionSeconds: number;
}

export type PlaybackHandle =
  | { kind: 'mediaUrl'; url: string; preview?: boolean; codec?: string; bitrate?: number }
  | { kind: 'spotifySdk'; trackUri: string; previewUrl?: string }
  | { kind: 'blobStream'; blobUrl: string };

/** Трек внешнего сервиса, сохранённый файлом в папку загрузок. */
export interface DownloadRecord {
  /** `source:id` без `:albumId`. */
  key: string;
  path: string;
  codec: string;
  bitrate?: number;
  size: number;
  downloadedAt: string;
  track: UnifiedTrack;
}

export interface DownloadProgress {
  key: string;
  received: number;
  total: number;
}
