import type { ExternalAccount, LoginMethod, LoginPrompt, LoginReply } from '@mss/shared';
import type { AuthStatus, TokenVault } from './types.js';
import { isVkAudioStub, unwrapAudio, type VkAudio } from './vk-mappers.js';
import {
  VK_HEADERS,
  VK_KATE_CLIENT_ID,
  VK_KATE_CLIENT_SECRET,
  checkQr,
  confirmQr,
  confirmSms,
  connectAuthToKateToken,
  deviceIdFromVault,
  kateTokenFromAndroidToken,
  oauthPayloadFromRedirectUrl,
  oauthRedirectError,
  normalizeVkPhone,
  sendPhoneOtp,
  startQrSession,
  startVkIdSession,
  validateAccount,
  vkOtpAlreadySent,
  vkQrBrowserUrl,
  vkSmsLoginUrl,
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
  kateAuthorizeUrl,
  parseKateOAuthRedirect,
  vkWebLoginStart,
  type VkTokenResponse,
} from './vk-auth.js';

const OAUTH_URL = 'https://oauth.vk.com/token';
const API_URL = 'https://api.vk.com/method';
const API_VERSION = '5.131';
const VAULT_KEY = 'vk_tokens';
const ACCOUNT_KEY = 'vk_account';
const QR_POLL_MS = 2000;

const VK_AUDIO_DENIED =
  'VK не отдаёт музыку с этим способом входа. Отключите VK и войдите через «Пароль» (логин и пароль VK) — для Kate Mobile это надёжнее, чем QR/SMS.';

