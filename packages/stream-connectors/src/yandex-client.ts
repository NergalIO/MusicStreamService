import { randomBytes } from 'node:crypto';
import type { DeviceCodePrompt, ExternalAccount } from '@mss/shared';
import type { TokenVault } from './types.js';

/** Публичные OAuth-данные Android-клиента Яндекс Музыки: только такой токен даёт полные треки. */
export const YANDEX_MUSIC_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';
export const YANDEX_MUSIC_CLIENT_SECRET = '53bc75238f0c4d08a118e51fe9203300';
/** Ключ подписи download-info и lyrics (Android-клиент). */
export const ANDROID_SIGN_KEY = 'p93jhgh689SBReK6ghtw62';
/** Ключ подписи get-file-info (веб-клиент), меняется с релизами фронтенда Яндекса. */
export const WEB_FILE_INFO_SIGN_KEY = '7tvSmFbyf5hJnIHhCimDDD';
export const DIRECT_LINK_SALT = 'XGRlBW9FXlekgbPrRHuSiA';

const CLIENT_HEADERS = {
  android: 'YandexMusicAndroid/24023621',
  /** get-file-info принимает WEB_FILE_INFO_SIGN_KEY только от веб-клиента, с Android-заголовком отвечает not-allowed. */
  web: 'YandexMusicWebNext/1.0.0',
} as const;

export type YandexClientKind = keyof typeof CLIENT_HEADERS;

const OAUTH_BASE = 'https://oauth.yandex.ru';
const API_BASE = 'https://api.music.yandex.net';
const VAULT_KEY = 'yandex_tokens';
const ACCOUNT_KEY = 'yandex_account';
const LEGACY_VAULT_KEY = 'yandex_token';

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  client_id: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  interval: number;
  expires_in: number;
}

export class YandexApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface YandexClientOptions {
  vault: TokenVault;
  openExternal: (url: string) => void;
  onDeviceCode?: (prompt: DeviceCodePrompt) => void;
  clientId?: string;
  clientSecret?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class YandexClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private authAbort: AbortController | null = null;
  /** Яндекс режет параллельные запросы — сериализуем API-вызовы. */
  private requestTail: Promise<void> = Promise.resolve();

  constructor(private readonly opts: YandexClientOptions) {
    this.clientId = opts.clientId || YANDEX_MUSIC_CLIENT_ID;
    this.clientSecret = opts.clientSecret || YANDEX_MUSIC_CLIENT_SECRET;
    opts.vault.delete(LEGACY_VAULT_KEY);
  }

  private loadTokens(): StoredTokens | null {
    const raw = this.opts.vault.get(VAULT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return null;
    }
  }

  private saveTokens(t: StoredTokens): void {
    this.opts.vault.set(VAULT_KEY, JSON.stringify(t));
  }

  /** Токен, выданный не музыкальному клиенту, Music API принимает только как превью. */
  get status(): 'disconnected' | 'connected' | 'expired' {
    const t = this.loadTokens();
    if (!t) return 'disconnected';
    if (t.client_id !== this.clientId) return 'expired';
    if (Date.now() >= t.expires_at && !t.refresh_token) return 'expired';
    return 'connected';
  }

  get cachedAccount(): ExternalAccount | null {
    const raw = this.opts.vault.get(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as ExternalAccount) : null;
  }

