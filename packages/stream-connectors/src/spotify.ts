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
const MAX_ARTIST_ALBUMS = 40;
const MAX_PLAYLISTS = 100;
const SPOTIFY_SCOPES =
  'user-read-email streaming user-read-playback-state user-library-read playlist-read-private playlist-read-collaborative';

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
    if (Date.now() < t.expires_at - 60_000) return t.access_token;
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
    };
    const next: SpotifyTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? t.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
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
      const data = await spotifyGet<{ tracks: { items: SpotifyTrack[] } }>('/search', {
        q: query,
        type: 'track',
        limit: String(Math.min(limit, 50)),
      });
      return (data.tracks.items ?? []).filter(Boolean).map((t) => mapSpotifyTrack(t));
    },
    async searchArtists(query: string, limit: number): Promise<UnifiedArtist[]> {
      const data = await spotifyGet<{ artists: { items: SpotifyArtist[] } }>('/search', {
        q: query,
        type: 'artist',
        limit: String(limit),
      });
      return (data.artists.items ?? []).map((a) => ({
        source: 'spotify' as const,
        id: a.id,
        name: a.name,
        imageUrl: a.images?.[0]?.url,
        genres: a.genres,
        followers: a.followers?.total,
      }));
    },
    async getArtistTracks(artistId: string, limit: number): Promise<UnifiedTrack[]> {
      const byId = new Map<string, UnifiedTrack>();
      const seenTitles = new Set<string>();
      const add = (t: UnifiedTrack) => {
        const titleKey = t.title.toLowerCase();
        if (byId.has(t.id) || seenTitles.has(titleKey)) return;
        byId.set(t.id, t);
        seenTitles.add(titleKey);
      };

      const top = await spotifyGet<{ tracks: SpotifyTrack[] }>(
        `/artists/${artistId}/top-tracks`,
        { market: 'from_token' },
      );
      top?.tracks.forEach((t) => add(mapSpotifyTrack(t)));

      const albums: SpotifyAlbum[] = [];
      for (let offset = 0; albums.length < MAX_ARTIST_ALBUMS; offset += 50) {
        const page = await spotifyGet<{ items: SpotifyAlbum[]; next: string | null }>(
          `/artists/${artistId}/albums`,
          { include_groups: 'album,single', limit: '50', offset: String(offset), market: 'from_token' },
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
        if (byId.size >= limit) break;
        const results = await Promise.all(
          chunk.map((album) =>
            spotifyGet<{ items: SpotifyAlbumTrack[] }>(`/albums/${album.id}/tracks`, {
              limit: '50',
              market: 'from_token',
            }).then((r) => ({ album, items: r?.items ?? [] })),
          ),
        );
        for (const { album, items } of results) {
          for (const t of items) {
            if (!t.artists.some((a) => a.id === artistId)) continue;
            add(mapSpotifyTrack({ ...t, album }));
          }
        }
      }

      if (!byId.size) {
        const artist = await spotifyGet<SpotifyArtist>(`/artists/${artistId}`);
        if (artist) {
          const found = await spotifyGet<{ tracks: { items: SpotifyTrack[] } }>('/search', {
            q: `artist:"${artist.name}"`,
            type: 'track',
            limit: '50',
          });
          found?.tracks.items
            .filter((t) => t.artists.some((a) => a.id === artistId))
            .forEach((t) => add(mapSpotifyTrack(t)));
        }
      }

      return [...byId.values()].slice(0, limit);
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
      for (let offset = 0; ; offset += 100) {
        const page = await spotifyGet<{ items: { item: SpotifyTrack | null }[]; next: string | null }>(
          `/playlists/${id}/items`,
          { limit: '100', offset: String(offset), market: 'from_token' },
        );
        if (!page) break;
        for (const row of page.items) {
          if (!row.item?.id) continue;
          const album = row.item.album?.images?.length ? row.item.album : fallbackAlbum;
          tracks.push(mapSpotifyTrack({ ...row.item, album }));
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
      const token = await refreshIfNeeded();
      if (!token) throw new Error('Spotify not connected');
      const res = await fetch(`https://api.spotify.com/v1/tracks/${track.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { uri: string; preview_url: string | null };
      if (data.preview_url) {
        return { kind: 'mediaUrl', url: data.preview_url };
      }
      return { kind: 'spotifySdk', trackUri: data.uri };
    },
  };
}
