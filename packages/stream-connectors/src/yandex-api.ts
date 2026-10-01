import { createHmac } from 'node:crypto';
import type {
  AlbumWithTracks,
  ArtistProfile,
  ExternalAccount,
  FeedBlock,
  FeedItem,
  PlaybackReport,
  PlaylistWithTracks,
  TrackLyrics,
  UnifiedAlbum,
  UnifiedPlaylist,
  UnifiedTrack,
  WaveBatch,
  WaveFeedbackType,
  WaveSettings,
} from '@mss/shared';
import { parseLrc } from './lyrics.js';
import { ANDROID_SIGN_KEY, YandexApiError, type YandexClient } from './yandex-client.js';
import {
  mapAlbum,
  mapArtist,
  mapPlaylist,
  mapTrack,
  trackBaseId,
  trackKey,
  type YAlbum,
  type YArtist,
  type YPlaylist,
  type YTrack,
} from './yandex-mappers.js';

const TRACKS_BATCH = 200;

interface RotorResponse {
  radioSessionId?: string;
  batchId: string;
  sequence?: { track?: YTrack }[];
}

function signTrack(trackId: string): { ts: number; sign: string } {
  const ts = Math.floor(Date.now() / 1000);
  const sign = createHmac('sha256', ANDROID_SIGN_KEY)
    .update(`${trackBaseId(trackId)}${ts}`)
    .digest('base64');
  return { ts, sign };
}

function waveSeeds(settings?: WaveSettings): string[] {
  const seeds = [settings?.seed || 'user:onyourwave'];
  if (settings?.diversity) seeds.push(`settingDiversity:${settings.diversity}`);
  if (settings?.moodEnergy) seeds.push(`settingMoodEnergy:${settings.moodEnergy}`);
  if (settings?.language) seeds.push(`settingLanguage:${settings.language}`);
  return seeds;
}

const LIKED_IDS_TTL_MS = 90_000;

export class YandexMusicApi {
  constructor(private readonly client: YandexClient) {}

  private likedIdsCache: { ids: string[]; fetchedAt: number } | null = null;
  private likedIdsInflight: Promise<string[]> | null = null;

  private invalidateLikedIdsCache(): void {
    this.likedIdsCache = null;
  }

  account(refresh = false): Promise<ExternalAccount | null> {
    if (!refresh && this.client.cachedAccount) return Promise.resolve(this.client.cachedAccount);
    return this.client.fetchAccount();
  }

  async tracks(ids: string[]): Promise<UnifiedTrack[]> {
    const out: UnifiedTrack[] = [];
    for (let i = 0; i < ids.length; i += TRACKS_BATCH) {
      const chunk = ids.slice(i, i + TRACKS_BATCH);
      const data = await this.client.postForm<YTrack[]>('/tracks', {
        'track-ids': chunk.join(','),
        'with-positions': 'false',
      });
      out.push(...data.map(mapTrack));
    }
    return out;
  }

  // --- Лайки ---

  async likedTrackIds(): Promise<string[]> {
    const now = Date.now();
    if (this.likedIdsCache && now - this.likedIdsCache.fetchedAt < LIKED_IDS_TTL_MS) {
      return this.likedIdsCache.ids;
    }
    if (this.likedIdsInflight) return this.likedIdsInflight;
    this.likedIdsInflight = (async () => {
      const uid = await this.client.uid();
      const data = await this.client.get<{ library?: { tracks?: { id: string | number }[] } }>(
        `/users/${uid}/likes/tracks`,
      );
      const ids = (data.library?.tracks ?? []).map((t) => String(t.id));
      this.likedIdsCache = { ids, fetchedAt: Date.now() };
      return ids;
    })().finally(() => {
      this.likedIdsInflight = null;
    });
    return this.likedIdsInflight;
  }

  async likedTracks(limit = 1000): Promise<UnifiedTrack[]> {
    const ids = (await this.likedTrackIds()).slice(0, limit);
    return this.tracks(ids);
  }

  async setLike(track: Pick<UnifiedTrack, 'id' | 'albumId'>, liked: boolean): Promise<void> {
    const uid = await this.client.uid();
    await this.client.postForm(`/users/${uid}/likes/tracks/${liked ? 'add-multiple' : 'remove'}`, {
      'track-ids': trackKey(track),
    });
    this.invalidateLikedIdsCache();
  }

  async likedAlbums(limit = 200): Promise<UnifiedAlbum[]> {
    const uid = await this.client.uid();
    const data = await this.client.get<Array<{ album?: YAlbum } & Partial<YAlbum>>>(
      `/users/${uid}/likes/albums`,
    );
    const rows = Array.isArray(data) ? data : [];
    const albums = rows
      .map((row) => row.album ?? (row.title ? row : undefined))
      .filter((a): a is YAlbum => !!a?.title);
    return albums.slice(0, limit).map(mapAlbum);
  }

  async setAlbumLike(albumId: string, liked: boolean): Promise<void> {
    const uid = await this.client.uid();
    await this.client.postForm(`/users/${uid}/likes/albums/${liked ? 'add-multiple' : 'remove'}`, {
      'album-ids': albumId,
    });
  }

