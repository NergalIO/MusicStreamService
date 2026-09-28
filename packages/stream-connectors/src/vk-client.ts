import type { ExternalAccount, LoginMethod, LoginPrompt, LoginReply } from '@mss/shared';
import type { AuthStatus, TokenVault } from './types.js';
import {
  VK_HEADERS,
  VK_KATE_CLIENT_ID,
  VK_KATE_CLIENT_SECRET,
  checkQr,
  confirmSms,
  deviceIdFromVault,
  normalizeVkPhone,
  sendPhoneOtp,
  startQrSession,
  startVkIdSession,
  validateAccount,
  VkAuthError,
  type QrSession,
  type VkIdSession,
  type VkTokenResponse,
} from './vk-auth.js';

export {
  VK_HEADERS,
  VK_KATE_CLIENT_ID,
  VK_KATE_CLIENT_SECRET,
  VK_KATE_USER_AGENT,
  type VkTokenResponse,
} from './vk-auth.js';

const OAUTH_URL = 'https://oauth.vk.com/token';
const API_URL = 'https://api.vk.com/method';
const API_VERSION = '5.131';
const VAULT_KEY = 'vk_tokens';
const ACCOUNT_KEY = 'vk_account';
const QR_POLL_MS = 2000;

const SCOPE = [
  'audio',
  'offline',
  'friends',
  'groups',
  'status',
  'wall',
  'photos',
  'video',
  'docs',
  'notes',
  'pages',
  'stats',
  'notifications',
  'messages',
].join(',');

export class VkApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface VkAuthNeedCaptcha {
  error: 'need_captcha';
  captcha_sid: string;
  captcha_img: string;
}

export interface VkAuthNeedValidation {
  error: 'need_validation';
  validation_type?: string;
  phone_mask?: string;
  error_description?: string;
}

export interface VkAuthFailed {
  error: string;
  error_description?: string;
}

export type VkAuthResult = VkTokenResponse | VkAuthNeedCaptcha | VkAuthNeedValidation | VkAuthFailed;

interface StoredTokens {
  access_token: string;
  user_id: number;
}

export interface VkClientOptions {
  vault: TokenVault;
  onLoginPrompt: (prompt: LoginPrompt, signal?: AbortSignal) => Promise<LoginReply>;
  onLoginPromptUpdate?: (prompt: LoginPrompt) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isToken(v: VkAuthResult): v is VkTokenResponse {
  return 'access_token' in v && typeof v.access_token === 'string';
}

function isCaptcha(v: VkAuthResult): v is VkAuthNeedCaptcha {
  return 'error' in v && v.error === 'need_captcha';
}

function isValidation(v: VkAuthResult): v is VkAuthNeedValidation {
  return 'error' in v && v.error === 'need_validation';
}

function authErrorMessage(result: VkAuthFailed): string {
  const desc = result.error_description ?? '';
  if (result.error === 'invalid_client' || /password|username/i.test(desc)) {
    return 'Неверный логин или пароль';
  }
  if (/flood/i.test(result.error) || /flood/i.test(desc)) return 'Слишком много попыток входа, подождите';
  return desc || `VK отказал во входе (${result.error})`;
}

type LoginFlowResult = { kind: 'done' } | { kind: 'switch'; method: LoginMethod; error?: string };

export class VkClient {
  status: AuthStatus = 'disconnected';
  cachedAccount: ExternalAccount | null = null;
  private authAbort: AbortController | null = null;
  private lastCall = 0;
  private tokens: StoredTokens | null = null;

  constructor(private readonly opts: VkClientOptions) {
    this.restore();
  }

  get userId(): number | null {
    return this.tokens?.user_id ?? null;
  }

  cancelLogin(): void {
    this.authAbort?.abort();
  }

  logout(): void {
    this.tokens = null;
    this.status = 'disconnected';
    this.cachedAccount = null;
    this.opts.vault.delete(VAULT_KEY);
    this.opts.vault.delete(ACCOUNT_KEY);
  }

  getAccessToken(): string | null {
    return this.tokens?.access_token ?? null;
  }

  async login(): Promise<void> {
    if (this.status === 'connected') return;
    this.authAbort = new AbortController();
    const signal = this.authAbort.signal;
    let method: LoginMethod = 'qr';
    let error: string | undefined;

    try {
      while (!signal.aborted) {
        let outcome: LoginFlowResult;
        if (method === 'qr') outcome = await this.loginWithQr(signal, error);
        else if (method === 'sms') outcome = await this.loginWithSms(signal, error);
        else outcome = await this.loginWithPassword(signal, error);
        error = undefined;
        if (outcome.kind === 'done') return;
        method = outcome.method;
        error = outcome.error;
      }
      throw new Error('Отменено');
    } finally {
      this.authAbort = null;
    }
  }