  private async oauthPost<T>(path: string, body: Record<string, string>): Promise<T> {
    const res = await fetch(`${OAUTH_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: this.authAbort?.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
    if (!res.ok) {
      throw new YandexApiError(res.status, data.error ?? `OAuth ${res.status}`);
    }
    return data;
  }

  async login(): Promise<void> {
    this.cancelLogin();
    const abort = new AbortController();
    this.authAbort = abort;

    const code = await this.oauthPost<DeviceCodeResponse>('/device/code', {
      client_id: this.clientId,
      device_id: randomBytes(8).toString('hex'),
      device_name: 'MusicStreamService Desktop',
    });

    this.opts.onDeviceCode?.({
      source: 'yandex',
      userCode: code.user_code,
      verificationUrl: code.verification_url,
      expiresIn: code.expires_in,
    });
    this.opts.openExternal(code.verification_url);

    const deadline = Date.now() + code.expires_in * 1000;
    const interval = Math.max(code.interval, 1) * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (abort.signal.aborted) throw new Error('Вход в Яндекс отменён');
      try {
        const token = await this.oauthPost<{
          access_token: string;
          refresh_token?: string;
          expires_in: number;
        }>('/token', {
          grant_type: 'device_code',
          code: code.device_code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        });
        this.saveTokens({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: Date.now() + token.expires_in * 1000,
          client_id: this.clientId,
        });
        this.authAbort = null;
        await this.fetchAccount().catch(() => null);
        return;
      } catch (e) {
        if (abort.signal.aborted) throw new Error('Вход в Яндекс отменён');
        if (e instanceof YandexApiError && e.message === 'authorization_pending') continue;
        this.authAbort = null;
        throw new Error(`Яндекс OAuth: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.authAbort = null;
    throw new Error('Код подтверждения истёк, попробуйте ещё раз');
  }

  cancelLogin(): void {
    this.authAbort?.abort();
    this.authAbort = null;
  }

  logout(): void {
    this.cancelLogin();
    this.opts.vault.delete(VAULT_KEY);
    this.opts.vault.delete(ACCOUNT_KEY);
  }

  async token(): Promise<string | null> {
    const t = this.loadTokens();
    if (!t || t.client_id !== this.clientId) return null;
    if (Date.now() < t.expires_at - 60_000) return t.access_token;
    if (!t.refresh_token) return null;
    try {
      const data = await this.oauthPost<{ access_token: string; expires_in: number; refresh_token?: string }>(
        '/token',
        {
          grant_type: 'refresh_token',
          refresh_token: t.refresh_token,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
      );
      this.saveTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? t.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
        client_id: this.clientId,
      });
      return data.access_token;
    } catch {
      return null;
    }
  }

  private runQueued<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.requestTail;
    this.requestTail = prev.then(() => slot);
    return prev.then(fn).finally(() => release());
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: { form?: Record<string, string>; json?: unknown },
    client: YandexClientKind = 'android',
  ): Promise<T> {
    return this.runQueued(async () => {
      const token = await this.token();
      if (!token) throw new YandexApiError(401, 'Яндекс Музыка не подключена');
      const headers: Record<string, string> = {
        Authorization: `OAuth ${token}`,
        'Accept-Language': 'ru',
        'X-Yandex-Music-Client': CLIENT_HEADERS[client],
      };
      let payload: BodyInit | undefined;
      if (body?.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = new URLSearchParams(body.form);
      } else if (body?.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body.json);
      }

      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
        if (res.ok) {
          const data = (await res.json()) as { result?: T } & T;
          return (data.result ?? data) as T;
        }
        const text = await res.text().catch(() => '');
        if (res.status === 429 && attempt < 3) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw new YandexApiError(res.status, `Yandex API ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      throw new YandexApiError(429, 'Yandex API 429: Concurrency limit exceeded');
    });
  }

  get<T>(path: string, client?: YandexClientKind): Promise<T> {
    return this.request<T>('GET', path, undefined, client);
  }

  postForm<T>(path: string, form: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, { form });
  }

  postJson<T>(path: string, json: unknown): Promise<T> {
    return this.request<T>('POST', path, { json });
  }

  async fetchAccount(): Promise<ExternalAccount> {
    const data = await this.get<{
      account?: { uid?: number; login?: string; displayName?: string; fullName?: string };
      plus?: { hasPlus?: boolean };
    }>('/account/status');
    const account: ExternalAccount = {
      uid: String(data.account?.uid ?? ''),
      login: data.account?.login,
      displayName: data.account?.displayName ?? data.account?.fullName,
      hasPlus: Boolean(data.plus?.hasPlus),
    };
    this.opts.vault.set(ACCOUNT_KEY, JSON.stringify(account));
    return account;
  }

  async uid(): Promise<string> {
    const cached = this.cachedAccount;
    if (cached?.uid) return cached.uid;
    const account = await this.fetchAccount();
    if (!account.uid) throw new Error('Не удалось определить аккаунт Яндекса');
    return account.uid;
  }
}
