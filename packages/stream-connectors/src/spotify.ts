import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type {
  ExternalAccount,
  PlaybackHandle,
  PlaylistWithTracks,
  UnifiedArtist,
  UnifiedPlaylist,
  UnifiedTrack,
} from '@mss/shared';
import type { StreamConnector, TokenVault } from './types.js';

const VAULT_KEY = 'spotify_tokens';
/** Меньше запросов к API — в Dev Mode общая квота на аккаунт разработчика. */
const MAX_ARTIST_ALBUMS = 12;
const MAX_PLAYLISTS = 100;
/** Dev Mode (Feb 2026+): GET /search limit max 10 — больше даёт 400 Invalid limit. */
const SPOTIFY_SEARCH_PAGE_MAX = 10;
/** Dev Mode: GET /artists/{id}/albums limit max 10 на части инстансов. */
const SPOTIFY_ARTIST_ALBUMS_PAGE_MAX = 10;
const SPOTIFY_SCOPES =
  'user-read-email streaming user-modify-playback-state user-read-playback-state user-library-read playlist-read-private playlist-read-collaborative user-top-read';

/** Web Playback SDK требует scope `streaming` в access token. */
export const SPOTIFY_MISSING_STREAMING_MSG =
  'В токене Spotify нет права streaming (Invalid token scopes). ' +
  'Настройки MSS → отключите Spotify → на https://open.spotify.com/account/apps удалите это приложение → подключите Spotify снова и подтвердите все галочки. ' +
  'Premium нужен на том аккаунте, которым вы слушаете, не только у владельца приложения в Dashboard.';

function hasStreamingScope(scope?: string): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes('streaming');
}

function assertStreamingScope(scope: string | undefined, clearVault: () => void): void {
  if (hasStreamingScope(scope)) return;
  clearVault();
  throw new Error(SPOTIFY_MISSING_STREAMING_MSG);
}

function clampLimit(limit: number, max = 50): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return Math.min(50, max);
  return Math.min(Math.floor(n), max);
}

function limitParam(limit: number, max = 50): string {
  return String(clampLimit(limit, max));
}

interface SpotifyAlbum {
  id: string;
  name: string;
  images: { url: string }[];
}

interface SpotifyAlbumTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  duration_ms: number;
  preview_url: string | null;
}

interface SpotifyTrack extends SpotifyAlbumTrack {
  album: SpotifyAlbum;
}

interface SpotifyArtist {
  id: string;
  name: string;
  images?: { url: string }[];
  genres?: string[];
  followers?: { total: number };
}

interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  owner: { display_name?: string };
  /** Legacy field (pre–Feb 2026). */
  tracks?: { total: number };
  /** Dev-mode API (Feb 2026+). */
  items?: { total: number };
  images: { url: string }[];
}

function playlistItemCount(p: SpotifyPlaylistSummary): number | undefined {
  return p.tracks?.total ?? p.items?.total;
}