  private prompt(fields: Omit<LoginPrompt, 'source'>, signal: AbortSignal): Promise<LoginReply> {
    return this.opts.onLoginPrompt({ source: 'vk', ...fields }, signal);
  }

  private switched(reply: LoginReply, current: LoginMethod): LoginMethod | undefined {
    if (reply.cancelled) throw new Error('Отменено');
    if (reply.method && reply.method !== current) return reply.method;
    return undefined;
  }

  private async loginWithQr(
    parent: AbortSignal,
    error?: string,
  ): Promise<LoginFlowResult> {
    const local = new AbortController();
    const stop = () => local.abort();
    parent.addEventListener('abort', stop);
    try {
      while (!parent.aborted && !local.signal.aborted) {
        const attempt = new AbortController();
        const stopAttempt = () => attempt.abort();
        local.signal.addEventListener('abort', stopAttempt);
        try {
          let session: QrSession;
          try {
            session = await startQrSession('MusicStreamService');
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Не удалось получить QR-код';
            const reply = await this.prompt({ step: 'qr', method: 'qr', error: message }, attempt.signal);
            const next = this.switched(reply, 'qr');
            if (next) return { kind: 'switch', method: next };
            continue;
          }

          const replyP = this.prompt(
            { step: 'qr', method: 'qr', qrUrl: session.authUrl, qrStatus: 'pending', error },
            attempt.signal,
          )
            .then((r) => ({ kind: 'reply' as const, r }))
            .catch((e: unknown) => ({ kind: 'aborted' as const, e }));
          const pollP = this.pollQr(session, attempt.signal, (status, nextSession) => {
            session = nextSession;
            this.opts.onLoginPromptUpdate?.({
              source: 'vk',
              step: 'qr',
              method: 'qr',
              qrUrl: session.authUrl,
              qrStatus: status,
            });
          })
            .then((token) => ({ kind: 'token' as const, token }))
            .catch((e: unknown) => ({ kind: 'poll-err' as const, e }));

          const raced = await Promise.race([replyP, pollP]);
          error = undefined;
          if (raced.kind === 'token') {
            if (!raced.token) throw new Error('Отменено');
            this.saveTokens(raced.token);
            return { kind: 'done' };
          }
          if (raced.kind === 'poll-err') {
            const message = raced.e instanceof Error ? raced.e.message : 'Не удалось войти по QR';
            if (/отмен/i.test(message)) throw new Error('Отменено');
            const reply = await this.prompt({ step: 'qr', method: 'qr', error: message }, attempt.signal);
            const next = this.switched(reply, 'qr');
            if (next) return { kind: 'switch', method: next };
            continue;
          }
          if (raced.kind === 'aborted') {
            if (parent.aborted || local.signal.aborted) throw new Error('Отменено');
            continue;
          }
          const next = this.switched(raced.r, 'qr');
          if (next) return { kind: 'switch', method: next };
        } finally {
          local.signal.removeEventListener('abort', stopAttempt);
          attempt.abort();
        }
      }
      throw new Error('Отменено');
    } finally {
      parent.removeEventListener('abort', stop);
      local.abort();
    }
  }

  private async pollQr(
    session: QrSession,
    signal: AbortSignal,
    onStatus: (status: NonNullable<LoginPrompt['qrStatus']>, session: QrSession) => void,
  ): Promise<VkTokenResponse | null> {
    while (!signal.aborted) {
      let check;
      try {
        check = await checkQr(session);
      } catch (e) {
        if (signal.aborted) return null;
        throw e;
      }
      if (signal.aborted) return null;
      if (check.status === 1) onStatus('scanned', session);
      if (check.status === 2) return check.token;
      if (check.status === 3) throw new Error('Вход по QR отклонён на телефоне');
      if (check.status === 4) {
        onStatus('expired', session);
        session = await startQrSession('MusicStreamService');
        onStatus('pending', session);
        continue;
      }
      await sleep(QR_POLL_MS);
    }
    return null;
  }

