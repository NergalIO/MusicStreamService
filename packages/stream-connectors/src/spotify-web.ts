import type {
  AlbumWithTracks,
  ArtistProfile,
  HomeFeedItem,
  HomeFeedSection,
  PlaybackHandle,
  PlaylistWithTracks,
  UnifiedAlbum,
  UnifiedArtist,
  UnifiedPlaylist,
  UnifiedTrack,
} from '@mss/shared';
import type { StreamConnector } from './types.js';

/**
 * Каталог Spotify через GraphQL веб-плеера (api-partner.spotify.com/pathfinder).
 * Публичный Web API отвечает 429 на токен open.spotify.com, а pathfinder — тот же канал,
 * которым пользуется сам веб-плеер. Хеши persisted queries хост берёт из бандла плеера.
 */
export type PathfinderQuery = (operationName: string, variables: Record<string, unknown>) => Promise<unknown>;

/** GET к spclient.wg.spotify.com от имени веб-плеера (путь начинается с `/`). */
export type SpclientGet = (path: string) => Promise<unknown>;

export interface SpotifyWebConnectorOptions {
  query: PathfinderQuery;
  spclient: SpclientGet;
  timeZone?: string;
  loggedIn: () => boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setLike?: (uri: string, liked: boolean) => Promise<{ ok: boolean; error?: string }>;
}

// Ответы pathfinder — глубокие и меняющиеся структуры; читаем их по одному полю.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const PLAYLIST_PAGE = 100;
const LIBRARY_PAGE = 50;
const LIBRARY_MAX = 2000;
const MAX_PLAYLIST_TRACKS = 2000;

function idFromUri(uri: string | undefined): string | undefined {
  return uri?.split(':').pop();
}

function bestImage(sources: Json): string | undefined {
  if (!Array.isArray(sources) || !sources.length) return undefined;
  const sorted = [...sources].sort((a, b) => (b?.width ?? 0) - (a?.width ?? 0));
  return sorted[0]?.url ?? sources[0]?.url;
}

export function mapPathfinderTrack(d: Json, fallbackCover?: string): UnifiedTrack | null {
  const uri: string | undefined = d?.uri ?? d?._uri;
  if (!uri?.startsWith('spotify:track:') || !d?.name) return null;
  const artists = ((d.artists?.items ?? []) as Json[])
    .map((a) => ({ id: idFromUri(a?.uri) ?? '', name: a?.profile?.name as string }))
    .filter((a) => a.name);
  const playable = d.playability?.playable !== false;
  return {
    source: 'spotify',
    id: idFromUri(uri)!,
    title: d.name,
    artist: artists.map((a) => a.name).join(', '),
    artists,
    album: d.albumOfTrack?.name,
    albumId: idFromUri(d.albumOfTrack?.uri),
    durationMs: d.duration?.totalMilliseconds ?? d.trackDuration?.totalMilliseconds,
    coverUrl: bestImage(d.albumOfTrack?.coverArt?.sources) ?? fallbackCover,
    explicit: d.contentRating?.label === 'EXPLICIT',
    playable,
    unplayableReason: playable ? undefined : 'Трек недоступен в Spotify',
  };
}

function compact<T>(list: (T | null | undefined)[]): T[] {
  return list.filter((x): x is T => x != null);
}

function artistRefs(items: Json): { id: string; name: string }[] {
  return ((items ?? []) as Json[])
    .map((a) => ({ id: a?.id ?? idFromUri(a?.uri) ?? '', name: a?.profile?.name as string }))
    .filter((a) => a.name);
}

const ALBUM_TYPES: Record<string, string> = { SINGLE: 'single', EP: 'single', COMPILATION: 'compilation' };

function mapAlbum(d: Json): UnifiedAlbum | null {
  const id = idFromUri(d?.uri);
  if (!id || !d?.uri?.startsWith('spotify:album:') || !d?.name) return null;
  const artists = artistRefs(d.artists?.items);
  const year = Number(d.date?.isoString?.slice(0, 4)) || d.date?.year || undefined;
  return {
    source: 'spotify',
    id,
    title: d.name,
    artist: artists.map((a) => a.name).join(', '),
    artists,
    year,
    coverUrl: bestImage(d.coverArt?.sources),
    trackCount: d.tracksV2?.totalCount ?? d.tracks?.totalCount,
    type: ALBUM_TYPES[d.albumType ?? d.type] ?? 'album',
  };
}

