import { createHash, createHmac } from 'node:crypto';
import type { ExternalAccount, PlaybackHandle, Quality, UnifiedArtist, UnifiedTrack } from '@mss/shared';
import type { StreamConnector } from './types.js';
import {
  ANDROID_SIGN_KEY,
  DIRECT_LINK_SALT,
  WEB_FILE_INFO_SIGN_KEY,
  YandexClient,
  type YandexClientOptions,
} from './yandex-client.js';
import { YandexMusicApi } from './yandex-api.js';
import {
  isCatalogTrackId,
  mapArtist,
  mapTrack,
  trackBaseId,
  type YArtist,
  type YTrack,
} from './yandex-mappers.js';

const ARTIST_TRACKS_PAGE = 20;

/** `flac-mp4` — FLAC в контейнере MP4; `quality=lossless` без flac-кодеков отдаёт MP3 320, а `nq` — 192. */
const FILE_INFO_QUALITY: Record<Quality, { quality: string; codecs: string[] }> = {
  lossless: { quality: 'lossless', codecs: ['flac', 'flac-mp4', 'mp3', 'aac'] },
  high: { quality: 'lossless', codecs: ['mp3', 'aac'] },
  normal: { quality: 'nq', codecs: ['mp3', 'aac'] },
};

interface DownloadInfoEntry {
  codec: string;
  preview: boolean;
  downloadInfoUrl?: string;
  bitrateInKbps?: number;
  container?: string;
}

function isPreviewQuality(quality?: string): boolean {
  return Boolean(quality && quality.includes('preview'));
}

async function resolveViaFileInfo(
  client: YandexClient,
  trackId: string,
  quality: Quality,
): Promise<Extract<PlaybackHandle, { kind: 'mediaUrl' }>> {
  const { quality: q, codecs } = FILE_INFO_QUALITY[quality];
  const ts = Math.floor(Date.now() / 1000);
  const transport = 'raw';
  const sign = createHmac('sha256', WEB_FILE_INFO_SIGN_KEY)
    .update(`${ts}${trackId}${q}${codecs.join('')}${transport}`)
    .digest('base64')
    .replace(/=+$/, '');
  const params = new URLSearchParams({
    ts: String(ts),
    trackId,
    quality: q,
    codecs: codecs.join(','),
    transports: transport,
    sign,
  });
  const data = await client.get<{
    downloadInfo?: { url?: string; urls?: string[]; quality?: string; codec?: string; bitrate?: number };
  }>(`/get-file-info?${params}`, 'web');
  const info = data.downloadInfo;
  const url = info?.url ?? info?.urls?.[0];
  if (!url) throw new Error('get-file-info: пустой ответ');
  return {
    kind: 'mediaUrl',
    url,
    preview: isPreviewQuality(info?.quality),
    codec: info?.codec,
    bitrate: info?.bitrate,
  };
}

async function resolveViaDownloadInfo(
  client: YandexClient,
  trackId: string,
): Promise<Extract<PlaybackHandle, { kind: 'mediaUrl' }>> {
  const ts = Math.floor(Date.now() / 1000);
  const sign = createHmac('sha256', ANDROID_SIGN_KEY).update(`${trackId}${ts}`).digest('base64');
  const items = await client.get<DownloadInfoEntry[]>(
    `/tracks/${encodeURIComponent(trackId)}/download-info?can_use_streaming=true&ts=${ts}&sign=${encodeURIComponent(sign)}`,
  );
  const usable = items
    .filter((d) => (d.codec === 'mp3' || d.codec === 'aac') && d.downloadInfoUrl && d.container !== 'hls')
    .sort((a, b) => Number(a.preview) - Number(b.preview) || (b.bitrateInKbps ?? 0) - (a.bitrateInKbps ?? 0));
  const entry = usable[0];
  if (!entry?.downloadInfoUrl) throw new Error('download-info: нет подходящего формата');

  const res = await fetch(entry.downloadInfoUrl);
  if (!res.ok) throw new Error(`Yandex storage ${res.status}`);
  const xml = await res.text();
  const tag = (name: string) => xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
  const host = tag('host');
  const filePath = tag('path');
  const s = tag('s');
  const linkTs = tag('ts');
  if (!host || !filePath || !s || !linkTs) throw new Error('Yandex: некорректный ответ storage');
  const hash = createHash('md5').update(`${DIRECT_LINK_SALT}${filePath.slice(1)}${s}`).digest('hex');
  return {
    kind: 'mediaUrl',
    url: `https://${host}/get-${entry.codec}/${hash}/${linkTs}${filePath}`,
    preview: entry.preview,
    codec: entry.codec,
    bitrate: entry.bitrateInKbps,
  };
}