  private async loginWithSms(
    signal: AbortSignal,
    error?: string,
  ): Promise<LoginFlowResult> {
    const deviceId = deviceIdFromVault(
      (k) => this.opts.vault.get(k),
      (k, v) => this.opts.vault.set(k, v),
    );
    let session: VkIdSession | null = null;
    let phone = '';
    let sid = '';
    let phoneMask: string | undefined;
    let captchaSid: string | undefined;
    let captchaImg: string | undefined;
    let step: Extract<LoginPrompt['step'], 'sms' | 'code' | 'captcha'> = 'sms';

    const ensureSession = async () => {
      session ??= await startVkIdSession(crypto.randomUUID());
      return session;
    };

    while (!signal.aborted) {
      const reply = await this.prompt(
        {
          step,
          method: 'sms',
          phoneMask,
          captchaImg,
          error,
        },
        signal,
      );
      const next = this.switched(reply, 'sms');
      if (next) return { kind: 'switch', method: next };
      error = undefined;

      try {
        if (step === 'sms' || (step === 'captcha' && !sid)) {
          phone = normalizeVkPhone(reply.username ?? phone);
          if (!phone) {
            error = 'Введите номер телефона';
            step = 'sms';
            continue;
          }
          const vkId = await ensureSession();
          const extra: Record<string, string> = { device_id: deviceId };
          if (captchaSid && reply.captchaKey) {
            extra.captcha_sid = captchaSid;
            extra.captcha_key = reply.captchaKey;
          }
          const result = await validateAccount(vkId, phone, extra);
          captchaSid = undefined;
          captchaImg = undefined;
          if (result.kind === 'robot') {
            return {
              kind: 'switch',
              method: 'qr',
              error: 'VK просит проверку «я не робот». Войдите по QR-коду — так проще',
            };
          }
          if (result.kind === 'captcha') {
            step = 'captcha';
            captchaSid = result.captchaSid;
            captchaImg = result.captchaImg;
            error = 'Введите код с картинки';
            continue;
          }
          sid = result.sid;
          phoneMask = result.phoneMask ?? phone;
          await sendPhoneOtp(vkId, sid, phone, deviceId);
          step = 'code';
          continue;
        }

        if (step === 'captcha' && sid) {
          step = 'code';
          captchaSid = undefined;
          captchaImg = undefined;
          continue;
        }

        const code = reply.code?.trim() ?? '';
        if (reply.forceSms) {
          const vkId = await ensureSession();
          await sendPhoneOtp(vkId, sid, phone, deviceId);
          continue;
        }
        if (!code) {
          error = 'Введите код из SMS';
          continue;
        }
        const vkId = await ensureSession();
        const token = await confirmSms(vkId, { phone, sid, code, deviceId });
        this.saveTokens(token);
        return { kind: 'done' };
      } catch (e) {
        const message = e instanceof VkAuthError || e instanceof Error ? e.message : 'Не удалось войти по SMS';
        if (message === 'PASSWORD_REQUIRED') {
          return { kind: 'switch', method: 'password', error: 'Для этого аккаунта VK просит пароль' };
        }
        if (e instanceof VkAuthError && e.robotCaptcha) {
          return { kind: 'switch', method: 'qr', error: message };
        }
        if (e instanceof VkAuthError && e.captchaSid) {
          step = 'captcha';
          captchaSid = e.captchaSid;
          captchaImg = e.captchaImg;
          error = 'Введите код с картинки';
          continue;
        }
        error = message;
      }
    }
    throw new Error('Отменено');
  }

  private async loginWithPassword(
    signal: AbortSignal,
    error?: string,
  ): Promise<LoginFlowResult> {
    let username = '';
    let password = '';
    let captchaSid: string | undefined;
    let captchaImg: string | undefined;
    let phoneMask: string | undefined;
    let step: Extract<LoginPrompt['step'], 'credentials' | 'code' | 'captcha'> = 'credentials';

    while (!signal.aborted) {
      const reply = await this.prompt(
        {
          step,
          method: 'password',
          captchaImg,
          phoneMask,
          error,
        },
        signal,
      );
      const next = this.switched(reply, 'password');
      if (next) return { kind: 'switch', method: next };
      error = undefined;

      if (step === 'credentials') {
        username = reply.username?.trim() ?? '';
        password = reply.password ?? '';
        if (!username || !password) {
          error = 'Введите логин и пароль';
          continue;
        }
      }

      const extra: Record<string, string> = {};
      if (step === 'code' || reply.code) extra.code = reply.code ?? '';
      if (reply.forceSms) extra.force_sms = '1';
      if (captchaSid && (step === 'captcha' || reply.captchaKey)) {
        extra.captcha_sid = captchaSid;
        extra.captcha_key = reply.captchaKey ?? '';
      }

      const result = await this.requestToken(username, password, extra);
      if (isToken(result)) {
        this.saveTokens(result);
        return { kind: 'done' };
      }
      if (isCaptcha(result)) {
        step = 'captcha';
        captchaSid = result.captcha_sid;
        captchaImg = result.captcha_img;
        error = 'Введите код с картинки';
        continue;
      }
      if (isValidation(result)) {
        step = 'code';
        phoneMask = result.phone_mask;
        error = result.error_description || 'Введите код подтверждения';
        continue;
      }
      step = 'credentials';
      captchaSid = undefined;
      captchaImg = undefined;
      phoneMask = undefined;
      error = authErrorMessage(result);
    }
    throw new Error('Отменено');
  }

