import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type {
  AlbumWithTracks,
  ArtistProfile,
  DeviceCodePrompt,
  DownloadProgress,
  DownloadRecord,
  ExternalAccount,
  FeedBlock,
  LoginPrompt,
  LoginReply,
  PlaybackHandle,
  PlaybackReport,
  PlaylistWithTracks,
  Quality,
  TrackLyrics,
  UnifiedAlbum,
  UnifiedArtist,
  UnifiedPlaylist,
  UnifiedTrack,
  WaveBatch,
  WaveFeedbackType,
  WaveSettings,
} from '@mss/shared';

export interface PlayerSnapshot {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  externalUrl?: string;
  playing: boolean;
  liked?: boolean;
  hasTrack: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  /** Играет «Моя волна»: порядок задаёт Яндекс, перемешивание недоступно, повтор — только трека. */
  radio: boolean;
  sleep?: { endsAt: number | null; afterTrack: boolean };
}

export interface VolumeChange {
  volume?: number;
  muted?: boolean;
}

export type SleepCommand = `sleep:${number}` | 'sleep:track' | 'sleep:off';

export type PlayerCommand =
  | 'toggle'
  | 'next'
  | 'prev'
  | 'like'
  | 'show'
  | 'shuffle'
  | 'repeat'
  | 'seekForward'
  | 'seekBack'
  | 'volumeUp'
  | 'volumeDown'
  | SleepCommand;

export interface PlayerProgress {
  position: number;
  duration: number;
  playing: boolean;
}

type TrackRef = Pick<UnifiedTrack, 'id' | 'albumId'>;

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const yandexCall = <T>(method: string, ...args: unknown[]) =>
  ipcRenderer.invoke('yandex:call', method, ...args) as Promise<T>;

export type ClientSecretKey = 'SPOTIFY_CLIENT_ID' | 'DISCORD_CLIENT_ID' | 'YANDEX_CLIENT_ID' | 'YANDEX_CLIENT_SECRET';

export interface ClientSecretFieldView {
  userValue: string;
  effectiveSet: boolean;
  source: 'user' | 'env' | 'baked' | 'none';
}

export interface ClientSecretsView {
  fields: Record<ClientSecretKey, ClientSecretFieldView>;
  yandexCustomOAuth: boolean;
}

export interface SystemSettings {
  closeToTray: boolean;
  startMinimized: boolean;
  globalShortcuts: boolean;
  discordPresence: boolean;
  discordShowCover: boolean;
  discordShowButton: boolean;
  discordShowOnPause: boolean;
  openAtLogin: boolean;
  discordClientIdFromEnv: boolean;
  /** Публичный URL API (как на лендинге), для REST и presence WS */
  apiPublicUrl?: string;
}

