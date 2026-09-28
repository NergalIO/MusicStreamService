import type {
  ExternalAccount,
  PlaybackHandle,
  PlaylistWithTracks,
  UnifiedArtist,
  UnifiedPlaylist,
  UnifiedTrack,
} from '@mss/shared';
import type { StreamConnector } from './types.js';
import { VkClient, type VkClientOptions } from './vk-client.js';
import {
  artistsFromTracks,
  mapVkPlaylist,
  mapVkTrack,
  parseVkAudioId,
  parseVkPlaylistId,
  unwrapAudio,
  type VkAudio,
  type VkPlaylist,
} from './vk-mappers.js';

const PAGE = 200;

export interface VkConnector extends StreamConnector {
  client: VkClient;
}

export type VkConnectorOptions = VkClientOptions;

interface VkList<T> {
  count: number;
  items: T[];
}

function isHls(url: string): boolean {
  return /m3u8(\?|$)/i.test(url);
}

async function collectAudio(
  client: VkClient,
  method: string,
  params: Record<string, string | number | undefined>,
  limit: number,
): Promise<VkAudio[]> {
  const items: VkAudio[] = [];
  let offset = 0;
  while (items.length < limit) {
    const page = await client.call<VkList<VkAudio | { audio?: VkAudio }>>(method, {
      ...params,
      offset,
      count: Math.min(PAGE, limit - items.length),
    });
    const batch = (page.items ?? []).map(unwrapAudio).filter((a): a is VkAudio => !!a);
    items.push(...batch);
    if (!batch.length || items.length >= (page.count ?? items.length)) break;
    offset += batch.length;
  }
  return items.slice(0, limit);
}

export function createVkConnector(opts: VkConnectorOptions): VkConnector {
  const client = new VkClient(opts);

  return {
    id: 'vk',
    displayName: 'VK Музыка',
    client,
    getAuthStatus: () => client.status,
    connect: () => client.login(),
    cancelConnect: () => client.cancelLogin(),
    async disconnect() {
      client.logout();
    },
    async getAccount(): Promise<ExternalAccount | null> {
      if (client.status !== 'connected') return null;
      return client.fetchAccount().catch(() => client.cachedAccount);
    },
    async getAccessToken() {
      return client.getAccessToken();
    },
    async search(query: string, limit: number): Promise<UnifiedTrack[]> {
      if (client.status !== 'connected') return [];
      const page = await client.call<VkList<VkAudio>>('audio.search', {
        q: query,
        count: Math.min(Math.max(limit, 1), 300),
        auto_complete: 1,
        sort: 2,
      });
      return (page.items ?? []).map(unwrapAudio).filter((a): a is VkAudio => !!a).slice(0, limit).map(mapVkTrack);
    },
    async searchArtists(query: string, limit: number): Promise<UnifiedArtist[]> {
      if (client.status !== 'connected') return [];
      const page = await client.call<VkList<VkAudio>>('audio.search', {
        q: query,
        count: Math.min(Math.max(limit * 8, 20), 200),
        auto_complete: 1,
      });
      return artistsFromTracks((page.items ?? []).map(unwrapAudio).filter((a): a is VkAudio => !!a), limit);
    },
    async getArtistTracks(artistId: string, limit: number, artistName?: string): Promise<UnifiedTrack[]> {
      if (client.status !== 'connected') return [];
      try {
        const page = await client.call<VkList<VkAudio>>('audio.getAudiosByArtist', {
          artist_id: artistId,
          count: Math.min(limit, 300),
        });
        if (page.items?.length) {
          return page.items.map(unwrapAudio).filter((a): a is VkAudio => !!a).slice(0, limit).map(mapVkTrack);
        }
      } catch {
        /* метод есть не у всех токенов */
      }
      const q = artistName || artistId;
      const found = await collectAudio(client, 'audio.search', { q, auto_complete: 1 }, Math.min(limit * 2, 200));
      const matched = found.filter((a) =>
        (a.main_artists ?? []).some((art) => String(art.id) === artistId || art.name.toLowerCase() === q.toLowerCase()),
      );
      return (matched.length ? matched : found).slice(0, limit).map(mapVkTrack);
    },
    async getSavedTracks(limit: number): Promise<UnifiedTrack[]> {
      if (client.status !== 'connected') return [];
      const ownerId = client.userId;
      return (await collectAudio(client, 'audio.get', ownerId ? { owner_id: ownerId } : {}, limit)).map(mapVkTrack);
    },
    async getHomeTracks(limit: number): Promise<UnifiedTrack[]> {
      if (client.status !== 'connected') return [];
      const ownerId = client.userId;
      return (await collectAudio(client, 'audio.get', ownerId ? { owner_id: ownerId } : {}, limit)).map(mapVkTrack);
    },
    async listPlaylists(): Promise<UnifiedPlaylist[]> {
      if (client.status !== 'connected' || !client.userId) return [];
      const items: VkPlaylist[] = [];
      let offset = 0;
      for (;;) {
        const page = await client.call<VkList<VkPlaylist>>('audio.getPlaylists', {
          owner_id: client.userId,
          offset,
          count: 100,
        });
        const batch = page.items ?? [];
        items.push(...batch);
        if (!batch.length || items.length >= (page.count ?? items.length)) break;
        offset += batch.length;
      }
      return items.map(mapVkPlaylist);
    },
    async getPlaylist(id: string): Promise<PlaylistWithTracks> {
      if (client.status !== 'connected') throw new Error('Войдите во VK');
      const { ownerId, playlistId, accessKey } = parseVkPlaylistId(id);
      let meta: VkPlaylist = { id: playlistId, owner_id: ownerId, title: 'Плейлист', access_key: accessKey };
      try {
        meta = await client.call<VkPlaylist>('audio.getPlaylistById', {
          owner_id: ownerId,
          playlist_id: playlistId,
          access_key: accessKey,
        });
      } catch {
        /* достаточно audio.get */
      }
      const tracks = (
        await collectAudio(
          client,
          'audio.get',
          { owner_id: ownerId, playlist_id: playlistId, access_key: accessKey },
          5000,
        )
      ).map(mapVkTrack);
      return { ...mapVkPlaylist({ ...meta, count: tracks.length }), tracks };
    },
    async setSavedTrack(track: UnifiedTrack, saved: boolean): Promise<void> {
      if (client.status !== 'connected') throw new Error('Войдите во VK');
      const { ownerId, audioId } = parseVkAudioId(track.id);
      const method = saved ? 'audio.add' : 'audio.delete';
      try {
        await client.call(method, { owner_id: ownerId, audio_id: audioId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already added|not found|214|15/i.test(msg)) return;
        throw e;
      }
    },
    async resolvePlayback(track: UnifiedTrack): Promise<PlaybackHandle> {
      if (client.status !== 'connected') throw new Error('Войдите во VK заново в Настройках');
      const { ownerId, audioId, accessKey } = parseVkAudioId(track.id);
      const audios = accessKey ? `${ownerId}_${audioId}_${accessKey}` : `${ownerId}_${audioId}`;
      const items = await client.call<Array<VkAudio | { audio?: VkAudio }>>('audio.getById', { audios });
      const audio = unwrapAudio(items[0] ?? {});
      const url = audio?.url;
      if (!url) {
        throw new Error(audio?.content_restricted ? 'Трек недоступен в VK' : 'VK не отдал ссылку на поток');
      }
      if (isHls(url)) {
        return { kind: 'mediaUrl', url: `mss-stream://vk/?u=${encodeURIComponent(url)}`, codec: 'mp3' };
      }
      return { kind: 'mediaUrl', url, codec: 'mp3' };
    },
  };
}
