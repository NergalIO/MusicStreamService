import type {
  ExternalAccount,
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
  getArtistTracks?(artistId: string, limit: number): Promise<UnifiedTrack[]>;
  listPlaylists?(): Promise<UnifiedPlaylist[]>;
  getPlaylist?(id: string): Promise<PlaylistWithTracks>;
  getSavedTracks?(limit: number): Promise<UnifiedTrack[]>;
  resolvePlayback(track: UnifiedTrack, options?: { quality?: Quality }): Promise<PlaybackHandle>;
  /** Access token for Web Playback SDK (Spotify). */
  getAccessToken?(): Promise<string | null>;
}