function mapPlaylist(d: Json): UnifiedPlaylist | null {
  const uri: string | undefined = d?.uri;
  if (!uri?.startsWith('spotify:playlist:') || !d?.name) return null;
  return {
    source: 'spotify',
    id: idFromUri(uri)!,
    title: d.name,
    owner: d.ownerV2?.data?.name,
    description: typeof d.description === 'string' ? d.description.replace(/<[^>]+>/g, '') || undefined : undefined,
    coverUrl: bestImage(d.images?.items?.[0]?.sources),
    trackCount: d.content?.totalCount,
  };
}

function mapArtist(d: Json): UnifiedArtist | null {
  const id = idFromUri(d?.uri);
  if (!id || !d?.uri?.startsWith('spotify:artist:') || !d?.profile?.name) return null;
  return { source: 'spotify', id, name: d.profile.name, imageUrl: bestImage(d.visuals?.avatarImage?.sources) };
}

function mapHomeItem(content: Json): HomeFeedItem | null {
  const d = content?.data;
  switch (content?.__typename) {
    case 'AlbumResponseWrapper': {
      const album = mapAlbum(d);
      return album && { kind: 'album', album };
    }
    case 'PlaylistResponseWrapper': {
      const playlist = mapPlaylist(d);
      return playlist && { kind: 'playlist', playlist };
    }
    case 'ArtistResponseWrapper': {
      const artist = mapArtist(d);
      return artist && { kind: 'artist', artist };
    }
    default:
      return null;
  }
}