function spotifyApiErrorMessage(status: number, raw: string, _path: string): string {
  let apiMessage = '';
  let apiReason = '';
  try {
    const j = JSON.parse(raw) as { error?: { message?: string; reason?: string } };
    apiMessage = j.error?.message ?? '';
    apiReason = j.error?.reason ?? '';
  } catch {
    apiMessage = raw.trim();
  }
  const detail = `${apiMessage} ${apiReason} ${raw}`;
  if (status === 401) return 'Сессия Spotify истекла — отключите и подключите снова в настройках';
  if (status === 403) {
    if (/top-tracks|top tracks/i.test(`${_path} ${detail}`)) {
      return (
        'Spotify убрал GET /artists/{id}/top-tracks в Development Mode (2026). Приложение использует поиск и альбомы; обновите desktop до последней версии.'
      );
    }
    if (/premium subscription required|active premium/i.test(detail)) {
      return (
        'Spotify блокирует Web API для приложений в Development Mode: у аккаунта-владельца приложения в developer.spotify.com/dashboard должен быть активный Spotify Premium. ' +
        'Это не ваш аккаунт в MSS, а тот Spotify-логин, под которым создано приложение «Music Stream». После оформления или продления Premium подождите несколько часов, затем перезапустите desktop. Allowlist и переподключение в приложении сами по себе не снимут эту ошибку.'
      );
    }
    if (/scope|permission|insufficient/i.test(detail)) {
      return 'Недостаточно прав Spotify. Отключите и подключите аккаунт заново, подтвердив доступ к библиотеке и плейлистам.';
    }
    if (/allowlist|not allowed|user management/i.test(detail)) {
      return (
        'Spotify отклонил запрос: добавьте свой аккаунт в User Management (developer.spotify.com/dashboard → приложение → User Management). В dev-mode API доступен только allowlist (до 5 пользователей).'
      );
    }
    return (
      'Spotify вернул 403 Forbidden. Проверьте Premium у владельца приложения в Dashboard, allowlist в User Management и scopes при подключении.' +
      (apiReason ? ` (${apiReason})` : apiMessage && apiMessage !== 'Forbidden' ? ` (${apiMessage})` : '')
    );
  }
  if (status === 400 && /invalid limit/i.test(detail)) {
    return `Spotify: некорректный limit (Dev Mode: search ≤ ${SPOTIFY_SEARCH_PAGE_MAX}). Обновите приложение.`;
  }
  if (status === 429 || apiReason === 'QUOTA_EXCEEDED' || /QUOTA_EXCEEDED/i.test(detail)) {
    return (
      'Исчерпана месячная квота Spotify Web API (Development Mode на аккаунте разработчика). ' +
      'Подождите сброса квоты или запросите Extended Quota в developer.spotify.com/dashboard → приложение → Extension Request. ' +
      'Пока квота исчерпана, воспроизведение и загрузка каталога Spotify недоступны.'
    );
  }
  if (status === 429) {
    return 'Spotify просит подождать (rate limit). Повторите через минуту.';
  }
  return apiReason || apiMessage || raw || `Spotify API ${status}`;
}

interface SpotifyPlaylistFull extends SpotifyPlaylistSummary {
  external_urls?: { spotify?: string };
}

function mapSpotifyTrack(t: SpotifyTrack): UnifiedTrack {
  const album = t.album;
  return {
    source: 'spotify',
    id: t.id,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    album: album?.name,
    durationMs: t.duration_ms,
    coverUrl: album?.images?.[0]?.url,
    // Premium / Web Playback SDK; preview — запасной вариант в resolvePlayback.
    playable: true,
    unplayableReason: t.preview_url ? undefined : 'Полный трек — через Spotify Premium',
  };
}

interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
}

export interface SpotifyConnectorOptions {
  clientId: string;
  redirectPort?: number;
  openExternal: (url: string) => void;
  vault: TokenVault;
}

