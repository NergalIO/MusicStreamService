export interface AuthUserDto {
  id: string;
  email: string;
  role?: string;
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

export type SourceId = 'local' | 'spotify' | 'yandex' | 'vk';

export type ExternalSourceId = Exclude<SourceId, 'local'>;

export type TrackStatus = 'processing' | 'ready' | 'failed' | 'registered' | 'cached' | 'uploading';

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
  /** Альбом MSS текущего пользователя, если трек в него входит. */
  albumId?: string | null;
  durationMs: number | null;
  status: TrackStatus;
  codec: string | null;
  coverUrl: string | null;
  contentHash?: string | null;
  availability?: TrackAvailability;
  /** Текущий пользователь держит трек — можно играть с локального файла. */
  userHolds?: boolean;
  streamUrl?: string | null;
  /** Прямая ссылка на master в облаке (presigned), пока не истекла. */
  cloudPlayUrl?: string | null;
  cloudDownloadUrl?: string | null;
  cloudUrlExpiresAt?: string | null;
  hasLyrics?: boolean;
}

export interface PlaylistDto {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  coverUrl: string | null;
  trackCount: number;
}

/** Альбом MSS: метаданные и обложка. Треки — отдельные объекты каталога, сюда только хуки. */
export interface AlbumDto {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  type: string | null;
  coverUrl: string | null;
  trackCount: number;
}

export interface AlbumDetailDto extends AlbumDto {
  tracks: TrackDto[];
}

/** Лайк альбома: MSS хранит снимок, чтобы список не зависел от Яндекса/Spotify. */
export interface LikedAlbumDto {
  source: SourceId;
  id: string;
  title: string;
  artist: string;
  artists?: ArtistRef[];
  year?: number | null;
  coverUrl?: string | null;
  trackCount?: number;
  type?: string | null;
  genre?: string | null;
}