export function createSpotifyWebConnector(opts: SpotifyWebConnectorOptions): StreamConnector {
  const { query, loggedIn } = opts;

  /** Библиотека отдаётся страницами: без дочитывания у пользователя пропадало всё после первых 50. */
  async function libraryItems(filter: string, flatten: boolean): Promise<Json[]> {
    const PAGE = LIBRARY_PAGE;
    const items: Json[] = [];
    for (let offset = 0; offset < LIBRARY_MAX; offset += PAGE) {
      const data: Json = await query('libraryV3', {
        filters: [filter],
        order: null,
        textFilter: '',
        features: ['LIKED_SONGS', 'YOUR_EPISODES'],
        limit: PAGE,
        offset,
        flatten,
        expandedFolders: [],
        folderUri: null,
        includeFoldersWhenFlattening: !flatten,
      });
      const library = data?.data?.me?.libraryV3;
      const page: Json[] = library?.items ?? [];
      items.push(...page);
      if (page.length < PAGE || items.length >= (library?.totalCount ?? items.length)) break;
    }
    return items;
  }

  async function playlistWithTracks(id: string): Promise<PlaylistWithTracks> {
    const tracks: UnifiedTrack[] = [];
    let meta: Json = null;
    for (let offset = 0; offset < MAX_PLAYLIST_TRACKS; offset += PLAYLIST_PAGE) {
      const data: Json = await query('fetchPlaylist', {
        uri: `spotify:playlist:${id}`,
        offset,
        limit: PLAYLIST_PAGE,
        enableWatchFeedEntrypoint: false,
        includeEpisodeContentRatingsV2: false,
      });
      const p = data?.data?.playlistV2;
      if (!p) throw new Error('Плейлист Spotify не найден');
      meta ??= p;
      const items: Json[] = p.content?.items ?? [];
      tracks.push(...compact(items.map((row) => mapPathfinderTrack(row?.itemV2?.data))));
      if (items.length < PLAYLIST_PAGE || offset + PLAYLIST_PAGE >= (p.content?.totalCount ?? 0)) break;
    }
    return {
      ...(mapPlaylist({ ...meta, uri: `spotify:playlist:${id}` }) ?? { source: 'spotify', id, title: 'Плейлист' }),
      trackCount: meta?.content?.totalCount,
      tracks,
    };
  }

  async function searchTracks(q: string, limit: number): Promise<UnifiedTrack[]> {
    const data: Json = await query('searchTracks', {
      searchTerm: q,
      offset: 0,
      limit: Math.min(Math.max(limit, 1), 50),
      numberOfTopResults: 20,
      includeAudiobooks: false,
      includePreReleases: false,
      includeAlbumPreReleases: false,
      includeAuthors: false,
      includeEpisodeContentRatingsV2: false,
    });
    const items: Json[] = data?.data?.searchV2?.tracksV2?.items ?? [];
    return compact(items.map((row) => mapPathfinderTrack(row?.item?.data)));
  }

  async function savedTracks(limit: number): Promise<UnifiedTrack[]> {
    const out: UnifiedTrack[] = [];
    for (let offset = 0; out.length < limit; offset += LIBRARY_PAGE) {
      const data: Json = await query('fetchLibraryTracks', { offset, limit: LIBRARY_PAGE });
      const page = data?.data?.me?.library?.tracks;
      const items: Json[] = page?.items ?? [];
      out.push(...compact(items.map((row) => mapPathfinderTrack({ ...row?.track?.data, uri: row?.track?._uri }))));
      if (items.length < LIBRARY_PAGE || offset + LIBRARY_PAGE >= (page?.totalCount ?? 0)) break;
    }
    return out.slice(0, limit);
  }

  return {
    id: 'spotify',
    displayName: 'Spotify',
    getAuthStatus: () => (loggedIn() ? 'connected' : 'disconnected'),
    connect: opts.connect,
    disconnect: opts.disconnect,
    search: searchTracks,
    async searchArtists(q: string, limit: number): Promise<UnifiedArtist[]> {
      const data: Json = await query('searchArtists', {
        searchTerm: q,
        offset: 0,
        limit: Math.min(Math.max(limit, 1), 50),
        numberOfTopResults: 5,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAuthors: false,
      });
      const items: Json[] = data?.data?.searchV2?.artists?.items ?? [];
      return compact(
        items.map((row) => {
          const a = row?.data;
          const id = idFromUri(a?.uri);
          if (!id || !a?.profile?.name) return null;
          return {
            source: 'spotify' as const,
            id,
            name: a.profile.name as string,
            imageUrl: bestImage(a.visuals?.avatarImage?.sources),
          };
        }),
      );
    },
    async getArtistTracks(artistId: string, limit: number, artistName?: string): Promise<UnifiedTrack[]> {
      const data: Json = await query('queryArtistOverview', {
        uri: `spotify:artist:${artistId}`,
        locale: '',
        preReleaseV2: false,
      });
      const top: Json[] = data?.data?.artistUnion?.discography?.topTracks?.items ?? [];
      const byTitle = new Map<string, UnifiedTrack>();
      const add = (t: UnifiedTrack) => {
        const key = t.title.toLowerCase().replace(/\s*[([].*$/, '').trim();
        if (!byTitle.has(key)) byTitle.set(key, t);
      };
      compact(top.map((row) => mapPathfinderTrack(row?.track))).forEach(add);
      const name = artistName ?? data?.data?.artistUnion?.profile?.name;
      if (name && byTitle.size < limit) {
        const found = await searchTracks(name, 50).catch(() => []);
        for (const t of found) {
          if (byTitle.size >= limit) break;
          if (t.artists?.some((a) => a.id === artistId)) add(t);
        }
      }
      return [...byTitle.values()].slice(0, limit);
    },
    async getArtistProfile(artistId: string): Promise<ArtistProfile> {
      const data: Json = await query('queryArtistOverview', {
        uri: `spotify:artist:${artistId}`,
        locale: '',
        preReleaseV2: false,
      });
      const a = data?.data?.artistUnion;
      if (!a?.profile?.name) throw new Error('Исполнитель Spotify не найден');
      const name: string = a.profile.name;
      const bio: string | undefined = a.profile.biography?.text;
      const d = a.discography ?? {};
      const releases = (block: Json): UnifiedAlbum[] =>
        compact(
          ((block?.items ?? []) as Json[]).flatMap((row) => {
            const nested: Json[] | undefined = row?.releases?.items;
            return (nested ?? [row]).map((r) => {
              const album = mapAlbum(r);
              return album && { ...album, artist: album.artist || name };
            });
          }),
        );
      const seen = new Set<string>();
      const unique = (list: UnifiedAlbum[]) => list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
      const albums = unique([...releases(d.popularReleasesAlbums), ...releases(d.albums), ...releases(d.compilations)]);
      const singles = unique(releases(d.singles));
      const related: Json[] = a.relatedContent?.relatedArtists?.items ?? [];
      return {
        artist: {
          source: 'spotify',
          id: idFromUri(a.uri) ?? artistId,
          name,
          imageUrl: bestImage(a.visuals?.avatarImage?.sources),
          followers: a.stats?.followers ?? undefined,
          monthlyListeners: a.stats?.monthlyListeners ?? undefined,
          description: bio ? bio.replace(/<[^>]+>/g, '').trim() || undefined : undefined,
        },
        popularTracks: compact(((d.topTracks?.items ?? []) as Json[]).map((row) => mapPathfinderTrack(row?.track))),
        albums,
        singles,
        similar: compact(related.map(mapArtist)),
      };
    },
    async listPlaylists(): Promise<UnifiedPlaylist[]> {
      const items = await libraryItems('Playlists', true);
      return compact(items.map((row) => mapPlaylist({ ...row?.item?.data, uri: row?.item?.data?.uri ?? row?.item?._uri })));
    },
    getPlaylist: playlistWithTracks,
    async getFavoriteArtists(): Promise<UnifiedArtist[]> {
      const items = await libraryItems('Artists', false);
      return compact(items.map((row) => mapArtist({ ...row?.item?.data, uri: row?.item?.data?.uri ?? row?.item?._uri })));
    },
    async getHomeFeed(): Promise<HomeFeedSection[]> {
      const data: Json = await query('home', {
        homeEndUserIntegration: 'INTEGRATION_WEB_PLAYER',
        timeZone: opts.timeZone ?? 'UTC',
        sp_t: '',
        facet: '',
        sectionItemsLimit: 12,
      });
      const sections: Json[] = data?.data?.home?.sectionContainer?.sections?.items ?? [];
      return compact(
        sections.map((s, i) => {
          const items = compact(((s?.sectionItems?.items ?? []) as Json[]).map((it) => mapHomeItem(it?.content)));
          const title: string | undefined = s?.data?.title?.transformedLabel ?? s?.data?.title?.text;
          if (!title || !items.length) return null;
          return { id: s?.uri ?? `section-${i}`, title, items };
        }),
      );
    },
    async getAlbum(id: string): Promise<AlbumWithTracks> {
      const PAGE = 50;
      const data: Json = await query('getAlbum', { uri: `spotify:album:${id}`, locale: '', offset: 0, limit: PAGE });
      const a = data?.data?.albumUnion;
      const album = mapAlbum({ ...a, uri: `spotify:album:${id}` });
      if (!a || !album) throw new Error('Альбом Spotify не найден');
      const rows: Json[] = [...((a.tracksV2?.items ?? []) as Json[])];
      const total: number = a.tracksV2?.totalCount ?? rows.length;
      // Длинные альбомы приходят страницами: без дочитывания у сборников пропадал хвост треков.
      while (rows.length < total && rows.length > 0) {
        const page: Json = await query('getAlbum', {
          uri: `spotify:album:${id}`,
          locale: '',
          offset: rows.length,
          limit: PAGE,
        });
        const next: Json[] = page?.data?.albumUnion?.tracksV2?.items ?? [];
        if (!next.length) break;
        rows.push(...next);
      }
      const tracks = compact(
        rows.map((row) =>
          mapPathfinderTrack(
            { ...row?.track, albumOfTrack: { name: album.title, uri: `spotify:album:${id}` } },
            album.coverUrl,
          ),
        ),
      );
      return {
        ...album,
        tracks,
        trackCount: total || tracks.length,
        durationMs: tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0),
        label: a.label || undefined,
        description:
          typeof a.description === 'string' ? a.description.replace(/<[^>]+>/g, '').trim() || undefined : undefined,
      };
    },
    async getTrackRadio(track: UnifiedTrack): Promise<PlaylistWithTracks> {
      const seed: Json = await opts.spclient(
        `/inspiredby-mix/v2/seed_to_playlist/spotify:track:${encodeURIComponent(track.id)}?response-format=json`,
      );
      const uri: string | undefined = seed?.mediaItems?.[0]?.uri;
      if (!uri?.startsWith('spotify:playlist:')) throw new Error('У этого трека нет радио в Spotify');
      return playlistWithTracks(idFromUri(uri)!);
    },
    getSavedTracks: savedTracks,
    getHomeTracks: (limit: number) => savedTracks(limit),
    async setSavedTrack(track: UnifiedTrack, saved: boolean): Promise<void> {
      const uri = `spotify:track:${track.id}`;
      if (opts.setLike) {
        const result = await opts.setLike(uri, saved);
        if (!result.ok) throw new Error(result.error === 'auth_missing' ? 'Войдите в Spotify' : 'Не удалось сохранить трек');
        return;
      }
      await query(saved ? 'addToLibrary' : 'removeFromLibrary', {
        libraryItemUris: [uri],
      });
    },
    async resolvePlayback(track: UnifiedTrack): Promise<PlaybackHandle> {
      if (!loggedIn()) throw new Error('Spotify не подключён');
      return { kind: 'spotifySdk', trackUri: `spotify:track:${track.id}` };
    },
  };
}
