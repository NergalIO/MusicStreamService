import { ipcMain } from 'electron';
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

export function registerConnectorIpc(): void {
  ipcMain.handle('connectors:status', async () => {
    const list = connectorRegistry.list();
    return list.map((c) => ({ id: c.id, status: c.getAuthStatus(), name: c.displayName }));
  });
  ipcMain.handle('connectors:connect', (_e, id: string) => connector(id).connect());
  ipcMain.handle('connectors:cancelConnect', (_e, id: string) => {
    connector(id).cancelConnect?.();
    cancelPendingLogin();
  });
  ipcMain.handle('connectors:loginReply', (_e, reply) => resolveLoginReply(reply));
  ipcMain.handle('connectors:disconnect', (_e, id: string) => connector(id).disconnect());
  ipcMain.handle('connectors:account', (_e, id: string) => connector(id).getAccount?.() ?? null);
  ipcMain.handle('connectors:accessToken', async (_e, id: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.getAccessToken || c.getAuthStatus() === 'disconnected') return null;
    return c.getAccessToken();
  });

  ipcMain.handle('connectors:search', async (_e, id: string, query: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c || c.getAuthStatus() === 'disconnected') return [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    try {
      return await c.search(query, safeLimit);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });
  ipcMain.handle('connectors:searchArtists', async (_e, id: string, query: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c?.searchArtists || c.getAuthStatus() === 'disconnected') return [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 12;
    try {
      return await c.searchArtists(query, safeLimit);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });
  ipcMain.handle(
    'connectors:artistTracks',
    async (_e, id: string, artistId: string, limit: number, artistName?: string) => {
      const c = connectorRegistry.get(id);
      if (!c?.getArtistTracks || c.getAuthStatus() === 'disconnected') return [];
      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
      return c.getArtistTracks(artistId, safeLimit, artistName);
    },
  );
  ipcMain.handle('connectors:artistProfile', async (_e, id: string, artistId: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.getArtistProfile || c.getAuthStatus() === 'disconnected') return null;
    return c.getArtistProfile(artistId);
  });
  ipcMain.handle('connectors:homeTracks', async (_e, id: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c?.getHomeTracks || c.getAuthStatus() === 'disconnected') return [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 30;
    return c.getHomeTracks(safeLimit);
  });
  ipcMain.handle(
    'connectors:resolvePlayback',
    (_e, id: string, track: UnifiedTrack, quality?: Quality) => connector(id).resolvePlayback(track, { quality }),
  );
  ipcMain.handle('connectors:setSaved', (_e, id: string, track: UnifiedTrack, saved: boolean) => {
    const c = connector(id);
    if (!c.setSavedTrack) throw new Error('Сохранение не поддерживается');
    return c.setSavedTrack(track, saved);
  });

  ipcMain.handle('connectors:listPlaylists', async (_e, id: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.listPlaylists || c.getAuthStatus() === 'disconnected') return [];
    try {
      return await c.listPlaylists();
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });

  ipcMain.handle('connectors:getPlaylist', async (_e, id: string, playlistId: string) => {
    const c = connector(id);
    if (!c.getPlaylist) throw new Error('Playlists not supported');
    return c.getPlaylist(playlistId);
  });

  ipcMain.handle('connectors:favoriteArtists', async (_e, id: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.getFavoriteArtists || c.getAuthStatus() === 'disconnected') return [];
    return c.getFavoriteArtists();
  });

  ipcMain.handle('connectors:homeFeed', async (_e, id: string) => {
    const c = connectorRegistry.get(id);
    if (!c?.getHomeFeed || c.getAuthStatus() === 'disconnected') return [];
    return c.getHomeFeed();
  });

  ipcMain.handle('connectors:album', async (_e, id: string, albumId: string) => {
    const c = connector(id);
    if (!c.getAlbum) throw new Error('Альбомы не поддерживаются');
    return cachedAlbum(`${id}:${albumId}`, () => c.getAlbum!(albumId));
  });

  ipcMain.handle('connectors:trackRadio', async (_e, id: string, track: UnifiedTrack) => {
    const c = connector(id);
    if (!c.getTrackRadio) throw new Error('Радио не поддерживается');
    return c.getTrackRadio(track);
  });

  ipcMain.handle('connectors:savedTracks', async (_e, id: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c?.getSavedTracks || c.getAuthStatus() === 'disconnected') return [];
    try {
      return await c.getSavedTracks(limit);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  });

  ipcMain.handle('yandex:call', async (_e, method: string, ...args: unknown[]) => {
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

/** Сразу отдаёт сохранённый альбом и в фоне обновляет запись; без записи — ждёт сеть. */
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
