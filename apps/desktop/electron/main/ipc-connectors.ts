import { ipcMain } from 'electron';
import type { Quality, UnifiedTrack } from '@mss/shared';
import type { YandexMusicApi } from '@mss/stream-connectors';
import { connectorRegistry, getYandex } from './connectors.js';

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
    for (const c of list) {
      if (c.id === 'spotify' && c.getAuthStatus() !== 'disconnected') {
        await c.getAccount?.().catch(() => null);
      }
    }
    return list.map((c) => ({ id: c.id, status: c.getAuthStatus(), name: c.displayName }));
  });
  ipcMain.handle('connectors:connect', (_e, id: string) => connector(id).connect());
  ipcMain.handle('connectors:cancelConnect', (_e, id: string) => connector(id).cancelConnect?.());
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
  ipcMain.handle('connectors:artistTracks', async (_e, id: string, artistId: string, limit: number) => {
    const c = connectorRegistry.get(id);
    if (!c?.getArtistTracks || c.getAuthStatus() === 'disconnected') return [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    return c.getArtistTracks(artistId, safeLimit);
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
    return fn.apply(api, args);
  });
}