  async dislike(track: Pick<UnifiedTrack, 'id' | 'albumId'>): Promise<void> {
    const uid = await this.client.uid();
    await this.client.postForm(`/users/${uid}/dislikes/tracks/add-multiple`, {
      'track-ids': trackKey(track),
    });
  }

  // --- Плейлисты ---

  async playlists(): Promise<UnifiedPlaylist[]> {
    const uid = await this.client.uid();
    const [own, liked] = await Promise.all([
      this.client.get<YPlaylist[]>(`/users/${uid}/playlists/list`),
      this.client
        .get<{ playlist?: YPlaylist }[]>(`/users/${uid}/likes/playlists`)
        .catch(() => [] as { playlist?: YPlaylist }[]),
    ]);
    const all = [...own, ...liked.map((l) => l.playlist).filter((p): p is YPlaylist => Boolean(p))];
    const seen = new Set<string>();
    return all.map(mapPlaylist).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }

  async playlist(id: string): Promise<PlaylistWithTracks> {
    const [ownerUid, kind] = id.split(':');
    const data = await this.client.get<YPlaylist>(`/users/${ownerUid}/playlists/${kind}`);
    const entries = data.tracks ?? [];
    const rich = entries.filter((e) => e.track).map((e) => mapTrack(e.track!));
    const missing = entries.filter((e) => !e.track).map((e) => String(e.id));
    const tracks = missing.length ? [...rich, ...(await this.tracks(missing))] : rich;
    return { ...mapPlaylist(data), tracks };
  }

  // --- Альбомы и исполнители ---

