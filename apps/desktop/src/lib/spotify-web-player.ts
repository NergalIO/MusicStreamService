/**
 * Spotify Web Playback SDK — полные треки для Premium (аудио идёт через SDK, не через Web Audio).
 */

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
const PLAYER_NAME = 'MusicStream';
const DEVICE_WAIT_MS = 25_000;

function mapSpotifySdkError(raw: string): string {
  if (/failed to initialize player/i.test(raw)) {
    return (
      'Spotify не запустил плеер: нет модуля Widevine (DRM). Перезапустите приложение — он скачивается при первом запуске. Нужен Premium.'
    );
  }
  if (/invalid token scopes?/i.test(raw)) {
    return (
      'Invalid token scopes: для Web Playback нужны streaming, user-read-email и user-read-private. ' +
      'Отключите Spotify в Настройках MSS, удалите приложение на open.spotify.com/account/apps и подключите снова, подтвердив все разрешения.'
    );
  }
  return raw;
}

export type SpotifyPlayerEvent =
  | 'play'
  | 'pause'
  | 'timeupdate'
  | 'durationchange'
  | 'ended'
  | 'nearend'
  | 'waiting'
  | 'playing'
  | 'error';

type Listener = () => void;

interface SpotifyPlaybackState {
  paused: boolean;
  position: number;
  duration: number;
  track_window?: { current_track?: { uri: string } };
}

interface SpotifyPlayerInstance {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setVolume(v: number): Promise<void>;
  activateElement(): Promise<void>;
  getCurrentState(): Promise<SpotifyPlaybackState | null>;
  addListener(event: string, cb: (payload: unknown) => void): void;
  removeListener(event: string, cb: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        volume: number;
        getOAuthToken: (cb: (token: string) => void) => void;
      }) => SpotifyPlayerInstance;
    };
  }
}

async function spotifyToken(): Promise<string> {
  const token = await window.electronAPI.connectors.accessToken('spotify');
  if (!token) throw new Error('Spotify не подключён — войдите в Настройках');
  return token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function discoverDeviceId(token: string): Promise<string | null> {
  const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { devices?: { id: string; name: string }[] };
  const device =
    data.devices?.find((d) => d.name === PLAYER_NAME) ??
    data.devices?.find((d) => d.name.toLowerCase() === PLAYER_NAME.toLowerCase());
  return device?.id ?? null;
}

function sdkReady(): boolean {
  return !!window.Spotify?.Player;
}

function loadSdk(): Promise<void> {
  if (sdkReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => (sdkReady() ? resolve() : reject(new Error('Spotify SDK не инициализировался')));
    const timeout = setTimeout(
      () => reject(new Error('Таймаут загрузки Spotify Web Playback SDK — проверьте интернет')),
      30_000,
    );
    const prevReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prevReady?.();
      clearTimeout(timeout);
      finish();
    };

    const existing = document.querySelector(`script[src="${SDK_SRC}"]`);
    if (existing) {
      if (sdkReady()) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      existing.addEventListener(
        'load',
        () => {
          if (sdkReady()) {
            clearTimeout(timeout);
            resolve();
          }
        },
        { once: true },
      );
      existing.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          reject(new Error('Не удалось загрузить Spotify Web Playback SDK'));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => {
      if (sdkReady()) {
        clearTimeout(timeout);
        resolve();
      }
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Не удалось загрузить Spotify Web Playback SDK'));
    };
    document.head.appendChild(script);
  });
}

class SpotifyWebPlayer {
  private player: SpotifyPlayerInstance | null = null;
  private deviceId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private activeUri = '';
  private lastState: SpotifyPlaybackState | null = null;
  private nearEndFired = false;
  private endedEmitted = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Map<SpotifyPlayerEvent, Set<Listener>>();

  isActive(): boolean {
    return !!this.activeUri;
  }

  on(event: SpotifyPlayerEvent, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  private emit(event: SpotifyPlayerEvent): void {
    this.listeners.get(event)?.forEach((l) => l());
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.player?.getCurrentState().then((s) => this.handleState(s));
    }, 400);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private handleState(state: SpotifyPlaybackState | null): void {
    if (!state) return;
    this.lastState = state;
    this.emit('timeupdate');
    if (state.track_window?.current_track?.uri === this.activeUri) {
      this.emit('durationchange');
      if (!state.paused) this.emit('playing');
    }
    if (!state.paused && state.duration > 0 && state.duration - state.position <= 1500 && !this.nearEndFired) {
      this.nearEndFired = true;
      this.emit('nearend');
    }
    if (!this.endedEmitted && state.duration > 0 && state.position >= state.duration - 400) {
      this.endedEmitted = true;
      this.emit('ended');
    }
  }

  private async waitForDeviceId(_player: SpotifyPlayerInstance): Promise<void> {
    if (this.deviceId) return;
    const deadline = Date.now() + DEVICE_WAIT_MS;

    while (!this.deviceId && Date.now() < deadline) {
      try {
        const token = await spotifyToken();
        const id = await discoverDeviceId(token);
        if (id) {
          this.deviceId = id;
          break;
        }
      } catch {
        /* retry */
      }
      await sleep(400);
    }

    if (!this.deviceId) {
      throw new Error(
        'Spotify не зарегистрировал плеер. Нужен Premium и права streaming, user-read-email, user-read-private. Переподключите Spotify в Настройках и перезапустите приложение.',
      );
    }
  }