interface VkAudioList {
  count?: number;
  items?: Array<VkAudio | { audio?: VkAudio }>;
}

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
  /** Окно Kate OAuth (VK ID), если SMS API отвечает flood/капчей. */
  openKateOAuth?: (url: string, signal?: AbortSignal) => Promise<string>;
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
  private kateUpgradeAttempted = false;
  /** null — не проверяли, true/false — результат probe audio.search */
  private audioSessionOk: boolean | null = null;

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
    this.kateUpgradeAttempted = false;
    this.audioSessionOk = null;
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
        if (outcome.kind === 'done') {
          try {
            await this.verifyAudioAccess(signal);
          } catch (e) {
            this.logout();
            throw e;
          }
          return;
        }
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

  private qrDeviceId(): string {
    return deviceIdFromVault(
      (k) => this.opts.vault.get(k),
      (k, v) => this.opts.vault.set(k, v),
    );
  }

  private qrFields(
    session: QrSession,
    status: NonNullable<LoginPrompt['qrStatus']>,
    error?: string,
  ): Omit<LoginPrompt, 'source'> {
    return {
      step: 'qr',
      method: 'qr',
      qrUrl: session.authUrl || vkQrBrowserUrl(session),
      qrStatus: status,
      error,
    };
  }

  private isSmsApiBlocked(err: unknown): boolean {
    if (err instanceof VkAuthError && (err.code === 9 || err.robotCaptcha)) return true;
    const message = err instanceof Error ? err.message : String(err);
    return /слишком много|не робот|flood/i.test(message);
  }

  private async loginSmsViaOAuth(signal: AbortSignal): Promise<LoginFlowResult | null> {
    if (!this.opts.openKateOAuth) return null;
    const session = await startQrSession('MusicStreamService', signal, this.qrDeviceId());
    const local = new AbortController();
    const stop = () => local.abort();
    signal.addEventListener('abort', stop);
    try {
      const windowP = this.opts.openKateOAuth(vkSmsLoginUrl(session), local.signal).then(
        (url) => ({ kind: 'window' as const, url }),
        (e: unknown) => {
          if (local.signal.aborted) return { kind: 'aborted' as const };
          const message = e instanceof Error ? e.message : String(e);
          if (/отмен/i.test(message)) return { kind: 'closed' as const };
          throw e;
        },
      );
      const tokenP = (async () => {
        while (!local.signal.aborted) {
          let check;
          try {
            check = await checkQr(session, local.signal);
          } catch (e) {
            if (local.signal.aborted) return { kind: 'aborted' as const };
            throw e;
          }
          if (local.signal.aborted) return { kind: 'aborted' as const };
          if (check.status === 2) return { kind: 'token' as const, token: check.token };
          if (check.status === 3) throw new VkAuthError('Вход отклонён в окне VK');
          if (check.status === 4) throw new VkAuthError('Сессия истекла. Откройте окно снова');
          await sleep(QR_POLL_MS);
        }
        return { kind: 'aborted' as const };
      })();

      const raced = await Promise.race([tokenP, windowP]);
      if (raced.kind === 'token') {
        this.saveTokens(raced.token);
        return { kind: 'done' };
      }
      if (raced.kind === 'window') {
        const oauthErr = oauthRedirectError(raced.url);
        if (oauthErr) throw new VkAuthError(oauthErr);
        const connect = oauthPayloadFromRedirectUrl(raced.url);
        if (connect) {
          const token = await connectAuthToKateToken(connect, signal);
          if (token) {
            this.saveTokens(token);
            return { kind: 'done' };
          }
        }
        throw new VkAuthError('Окно закрыто. Нажмите «Продолжить», чтобы открыть снова');
      }
      if (raced.kind === 'closed') {
        throw new VkAuthError('Окно закрыто. Нажмите «Продолжить», чтобы открыть снова');
      }
      throw new Error('Отменено');
    } finally {
      signal.removeEventListener('abort', stop);
      local.abort();
    }
  }

  private async loginWithSms(signal: AbortSignal, error?: string): Promise<LoginFlowResult> {
    if (this.opts.openKateOAuth) return this.loginWithSmsWindow(signal, error);
    return this.loginWithSmsApi(signal, error);
  }

  /** SMS через страницу VK ID: прямой auth.validatePhone с десктопа ловит flood control. */
  private async loginWithSmsWindow(parent: AbortSignal, error?: string): Promise<LoginFlowResult> {
    const local = new AbortController();
    const stop = () => local.abort();
    parent.addEventListener('abort', stop);
    try {
      while (!parent.aborted && !local.signal.aborted) {
        const attempt = new AbortController();
        const stopAttempt = () => attempt.abort();
        local.signal.addEventListener('abort', stopAttempt);
        try {
          const replyP = this.prompt({ step: 'sms', method: 'sms', error }, attempt.signal)
            .then((r) => ({ kind: 'reply' as const, r }))
            .catch((e: unknown) => ({ kind: 'aborted' as const, e }));

          const oauthP = this.loginSmsViaOAuth(attempt.signal)
            .then((result) => ({ kind: 'oauth' as const, result }))
            .catch((e: unknown) => ({ kind: 'oauth-err' as const, e }));

          const raced = await Promise.race([replyP, oauthP]);
          error = undefined;

          if (raced.kind === 'oauth') {
            if (raced.result) return raced.result;
            continue;
          }

          if (raced.kind === 'oauth-err') {
            const message = raced.e instanceof Error ? raced.e.message : 'Не удалось открыть окно VK';
            if (parent.aborted || local.signal.aborted) throw new Error('Отменено');
            this.opts.onLoginPromptUpdate?.({
              source: 'vk',
              step: 'sms',
              method: 'sms',
              error: /отмен/i.test(message)
                ? 'Окно закрыто. Нажмите «Продолжить», чтобы открыть снова'
                : message,
            });
            const reply = await replyP;
            if (reply.kind === 'aborted') {
              if (parent.aborted || local.signal.aborted) throw new Error('Отменено');
              continue;
            }
            const next = this.switched(reply.r, 'sms');
            if (next) return { kind: 'switch', method: next };
            continue;
          }

          if (raced.kind === 'aborted') {
            if (parent.aborted || local.signal.aborted) throw new Error('Отменено');
            continue;
          }
          const next = this.switched(raced.r, 'sms');
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

  private async loginWithQr(
    parent: AbortSignal,
    error?: string,
  ): Promise<LoginFlowResult> {
    const local = new AbortController();
    const stop = () => local.abort();
    parent.addEventListener('abort', stop);
    let qrSession: QrSession | null = null;
    let qrUi: NonNullable<LoginPrompt['qrStatus']> = 'pending';
    try {
      while (!parent.aborted && !local.signal.aborted) {
        const attempt = new AbortController();
        const stopAttempt = () => attempt.abort();
        local.signal.addEventListener('abort', stopAttempt);
        try {
          const replyP = this.prompt(
            qrSession ? this.qrFields(qrSession, qrUi, error) : { step: 'qr', method: 'qr', qrStatus: 'pending', error },
            attempt.signal,
          )
            .then((r) => ({ kind: 'reply' as const, r }))
            .catch((e: unknown) => ({ kind: 'aborted' as const, e }));

          const pollP = (async () => {
            qrSession ??= await startQrSession('MusicStreamService', attempt.signal, this.qrDeviceId());
            if (attempt.signal.aborted) return null;
            this.opts.onLoginPromptUpdate?.({
              source: 'vk',
              ...this.qrFields(qrSession, qrUi),
            });
            return this.pollQr(qrSession, attempt.signal, (status, nextSession) => {
              qrSession = nextSession;
              qrUi = status;
              this.opts.onLoginPromptUpdate?.({
                source: 'vk',
                ...this.qrFields(nextSession, status),
              });
            });
          })()
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
            qrSession = null;
            const reply = await this.prompt({ step: 'qr', method: 'qr', error: message }, attempt.signal);
            const next = this.switched(reply, 'qr');
            if (next) return { kind: 'switch', method: next };
            qrUi = 'pending';
            continue;
          }
          if (raced.kind === 'aborted') {
            if (parent.aborted || local.signal.aborted) throw new Error('Отменено');
            continue;
          }
          const next = this.switched(raced.r, 'qr');
          if (next) return { kind: 'switch', method: next };
          const digits = (raced.r.code ?? '').replace(/\D/g, '');
          if (digits) {
            if (!qrSession) {
              error = 'Дождитесь QR-кода';
              continue;
            }
            try {
              const check = await confirmQr(qrSession, digits, parent);
              if (check.status === 2) {
                this.saveTokens(check.token);
                return { kind: 'done' };
              }
              if (check.status === 3) {
                error = 'Вход по QR отклонён на телефоне';
                qrSession = null;
                qrUi = 'pending';
                continue;
              }
              if (check.status === 4) {
                error = 'Сессия истекла. Обновите QR';
                qrSession = null;
                qrUi = 'pending';
                continue;
              }
              qrUi = 'scanned';
              error = undefined;
            } catch (e) {
              error = e instanceof Error ? e.message : 'Неверный код из приложения VK';
            }
            continue;
          }
          qrSession = null;
          qrUi = 'pending';
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
        check = await checkQr(session, signal);
      } catch (e) {
        if (signal.aborted) return null;
        throw e;
      }
      if (signal.aborted) return null;
      if (check.status === 1 || check.status === 5) onStatus('scanned', session);
      if (check.status === 2) return check.token;
      if (check.status === 3) throw new Error('Вход по QR отклонён на телефоне');
      if (check.status === 4) {
        onStatus('expired', session);
        session = await startQrSession('MusicStreamService', signal, this.qrDeviceId());
        onStatus('pending', session);
        continue;
      }
      await sleep(QR_POLL_MS);
    }
    return null;
  }

  private async loginWithSmsApi(
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
      session ??= await startVkIdSession(crypto.randomUUID(), signal);
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
          const result = await validateAccount(vkId, phone, extra, signal);
          captchaSid = undefined;
          captchaImg = undefined;
          if (result.kind === 'robot') {
            const viaWindow = await this.loginSmsViaOAuth(signal);
            if (viaWindow) return viaWindow;
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
          if (!vkOtpAlreadySent(result.verification)) {
            return { kind: 'switch', method: 'password', error: 'Для этого аккаунта VK просит пароль' };
          }
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
        const token = await confirmSms(vkId, { phone, sid, code, deviceId }, signal);
        this.saveTokens(token);
        return { kind: 'done' };
      } catch (e) {
        const message = e instanceof VkAuthError || e instanceof Error ? e.message : 'Не удалось войти по SMS';
        if (message === 'PASSWORD_REQUIRED') {
          return { kind: 'switch', method: 'password', error: 'Для этого аккаунта VK просит пароль' };
        }
        if (e instanceof VkAuthError && e.captchaSid) {
          step = 'captcha';
          captchaSid = e.captchaSid;
          captchaImg = e.captchaImg;
          error = 'Введите код с картинки';
          continue;
        }
        if (this.isSmsApiBlocked(e)) {
          const viaWindow = await this.loginSmsViaOAuth(signal);
          if (viaWindow) return viaWindow;
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

  private async tryUpgradeKateToken(signal?: AbortSignal): Promise<boolean> {
    if (this.kateUpgradeAttempted || !this.tokens?.access_token) return false;
    this.kateUpgradeAttempted = true;
    try {
      const upgraded = await kateTokenFromAndroidToken(this.tokens.access_token, signal);
      this.saveTokens(upgraded);
      return true;
    } catch {
      return false;
    }
  }

  /** Отсекает токены, при которых VK отдаёт только заглушку «Аудио доступно на vk.com». */
  async requireWorkingAudio(signal?: AbortSignal): Promise<void> {
    if (this.audioSessionOk === true) return;
    if (this.audioSessionOk === false) throw new VkApiError(15, VK_AUDIO_DENIED);
    if (await this.probeRealAudio()) {
      this.audioSessionOk = true;
      return;
    }
    if ((await this.tryUpgradeKateToken(signal)) && (await this.probeRealAudio())) {
      this.audioSessionOk = true;
      return;
    }
    this.audioSessionOk = false;
    throw new VkApiError(15, VK_AUDIO_DENIED);
  }

  private async probeRealAudio(): Promise<boolean> {
    try {
      const page = await this.invokeApi<VkAudioList>(
        'audio.search',
        { q: 'love', count: 30, auto_complete: 1, sort: 2 },
        true,
      );
      const items = (page.items ?? []).map(unwrapAudio).filter((a): a is VkAudio => !!a);
      return items.some((a) => !isVkAudioStub(a) && !!a.url);
    } catch {
      return false;
    }
  }

  private async verifyAudioAccess(signal?: AbortSignal): Promise<void> {
    await this.requireWorkingAudio(signal);
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
    return this.invokeApi<T>(method, params);
  }

  private async invokeApi<T>(
    method: string,
    params: Record<string, string | number | undefined> = {},
    skipAudioGate = false,
  ): Promise<T> {
    if (!skipAudioGate && method.startsWith('audio.')) await this.requireWorkingAudio();
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
          if (method.startsWith('audio.') && await this.tryUpgradeKateToken()) continue;
          throw new VkApiError(code, 'VK отклонил доступ к аудио. Войдите заново — нужен клиент с правом audio');
        }
        if ((code === 8 || code === 113) && method.startsWith('audio.') && method !== 'audio.get') {
          if (await this.tryUpgradeKateToken()) continue;
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
    this.audioSessionOk = null;
    this.kateUpgradeAttempted = false;
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