  async album(id: string): Promise<AlbumWithTracks> {
    const data = await this.client.get<YAlbum & { description?: string; shortDescription?: string }>(
      `/albums/${id}/with-tracks`,
    );
    const tracks = (data.volumes ?? []).flat().map(mapTrack);
    const label = data.labels?.map((l) => (typeof l === 'string' ? l : l.name)).join(', ');
    const description = [data.description, data.shortDescription].find((d) => typeof d === 'string' && d.trim());
    return {
      ...mapAlbum(data),
      tracks,
      label: label || undefined,
      description: description?.trim(),
      durationMs: tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0),
    };
  }

  async artistProfile(id: string): Promise<ArtistProfile> {
    const [brief, direct] = await Promise.all([
      this.client.get<{
        artist: YArtist & { description?: { text?: string } | string };
        popularTracks?: YTrack[];
        albums?: YAlbum[];
        similarArtists?: YArtist[];
        stats?: { lastMonthListeners?: number };
      }>(`/artists/${id}/brief-info`),
      this.client
        .get<{ albums?: YAlbum[] }>(`/artists/${id}/direct-albums?page=0&page-size=100&sort-by=year`)
        .catch(() => ({ albums: [] as YAlbum[] })),
    ]);
    const releases = (direct.albums?.length ? direct.albums : (brief.albums ?? [])).map(mapAlbum);
    releases.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    const about = brief.artist.description;
    const description = (typeof about === 'string' ? about : about?.text)?.trim() || undefined;
    return {
      artist: {
        ...mapArtist(brief.artist),
        monthlyListeners: brief.stats?.lastMonthListeners,
        description,
      },
      popularTracks: (brief.popularTracks ?? []).map(mapTrack),
      albums: releases.filter((a) => a.type !== 'single'),
      singles: releases.filter((a) => a.type === 'single'),
      similar: (brief.similarArtists ?? []).map(mapArtist),
    };
  }

  // --- Поиск ---

  async searchAlbums(query: string, limit = 20): Promise<UnifiedAlbum[]> {
    const data = await this.client.get<{ albums?: { results?: YAlbum[] } }>(
      `/search?text=${encodeURIComponent(query)}&type=album&page=0&pageSize=${limit}`,
    );
    return (data.albums?.results ?? []).slice(0, limit).map(mapAlbum);
  }

  async searchPlaylists(query: string, limit = 20): Promise<UnifiedPlaylist[]> {
    const data = await this.client.get<{ playlists?: { results?: YPlaylist[] } }>(
      `/search?text=${encodeURIComponent(query)}&type=playlist&page=0&pageSize=${limit}`,
    );
    return (data.playlists?.results ?? []).slice(0, limit).map(mapPlaylist);
  }

  async suggest(part: string): Promise<string[]> {
    const data = await this.client.get<{ suggestions?: string[] }>(`/search/suggest?part=${encodeURIComponent(part)}`);
    return (data.suggestions ?? []).slice(0, 8);
  }

  // --- Похожие ---

  async similarTracks(trackId: string): Promise<UnifiedTrack[]> {
    const data = await this.client.get<{ similarTracks?: YTrack[] }>(
      `/tracks/${encodeURIComponent(trackBaseId(trackId))}/similar`,
    );
    return (data.similarTracks ?? []).map(mapTrack);
  }

  // --- Тексты ---

  async lyrics(trackId: string): Promise<TrackLyrics | null> {
    const baseId = trackBaseId(trackId);
    const load = async (format: 'LRC' | 'TEXT') => {
      const { ts, sign } = signTrack(trackId);
      const info = await this.client.get<{ downloadUrl: string; writers?: string[] }>(
        `/tracks/${encodeURIComponent(baseId)}/lyrics?format=${format}&timeStamp=${ts}&sign=${encodeURIComponent(sign)}`,
      );
      const res = await fetch(info.downloadUrl);
      if (!res.ok) throw new YandexApiError(res.status, 'lyrics download failed');
      return { text: await res.text(), writers: info.writers };
    };
    try {
      const { text, writers } = await load('LRC');
      const lines = parseLrc(text);
      if (lines.length) return { synced: true, lines, writers };
    } catch (e) {
      if (!(e instanceof YandexApiError) || (e.status !== 404 && e.status !== 400)) throw e;
    }
    try {
      const { text, writers } = await load('TEXT');
      return {
        synced: false,
        lines: text.split(/\r?\n/).map((line) => ({ timeMs: -1, text: line })),
        writers,
      };
    } catch (e) {
      if (e instanceof YandexApiError && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }
  }

  // --- Главная ---

  async feed(): Promise<FeedBlock[]> {
    type Entity = { type: string; data: Record<string, unknown> };
    const data = await this.client.get<{
      blocks?: { id: string; type: string; title: string; entities?: Entity[] }[];
    }>('/landing3?blocks=personalplaylists,new-releases,new-playlists,chart');

    const toItem = (e: Entity): FeedItem | null => {
      switch (e.type) {
        case 'personal-playlist': {
          const inner = (e.data as { data?: YPlaylist }).data;
          return inner ? { kind: 'playlist', playlist: mapPlaylist(inner) } : null;
        }
        case 'playlist':
          return { kind: 'playlist', playlist: mapPlaylist(e.data as unknown as YPlaylist) };
        case 'album':
          return { kind: 'album', album: mapAlbum(e.data as unknown as YAlbum) };
        case 'chart-item': {
          const track = (e.data as { track?: YTrack }).track;
          return track ? { kind: 'track', track: mapTrack(track) } : null;
        }
        default:
          return null;
      }
    };

    return (data.blocks ?? [])
      .map((b) => ({
        id: b.id || b.type,
        title: b.title,
        items: (b.entities ?? []).map(toItem).filter((x): x is FeedItem => x !== null),
      }))
      .filter((b) => b.items.length > 0);
  }

  async chart(): Promise<UnifiedTrack[]> {
    const data = await this.client.get<{ chart?: { tracks?: { track?: YTrack }[] } }>('/landing3/chart');
    return (data.chart?.tracks ?? []).flatMap((t) => (t.track ? [mapTrack(t.track)] : []));
  }

  // --- Моя волна ---

  private toBatch(data: RotorResponse, sessionId: string): WaveBatch {
    return {
      sessionId: data.radioSessionId ?? sessionId,
      batchId: data.batchId,
      tracks: (data.sequence ?? []).flatMap((s) => (s.track ? [mapTrack(s.track)] : [])),
    };
  }

  async waveStart(settings?: WaveSettings): Promise<WaveBatch> {
    const data = await this.client.postJson<RotorResponse>('/rotor/session/new', {
      seeds: waveSeeds(settings),
      includeTracksInResponse: true,
    });
    const batch = this.toBatch(data, '');
    void this.waveFeedback(batch.sessionId, batch.batchId, 'radioStarted').catch(() => undefined);
    return batch;
  }

  async waveMore(sessionId: string, queue: string[]): Promise<WaveBatch> {
    const data = await this.client.postJson<RotorResponse>(`/rotor/session/${sessionId}/tracks`, {
      queue,
    });
    return this.toBatch(data, sessionId);
  }

  async waveFeedback(
    sessionId: string,
    batchId: string,
    type: WaveFeedbackType,
    track?: Pick<UnifiedTrack, 'id' | 'albumId'>,
    totalPlayedSeconds?: number,
  ): Promise<void> {
    const event: Record<string, unknown> = { type, timestamp: new Date().toISOString() };
    if (track) event.trackId = trackKey(track);
    if (totalPlayedSeconds !== undefined) event.totalPlayedSeconds = Math.round(totalPlayedSeconds);
    await this.client.postJson(`/rotor/session/${sessionId}/feedback`, { event, batchId });
  }

  // --- История прослушиваний ---

  async reportPlay(report: PlaybackReport): Promise<void> {
    const uid = await this.client.uid();
    const now = new Date().toISOString();
    await this.client.postForm('/play-audio', {
      'track-id': trackBaseId(report.trackId),
      'album-id': report.albumId ?? '',
      'from-cache': 'false',
      from: 'mss-desktop',
      'play-id': '',
      uid,
      timestamp: now,
      'track-length-seconds': String(Math.round(report.trackLengthSeconds)),
      'total-played-seconds': String(Math.round(report.totalPlayedSeconds)),
      'end-position-seconds': String(Math.round(report.endPositionSeconds)),
      'client-now': now,
    });
  }
}