export type UpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloaded' | 'error' | 'dev';
  version?: string;
  message?: string;
};

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const api = {
  getDeviceId: () => ipcRenderer.invoke('app:getDeviceId') as Promise<string>,
  system: {
    getSettings: () => ipcRenderer.invoke('system:getSettings') as Promise<SystemSettings>,
    setSettings: (patch: Partial<SystemSettings>) =>
      ipcRenderer.invoke('system:setSettings', patch) as Promise<SystemSettings>,
    getClientSecrets: () => ipcRenderer.invoke('system:getClientSecrets') as Promise<ClientSecretsView>,
    setClientSecrets: (patch: {
      secrets?: Partial<Record<ClientSecretKey, string | null>>;
      yandexCustomOAuth?: boolean;
    }) => ipcRenderer.invoke('system:setClientSecrets', patch) as Promise<ClientSecretsView>,
    version: () => ipcRenderer.invoke('system:version') as Promise<string>,
    openLogs: () => ipcRenderer.invoke('app:openLogs') as Promise<void>,
    log: (level: LogLevel, parts: string[]) => ipcRenderer.send('log:write', level, parts),
    /** Диалог «Сохранить как»; возвращает путь или null, если пользователь отменил. */
    saveTextFile: (defaultName: string, content: string, filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('system:saveTextFile', defaultName, content, filters) as Promise<string | null>,
    checkForUpdate: () => ipcRenderer.invoke('update:check') as Promise<UpdateStatus>,
    installUpdate: () => ipcRenderer.invoke('update:install') as Promise<void>,
    onUpdate: (cb: (status: UpdateStatus) => void) => subscribe('update:status', cb),
    onDeepLink: (cb: (url: string) => void) => subscribe('deep-link', cb),
    exportReport: () => ipcRenderer.invoke('system:exportReport') as Promise<string | null>,
    openCrashes: () => ipcRenderer.invoke('system:openCrashes') as Promise<void>,
    openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url) as Promise<boolean>,
  },
  spotifySession: {
    show: () => ipcRenderer.invoke('spotify-session:show') as Promise<void>,
    hide: () => ipcRenderer.invoke('spotify-session:hide') as Promise<void>,
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('spotify-session:setBounds', bounds) as Promise<void>,
    pause: () => ipcRenderer.invoke('spotify-session:pause') as Promise<void>,
    logout: () => ipcRenderer.invoke('spotify-session:logout') as Promise<void>,
    loggedIn: () => ipcRenderer.invoke('spotify-session:loggedIn') as Promise<boolean>,
    onLoggedIn: (cb: (loggedIn: boolean) => void) => subscribe('spotify-session:loggedIn', cb),
    onMedia: (cb: (state: { playing: boolean }) => void) => subscribe('spotify-session:media', cb),
  },
  localTracks: {
    pickFiles: () => ipcRenderer.invoke('localTracks:pickFiles') as Promise<string[]>,
    prepare: (filePath: string) =>
      ipcRenderer.invoke('localTracks:prepare', filePath) as Promise<{
        path: string;
        contentHash: string;
        title: string;
        artist: string;
        album: string | null;
        durationMs: number | null;
        sizeBytes: number;
        originalFilename: string;
        coverJpeg?: Uint8Array;
      }>,
    bind: (trackId: string, path: string, contentHash: string) =>
      ipcRenderer.invoke('localTracks:bind', trackId, path, contentHash) as Promise<void>,
    resolvePlayUrl: (trackId: string) =>
      ipcRenderer.invoke('localTracks:resolvePlayUrl', trackId) as Promise<string | null>,
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  presence: {
    connect: (accessToken: string) => ipcRenderer.invoke('presence:connect', accessToken) as Promise<void>,
    updateAccessToken: (accessToken: string) =>
      ipcRenderer.invoke('presence:updateAccessToken', accessToken) as Promise<void>,
    disconnect: () => ipcRenderer.invoke('presence:disconnect') as Promise<void>,
  },
  relay: {
    provideFile: (sessionId: string) => ipcRenderer.invoke('relay:provideFile', sessionId) as Promise<void>,
    onEvent: (cb: (payload: unknown) => void) => subscribe('relay:event', cb),
  },
  offline: {
    list: () => ipcRenderer.invoke('offline:list') as Promise<{ trackId: string; path: string }[]>,
    remove: (trackId: string) => ipcRenderer.invoke('offline:remove', trackId),
    save: (trackId: string, buffer: ArrayBuffer) =>
      ipcRenderer.invoke('offline:save', trackId, buffer) as Promise<string>,
    resolvePlayUrl: (trackId: string, userId: string) =>
      ipcRenderer.invoke('offline:resolvePlayUrl', trackId, userId) as Promise<string>,
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list') as Promise<DownloadRecord[]>,
    start: (track: UnifiedTrack, quality: Quality, compressKbps: number) =>
      ipcRenderer.invoke('downloads:start', track, quality, compressKbps) as Promise<DownloadRecord>,
    compressAll: (kbps: number) =>
      ipcRenderer.invoke('downloads:compressAll', kbps) as Promise<{
        compressed: number;
        failed: number;
        savedBytes: number;
      }>,
    ffmpegAvailable: () => ipcRenderer.invoke('downloads:ffmpegAvailable') as Promise<boolean>,
    remove: (key: string) => ipcRenderer.invoke('downloads:remove', key) as Promise<void>,
    cancel: (key: string) => ipcRenderer.invoke('downloads:cancel', key) as Promise<void>,
    cancelAll: () => ipcRenderer.invoke('downloads:cancelAll') as Promise<void>,
    reveal: (key: string) => ipcRenderer.invoke('downloads:reveal', key) as Promise<void>,
    getDir: () => ipcRenderer.invoke('downloads:getDir') as Promise<string>,
    chooseDir: () => ipcRenderer.invoke('downloads:chooseDir') as Promise<string | null>,
    openDir: () => ipcRenderer.invoke('downloads:openDir') as Promise<void>,
    onProgress: (cb: (progress: DownloadProgress) => void) => subscribe('downloads:progress', cb),
    onChanged: (cb: () => void) => subscribe('downloads:changed', cb),
  },
  connectors: {
    status: () =>
      ipcRenderer.invoke('connectors:status') as Promise<{ id: string; status: string; name: string }[]>,
    connect: (id: string) => ipcRenderer.invoke('connectors:connect', id) as Promise<void>,
    cancelConnect: (id: string) => ipcRenderer.invoke('connectors:cancelConnect', id) as Promise<void>,
    disconnect: (id: string) => ipcRenderer.invoke('connectors:disconnect', id) as Promise<void>,
    account: (id: string) =>
      ipcRenderer.invoke('connectors:account', id) as Promise<ExternalAccount | null>,
    accessToken: (id: string) => ipcRenderer.invoke('connectors:accessToken', id) as Promise<string | null>,
    onDeviceCode: (cb: (prompt: DeviceCodePrompt) => void) => subscribe('connectors:deviceCode', cb),
    onLoginPrompt: (cb: (prompt: LoginPrompt) => void) => subscribe('connectors:loginPrompt', cb),
    loginReply: (reply: LoginReply) => ipcRenderer.invoke('connectors:loginReply', reply) as Promise<void>,
    search: (id: string, query: string, limit: number) =>
      ipcRenderer.invoke('connectors:search', id, query, limit) as Promise<UnifiedTrack[]>,
    searchArtists: (id: string, query: string, limit: number) =>
      ipcRenderer.invoke('connectors:searchArtists', id, query, limit) as Promise<UnifiedArtist[]>,
    artistTracks: (id: string, artistId: string, limit: number, artistName?: string) =>
      ipcRenderer.invoke('connectors:artistTracks', id, artistId, limit, artistName) as Promise<UnifiedTrack[]>,
    homeTracks: (id: string, limit: number) =>
      ipcRenderer.invoke('connectors:homeTracks', id, limit) as Promise<UnifiedTrack[]>,
    resolvePlayback: (id: string, track: UnifiedTrack, quality?: Quality) =>
      ipcRenderer.invoke('connectors:resolvePlayback', id, track, quality) as Promise<PlaybackHandle>,
    listPlaylists: (id: string) =>
      ipcRenderer.invoke('connectors:listPlaylists', id) as Promise<UnifiedPlaylist[]>,
    getPlaylist: (id: string, playlistId: string) =>
      ipcRenderer.invoke('connectors:getPlaylist', id, playlistId) as Promise<PlaylistWithTracks>,
    savedTracks: (id: string, limit: number) =>
      ipcRenderer.invoke('connectors:savedTracks', id, limit) as Promise<UnifiedTrack[]>,
    setSaved: (id: string, track: UnifiedTrack, saved: boolean) =>
      ipcRenderer.invoke('connectors:setSaved', id, track, saved) as Promise<void>,
  },
  yandex: {
    account: (refresh = false) => yandexCall<ExternalAccount | null>('account', refresh),
    tracks: (ids: string[]) => yandexCall<UnifiedTrack[]>('tracks', ids),
    likedTrackIds: () => yandexCall<string[]>('likedTrackIds'),
    likedTracks: (limit?: number) => yandexCall<UnifiedTrack[]>('likedTracks', limit),
    setLike: (track: TrackRef, liked: boolean) => yandexCall<void>('setLike', track, liked),
    dislike: (track: TrackRef) => yandexCall<void>('dislike', track),
    playlists: () => yandexCall<UnifiedPlaylist[]>('playlists'),
    playlist: (id: string) => yandexCall<PlaylistWithTracks>('playlist', id),
    album: (id: string) => yandexCall<AlbumWithTracks>('album', id),
    artistProfile: (id: string) => yandexCall<ArtistProfile>('artistProfile', id),
    lyrics: (trackId: string) => yandexCall<TrackLyrics | null>('lyrics', trackId),
    feed: () => yandexCall<FeedBlock[]>('feed'),
    chart: () => yandexCall<UnifiedTrack[]>('chart'),
    waveStart: (settings?: WaveSettings) => yandexCall<WaveBatch>('waveStart', settings),
    waveMore: (sessionId: string, queue: string[]) => yandexCall<WaveBatch>('waveMore', sessionId, queue),
    waveFeedback: (
      sessionId: string,
      batchId: string,
      type: WaveFeedbackType,
      track?: TrackRef,
      totalPlayedSeconds?: number,
    ) => yandexCall<void>('waveFeedback', sessionId, batchId, type, track, totalPlayedSeconds),
    reportPlay: (report: PlaybackReport) => yandexCall<void>('reportPlay', report),
    searchAlbums: (query: string, limit?: number) => yandexCall<UnifiedAlbum[]>('searchAlbums', query, limit),
    searchPlaylists: (query: string, limit?: number) => yandexCall<UnifiedPlaylist[]>('searchPlaylists', query, limit),
    suggest: (part: string) => yandexCall<string[]>('suggest', part),
    similarTracks: (trackId: string) => yandexCall<UnifiedTrack[]>('similarTracks', trackId),
  },
  player: {
    publishState: (state: PlayerSnapshot) => ipcRenderer.send('player:state', state),
    onState: (cb: (state: PlayerSnapshot) => void) => subscribe('player:state', cb),
    sendCommand: (command: PlayerCommand) => ipcRenderer.send('player:command', command),
    onCommand: (cb: (command: PlayerCommand) => void) => subscribe('player:command', cb),
    changeVolume: (change: VolumeChange) => ipcRenderer.send('player:volume', change),
    onVolumeChange: (cb: (change: VolumeChange) => void) => subscribe('player:volume', cb),
    publishProgress: (progress: PlayerProgress | null) => ipcRenderer.send('player:progress', progress),
    /** Полосы спектра для визуализатора мини-плеера, 0..255. */
    publishSpectrum: (bands: number[]) => ipcRenderer.send('player:spectrum', bands),
    onSpectrum: (cb: (bands: number[]) => void) => subscribe('player:spectrum', cb),
    onMiniOpenChange: (cb: (open: boolean) => void) => subscribe('mini:open', cb),
  },
  platform: process.platform,
  lobby: {
    setPresence: (ctx: {
      active: boolean;
      lobbyId: string | null;
      inviteCode: string | null;
      title: string | null;
      memberCount: number;
      maxMembers: number;
      role: 'host' | 'guest' | null;
    }) => ipcRenderer.invoke('lobby:setPresence', ctx),
    captureWindowAudio: async (): Promise<MediaStream | null> => {
      const meta = (await ipcRenderer.invoke('lobby:captureWindowAudio')) as {
        sourceId: string;
        chromeMediaSource: 'window' | 'screen';
      } | null;
      if (!meta) return null;
      const chromeMediaSource = meta.chromeMediaSource === 'screen' ? 'desktop' : 'window';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource,
            chromeMediaSourceId: meta.sourceId,
          },
        },
        video: {
          mandatory: {
            chromeMediaSource,
            chromeMediaSourceId: meta.sourceId,
            maxWidth: 1,
            maxHeight: 1,
            maxFrameRate: 1,
          },
        },
      } as MediaStreamConstraints);
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      return stream.getAudioTracks().length ? stream : null;
    },
  },
  window: {
    toggleMini: () => ipcRenderer.send('window:toggleMini'),
    closeMini: () => ipcRenderer.send('window:closeMini'),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
    onMaximizedChange: (cb: (maximized: boolean) => void) => subscribe('window:maximized', cb),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
