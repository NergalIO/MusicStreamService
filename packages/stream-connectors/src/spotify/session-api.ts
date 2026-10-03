import {
  cookieNamesIndicateLogin,
  emptyAuthResult,
  parseAuthToken,
  pickEmail,
  type LoginRequest,
} from './auth.js';
import {
  ADD_LIBRARY_OPERATIONS,
  APRESOLVE_URL,
  IN_LIBRARY_OPERATIONS,
  PATHFINDER_MUTATE_URLS,
  PATHFINDER_URLS,
  QueryHashCache,
  captureConnectionId,
  connectClusterBody,
  connectClusterUrl,
  connectCommandUrl,
  connectDevicesUrl,
  connectPlayBody,
  connectTransferBody,
  connectTransferUrl,
  extractQueryHashes,
  fallbackSpclientHosts,
  graphQLLibraryWriteOk,
  graphQLOk,
  graphQLRequest,
  isUnauthorized,
  jsonRequest,
  libraryVariableSets,
  libraryVariables,
  lyricsUrl,
  parseDevices,
  parseIsInLibrary,
  parseLyrics,
  parseSpclientHosts,
  persistedQueryMissing,
  parseAlbumUriFromTrack,
  publicContainsUrl,
  publicDevicesUrl,
  publicJsonRequest,
  publicLibraryBody,
  publicLibraryContainsUrl,
  publicLibraryEndpoint,
  publicLibraryUrl,
  publicPlayerPlayUrl,
  publicPlayBody,
  publicSearchUrl,
  publicTracksUrl,
  publicTrackUrl,
  publicTransferBody,
  publicTransferUrl,
  parseSearchResults,
  REMOVE_LIBRARY_OPERATIONS,
  restLibraryWriteOk,
  SEARCH_OPERATIONS,
  searchVariables,
  type PageFetchRequest,
  type PageFetchResult,
  type PartnerTokens,
} from './partner.js';
import { parsePlayUri, parseTrackUri, toPublicSnapshot } from './state.js';
import {
  LOGIN_URL,
  SPOTIFY_ORIGIN,
  authStepFromUrl,
  isAccountsUrl,
  isOpenSpotifyUrl,
  shouldResumeLogin,
  urlLooksLikeCaptcha,
} from './login.js';
import {
  DETECT_AUTH_STEP,
  DISMISS_BANNERS,
  HAS_CAPTCHA,
  READ_LOGIN_ERROR,
  SUBMIT_LOGIN_FORM,
  SWITCH_TO_EMAIL_CODE,
  SWITCH_TO_PASSWORD,
  PASSWORD_SELECTORS,
  USERNAME_SELECTORS,
  fillEmailCodeScript,
  fillEmailScript,
  fillPasswordScript,
  focusOtpScript,
  focusVisibleInputScript,
  readOtpValueScript,
  readVisibleInputScript,
  waitForContinueEnabledScript,
  CONTINUE_ENABLED,
  waitForUsernameFieldScript,
} from './login-dom.js';
import {
  PEEK_TRACK_URI,
  READ_NOW_PLAYING_LIKED,
  clickNowPlayingLikeScript,
  runLibraryApiScript,
} from './library-dom.js';
import { nodeFetch, pageFetchScript } from './page-fetch.js';
import type {
  AuthResult,
  AuthStep,
  CommandArgs,
  CommandName,
  CommandResult,
  ConnectDevice,
  DevicesApiResult,
  DomDebugDump,
  HealthStatus,
  LyricsApiResult,
  LikeStatusResult,
  PlaybackDebugDump,
  PlaybackSnapshot,
  PlayerMethodsDump,
  SearchApiResult,
} from './types.js';

export class TabMissingError extends Error {
  constructor(message = 'Spotify WebContents недоступен') {
    super(message);
    this.name = 'TabMissingError';
  }
}

export interface SpotifyCapturedState {
  accessToken: string | null;
  clientToken: string | null;
  connectionId: string | null;
  appVersion: string | null;
}

export interface SpotifyPageHost {
  evaluate<T>(expression: string): Promise<T>;
  getUrl(): string;
  loadURL(url: string): Promise<void>;
  getCookieNames?(): Promise<string[]>;
  /** Electron: insert keystrokes into the focused Spotify input (React-safe). */
  typeText?(text: string, opts?: { selectAll?: boolean }): Promise<void>;
  focusPage?(): Promise<void>;
  hasCaptchaPopup?(): Promise<boolean>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomObserverId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function captureAuthHeaders(headers: Record<string, string>): {
  accessToken: string | null;
  clientToken: string | null;
} {
  const auth = headers.authorization ?? headers.Authorization ?? '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const clientToken = headers['client-token'] ?? headers['Client-Token'] ?? null;
  return { accessToken, clientToken };
}

export class SpotifyInjectorSession {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly hashCache = new QueryHashCache();
  private spclientHosts: string[] | null = null;
  private cachedDevices: ConnectDevice[] = [];
  private localDeviceId: string | null = null;
  private readonly observerDeviceId = randomObserverId();
  private hashesSniffed = false;
  private accountEmail: string | null = null;

  constructor(
    private readonly host: SpotifyPageHost,
    private readonly captured: SpotifyCapturedState,
  ) {}

  get hashCacheRef(): QueryHashCache {
    return this.hashCache;
  }

  ingestRequestHeaders(headers: Record<string, string>): void {
    const auth = captureAuthHeaders(headers);
    if (auth.accessToken) this.captured.accessToken = auth.accessToken;
    if (auth.clientToken) this.captured.clientToken = auth.clientToken;
    const connectionId = captureConnectionId(headers);
    if (connectionId) this.captured.connectionId = connectionId;
    const appVersion = headers['spotify-app-version'] ?? headers['Spotify-App-Version'];
    if (appVersion) this.captured.appVersion = appVersion;
  }