/** Лайк исполнителя MSS: снимок имени и обложки, отдельной сущности в каталоге нет. */
export interface LikedArtistDto {
  source: SourceId;
  id: string;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
  trackCount?: number;
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
      external: { source: ExternalSourceId; id: string; snapshot: ExternalTrackSnapshot };
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

/** Последние уникальные прослушивания аккаунта — одни и те же на телефоне и компьютере. */
export interface ListeningHistoryItem {
  source: SourceId;
  trackId: string;
  title: string;
  artist: string;
  artists: ArtistRef[] | null;
  album: string | null;
  albumId: string | null;
  coverUrl: string | null;
  durationMs: number | null;
  playedAt: string;
}

export interface ListeningHistory {
  items: ListeningHistoryItem[];
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
  streamUrl?: string;
  cloudPlayUrl?: string;
  cloudDownloadUrl?: string;
  cloudUrlExpiresAt?: string;
  contentHash?: string | null;
}

export interface UnifiedArtist {
  source: SourceId;
  id: string;
  name: string;
  imageUrl?: string;
  genres?: string[];
  followers?: number;
  monthlyListeners?: number;
  description?: string;
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
  description?: string;
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

export type HomeFeedItem =
  | { kind: 'album'; album: UnifiedAlbum }
  | { kind: 'playlist'; playlist: UnifiedPlaylist }
  | { kind: 'artist'; artist: UnifiedArtist };

/** Секция главной страницы источника (рекомендации, новинки, подборки). */
export interface HomeFeedSection {
  id: string;
  title: string;
  items: HomeFeedItem[];
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

export type LoginMethod = 'qr' | 'sms' | 'password';

export type LoginPromptStep = 'qr' | 'sms' | 'credentials' | 'code' | 'captcha';

export interface LoginPrompt {
  source: SourceId;
  step: LoginPromptStep;
  method?: LoginMethod;
  captchaImg?: string;
  phoneMask?: string;
  error?: string;
  qrUrl?: string;
  qrAuthCode?: string;
  qrStatus?: 'pending' | 'scanned' | 'expired';
}

export interface LoginReply {
  source: SourceId;
  cancelled?: boolean;
  method?: LoginMethod;
  username?: string;
  password?: string;
  code?: string;
  forceSms?: boolean;
  captchaKey?: string;
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

export type LobbyMemberRole = 'host' | 'guest';
export type LobbyQueueStatus = 'suggested' | 'queued' | 'playing' | 'played' | 'rejected';

export interface LobbyPlaybackState {
  track: UnifiedTrack | null;
  paused: boolean;
  positionMs: number;
  updatedAt: string;
}

export interface LobbyMemberDto {
  userId: string;
  role: LobbyMemberRole;
  displayName: string | null;
  joinedAt: string;
}

export interface LobbyQueueItemDto {
  id: string;
  position: number;
  track: UnifiedTrack;
  suggestedBy: string | null;
  status: LobbyQueueStatus;
  createdAt: string;
}

export interface LobbyDto {
  id: string;
  inviteCode: string;
  title: string;
  maxMembers: number;
  isPublic: boolean;
  hostUserId: string;
  createdAt: string;
  endedAt: string | null;
  members: LobbyMemberDto[];
  queue: LobbyQueueItemDto[];
  playback: LobbyPlaybackState;
}

/** Карточка комнаты в списке: без очереди и участников, зато с качеством связи до DJ. */
export interface LobbySummaryDto {
  id: string;
  inviteCode: string;
  title: string;
  /** Сколько человек в комнате, включая DJ. */
  listeners: number;
  maxMembers: number;
  isPublic: boolean;
  isMember: boolean;
  hostUserId: string;
  hostDisplayName: string | null;
  /** DJ держит сокет комнаты. */
  hostOnline: boolean;
  /** RTT DJ ↔ сервер, мс. null — DJ не в сети или ещё не ответил на ping. */
  hostRttMs: number | null;
  /** Потери кадров эфира на участке DJ → сервер, проценты. null — данных ещё мало. */
  hostLossPct: number | null;
  createdAt: string;
}

export interface LobbyListDto {
  items: LobbySummaryDto[];
  /** Время обработки запроса на сервере, мс: клиент вычитает его из своего RTT. */
  tookMs: number;
}

/** Состояние прямого канала гость ↔ DJ. Сервер только форвардит, SDP не разбирает. */
export type LobbyWebrtcState = 'connecting' | 'connected' | 'failed';

export type LobbyWsEvent =
  | { type: 'lobby_state'; lobby: LobbyDto }
  | { type: 'member_join'; member: LobbyMemberDto }
  | { type: 'member_leave'; userId: string }
  | { type: 'listener_ready'; userId: string }
  | { type: 'queue_updated'; queue: LobbyQueueItemDto[] }
  | { type: 'playback'; playback: LobbyPlaybackState }
  | { type: 'suggestion_new'; item: LobbyQueueItemDto }
  | { type: 'lobby_closed' }
  /** Сервер измеряет RTT участника: `t` возвращается в `pong` без изменений. */
  | { type: 'ping'; t?: number }
  | { type: 'pong'; t?: number }
  | { type: 'error'; message: string }
  | { type: 'webrtc_offer'; fromUserId: string; toUserId: string; sdp: string }
  | { type: 'webrtc_answer'; fromUserId: string; toUserId: string; sdp: string }
  | {
      type: 'webrtc_ice';
      fromUserId: string;
      toUserId: string;
      candidate: string | null;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    }
  | { type: 'webrtc_state'; fromUserId: string; toUserId: string; state: LobbyWebrtcState };

/** Исходящие JSON с клиента: `fromUserId` подставляет сервер. */
export type LobbyWsClientMessage =
  | { type: 'ping'; t?: number }
  | { type: 'pong'; t?: number }
  | { type: 'webrtc_offer'; toUserId: string; sdp: string }
  | { type: 'webrtc_answer'; toUserId: string; sdp: string }
  | {
      type: 'webrtc_ice';
      toUserId: string;
      candidate: string | null;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    }
  | { type: 'webrtc_state'; toUserId: string; state: LobbyWebrtcState };