  async fetchAccount(refresh = false): Promise<ExternalAccount | null> {
    if (this.status !== 'connected' || !this.tokens) return null;
    if (!refresh && this.cachedAccount) return this.cachedAccount;
    const users = await this.call<Array<{ id: number; first_name?: string; last_name?: string; screen_name?: string }>>(
      'users.get',
      { user_ids: String(this.tokens.user_id), fields: 'screen_name' },
    );
    const u = users[0];
    const account: ExternalAccount = {
      uid: String(this.tokens.user_id),
      login: u?.screen_name,
      displayName: [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.screen_name,
      hasPlus: false,
    };
    this.cachedAccount = account;
    this.opts.vault.set(ACCOUNT_KEY, JSON.stringify(account));
    return account;
  }

  async call<T>(method: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    if (!this.tokens) throw new Error('Войдите во VK заново в Настройках');
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.throttle();
      const body = new URLSearchParams();
      body.set('access_token', this.tokens.access_token);
      body.set('v', API_VERSION);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') body.set(k, String(v));
      }
      const res = await fetch(`${API_URL}/${method}`, {
        method: 'POST',
        headers: { ...VK_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = (await res.json()) as {
        response?: T;
        error?: { error_code: number; error_msg: string };
      };
      if (json.error) {
        const { error_code: code, error_msg: msg } = json.error;
        if (code === 6 || code === 9) {
          lastError = new VkApiError(code, msg);
          await sleep(400 * (attempt + 1));
          continue;
        }
        if (code === 5) {
          this.logout();
          throw new VkApiError(5, 'Сессия VK истекла — войдите заново');
        }
        if (code === 14) {
          throw new VkApiError(14, 'VK запросил капчу. Отключите сервис и войдите снова');
        }
        if (code === 15 || code === 201 || code === 1133) {
          throw new VkApiError(code, 'VK отклонил доступ к аудио. Войдите заново — нужен клиент с правом audio');
        }
        throw new VkApiError(code, msg || `Ошибка VK ${code}`);
      }
      if (json.response === undefined) throw new Error(`Пустой ответ VK (${method})`);
      return json.response;
    }
    throw lastError instanceof Error ? lastError : new Error('VK: слишком много запросов');
  }

  private restore(): void {
    const raw = this.opts.vault.get(VAULT_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as StoredTokens;
      if (stored.access_token && stored.user_id) {
        this.tokens = stored;
        this.status = 'connected';
      }
    } catch {
      this.opts.vault.delete(VAULT_KEY);
    }
    const accountRaw = this.opts.vault.get(ACCOUNT_KEY);
    if (accountRaw) {
      try {
        this.cachedAccount = JSON.parse(accountRaw) as ExternalAccount;
      } catch {
        this.opts.vault.delete(ACCOUNT_KEY);
      }
    }
  }

  private saveTokens(tokens: VkTokenResponse): void {
    this.tokens = { access_token: tokens.access_token, user_id: tokens.user_id };
    this.status = 'connected';
    this.opts.vault.set(VAULT_KEY, JSON.stringify(this.tokens));
  }

  private async requestToken(
    username: string,
    password: string,
    extra: Record<string, string>,
  ): Promise<VkAuthResult> {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: VK_KATE_CLIENT_ID,
      client_secret: VK_KATE_CLIENT_SECRET,
      username,
      password,
      scope: SCOPE,
      '2fa_supported': '1',
      v: API_VERSION,
      ...extra,
    });
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { ...VK_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    return (await res.json()) as VkAuthResult;
  }

  private async throttle(): Promise<void> {
    const wait = 350 - (Date.now() - this.lastCall);
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
  }
}
