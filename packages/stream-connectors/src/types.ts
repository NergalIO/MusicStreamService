import type {
  AlbumWithTracks,
  ArtistProfile,
  ExternalAccount,
  HomeFeedSection,
  PlaybackHandle,
  PlaylistWithTracks,
  Quality,
  SourceId,
  UnifiedArtist,
  UnifiedPlaylist,
  UnifiedTrack,
} from '@mss/shared';

export type AuthStatus = 'disconnected' | 'connected' | 'expired';

export interface TokenVault {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface StreamConnector {
  id: SourceId;
  displayName: string;
  getAuthStatus(): AuthStatus;
  connect(): Promise<void>;
  cancelConnect?(): void;
  disconnect(): Promise<void>;
  getAccount?(): Promise<ExternalAccount | null>;
  search(query: string, limit: number): Promise<UnifiedTrack[]>;
  searchArtists?(query: string, limit: number): Promise<UnifiedArtist[]>;
  getArtistTracks?(artistId: string, limit: number, artistName?: string): Promise<UnifiedTrack[]>;
  /** Карточка исполнителя: слушатели, биография, топ-треки и дискография. */
  getArtistProfile?(artistId: string): Promise<ArtistProfile>;
  /** Исполнители, которых пользователь лайкнул или на которых подписан в самом сервисе. */
  getFavoriteArtists?(): Promise<UnifiedArtist[]>;
  listPlaylists?(): Promise<UnifiedPlaylist[]>;
  getPlaylist?(id: string): Promise<PlaylistWithTracks>;
  getSavedTracks?(limit: number): Promise<UnifiedTrack[]>;
  /** Подборка для «Слушать сейчас» на главной источника. */
  getHomeTracks?(limit: number): Promise<UnifiedTrack[]>;
  /** Секции главной страницы источника: альбомы, подборки, исполнители. */
  getHomeFeed?(): Promise<HomeFeedSection[]>;
  getAlbum?(id: string): Promise<AlbumWithTracks>;
  /** Станция «радио» по треку — плейлист похожих треков. */
  getTrackRadio?(track: UnifiedTrack): Promise<PlaylistWithTracks>;
  resolvePlayback(track: UnifiedTrack, options?: { quality?: Quality }): Promise<PlaybackHandle>;
  /** Добавить или убрать трек из «Моей музыки» источника. */
  setSavedTrack?(track: UnifiedTrack, saved: boolean): Promise<void>;
  /** Access token for Web Playback SDK (Spotify). */
  getAccessToken?(): Promise<string | null>;
}