export interface YandexConnector extends StreamConnector {
  client: YandexClient;
  api: YandexMusicApi;
}

export type YandexConnectorOptions = YandexClientOptions;

export function createYandexConnector(opts: YandexConnectorOptions): YandexConnector {
  const client = new YandexClient(opts);
  const api = new YandexMusicApi(client);

  return {
    id: 'yandex',
    displayName: 'Яндекс Музыка',
    client,
    api,
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
    async search(query: string, limit: number): Promise<UnifiedTrack[]> {
      if (client.status !== 'connected') return [];
      const data = await client.get<{ tracks?: { results: YTrack[] } }>(
        `/search?text=${encodeURIComponent(query)}&type=track&page=0&pageSize=${limit}`,
      );
      return (data.tracks?.results ?? []).map(mapTrack);
    },
    async searchArtists(query: string, limit: number): Promise<UnifiedArtist[]> {
      if (client.status !== 'connected') return [];
      const data = await client.get<{ artists?: { results: YArtist[] } }>(
        `/search?text=${encodeURIComponent(query)}&type=artist&page=0&pageSize=${limit}`,
      );
      return (data.artists?.results ?? []).slice(0, limit).map(mapArtist);
    },
    async getArtistTracks(artistId: string, limit: number, _artistName?: string): Promise<UnifiedTrack[]> {
      if (client.status !== 'connected') return [];
      type Page = { tracks?: YTrack[]; pager?: { total: number } };
      const pagePath = (page: number) =>
        `/artists/${encodeURIComponent(artistId)}/tracks?page=${page}&page-size=${ARTIST_TRACKS_PAGE}`;
      const first = await client.get<Page>(pagePath(0));
      const tracks = (first.tracks ?? []).map(mapTrack);
      const perPage = Math.max(first.tracks?.length ?? 0, 1);
      const total = Math.min(first.pager?.total ?? tracks.length, limit);
      const pages = Math.ceil(total / perPage);
      for (let start = 1; start < pages; start += 5) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(5, pages - start) }, (_, i) =>
            client.get<Page>(pagePath(start + i)).catch(() => ({ tracks: [] }) as Page),
          ),
        );
        for (const page of batch) tracks.push(...(page.tracks ?? []).map(mapTrack));
      }
      const seen = new Set<string>();
      return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, limit);
    },
    async resolvePlayback(track: UnifiedTrack, options?: { quality?: Quality }): Promise<PlaybackHandle> {
      if (client.status !== 'connected') {
        throw new Error('Войдите в Яндекс Музыку заново в Настройках (нужен музыкальный токен)');
      }
      const trackId = trackBaseId(track.id);
      const quality = options?.quality ?? 'high';
      const errors: string[] = [];

      if (isCatalogTrackId(trackId)) {
        try {
          const handle = await resolveViaFileInfo(client, trackId, quality);
          if (!handle.preview) return handle;
          errors.push('get-file-info: только превью');
          const fallback = await resolveViaDownloadInfo(client, trackId).catch(() => null);
          return fallback && !fallback.preview ? fallback : handle;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      try {
        return await resolveViaDownloadInfo(client, trackId);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      throw new Error(`Не удалось получить ссылку на трек (${errors.join('; ')})`);
    },
  };
}
