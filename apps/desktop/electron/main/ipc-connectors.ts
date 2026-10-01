import { BrowserWindow, ipcMain } from 'electron';
import type { AlbumWithTracks, Quality, TrackLyrics, UnifiedTrack } from '@mss/shared';
import type { YandexMusicApi } from '@mss/stream-connectors';
import { connectorRegistry, getYandex, resolveLoginReply, cancelPendingLogin } from './connectors.js';
import { readCachedJson, writeCachedJson } from './content-cache.js';

const YANDEX_METHODS = [
  'account',
  'tracks',
  'likedTrackIds',
  'likedTracks',
  'setLike',
  'likedAlbums',
  'setAlbumLike',
  'dislike',
  'playlists',
  'playlist',
  'album',
  'artistProfile',
  'lyrics',
  'feed',
  'chart',
  'waveStart',
  'waveMore',
  'waveFeedback',
  'reportPlay',
  'searchAlbums',
  'searchPlaylists',
  'suggest',
  'similarTracks',
] as const satisfies readonly (keyof YandexMusicApi)[];

type YandexMethod = (typeof YANDEX_METHODS)[number];

function connector(id: string) {
  const c = connectorRegistry.get(id);
  if (!c) throw new Error(`Источник ${id} не настроен`);
  return c;
}

let lastStatuses = '';

/**
 * Коннектор может сам сбросить протухшую сессию посреди обычного запроса. Без оповещения
 * интерфейс продолжил бы показывать сервис подключённым до истечения кеша запросов.
 */
function broadcastStatusIfChanged(): void {
  const snapshot = connectorRegistry
    .list()
    .map((c) => `${c.id}:${c.getAuthStatus()}`)
    .join('|');
  if (snapshot === lastStatuses) return;
  lastStatuses = snapshot;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('connectors:statusChanged');
  }
}

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown;

function handleConnector(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await (fn as (e: Electron.IpcMainInvokeEvent, ...a: unknown[]) => unknown)(event, ...args);
    } finally {
      broadcastStatusIfChanged();
    }
  });
}

export function registerConnectorIpc(): void {
  handleConnector('connectors:status', async () => {
    const list = connectorRegistry.list();
    return list.map((c) => ({ id: c.id, status: c.getAuthStatus(), name: c.displayName }));
  });
  handleConnector('connectors:connect', (_e, id: string) => connector(id).connect());
  handleConnector('connectors:cancelConnect', (_e, id: string) => {
    connector(id).cancelConnect?.();
    cancelPendingLogin();
  });
  handleConnector('connectors:loginReply', (_e, reply) => resolveLoginReply(reply));
  handleConnector('connectors:disconnect', (_e, id: string) => connector(id).disconnect());
  handleConnector('connectors:account', (_e, id: string) => connector(id).getAccount?.() ?? null);
  handleConnector('connectors:search', async (_e, id: string, query: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c || c.getAuthStatus() === 'disconnected') return [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    try {
      return await c.search(query, safeLimit);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });
  handleConnector('connectors:searchArtists', async (_e, id: string, query: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c?.searchArtists || c.getAuthStatus() === 'disconnected') return [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 12;
    try {
      return await c.searchArtists(query, safeLimit);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });
  handleConnector(
    'connectors:artistTracks',
    async (_e, id: string, artistId: string, limit: number, artistName?: string) => {
      const c = connectorRegistry.get(id);
      if (!c?.getArtistTracks || c.getAuthStatus() === 'disconnected') return [];
      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
      return c.getArtistTracks(artistId, safeLimit, artistName);
    },
  );
  handleConnector('connectors:artistProfile', async (_e, id: string, artistId: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.getArtistProfile || c.getAuthStatus() === 'disconnected') return null;
    return c.getArtistProfile(artistId);
  });
  handleConnector('connectors:homeTracks', async (_e, id: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c?.getHomeTracks || c.getAuthStatus() === 'disconnected') return [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 30;
    return c.getHomeTracks(safeLimit);
  });
  handleConnector(
    'connectors:resolvePlayback',
    (_e, id: string, track: UnifiedTrack, quality?: Quality) => connector(id).resolvePlayback(track, { quality }),
  );
  handleConnector('connectors:setSaved', (_e, id: string, track: UnifiedTrack, saved: boolean) => {
    const c = connector(id);
    if (!c.setSavedTrack) throw new Error('Сохранение не поддерживается');
    return c.setSavedTrack(track, saved);
  });

  handleConnector('connectors:listPlaylists', async (_e, id: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.listPlaylists || c.getAuthStatus() === 'disconnected') return [];
    try {
      return await c.listPlaylists();
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });

  handleConnector('connectors:getPlaylist', async (_e, id: string, playlistId: string) => {
    const c = connector(id);
    if (!c.getPlaylist) throw new Error('Playlists not supported');
    return c.getPlaylist(playlistId);
  });

  handleConnector('connectors:favoriteArtists', async (_e, id: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.getFavoriteArtists || c.getAuthStatus() === 'disconnected') return [];
    return c.getFavoriteArtists();
  });

  handleConnector('connectors:homeFeed', async (_e, id: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.getHomeFeed || c.getAuthStatus() === 'disconnected') return [];
    return c.getHomeFeed();
  });

  handleConnector('connectors:album', async (_e, id: string, albumId: string) => {
    const c = connector(id);
    if (!c.getAlbum) throw new Error('Альбомы не поддерживаются');
    if (c.getAuthStatus() === 'disconnected') throw new Error(`Источник ${c.displayName} не подключён`);
    return cachedAlbum(`${id}:${albumId}`, () => c.getAlbum!(albumId));
  });

  handleConnector('connectors:trackRadio', async (_e, id: string, track: UnifiedTrack) => {
    const c = connector(id);
    if (!c.getTrackRadio) throw new Error('Радио не поддерживается');
    return c.getTrackRadio(track);
  });

  handleConnector('connectors:savedTracks', async (_e, id: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c?.getSavedTracks || c.getAuthStatus() === 'disconnected') return [];
    try {
      return await c.getSavedTracks(limit);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });

  handleConnector('yandex:call', async (_e, method: string, ...args: unknown[]) => {
    if (!(YANDEX_METHODS as readonly string[]).includes(method)) {
      throw new Error(`Unknown Yandex method: ${method}`);
    }
    const api = getYandex().api;
    const fn = api[method as YandexMethod] as (...a: unknown[]) => Promise<unknown>;
    if (method === 'album' && typeof args[0] === 'string') {
      return cachedAlbum(`yandex:${args[0]}`, () => fn.apply(api, args) as Promise<AlbumWithTracks>);
    }
    if (method === 'lyrics' && typeof args[0] === 'string') {
      const key = `yandex:${args[0]}`;
      const cached = await readCachedJson<TrackLyrics>('lyrics', key);
      if (cached) return cached;
      const lyrics = (await fn.apply(api, args)) as TrackLyrics | null;
      if (lyrics?.lines.length) await writeCachedJson('lyrics', key, lyrics);
      return lyrics;
    }
    return fn.apply(api, args);
  });
}

/** Сразу отдаёт сохранённый альбом и в фоне обновляет запись; без записи — ждёт сеть. Записи живут с TTL. */
async function cachedAlbum(key: string, load: () => Promise<AlbumWithTracks>): Promise<AlbumWithTracks> {
  const fetchFresh = async () => {
    const album = await load();
    if (album?.tracks?.length) await writeCachedJson('album', key, album);
    return album;
  };
  const cached = await readCachedJson<AlbumWithTracks>('album', key);
  if (cached) {
    fetchFresh().catch(() => {});
    return cached;
  }
  return fetchFresh();
}