export function createSpotifyConnector(opts: SpotifyConnectorOptions): StreamConnector {
  const { clientId, redirectPort = 8765, openExternal, vault } = opts;

  function loadTokens(): SpotifyTokens | null {
    const raw = vault.get(VAULT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SpotifyTokens;
    } catch {
      return null;
    }
  }

  function saveTokens(t: SpotifyTokens): void {
    vault.set(VAULT_KEY, JSON.stringify(t));
  }

  async function refreshIfNeeded(): Promise<string | null> {
    const t = loadTokens();
    if (!t) return null;
    const accessFresh = Date.now() < t.expires_at - 60_000;
    if (accessFresh && t.scope) {
      assertStreamingScope(t.scope, () => vault.delete(VAULT_KEY));
      return t.access_token;
    }
    /* accessFresh без scope — обновим токен, чтобы прочитать scope из ответа Spotify. */
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
      client_id: clientId,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 401) vault.delete(VAULT_KEY);
      throw new Error(err || 'Не удалось обновить сессию Spotify — переподключите в настройках');
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
    };
    const scope = data.scope ?? t.scope;
    assertStreamingScope(scope, () => vault.delete(VAULT_KEY));
    const next: SpotifyTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? t.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      scope,
    };
    saveTokens(next);
    return next.access_token;
  }

  async function spotifyGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await refreshIfNeeded();
    if (!token) throw new Error('Spotify не подключён');
    const url = new URL(`https://api.spotify.com/v1${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(spotifyApiErrorMessage(res.status, err, path));
    }
    return (await res.json()) as T;
  }

  async function searchTrackItems(q: string, want: number): Promise<SpotifyTrack[]> {
    const cap = clampLimit(want, 50);
    const out: SpotifyTrack[] = [];
    for (let offset = 0; out.length < cap; offset += SPOTIFY_SEARCH_PAGE_MAX) {
      const pageLimit = Math.min(SPOTIFY_SEARCH_PAGE_MAX, cap - out.length);
      const data = await spotifyGet<{ tracks: { items: (SpotifyTrack | null)[] } }>('/search', {
        q,
        type: 'track',
        limit: limitParam(pageLimit, SPOTIFY_SEARCH_PAGE_MAX),
        offset: String(offset),
      });
      const batch = (data.tracks?.items ?? []).filter((t): t is SpotifyTrack => !!t?.id);
      out.push(...batch);
      if (batch.length < pageLimit) break;
    }
    return out;
  }

  async function searchArtistItems(q: string, want: number): Promise<SpotifyArtist[]> {
    const cap = clampLimit(want, 50);
    const out: SpotifyArtist[] = [];
    for (let offset = 0; out.length < cap; offset += SPOTIFY_SEARCH_PAGE_MAX) {
      const pageLimit = Math.min(SPOTIFY_SEARCH_PAGE_MAX, cap - out.length);
      const data = await spotifyGet<{ artists: { items: SpotifyArtist[] } }>('/search', {
        q,
        type: 'artist',
        limit: limitParam(pageLimit, SPOTIFY_SEARCH_PAGE_MAX),
        offset: String(offset),
      });
      const batch = data.artists?.items ?? [];
      out.push(...batch);
      if (batch.length < pageLimit) break;
    }
    return out;
  }

  return {
    id: 'spotify',
    displayName: 'Spotify',
    getAuthStatus() {
      const t = loadTokens();
      if (!t?.refresh_token) return 'disconnected';
      // access_token обновляется при запросах; наличие refresh = «подключён» для UI.
      return 'connected';
    },
    async connect() {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const state = randomBytes(16).toString('hex');
      const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;

      await new Promise<void>((resolve, reject) => {
        let server: Server;
        const timeout = setTimeout(() => {
          server?.close();
          reject(new Error('Spotify OAuth timeout'));
        }, 120_000);

        server = createServer(async (req, res) => {
          if (!req.url?.startsWith('/callback')) {
            res.writeHead(404);
            res.end();
            return;
          }
          const url = new URL(req.url, `http://127.0.0.1:${redirectPort}`);
          if (url.searchParams.get('state') !== state) {
            res.writeHead(400);
            res.end('Invalid state');
            return;
          }
          const code = url.searchParams.get('code');
          if (!code) {
            res.writeHead(400);
            res.end('No code');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body>OK, можно закрыть окно.</body></html>');
          clearTimeout(timeout);
          server.close();

          const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
          });
          let tokenRes: Response;
          try {
            tokenRes = await fetch('https://accounts.spotify.com/api/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body,
            });
          } catch (e) {
            reject(new Error(e instanceof Error ? e.message : 'Нет связи с accounts.spotify.com'));
            return;
          }
          if (!tokenRes.ok) {
            const err = await tokenRes.text().catch(() => '');
            reject(new Error(err || 'Token exchange failed'));
            return;
          }
          const data = (await tokenRes.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            scope?: string;
          };
          if (!data.refresh_token) {
            reject(new Error('Spotify не выдал refresh_token — удалите приложение на spotify.com/account/apps и подключите снова'));
            return;
          }
          try {
            assertStreamingScope(data.scope, () => vault.delete(VAULT_KEY));
          } catch (e) {
            reject(e);
            return;
          }
          saveTokens({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + data.expires_in * 1000,
            scope: data.scope,
          });
          resolve();
        });
        server.listen(redirectPort);

        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('code_challenge', challenge);
        // Иначе Spotify может выдать токен со старыми scopes без экрана согласия.
        authUrl.searchParams.set('show_dialog', 'true');
        openExternal(authUrl.toString());
      });
    },
    async disconnect() {
      vault.delete(VAULT_KEY);
    },
    getAccessToken: refreshIfNeeded,
    async getAccount(): Promise<ExternalAccount | null> {
      try {
        const me = await spotifyGet<{ id: string; display_name?: string; email?: string; product?: string }>('/me');
        return {
          uid: me.id,
          login: me.email,
          displayName: me.display_name,
          hasPlus: me.product === 'premium',
        };
      } catch {
        return null;
      }
    },
    async search(query: string, limit: number): Promise<UnifiedTrack[]> {
      const items = await searchTrackItems(query, limit);
      return items.map((t) => mapSpotifyTrack(t));
    },
    async searchArtists(query: string, limit: number): Promise<UnifiedArtist[]> {
      const items = await searchArtistItems(query, limit);
      return items.map((a) => ({
        source: 'spotify' as const,
        id: a.id,
        name: a.name,
        imageUrl: a.images?.[0]?.url,
        genres: a.genres,
        followers: a.followers?.total,
      }));
    },
    async getArtistTracks(artistId: string, limit: number): Promise<UnifiedTrack[]> {
      const cap = clampLimit(limit, 200);
      const byId = new Map<string, UnifiedTrack>();
      const seenTitles = new Set<string>();
      const add = (t: UnifiedTrack) => {
        const titleKey = t.title.toLowerCase();
        if (byId.has(t.id) || seenTitles.has(titleKey)) return;
        byId.set(t.id, t);
        seenTitles.add(titleKey);
      };

      let artistName: string | null = null;
      try {
        const artist = await spotifyGet<SpotifyArtist>(`/artists/${artistId}`);
        artistName = artist?.name ?? null;
      } catch {
        /* GET /artists/{id} может быть недоступен — попробуем только по id в альбомах */
      }

      if (artistName) {
        try {
          const q = `artist:"${artistName.replace(/"/g, '')}"`;
          const found = await searchTrackItems(q, cap);
          found
            .filter((t) => t.artists.some((a) => a.id === artistId))
            .forEach((t) => add(mapSpotifyTrack(t)));
        } catch {
          /* search fallback */
        }
      }

      try {
        const albums: SpotifyAlbum[] = [];
        for (let offset = 0; albums.length < MAX_ARTIST_ALBUMS; offset += SPOTIFY_ARTIST_ALBUMS_PAGE_MAX) {
          const page = await spotifyGet<{ items: SpotifyAlbum[]; next: string | null }>(
            `/artists/${artistId}/albums`,
            {
              include_groups: 'album,single',
              limit: String(SPOTIFY_ARTIST_ALBUMS_PAGE_MAX),
              offset: String(offset),
              market: 'from_token',
            },
          );
          if (!page) break;
          albums.push(...page.items);
          if (!page.next) break;
        }

        const chunks: SpotifyAlbum[][] = [];
        for (let i = 0; i < Math.min(albums.length, MAX_ARTIST_ALBUMS); i += 5) {
          chunks.push(albums.slice(i, i + 5));
        }
        for (const chunk of chunks) {
          if (byId.size >= cap) break;
          for (const album of chunk) {
            if (byId.size >= cap) break;
            const page = await spotifyGet<{ items: SpotifyAlbumTrack[] }>(`/albums/${album.id}/tracks`, {
              limit: '50',
              market: 'from_token',
            });
            for (const t of page?.items ?? []) {
              if (!t.artists.some((a) => a.id === artistId)) continue;
              add(mapSpotifyTrack({ ...t, album }));
            }
          }
        }
      } catch {
        /* альбомы необязательны, если search уже дал треки */
      }

      if (!byId.size) {
        throw new Error(
          'Не удалось загрузить треки исполнителя из Spotify. Проверьте allowlist, Premium у владельца приложения и переподключите аккаунт.',
        );
      }

      return [...byId.values()].slice(0, cap);
    },
    async getHomeTracks(limit: number): Promise<UnifiedTrack[]> {
      const cap = clampLimit(limit, 50);
      try {
        const top = await spotifyGet<{ items: SpotifyTrack[] }>('/me/top/tracks', {
          limit: limitParam(cap),
          time_range: 'short_term',
        });
        if (top.items?.length) return top.items.map((t) => mapSpotifyTrack(t));
      } catch {
        /* нет scope user-top-read или пустая история */
      }
      try {
        const rec = await spotifyGet<{ tracks: SpotifyTrack[] }>('/recommendations', {
          limit: limitParam(cap),
          seed_genres: 'pop,hip-hop,electronic',
        });
        if (rec.tracks?.length) return rec.tracks.map((t) => mapSpotifyTrack(t));
      } catch {
        /* recommendations недоступны в части режимов */
      }
      const saved = await spotifyGet<{ items: { track: SpotifyTrack | null }[] }>('/me/tracks', {
        limit: limitParam(Math.min(cap, 50)),
        market: 'from_token',
      });
      return (saved.items ?? []).map((row) => row.track).filter((t): t is SpotifyTrack => !!t?.id).map((t) => mapSpotifyTrack(t));
    },
    async listPlaylists(): Promise<UnifiedPlaylist[]> {
      const out: UnifiedPlaylist[] = [];
      for (let offset = 0; out.length < MAX_PLAYLISTS; offset += 50) {
        const page = await spotifyGet<{ items: SpotifyPlaylistSummary[]; next: string | null }>('/me/playlists', {
          limit: '50',
          offset: String(offset),
        });
        if (!page) break;
        for (const p of page.items) {
          out.push({
            source: 'spotify',
            id: p.id,
            title: p.name,
            owner: p.owner.display_name,
            description: p.description ?? undefined,
            coverUrl: p.images[0]?.url,
            trackCount: playlistItemCount(p),
          });
        }
        if (!page.next) break;
      }
      return out.slice(0, MAX_PLAYLISTS);
    },
    async getPlaylist(id: string): Promise<PlaylistWithTracks> {
      const meta = await spotifyGet<SpotifyPlaylistFull>(`/playlists/${id}`);
      if (!meta) throw new Error('Playlist not found');
      const fallbackAlbum: SpotifyAlbum = {
        id: meta.id,
        name: meta.name,
        images: meta.images,
      };
      const tracks: UnifiedTrack[] = [];
      const pageSize = 50;
      for (let offset = 0; ; offset += pageSize) {
        const page = await spotifyGet<{
          items: ({ track?: SpotifyTrack | null; item?: SpotifyTrack | null })[];
          next: string | null;
        }>(`/playlists/${id}/items`, {
          limit: String(pageSize),
          offset: String(offset),
          market: 'from_token',
        });
        if (!page) break;
        for (const row of page.items) {
          const raw = row.track ?? row.item;
          if (!raw?.id) continue;
          const album = raw.album?.images?.length ? raw.album : fallbackAlbum;
          tracks.push(mapSpotifyTrack({ ...raw, album }));
        }
        if (!page.next) break;
      }
      return {
        source: 'spotify',
        id: meta.id,
        title: meta.name,
        owner: meta.owner.display_name,
        description: meta.description ?? undefined,
        coverUrl: meta.images[0]?.url,
        trackCount: playlistItemCount(meta),
        tracks,
      };
    },
    async getSavedTracks(limit: number): Promise<UnifiedTrack[]> {
      const out: UnifiedTrack[] = [];
      const cap = Math.min(limit, 2000);
      for (let offset = 0; out.length < cap; offset += 50) {
        const page = await spotifyGet<{ items: { track: SpotifyTrack | null }[]; next: string | null }>(
          '/me/tracks',
          { limit: '50', offset: String(offset), market: 'from_token' },
        );
        if (!page) break;
        for (const row of page.items) {
          if (!row.track?.id) continue;
          out.push(mapSpotifyTrack(row.track));
          if (out.length >= cap) break;
        }
        if (!page.next || out.length >= cap) break;
      }
      return out;
    },
    async resolvePlayback(track: UnifiedTrack): Promise<PlaybackHandle> {
      if (!loadTokens()?.refresh_token) throw new Error('Spotify не подключён');
      // URI детерминирован; GET /tracks/{id} тратит квоту Dev Mode без пользы для Web Playback SDK.
      return { kind: 'spotifySdk', trackUri: `spotify:track:${track.id}` };
    },
  };
}