  private async ensureReady(): Promise<SpotifyPlayerInstance> {
    if (this.player && this.deviceId) return this.player;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        let sdkError: string | null = null;
        try {
          await loadSdk();
          if (!window.Spotify?.Player) throw new Error('Spotify SDK недоступен');
          const player = new window.Spotify.Player({
            name: PLAYER_NAME,
            volume: 0.85,
            getOAuthToken: (cb) => {
              void spotifyToken()
                .then((t) => cb(t))
                .catch(() => cb(''));
            },
          });
          player.addListener('ready', ({ device_id }: { device_id: string }) => {
            this.deviceId = device_id;
          });
          player.addListener('not_ready', () => {
            this.deviceId = null;
          });
          player.addListener('player_state_changed', (state) => this.handleState(state as SpotifyPlaybackState | null));
          const noteError = (msg: unknown) => {
            const raw = typeof msg === 'string' ? msg : (msg as { message?: string })?.message ?? 'Spotify SDK error';
            sdkError = mapSpotifySdkError(raw);
          };
          player.addListener('authentication_error', noteError);
          player.addListener('account_error', noteError);
          player.addListener('playback_error', noteError);
          player.addListener('initialization_error', noteError);

          const connected = await player.connect();
          if (sdkError) throw new Error(String(sdkError));
          if (!connected) {
            throw new Error(
              'Spotify Web Playback не подключился. Нужен Premium и повторный вход в Spotify в Настройках (streaming, user-read-email, user-read-private).',
            );
          }
          this.player = player;
          await this.waitForDeviceId(player);
        } catch (e) {
          this.initPromise = null;
          this.player = null;
          this.deviceId = null;
          throw e;
        }
      })();
    }
    try {
      await this.initPromise;
    } catch (e) {
      this.initPromise = null;
      throw e;
    }
    if (!this.player || !this.deviceId) throw new Error('Spotify player not ready');
    return this.player;
  }

  private async transferToThisDevice(token: string): Promise<void> {
    if (!this.deviceId) return;
    const res = await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_ids: [this.deviceId], play: false }),
    });
    if (res.status === 204 || res.ok) return;
    if (res.status === 403) {
      const body = await res.text().catch(() => '');
      if (/premium/i.test(body)) throw new Error('Для полных треков Spotify нужен Premium');
    }
  }

  async play(uri: string, startAtSec = 0): Promise<void> {
    const player = await this.ensureReady();
    await player.activateElement().catch(() => undefined);
    const token = await spotifyToken();
    await this.transferToThisDevice(token);

    const positionMs = Math.max(0, Math.round(startAtSec * 1000));
    let res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(this.deviceId!)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
      },
    );

    if (res.status === 404) {
      await this.transferToThisDevice(token);
      res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(this.deviceId!)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
        },
      );
    }

    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '');
      if (res.status === 403 && /premium/i.test(body)) {
        throw new Error('Для полных треков Spotify нужен Premium на аккаунте, которым вы слушаете');
      }
      if (res.status === 401) {
        throw new Error('Сессия Spotify истекла — отключите и подключите Spotify в Настройках');
      }
      let detail = body.trim();
      try {
        const j = JSON.parse(body) as { error?: { message?: string; reason?: string } };
        const reason = j.error?.reason ?? '';
        detail = j.error?.message ?? detail;
        if (res.status === 429 || reason === 'QUOTA_EXCEEDED' || /QUOTA_EXCEEDED/i.test(body)) {
          throw new Error(
            'Исчерпана квота Spotify Web API (Development Mode). Подождите или запросите Extended Quota в Spotify Developer Dashboard.',
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('квота Spotify')) throw e;
        /* raw body */
      }
      throw new Error(detail || `Spotify не начал воспроизведение (${res.status})`);
    }

    this.activeUri = uri;
    this.nearEndFired = false;
    this.endedEmitted = false;
    this.lastState = null;
    const state = await player.getCurrentState();
    if (state) this.lastState = state;
    this.emit('play');
    this.emit('durationchange');
    this.emit('playing');
    this.startPolling();
  }

  async resume(): Promise<void> {
    if (!this.player) return;
    await this.player.resume();
    this.emit('play');
    this.emit('playing');
  }

  pause(): void {
    void this.player?.pause();
    this.emit('pause');
  }

  stop(): void {
    this.stopPolling();
    this.activeUri = '';
    this.lastState = null;
    this.nearEndFired = false;
    this.endedEmitted = false;
    void this.player?.pause();
    this.emit('pause');
  }

  seek(seconds: number): void {
    const d = this.getDuration();
    const targetMs = Math.round(Math.max(0, d ? Math.min(seconds, d) : seconds) * 1000);
    void (async () => {
      const token = await spotifyToken();
      if (!this.deviceId) return;
      await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${targetMs}&device_id=${encodeURIComponent(this.deviceId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (this.lastState) this.lastState = { ...this.lastState, position: targetMs };
      this.emit('timeupdate');
    })();
  }

  setVolume(linear: number): void {
    void this.player?.setVolume(Math.max(0, Math.min(1, linear)));
  }

  get paused(): boolean {
    return this.lastState?.paused ?? !this.activeUri;
  }

  getCurrentTime(): number {
    return (this.lastState?.position ?? 0) / 1000;
  }

  getDuration(): number {
    const d = this.lastState?.duration ?? 0;
    return d > 0 ? d / 1000 : 0;
  }
}

let singleton: SpotifyWebPlayer | null = null;

export function getSpotifyWebPlayer(): SpotifyWebPlayer {
  if (!singleton) singleton = new SpotifyWebPlayer();
  return singleton;
}

export function isSpotifyPlaybackActive(): boolean {
  return getSpotifyWebPlayer().isActive();
}