  rememberPathfinder(url: string, postData?: string): void {
    if (!postData) return;
    try {
      this.hashCache.rememberFromPost(postData);
    } catch {
      /* ignore */
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async getState(): Promise<PlaybackSnapshot> {
    return this.serial(async () => {
      if (isAccountsUrl(this.host.getUrl())) {
        return idleSnapshot();
      }
      const sample = await this.host.evaluate<PlaybackSnapshot>(`(() => {
        const bridge = window.__spotifyBridge;
        if (!bridge) {
          return {
            ready: false, uri: null, id: null, title: null, artists: [], album: null,
            durationMs: null, positionMs: 0, isPlaying: false, liked: null, volume: null,
            shuffle: 'Unavailable', repeat: 'Unavailable', muted: null,
            sampledAt: Date.now(), source: 'dom',
          };
        }
        return bridge.getState();
      })()`);
      return toPublicSnapshot(sample);
    });
  }

  async command(name: CommandName, payload: CommandArgs = {}): Promise<CommandResult> {
    return this.serial(async () => {
      if (name === 'play' || name === 'resume') {
        await this.ensurePlayerPage();
      }
      if (name !== 'play') {
        return this.evalBridgeCommand(name, payload);
      }
      return this.playTrack(payload);
    });
  }

  /** Play only succeeds when the requested track id is actually playing. */
  private async playTrack(payload: CommandArgs): Promise<CommandResult> {
    const raw = payload.uri ?? '';
    const parsed = parsePlayUri(raw);
    const trackUri =
      payload.offsetUri ??
      (parsed?.kind === 'track' ? parsed.uri : undefined) ??
      (parsePlayUri(payload.uri ?? '')?.kind === 'track' ? payload.uri : payload.uri);
    const positionMs = payload.positionMs;

    // 1) Prefer single-track / synthetic context — avoids album auto-skip of unavailable tracks.
    const singlePayload: CommandArgs =
      parsed?.kind === 'track'
        ? { uri: parsed.uri, positionMs }
        : { uri: raw, offsetUri: payload.offsetUri, positionMs };

    let result = await this.evalBridgeCommand('play', singlePayload);
    if (result.ok && (await this.verifyPlayingTrack(trackUri))) return result;
    if (result.ok) {
      await this.safePause();
      result = { ok: false, error: 'track_unavailable' };
    }

    // 2) Album/playlist context only as fallback (may skip siblings — verify id after).
    const withAlbum = await this.preparePlayPayload(payload);
    const usedAlbumWrap = !!(withAlbum.offsetUri && withAlbum.uri && withAlbum.uri !== singlePayload.uri);
    if (usedAlbumWrap && result.error !== 'track_unavailable') {
      result = await this.evalBridgeCommand('play', withAlbum);
      if (result.ok && (await this.verifyPlayingTrack(trackUri))) return result;
      if (result.ok) {
        await this.safePause();
        result = { ok: false, error: 'track_unavailable' };
      }
    }

    const contextUri = usedAlbumWrap && withAlbum.uri ? withAlbum.uri : trackUri;
    const offsetUri = withAlbum.offsetUri ?? trackUri;

    if (!result.ok && result.error !== 'track_unavailable' && contextUri && offsetUri) {
      const viaConnect = await this.playViaConnect(contextUri, offsetUri, positionMs);
      if (viaConnect.ok && (await this.verifyPlayingTrack(trackUri))) return viaConnect;
      if (viaConnect.ok) await this.safePause();
      else if (viaConnect.error === 'track_unavailable') result = viaConnect;
    }
    if (!result.ok && result.error !== 'track_unavailable' && contextUri && offsetUri) {
      const viaPublic = await this.playViaPublicApi(contextUri, offsetUri, positionMs);
      if (viaPublic.ok && (await this.verifyPlayingTrack(trackUri))) return viaPublic;
      if (viaPublic.ok) await this.safePause();
    }
    if (!result.ok && result.error !== 'track_unavailable' && trackUri) {
      const viaNav = await this.playViaTrackPage(trackUri, positionMs);
      if (viaNav.ok && (await this.verifyPlayingTrack(trackUri))) return viaNav;
      if (viaNav.ok) {
        await this.safePause();
        return { ok: false, error: 'track_unavailable' };
      }
      if (viaNav.error === 'track_unavailable') result = viaNav;
    }

    await this.safePause();
    if (result.error === 'track_unavailable') return result;
    return result.ok ? { ok: false, error: 'track_unavailable' } : result;
  }

  private async verifyPlayingTrack(trackUri: string | undefined): Promise<boolean> {
    if (!trackUri) return false;
    if (await this.confirmPlaying(trackUri)) return true;
    const parsed = parseTrackUri(trackUri);
    if (!parsed) return false;
    try {
      const state = await this.host.evaluate<{ id: string | null; isPlaying: boolean } | null>(`(() => {
        const s = window.__spotifyBridge?.getState?.();
        if (!s) return null;
        return { id: s.id ?? null, isPlaying: !!s.isPlaying };
      })()`);
      return !!(state && state.isPlaying && state.id === parsed.id);
    } catch {
      return false;
    }
  }

  private async safePause(): Promise<void> {
    try {
      await this.evalBridgeCommand('pause', {});
    } catch {
      /* ignore */
    }
  }

  private async ensurePlayerPage(): Promise<void> {
    const url = this.host.getUrl();
    const onPlayer = isOpenSpotifyUrl(url) && !/\/(?:login|signup)/i.test(url);
    if (onPlayer) return;
    await this.host.loadURL(`${SPOTIFY_ORIGIN}/`);
  }

  private async preparePlayPayload(payload: CommandArgs): Promise<CommandArgs> {
    const raw = payload.uri ?? '';
    const parsed = parsePlayUri(raw);
    if (!parsed) return payload;
    if (parsed.kind !== 'track') {
      return {
        uri: parsed.uri,
        offsetUri: payload.offsetUri,
        positionMs: payload.positionMs,
      };
    }
    if (payload.offsetUri) {
      return { uri: parsed.uri, offsetUri: payload.offsetUri, positionMs: payload.positionMs };
    }
    const albumUri = await this.resolveAlbumUri(parsed.id, payload.albumId);
    if (albumUri) {
      return { uri: albumUri, offsetUri: parsed.uri, positionMs: payload.positionMs };
    }
    return { uri: parsed.uri, positionMs: payload.positionMs };
  }

  private async resolveAlbumUri(trackId: string, hintedAlbumId?: string): Promise<string | null> {
    const hint = hintedAlbumId?.trim();
    if (hint && /^[0-9A-Za-z]{22}$/.test(hint)) return `spotify:album:${hint}`;
    const tokens = await this.ensureTokens();
    if (!tokens) return null;
    const rest = await this.publicFetch(publicJsonRequest(publicTrackUrl(trackId), 'GET', tokens));
    const fromRest = parseAlbumUriFromTrack(rest.body);
    if (fromRest) return fromRest;
    await this.sniffHashes();
    const gql = await this.tryGraphQL(tokens, ['getTrack', 'queryTrack'], { uri: `spotify:track:${trackId}` });
    if (gql && graphQLOk(gql)) {
      const fromGql = parseAlbumUriFromTrack(gql.body);
      if (fromGql) return fromGql;
    }
    return null;
  }

  private async scrapeAlbumUri(trackId: string): Promise<string | null> {
    try {
      const id = await this.host.evaluate<string | null>(`(() => {
        const trackId = ${JSON.stringify(trackId)};
        if (!location.pathname.includes('/track/' + trackId)) return null;
        const main = document.querySelector('main') ?? document.body;
        const links = main.querySelectorAll('a[href*="/album/"]');
        for (const link of links) {
          const href = link.getAttribute('href') ?? '';
          const match = href.match(/\\/album\\/([0-9A-Za-z]{22})/);
          if (match) return match[1];
        }
        return null;
      })()`);
      return id ? `spotify:album:${id}` : null;
    } catch {
      return null;
    }
  }

  private async confirmPlaying(trackUri: string): Promise<boolean> {
    const parsed = parseTrackUri(trackUri);
    if (!parsed) return false;
    try {
      return await this.host.evaluate<boolean>(`(async () => {
        const id = ${JSON.stringify(parsed.id)};
        const uri = ${JSON.stringify(parsed.uri)};
        const toast = () => {
          const nodes = document.querySelectorAll('[role="alert"], [role="status"], [data-testid*="toast"]');
          for (const el of nodes) {
            if (/этот трек недоступен|this track is unavailable|isn't available/i.test(el.textContent ?? '')) return true;
          }
          return false;
        };
        for (let i = 0; i < 12; i += 1) {
          if (toast()) return false;
          const state = window.__spotifyBridge?.getState?.();
          if (state && (state.id === id || state.uri === uri) && state.isPlaying) return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      })()`);
    } catch {
      return false;
    }
  }

  private async playViaConnect(contextUri: string, trackUri: string, positionMs?: number): Promise<CommandResult> {
    const tokens = await this.ensureTokens();
    if (!tokens) return { ok: false, error: 'auth_missing' };
    const extra = this.partnerExtraHeaders();
    if (!this.localDeviceId) {
      const hosts = await this.resolveSpclient(tokens);
      for (const host of hosts) {
        const cluster = await this.pageFetch(
          jsonRequest(connectClusterUrl(host, this.observerDeviceId), 'PUT', tokens, connectClusterBody(), extra),
        );
        this.rememberDevices(parseDevices(cluster.body));
        if (this.localDeviceId) break;
      }
    }
    const deviceId = this.localDeviceId ?? this.captured.connectionId;
    if (!deviceId) return { ok: false, error: 'device_missing' };
    const fromId = this.captured.connectionId ?? deviceId;
    const hosts = await this.resolveSpclient(tokens);
    const body = connectPlayBody(contextUri, trackUri, positionMs);
    for (const host of hosts) {
      const command = await this.pageFetch(
        jsonRequest(connectCommandUrl(host, fromId, deviceId), 'POST', tokens, body, extra),
      );
      if (command.ok && (await this.confirmPlaying(trackUri))) return { ok: true };
    }
    return { ok: false, error: 'connect_play_failed' };
  }

  private async playViaPublicApi(contextUri: string, trackUri: string, positionMs?: number): Promise<CommandResult> {
    const tokens = await this.ensureTokens();
    if (!tokens) return { ok: false, error: 'auth_missing' };
    const rest = await this.publicFetch(
      publicJsonRequest(
        publicPlayerPlayUrl(this.localDeviceId),
        'PUT',
        tokens,
        publicPlayBody(contextUri, trackUri, positionMs),
      ),
    );
    if ((rest.ok || rest.status === 204) && (await this.confirmPlaying(trackUri))) return { ok: true };
    return { ok: false, error: 'public_play_failed' };
  }

  private async playViaTrackPage(uri: string, positionMs?: number): Promise<CommandResult> {
    const parsed = parsePlayUri(uri);
    if (!parsed || parsed.kind !== 'track') return { ok: false, error: 'player_method_missing' };
    const path = `/track/${parsed.id}`;
    if (!this.host.getUrl().includes(path)) {
      await this.host.loadURL(`${SPOTIFY_ORIGIN}${path}`);
    }
    let albumUri: string | null = null;
    for (let i = 0; i < 8 && !albumUri; i += 1) {
      albumUri = await this.scrapeAlbumUri(parsed.id);
      if (!albumUri) await sleep(200);
    }
    if (albumUri) {
      const viaAlbum = await this.evalBridgeCommand('play', {
        uri: albumUri,
        offsetUri: parsed.uri,
        positionMs,
      });
      if (viaAlbum.ok) return viaAlbum;
    }
    const clicked = await this.host.evaluate<CommandResult>(`(async () => {
      const id = ${JSON.stringify(parsed.id)};
      const deadline = Date.now() + 4000;
      const headerPlay = () => {
        const main = document.querySelector('main') ?? document.body;
        const buttons = main.querySelectorAll('[data-testid="play-button"], [data-testid="entity-action-play"]');
        for (const el of buttons) {
          if (!(el instanceof HTMLElement)) continue;
          const label = (el.getAttribute('aria-label') ?? '').toLowerCase();
          if (/pause|пауза/.test(label)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width >= 24 && rect.height >= 24) return el;
        }
        return null;
      };
      const toast = () => {
        const nodes = document.querySelectorAll('[role="alert"], [role="status"], [data-testid*="toast"]');
        for (const el of nodes) {
          if (/этот трек недоступен|this track is unavailable|isn't available/i.test(el.textContent ?? '')) return true;
        }
        return false;
      };
      while (Date.now() < deadline) {
        if (!location.pathname.includes('/track/' + id)) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        const btn = headerPlay();
        if (btn) {
          btn.click();
          for (let i = 0; i < 10; i += 1) {
            if (toast()) return { ok: false, error: 'track_unavailable' };
            const state = window.__spotifyBridge?.getState?.();
            if (state && state.id === id && state.isPlaying) return { ok: true };
            await new Promise((r) => setTimeout(r, 200));
          }
          return { ok: false, error: toast() ? 'track_unavailable' : 'player_method_missing' };
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return { ok: false, error: 'player_method_missing' };
    })()`);
    return clicked;
  }

  private async evalBridgeCommand(name: CommandName, payload: CommandArgs): Promise<CommandResult> {
      const command = JSON.stringify(name);
      const args = JSON.stringify(payload);
      const run = () => this.host.evaluate<CommandResult>(`(async () => {
        const bridge = window.__spotifyBridge;
        if (!bridge) return { ok: false, error: 'bridge_missing' };
        const command = ${command};
        const args = ${args};
        switch (command) {
          case 'pause': return bridge.pause();
          case 'resume': return bridge.resume();
          case 'next': return bridge.next();
          case 'previous': return bridge.previous();
          case 'play':
            return bridge.play({
              uri: String(args.uri ?? ''),
              offsetUri: args.offsetUri,
              positionMs: args.positionMs,
            });
          case 'setVolume': return bridge.setVolume(Number(args.level));
          case 'seek': return bridge.seek(Number(args.positionMs));
          case 'setShuffle': return bridge.setShuffle(Boolean(args.enabled));
          case 'setRepeat':
            return bridge.setRepeat(args.mode === 'context' || args.mode === 'track' ? args.mode : 'off');
          case 'setMute': return bridge.setMute(Boolean(args.muted));
          case 'queue': return bridge.queue(String(args.uri ?? ''));
          default: return { ok: false, error: 'unknown_command' };
        }
      })()`);
      let result = await run();
      if (!result.ok && result.error === 'bridge_missing') {
        await sleep(400);
        result = await run();
      }
      return result;
  }

  async pathfinderQuery(operationName: string, variables: Record<string, unknown>): Promise<unknown> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) throw new Error('Войдите в Spotify');
      await this.sniffHashes();
      const hash = this.hashCache.get(operationName);
      if (!hash) {
        throw new Error(`Веб-плеер Spotify не знает запрос ${operationName} — откройте Spotify → Веб-плеер`);
      }
      const urls = [...PATHFINDER_URLS, ...PATHFINDER_MUTATE_URLS];
      let last: PageFetchResult | null = null;
      for (const url of urls) {
        const result = await this.pageFetch(
          graphQLRequest(url, tokens, operationName, hash, variables, this.partnerExtraHeaders()),
        );
        last = result;
        if (persistedQueryMissing(result)) continue;
        if (graphQLOk(result)) return result.body;
      }
      const status = last?.status ?? 0;
      throw new Error(`Spotify pathfinder ${status || 'failed'}: ${operationName}`);
    });
  }

  async spclientGet(path: string): Promise<unknown> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) throw new Error('Войдите в Spotify');
      const hosts = await this.resolveSpclient(tokens);
      const normalized = path.startsWith('/') ? path : `/${path}`;
      for (const host of hosts) {
        const url = `${host.replace(/\/$/, '')}${normalized}`;
        const result = await this.pageFetch(
          jsonRequest(url, 'GET', tokens, undefined, this.partnerExtraHeaders()),
        );
        if (result.ok) return result.body;
        if (!isUnauthorized(result)) continue;
      }
      throw new Error('Spotify spclient request failed');
    });
  }

  async getAuth(): Promise<AuthResult> {
    return this.serial(async () => {
      const auth = await this.readAuth();
      if (auth.loggedIn && !auth.accessToken && !this.captured.accessToken) {
        return this.waitForAuthTokens(4_000);
      }
      if (!auth.accessToken && this.captured.accessToken) {
        return {
          ...auth,
          accessToken: this.captured.accessToken,
          tokenType: 'Bearer',
          clientToken: auth.clientToken ?? this.captured.clientToken,
        };
      }
      return auth;
    });
  }

  async login(request: LoginRequest): Promise<AuthResult> {
    return this.serial(async () => {
      this.accountEmail = request.email;
      try {
        let step: AuthStep = isAccountsUrl(this.host.getUrl()) ? await this.detectStep() : 'email';
        const resume = shouldResumeLogin(this.host.getUrl(), step);

        if (!resume) {
          const stayForCode = isAccountsUrl(this.host.getUrl()) && Boolean(request.code);
          if (stayForCode) {
            await this.host.evaluate<void>(DISMISS_BANNERS);
            step = await this.detectStep();
          } else {
            step = await this.advanceFromEmail(request.email);
            if (step === 'email' && !request.code && !request.password) {
              return { ...emptyAuthResult('email'), ok: false, error: 'web_continue_required' };
            }
          }
        } else {
          await this.host.evaluate<void>(DISMISS_BANNERS);
        }

        if (!request.password && step === 'password') {
          await this.host.evaluate<boolean>(SWITCH_TO_EMAIL_CODE);
          step = await this.waitForNextStep(12_000);
        }
        if (request.password && !request.code && step === 'code') {
          await this.host.evaluate<boolean>(SWITCH_TO_PASSWORD);
          step = await this.waitForNextStep(12_000);
        }

        if (!request.code && !request.password) {
          if (await this.waitForCaptcha(2_000)) {
            return { ...emptyAuthResult(step), ok: false, error: 'captcha_required', captcha: true };
          }
          if (step === 'done') {
            return this.waitForAuthTokens(8_000);
          }
          const message = await this.host.evaluate<string | null>(READ_LOGIN_ERROR);
          if (message && step !== 'code' && step !== 'password') {
            return { ...emptyAuthResult(step), ok: false, error: 'login_failed' };
          }
          return emptyAuthResult(step);
        }

        if (request.code) {
          if (step === 'email') {
            step = await this.advanceFromEmail(request.email, { reload: false });
          }
          if (step === 'password') {
            await this.host.evaluate<boolean>(SWITCH_TO_EMAIL_CODE);
            step = await this.waitForNextStep(8_000);
          }
          if (step !== 'code') {
            step = await this.waitForNextStep(8_000);
          }
          if (!(await this.fillOtp(request.code))) {
            return { ...emptyAuthResult(await this.detectStep()), ok: false, error: 'login_code_missing' };
          }
          await sleep(150);
          await this.host.evaluate<boolean>(SUBMIT_LOGIN_FORM);
        } else if (request.password) {
          if (step !== 'password') step = await this.waitForNextStep(5_000);
          if (step === 'code') {
            return { ...emptyAuthResult('code'), ok: false, error: 'auth_step_mismatch' };
          }
          if (
            !(await this.fillLoginField(
              PASSWORD_SELECTORS,
              fillPasswordScript(request.password),
              request.password,
            ))
          ) {
            return { ...emptyAuthResult(await this.detectStep()), ok: false, error: 'login_password_missing' };
          }
          await this.host.evaluate<boolean>(SUBMIT_LOGIN_FORM);
        }

        if (await this.waitForCaptcha(2_500)) {
          return { ...emptyAuthResult(await this.detectStep()), ok: false, error: 'captcha_required', captcha: true };
        }

        return this.waitForLoggedIn(12_000);
      } catch {
        return { ...emptyAuthResult('email'), ok: false, error: 'login_timeout' };
      }
    });
  }

  async getLyrics(uri?: string): Promise<LyricsApiResult> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) return { ok: false, error: 'auth_missing' };
      const raw =
        uri ??
        (await this.host.evaluate<string | null>(
          `(() => { const b = window.__spotifyBridge; const u = b?.getState?.()?.uri; return typeof u === 'string' ? u : null; })()`,
        ));
      if (!raw) return { ok: false, error: 'no_track' };
      const parsed = parseTrackUri(raw);
      if (!parsed) return { ok: false, error: 'invalid_uri' };
      const hosts = await this.resolveSpclient(tokens);
      for (const host of hosts) {
        const result = await this.pageFetch(
          jsonRequest(lyricsUrl(host, parsed.id), 'GET', tokens, undefined, this.partnerExtraHeaders()),
        );
        if (isUnauthorized(result)) continue;
        const lyrics = parseLyrics(result.body);
        if (lyrics) return { ok: true, syncType: lyrics.syncType, lines: lyrics.lines };
      }
      return { ok: false, error: 'lyrics_unavailable' };
    });
  }

  async getDevices(): Promise<DevicesApiResult> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) return { ok: false, error: 'auth_missing' };
      if (this.cachedDevices.length > 0) return { ok: true, devices: this.cachedDevices };
      const extra = this.partnerExtraHeaders();
      const hosts = await this.resolveSpclient(tokens);
      for (const host of hosts) {
        const cluster = await this.pageFetch(
          jsonRequest(connectClusterUrl(host, this.observerDeviceId), 'PUT', tokens, connectClusterBody(), extra),
        );
        const fromCluster = this.rememberDevices(parseDevices(cluster.body));
        if (fromCluster.length > 0) return { ok: true, devices: fromCluster };
        const listed = await this.pageFetch(
          jsonRequest(connectDevicesUrl(host), 'GET', tokens, undefined, extra),
        );
        const fromList = this.rememberDevices(parseDevices(listed.body));
        if (fromList.length > 0) return { ok: true, devices: fromList };
      }
      const rest = await this.publicFetch(publicJsonRequest(publicDevicesUrl(), 'GET', tokens));
      if (rest.ok) {
        const devices = this.rememberDevices(parseDevices(rest.body));
        return { ok: true, devices };
      }
      if (this.cachedDevices.length > 0) return { ok: true, devices: this.cachedDevices };
      return { ok: false, error: 'devices_failed' };
    });
  }

  async transferPlayback(deviceId: string, play: boolean): Promise<CommandResult> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) return { ok: false, error: 'auth_missing' };
      const fromId = this.localDeviceId ?? this.captured.connectionId;
      const extra = this.partnerExtraHeaders();
      if (fromId) {
        const hosts = await this.resolveSpclient(tokens);
        for (const host of hosts) {
          const command = await this.pageFetch(
            jsonRequest(connectCommandUrl(host, fromId, deviceId), 'POST', tokens, connectTransferBody(play), extra),
          );
          if (command.ok) return { ok: true };
          const transfer = await this.pageFetch(
            jsonRequest(
              connectTransferUrl(host, fromId, deviceId),
              'POST',
              tokens,
              JSON.stringify({ play }),
              extra,
            ),
          );
          if (transfer.ok) return { ok: true };
        }
      }
      const rest = await this.publicFetch(
        publicJsonRequest(publicTransferUrl(), 'PUT', tokens, publicTransferBody(deviceId, play)),
      );
      if (rest.ok || rest.status === 204) return { ok: true };
      return { ok: false, error: 'transfer_failed' };
    });
  }

  async getLike(uri?: string): Promise<LikeStatusResult> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) return { ok: false, error: 'auth_missing' };
      const resolved = await this.resolveLibraryUri(uri);
      if ('error' in resolved) return { ok: false, error: resolved.error };
      await this.sniffHashes();
      const liked = await this.libraryContains(tokens, resolved);
      if (liked != null) return { ok: true, liked, uri: resolved.uri };
      if (await this.isCurrentTrack(uri, resolved.uri)) {
        const fromDom = await this.readNowPlayingLiked();
        if (fromDom != null) return { ok: true, liked: fromDom, uri: resolved.uri };
      }
      return { ok: false, error: 'like_failed' };
    });
  }

  async setLike(uri: string | undefined, liked: boolean): Promise<LikeStatusResult> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) return { ok: false, error: 'auth_missing' };
      const resolved = await this.resolveLibraryUri(uri);
      if ('error' in resolved) return { ok: false, error: resolved.error };
      await this.sniffHashes();
      const fromLibrary = await this.runLibraryApi(resolved.uri, liked, 'mutate');
      if (fromLibrary.ok) return { ok: true, liked, uri: resolved.uri };
      const current = await this.libraryContains(tokens, resolved);
      if (current === liked) {
        await this.runLibraryApi(resolved.uri, liked, 'sync');
        await this.paintNowPlayingLike(uri, resolved.uri, liked);
        return { ok: true, liked, uri: resolved.uri };
      }

      const operations = liked ? ADD_LIBRARY_OPERATIONS : REMOVE_LIBRARY_OPERATIONS;
      const urls = [...PATHFINDER_URLS, ...PATHFINDER_MUTATE_URLS];
      for (const vars of libraryVariableSets([resolved.uri])) {
        const gql = await this.tryGraphQL(tokens, operations, vars, urls);
        if (gql && graphQLLibraryWriteOk(gql, liked)) {
          await this.runLibraryApi(resolved.uri, liked, 'sync');
          await this.paintNowPlayingLike(uri, resolved.uri, liked);
          return { ok: true, liked, uri: resolved.uri };
        }
      }

      const method = liked ? 'PUT' : 'DELETE';
      const restRequests = [
        ...(resolved.kind === 'track' ? [publicJsonRequest(publicTracksUrl(resolved.id), method, tokens)] : []),
        publicJsonRequest(publicLibraryUrl(resolved.uri), method, tokens),
        publicJsonRequest(publicLibraryEndpoint(), method, tokens, publicLibraryBody([resolved.uri])),
      ];
      for (const request of restRequests) {
        const rest = await this.pageFetch(request);
        if (restLibraryWriteOk(rest, liked)) {
          await this.runLibraryApi(resolved.uri, liked, 'sync');
          await this.paintNowPlayingLike(uri, resolved.uri, liked);
          return { ok: true, liked, uri: resolved.uri };
        }
      }

      if (await this.isCurrentTrack(uri, resolved.uri)) {
        if (await this.clickNowPlayingLike(liked)) return { ok: true, liked, uri: resolved.uri };
      }
      return { ok: false, error: 'like_failed' };
    });
  }

  async searchCatalog(query: string, limit: number): Promise<SearchApiResult> {
    return this.serial(async () => {
      const tokens = await this.ensureTokens();
      if (!tokens) return { ok: false, error: 'auth_missing' };
      await this.sniffHashes();
      const gql = await this.tryGraphQL(tokens, SEARCH_OPERATIONS, searchVariables(query, limit));
      if (gql && graphQLOk(gql)) return { ok: true, results: parseSearchResults(gql.body, limit) };
      const rest = await this.publicFetch(publicJsonRequest(publicSearchUrl(query, limit), 'GET', tokens));
      if (rest.ok) return { ok: true, results: parseSearchResults(rest.body, limit) };
      return { ok: false, error: 'search_failed' };
    });
  }

  async health(): Promise<HealthStatus> {
    try {
      const url = this.host.getUrl();
      if (!url) return { ok: false, tab: false, bridge: false, url: null };
      let bridge = false;
      if (isOpenSpotifyUrl(url)) {
        bridge = await this.host.evaluate<boolean>('Boolean(window.__spotifyBridge)');
      }
      return { ok: bridge, tab: true, bridge, url };
    } catch (err) {
      if (err instanceof TabMissingError) {
        return { ok: false, tab: false, bridge: false, url: null };
      }
      throw err;
    }
  }

  async getDomDebug(): Promise<DomDebugDump> {
    return this.serial(async () => {
      return this.host.evaluate<DomDebugDump>(`(() => {
        const bridge = window.__spotifyBridge;
        if (!bridge?.getDomDebug) {
          return {
            title: '',
            widgetAria: null,
            testids: [],
            hrefs: [],
            sliders: [],
            hasPlayer: false,
            hasRequire: false,
            treeTrack: null,
          };
        }
        return bridge.getDomDebug();
      })()`);
    });
  }

  async getPlaybackDebug(): Promise<PlaybackDebugDump> {
    return this.serial(async () => {
      return this.host.evaluate<PlaybackDebugDump>(`(() => {
        const bridge = window.__spotifyBridge;
        if (!bridge?.getPlaybackDebug) {
          return {
            mediaSession: null,
            positionClock: null,
            durationClock: null,
            playPauseLabel: null,
            progress: null,
            playerKeys: [],
            stateSummary: {},
            liveSummary: {},
            livePosition: null,
            livePaused: null,
          };
        }
        return bridge.getPlaybackDebug();
      })()`);
    });
  }

  async getMethods(): Promise<PlayerMethodsDump> {
    return this.serial(async () => {
      return this.host.evaluate<PlayerMethodsDump>(`(() => {
        const bridge = window.__spotifyBridge;
        if (!bridge) return { found: false, methods: [], chunks: [], hasRequire: false, cacheSize: 0 };
        return bridge.getMethods();
      })()`);
    });
  }

  private async captchaVisible(): Promise<boolean> {
    if (urlLooksLikeCaptcha(this.host.getUrl())) return true;
    if (this.host.hasCaptchaPopup) {
      try {
        if (await this.host.hasCaptchaPopup()) return true;
      } catch {
        /* popup check failed */
      }
    }
    try {
      return await this.host.evaluate<boolean>(HAS_CAPTCHA);
    } catch {
      return false;
    }
  }

  private async waitForCaptcha(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.captchaVisible()) return true;
      await sleep(200);
    }
    return this.captchaVisible();
  }

  private async detectStep(): Promise<AuthStep> {
    const url = this.host.getUrl();
    const fromUrl = authStepFromUrl(url);
    if (fromUrl) return fromUrl;
    if (isOpenSpotifyUrl(url) && !url.includes('/login')) return 'done';
    return this.host.evaluate<AuthStep>(DETECT_AUTH_STEP);
  }

  private async fillLoginField(selectors: string[], fillScript: string, value: string): Promise<boolean> {
    const matches = (read: string) => {
      if (read === value) return true;
      return read.length > 0 && value.startsWith(read) && value.length > read.length;
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.host.evaluate<boolean>(fillScript);
      await sleep(80);
      const read = await this.host.evaluate<string>(readVisibleInputScript(selectors));
      if (matches(read)) return true;
    }
    if (this.host.typeText) {
      const focused = await this.host.evaluate<boolean>(focusVisibleInputScript(selectors));
      if (focused) {
        await this.host.typeText(value);
        await sleep(80);
        const typed = await this.host.evaluate<string>(readVisibleInputScript(selectors));
        if (matches(typed)) return true;
      }
    }
    const last = await this.host.evaluate<string>(readVisibleInputScript(selectors));
    return matches(last);
  }

  private async advanceFromEmail(email: string, opts?: { reload?: boolean }): Promise<AuthStep> {
    if (opts?.reload !== false) {
      await this.host.loadURL(LOGIN_URL);
    }
    const hasField = await this.host.evaluate<boolean>(waitForUsernameFieldScript(opts?.reload === false ? 4_000 : 12_000));
    await this.host.evaluate<void>(DISMISS_BANNERS);
    if (!hasField) return 'email';
    await sleep(300);
    if (!(await this.fillLoginField(USERNAME_SELECTORS, fillEmailScript(email), email))) {
      return 'email';
    }
    let ready = await this.host.evaluate<boolean>(waitForContinueEnabledScript(2_000));
    if (!ready && this.host.typeText) {
      const focused = await this.host.evaluate<boolean>(focusVisibleInputScript(USERNAME_SELECTORS));
      if (focused) await this.host.typeText(email, { selectAll: true });
      ready = await this.host.evaluate<boolean>(waitForContinueEnabledScript(2_000));
    }
    if (!ready) await this.host.evaluate<boolean>(waitForContinueEnabledScript(1_000));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const step = await this.detectStep();
      if (step === 'password' || step === 'code' || step === 'done') return step;
      await this.host.evaluate<boolean>(SUBMIT_LOGIN_FORM);
      const next = await this.waitForNextStep(5_000);
      if (next === 'password' || next === 'code' || next === 'done') return next;
      await sleep(400);
    }
    return this.detectStep();
  }

  private async fillOtp(code: string): Promise<boolean> {
    const digits = code.replace(/\s+/g, '');
    const matches = (read: string) => read.replace(/\s+/g, '') === digits;
    const nextWasEnabled = await this.host.evaluate<boolean>(CONTINUE_ENABLED);
    await this.host.evaluate<string>(fillEmailCodeScript(digits));
    await sleep(80);
    if (matches(await this.host.evaluate<string>(readOtpValueScript()))) return true;
    if (this.host.focusPage) await this.host.focusPage();
    await this.host.evaluate<boolean>(focusOtpScript());
    if (this.host.typeText) {
      await this.host.typeText(digits, { selectAll: false });
      await sleep(200);
    }
    if (matches(await this.host.evaluate<string>(readOtpValueScript()))) return true;
    await this.host.evaluate<string>(fillEmailCodeScript(digits));
    await sleep(80);
    if (matches(await this.host.evaluate<string>(readOtpValueScript()))) return true;
    const nextEnabled = await this.host.evaluate<boolean>(CONTINUE_ENABLED);
    return nextEnabled && !nextWasEnabled;
  }

  private async waitForNextStep(timeoutMs: number): Promise<AuthStep> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const step = await this.detectStep();
        if (step === 'password' || step === 'code' || step === 'done') return step;
      } catch {
        /* navigation between login steps */
      }
      await sleep(200);
    }
    try {
      return await this.detectStep();
    } catch {
      return 'email';
    }
  }

  private async waitForLoggedIn(timeoutMs: number): Promise<AuthResult> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const url = this.host.getUrl();
        if (isOpenSpotifyUrl(url) && !url.includes('/login')) {
          return this.waitForAuthTokens(8_000);
        }
        const step = await this.detectStep();
        if (await this.captchaVisible()) {
          return { ...emptyAuthResult(step), ok: false, error: 'captcha_required', captcha: true };
        }
        if (step === 'done') return this.waitForAuthTokens(8_000);
        const message = await this.host.evaluate<string | null>(READ_LOGIN_ERROR);
        if (message) {
          return { ...emptyAuthResult(step), ok: false, error: 'login_failed' };
        }
      } catch {
        /* navigation after submit */
      }
      await sleep(250);
    }
    try {
      const url = this.host.getUrl();
      if (isOpenSpotifyUrl(url) && !url.includes('/login')) {
        return this.waitForAuthTokens(8_000);
      }
      const next = await this.detectStep();
      if (await this.captchaVisible()) {
        return { ...emptyAuthResult(next), ok: false, error: 'captcha_required', captcha: true };
      }
      if (next === 'done') return this.waitForAuthTokens(8_000);
      return { ...emptyAuthResult(next), ok: false, error: 'login_failed' };
    } catch {
      return { ...emptyAuthResult('code'), ok: false, error: 'login_timeout' };
    }
  }

  private async readAuth(): Promise<AuthResult> {
    const url = this.host.getUrl();
    if (isAccountsUrl(url) || urlLooksLikeCaptcha(url)) {
      const step = await this.detectStep();
      const captcha = await this.captchaVisible();
      return { ...emptyAuthResult(step), captcha };
    }
    let fromBridge: {
      loggedIn?: boolean;
      hasPremium?: boolean;
      email?: string | null;
      accessToken?: string | null;
      expiresAt?: number | null;
      clientToken?: string | null;
    } | null = null;
    try {
      fromBridge = await this.host.evaluate(`(async () => {
        const bridge = window.__spotifyBridge;
        if (!bridge?.getAuth) return null;
        return bridge.getAuth();
      })()`);
    } catch {
      fromBridge = null;
    }
    const cookieNames = this.host.getCookieNames ? await this.host.getCookieNames() : [];
    const cookieLoggedIn = cookieNamesIndicateLogin(cookieNames);
    const parsedCaptured = this.captured.accessToken ? parseAuthToken(this.captured.accessToken) : null;
    let hookedCapture: { accessToken: string | null; clientToken: string | null } | null = null;
    try {
      hookedCapture = await this.host.evaluate(`window.__spotifyAuthCapture ?? null`);
    } catch {
      hookedCapture = null;
    }
    const accessToken =
      fromBridge?.accessToken ?? hookedCapture?.accessToken ?? parsedCaptured?.accessToken ?? null;
    let loginCtaVisible = false;
    try {
      loginCtaVisible = await this.host.evaluate(`(() => {
        const el = document.querySelector('[data-testid="login-button"], [data-testid="signup-button"]');
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })()`);
    } catch {
      loginCtaVisible = false;
    }
    const loggedIn = loginCtaVisible ? false : Boolean(fromBridge?.loggedIn || cookieLoggedIn || accessToken);
    if (!loggedIn) {
      const step = await this.detectStep();
      return {
        ok: true,
        loggedIn: false,
        hasPremium: false,
        email: null,
        step,
        codeRequired: step === 'code',
        accessToken: null,
        expiresAt: null,
        tokenType: null,
        clientToken: null,
      };
    }
    const email = pickEmail(fromBridge?.email) ?? this.accountEmail;
    if (email) {
      if (this.accountEmail !== email) {
        try {
          await this.host.evaluate(
            `try{localStorage.setItem('mss.accountEmail',${JSON.stringify(email)})}catch(e){}`,
          );
        } catch {
          /* page not ready */
        }
      }
      this.accountEmail = email;
    }
    return {
      ok: true,
      loggedIn: true,
      hasPremium: Boolean(fromBridge?.hasPremium),
      email,
      step: 'done',
      codeRequired: false,
      accessToken,
      expiresAt: fromBridge?.expiresAt ?? parsedCaptured?.expiresAt ?? null,
      tokenType: accessToken ? 'Bearer' : null,
      clientToken: fromBridge?.clientToken ?? hookedCapture?.clientToken ?? this.captured.clientToken,
    };
  }

  private async waitForAuthTokens(timeoutMs: number): Promise<AuthResult> {
    const deadline = Date.now() + timeoutMs;
    let last = await this.readAuth();
    while (!last.accessToken && last.loggedIn && Date.now() < deadline) {
      await sleep(400);
      last = await this.readAuth();
    }
    return last;
  }

  private async ensureTokens(): Promise<PartnerTokens | null> {
    let auth = await this.readAuth();
    if (!auth.accessToken && !this.captured.accessToken && auth.loggedIn) {
      auth = await this.waitForAuthTokens(5_000);
    }
    const accessToken = auth.accessToken ?? this.captured.accessToken;
    if (!accessToken) return null;
    return { accessToken, clientToken: auth.clientToken ?? this.captured.clientToken };
  }

  private partnerExtraHeaders(): Record<string, string> {
    return {
      'spotify-app-version': this.captured.appVersion ?? '1.2.81.104.g225ec0e6',
      ...(this.captured.connectionId ? { 'x-spotify-connection-id': this.captured.connectionId } : {}),
    };
  }

  private rememberDevices(devices: ConnectDevice[]): ConnectDevice[] {
    const filtered = devices.filter((device) => {
      if (device.id === this.observerDeviceId) return false;
      if (device.id === `hobs_${this.observerDeviceId}`) return false;
      return true;
    });
    if (filtered.length > 0) {
      this.cachedDevices = filtered;
      const active = filtered.find((device) => device.isActive);
      if (active) this.localDeviceId = active.id;
    }
    return filtered;
  }

  private async resolveSpclient(tokens: PartnerTokens): Promise<string[]> {
    if (this.spclientHosts?.length) return this.spclientHosts;
    const result = await this.pageFetch(jsonRequest(APRESOLVE_URL, 'GET', tokens));
    const hosts = parseSpclientHosts(result.body);
    this.spclientHosts = hosts.length > 0 ? hosts : fallbackSpclientHosts();
    return this.spclientHosts;
  }

  private async sniffHashes(): Promise<void> {
    if (this.hashesSniffed) return;
    this.hashesSniffed = true;
    try {
      const inline = await this.host.evaluate<string[]>(`(() =>
        Array.from(document.scripts)
          .filter((script) => !script.src)
          .map((script) => script.textContent ?? '')
          .filter((text) => /addToLibrary|removeFromLibrary|sha256Hash|"mutation"/.test(text))
      )()`);
      for (const source of inline) {
        for (const item of extractQueryHashes(source)) this.hashCache.remember(item.operationName, item.sha256Hash);
      }
      const scriptUrls = await this.host.evaluate<string[]>(`(() => {
        const urls = [
          ...Array.from(document.scripts).map((script) => script.src),
          ...Array.from(document.querySelectorAll("link[rel='modulepreload'], link[rel='preload'][as='script']")).map(
            (link) => link.href,
          ),
          ...performance.getEntriesByType('resource').map((entry) => entry.name),
        ];
        return urls.filter((src) => /spotifycdn|web-player|xpui/i.test(src) && /\\.js(\\?|$)/i.test(src));
      })()`);
      const ranked = [...new Set(scriptUrls)].sort((a, b) => {
        const score = (url: string) => {
          if (/web-player\\.[a-f0-9]/i.test(url)) return 4;
          if (/web-player/i.test(url)) return 3;
          if (/xpui/i.test(url)) return 2;
          return 1;
        };
        return score(b) - score(a);
      }).slice(0, 8);
      for (const url of ranked) {
        try {
          const text = await this.host.evaluate<string>(`(async () => {
            const res = await fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) return '';
            return res.text();
          })()`);
          if (!text) continue;
          const found = extractQueryHashes(text);
          for (const item of found) this.hashCache.remember(item.operationName, item.sha256Hash);
          if (found.some((item) => item.operationName === 'addToLibrary' || item.operationName === 'addItemsToLibrary')) {
            break;
          }
        } catch {
          /* CDN chunk may 404 */
        }
      }
    } catch {
      this.hashesSniffed = false;
    }
  }

  private async peekTrackUri(): Promise<string | null> {
    try {
      return await this.host.evaluate<string | null>(PEEK_TRACK_URI);
    } catch {
      return null;
    }
  }

  private async resolveLibraryUri(
    uri?: string,
  ): Promise<{ uri: string; id: string; kind: string } | { error: string }> {
    const raw = uri ?? (await this.peekTrackUri());
    if (!raw) return { error: 'no_track' };
    const parsed = parsePlayUri(raw);
    if (!parsed) return { error: 'invalid_uri' };
    return parsed;
  }

  private async libraryContains(
    tokens: PartnerTokens,
    resolved: { uri: string; id: string; kind: string },
  ): Promise<boolean | null> {
    const gql = await this.tryGraphQL(tokens, IN_LIBRARY_OPERATIONS, libraryVariables([resolved.uri]));
    if (gql && graphQLOk(gql)) {
      const liked = parseIsInLibrary(gql.body);
      if (liked != null) return liked;
    }
    const restUrls = [
      ...(resolved.kind === 'track' ? [publicContainsUrl(resolved.id)] : []),
      publicLibraryContainsUrl(resolved.uri),
    ];
    for (const url of restUrls) {
      const rest = await this.pageFetch(publicJsonRequest(url, 'GET', tokens));
      const liked = parseIsInLibrary(rest.body);
      if (liked != null) return liked;
    }
    return null;
  }

  private async isCurrentTrack(requestedUri: string | undefined, resolvedUri: string): Promise<boolean> {
    if (requestedUri == null) return true;
    return (await this.peekTrackUri()) === resolvedUri;
  }

  private async paintNowPlayingLike(
    requestedUri: string | undefined,
    resolvedUri: string,
    liked: boolean,
  ): Promise<void> {
    if (!(await this.isCurrentTrack(requestedUri, resolvedUri))) return;
    await this.clickNowPlayingLike(liked);
  }

  private async readNowPlayingLiked(): Promise<boolean | null> {
    try {
      return await this.host.evaluate<boolean | null>(READ_NOW_PLAYING_LIKED);
    } catch {
      return null;
    }
  }

  private async clickNowPlayingLike(liked: boolean): Promise<boolean> {
    try {
      return (await this.host.evaluate<boolean>(clickNowPlayingLikeScript(liked))) === true;
    } catch {
      return false;
    }
  }

  private async runLibraryApi(
    uri: string,
    liked: boolean,
    mode: 'mutate' | 'sync',
  ): Promise<{ ok: boolean; method: string; error?: string }> {
    try {
      return await this.host.evaluate(runLibraryApiScript(uri, liked, mode));
    } catch (err) {
      return { ok: false, method: 'throw', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async tryGraphQL(
    tokens: PartnerTokens,
    operations: readonly string[],
    variables: Record<string, unknown>,
    urls: readonly string[] = PATHFINDER_URLS,
  ): Promise<PageFetchResult | null> {
    const extra = this.partnerExtraHeaders();
    let last: PageFetchResult | null = null;
    for (const operationName of operations) {
      const hash = this.hashCache.get(operationName);
      if (!hash) continue;
      for (const url of urls) {
        const result = await this.pageFetch(
          graphQLRequest(url, tokens, operationName, hash, variables, extra),
        );
        last = result;
        if (persistedQueryMissing(result)) continue;
        if (graphQLOk(result)) return result;
      }
    }
    return last;
  }

  private async pageFetch(request: PageFetchRequest): Promise<PageFetchResult> {
    const fromPage = await this.host.evaluate<PageFetchResult>(pageFetchScript(request));
    if (fromPage.status > 0 && !isUnauthorized(fromPage)) return fromPage;
    const fromNode = await nodeFetch(request);
    if (fromNode.status > 0) return fromNode;
    return fromPage;
  }

  private async publicFetch(request: PageFetchRequest): Promise<PageFetchResult> {
    return this.pageFetch(request);
  }
}

function idleSnapshot(): PlaybackSnapshot {
  return {
    ready: false,
    uri: null,
    id: null,
    title: null,
    artists: [],
    album: null,
    durationMs: null,
    positionMs: 0,
    isPlaying: false,
    liked: null,
    volume: null,
    shuffle: 'Unavailable',
    repeat: 'Unavailable',
    muted: null,
    sampledAt: Date.now(),
    source: 'dom',
  };
}

export { captureAuthHeaders };
