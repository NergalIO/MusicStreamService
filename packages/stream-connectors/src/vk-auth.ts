/** Публичный клиент Kate Mobile: только с ним VK отдаёт audio.*. */
export const VK_KATE_CLIENT_ID = '2685278';
export const VK_KATE_CLIENT_SECRET = 'lxhD8OD7dMsqtXIm5IUAGS6Ok4UIAK';
export const VK_KATE_USER_AGENT =
  'KateMobileAndroid/99.2 lite-499 (Android 11; SDK 30; arm64-v8a; Xiaomi Redmi Note 8 Pro; ru)';

export const VK_HEADERS: Record<string, string> = {
  'User-Agent': VK_KATE_USER_AGENT,
  'X-Requested-With': 'com.perm.kate_new_6',
};

export interface VkTokenResponse {
  access_token: string;
  user_id: number;
}

/** Официальный Android-клиент VK: нужен только чтобы получить anonym_token для QR Kate. */
const ANDROID_CLIENT_ID = '2274003';
const ANDROID_CLIENT_SECRET = 'hHbZxrka2uZ6jB1inYsH';

const API_URL = 'https://api.vk.com/method';
const AUTH_API_VERSION = '5.207';
const USERS_API_VERSION = '5.131';
const KATE_SCOPE_ALL = '1073737727';
const ID_AUTH_URL = 'https://id.vk.com/auth';
const LOGIN_URL = 'https://login.vk.com/';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export class VkAuthError extends Error {
  constructor(
    message: string,
    readonly code?: number | string,
    readonly captchaImg?: string,
    readonly captchaSid?: string,
    readonly robotCaptcha?: boolean,
  ) {
    super(message);
  }
}

export interface QrSession {
  anonymToken: string;
  authUrl: string;
  authHash: string;
  authCode: string;
  expiresAt: number;
}

export type QrCheck =
  | { status: 0 | 1; expiresAt?: number }
  | { status: 2; token: VkTokenResponse }
  | { status: 3; declined: true }
  | { status: 4; expired: true };

export interface VkIdSession {
  uuid: string;
  anonymousToken: string;
  authToken: string;
  cookies: Map<string, string>;
}

export type ValidateAccountResult =
  | {
      kind: 'next';
      sid: string;
      verification: string;
      phoneMask?: string;
      canSkipPassword: boolean;
    }
  | { kind: 'captcha'; captchaSid: string; captchaImg: string }
  | { kind: 'robot' };

export interface ConnectAuthSuccess {
  accessToken?: string;
  userId?: number;
  silentToken?: string;
  silentUuid?: string;
}

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeVkPhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  if (trimmed.startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

export function parseVkIdAnonymousToken(html: string): string | null {
  const match = html.match(/"anonymous_token"\s*:\s*"([^"]+)"/);
  return match?.[1] || null;
}

export function parseVkIdAuthToken(html: string): string | null {
  const match = html.match(/"auth_token"\s*:\s*"([^"]+)"/);
  const token = match?.[1];
  if (!token || token.length < 16) return null;
  return token;
}

/** VK уже отправил код, повторный auth.validatePhone ловит flood control. */
export function vkOtpAlreadySent(verification: string): boolean {
  return /^(sms|otp|call|callreset|push)/.test(verification);
}

export function kateAuthorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: VK_KATE_CLIENT_ID,
    scope: KATE_SCOPE_ALL,
    redirect_uri: 'https://oauth.vk.com/blank.html',
    display: 'mobile',
    response_type: 'token',
    revoke: '1',
    v: AUTH_API_VERSION,
  });
  return `https://oauth.vk.com/authorize?${params.toString()}`;
}

export function parseKateOAuthRedirect(url: string): {
  access_token?: string;
  user_id?: number;
  silent_token?: string;
  uuid?: string;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/oauth\.vk\.(com|ru)$/i.test(parsed.hostname) || !parsed.pathname.includes('blank.html')) return null;
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const query = parsed.searchParams;
  const get = (key: string) => hash.get(key) || query.get(key);
  const payloadRaw = get('payload');
  if (payloadRaw) {
    try {
      const payload = JSON.parse(payloadRaw) as Json;
      const silent = typeof payload.token === 'string' ? payload.token : undefined;
      const uuid = typeof payload.uuid === 'string' ? payload.uuid : undefined;
      const access = typeof payload.access_token === 'string' ? payload.access_token : undefined;
      const userId = typeof payload.user_id === 'number' ? payload.user_id : undefined;
      if (silent || access) return { silent_token: silent, uuid, access_token: access, user_id: userId };
    } catch {
      /* ignore malformed payload */
    }
  }
  const access = get('access_token') ?? undefined;
  const silent = get('silent_token') ?? undefined;
  const userIdRaw = get('user_id');
  const userId = userIdRaw ? Number(userIdRaw) : undefined;
  if (!access && !silent) return null;
  return { access_token: access, silent_token: silent, uuid: get('uuid') ?? undefined, user_id: userId && userId > 0 ? userId : undefined };
}

export function unixOrDurationToMs(expiresIn: number | undefined, fallbackMs: number): number {
  if (!expiresIn || !Number.isFinite(expiresIn)) return Date.now() + fallbackMs;
  if (expiresIn > 1_000_000_000) return expiresIn * 1000;
  return Date.now() + expiresIn * 1000;
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbCookies(headers: Headers, cookies: Map<string, string>): void {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const line of raw) {
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name && value && value !== 'DELETED') cookies.set(name, value);
  }
}

function apiError(json: Json): VkAuthError | null {
  if (!isRecord(json.error) && typeof json.error !== 'string') return null;
  if (typeof json.error === 'string') {
    return new VkAuthError(String(json.error_description || json.error_text || json.error), json.error);
  }
  const err = json.error;
  const code = typeof err.error_code === 'number' ? err.error_code : undefined;
  const msg = String(err.error_text || err.error_msg || 'Ошибка VK');
  const captchaSid = typeof err.captcha_sid === 'string' ? err.captcha_sid : undefined;
  const captchaImg = typeof err.captcha_img === 'string' ? err.captcha_img : undefined;
  const redirect = typeof err.redirect_uri === 'string' ? err.redirect_uri : '';
  if (code === 14 || captchaSid) {
    if (/not_robot_captcha/i.test(redirect)) {
      return new VkAuthError('VK просит проверку «я не робот». Войдите по QR-коду', code, undefined, undefined, true);
    }
    return new VkAuthError('Введите код с картинки', code, captchaImg, captchaSid);
  }
  if (code === 9 || /flood/i.test(msg)) return new VkAuthError('Слишком много попыток, подождите пару минут', code);
  return new VkAuthError(msg, code);
}

async function readJson(res: Response): Promise<Json> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new VkAuthError('VK вернул не JSON');
  }
}

/** Node fetch теряет Set-Cookie на промежуточных 302 — VK ID без remix-cookie сразу даёт flood. */
async function fetchFollow(url: string, init: RequestInit, cookies?: Map<string, string>, hops = 0): Promise<Response> {
  if (hops > 8) throw new VkAuthError('Слишком много редиректов VK');
  const headers = new Headers(init.headers);
  if (cookies?.size) headers.set('Cookie', cookieHeader(cookies));
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  if (cookies) absorbCookies(res.headers, cookies);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (!loc) return res;
    await res.arrayBuffer();
    const next = new URL(loc, url).href;
    const keepBody = res.status === 307 || res.status === 308;
    return fetchFollow(
      next,
      {
        method: keepBody ? (init.method ?? 'GET') : 'GET',
        signal: init.signal,
        headers: { 'User-Agent': headers.get('User-Agent') || BROWSER_UA },
        body: keepBody ? init.body : undefined,
      },
      cookies,
      hops + 1,
    );
  }
  return res;
}

async function formPost(
  url: string,
  body: Record<string, string | undefined>,
  opts?: { headers?: Record<string, string>; cookies?: Map<string, string>; skipAppHeaders?: boolean; signal?: AbortSignal },
): Promise<Json> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(opts?.skipAppHeaders ? { 'User-Agent': BROWSER_UA } : VK_HEADERS),
    ...opts?.headers,
  };
  const init: RequestInit = { method: 'POST', headers, body: params, signal: opts?.signal };
  const res = opts?.cookies ? await fetchFollow(url, init, opts.cookies) : await fetch(url, init);
  const json = await readJson(res);
  const err = apiError(json);
  if (err) throw err;
  return json;
}

function vkIdRequest(
  url: string,
  body: Record<string, string | undefined>,
  cookies: Map<string, string>,
  signal?: AbortSignal,
): Promise<Json> {
  return formPost(url, body, {
    cookies,
    skipAppHeaders: true,
    signal,
    headers: {
      'User-Agent': BROWSER_UA,
      Origin: 'https://id.vk.com',
      Referer: 'https://id.vk.com/',
    },
  });
}

async function apiMethod(
  method: string,
  body: Record<string, string | undefined>,
  cookies?: Map<string, string>,
  signal?: AbortSignal,
): Promise<Json> {
  const json = await formPost(`${API_URL}/${method}`, body, {
    cookies,
    signal,
    headers: { 'X-Origin': 'https://vk.com', Origin: 'https://id.vk.com', Referer: 'https://id.vk.com/' },
  });
  if (json.response === undefined) throw new VkAuthError(`Пустой ответ VK (${method})`);
  if (!isRecord(json.response) && !Array.isArray(json.response)) {
    throw new VkAuthError(`Некорректный ответ VK (${method})`);
  }
  return json;
}

function asToken(accessToken: string, userId: number): VkTokenResponse {
  if (!accessToken || !userId) throw new VkAuthError('VK не вернул токен');
  return { access_token: accessToken, user_id: userId };
}

export async function fetchUserId(accessToken: string): Promise<number> {
  const json = await formPost(`${API_URL}/users.get`, {
    access_token: accessToken,
    v: USERS_API_VERSION,
  });
  const list = json.response;
  if (!Array.isArray(list) || !isRecord(list[0]) || typeof list[0].id !== 'number') {
    throw new VkAuthError('Не удалось определить пользователя VK');
  }
  return list[0].id;
}

export async function materializeKateToken(raw: {
  access_token?: string;
  user_id?: number;
  silent_token?: string;
  silent_token_uuid?: string;
  uuid?: string;
}): Promise<VkTokenResponse> {
  if (raw.access_token) {
    const userId = raw.user_id && raw.user_id > 0 ? raw.user_id : await fetchUserId(raw.access_token);
    return asToken(raw.access_token, userId);
  }
  if (raw.silent_token) {
    const uuid = raw.silent_token_uuid || raw.uuid;
    if (!uuid) throw new VkAuthError('VK не вернул uuid silent-токена');
    return exchangeSilentToken(raw.silent_token, uuid);
  }
  throw new VkAuthError('VK не вернул токен сессии');
}

export async function getAndroidAnonymToken(signal?: AbortSignal): Promise<string> {
  const json = await apiMethod(
    'auth.getAnonymToken',
    {
      client_id: ANDROID_CLIENT_ID,
      client_secret: ANDROID_CLIENT_SECRET,
      v: AUTH_API_VERSION,
    },
    undefined,
    signal,
  );
  const token = isRecord(json.response) ? json.response.token : undefined;
  if (typeof token !== 'string' || !token) throw new VkAuthError('Не удалось получить анонимный токен VK');
  return token;
}

export async function getKateLoginAnonymToken(): Promise<string> {
  const json = await formPost(`${LOGIN_URL}?act=get_anonym_token`, {
    client_id: VK_KATE_CLIENT_ID,
    client_secret: VK_KATE_CLIENT_SECRET,
    version: '1',
    app_id: VK_KATE_CLIENT_ID,
  });
  const data = isRecord(json.data) ? json.data : json;
  const token = typeof data.access_token === 'string' ? data.access_token : undefined;
  if (!token) throw new VkAuthError('Не удалось получить анонимный токен Kate');
  return token;
}

export async function startQrSession(deviceName: string, signal?: AbortSignal): Promise<QrSession> {
  const anonymToken = await getAndroidAnonymToken(signal);
  const json = await apiMethod(
    'auth.getAuthCode',
    {
      client_id: VK_KATE_CLIENT_ID,
      scope: KATE_SCOPE_ALL,
      anonymous_token: anonymToken,
      device_name: deviceName,
      v: AUTH_API_VERSION,
    },
    undefined,
    signal,
  );
  const r = json.response;
  if (!isRecord(r) || typeof r.auth_url !== 'string' || typeof r.auth_hash !== 'string') {
    throw new VkAuthError('VK не выдал QR-код');
  }
  return {
    anonymToken,
    authUrl: r.auth_url,
    authHash: r.auth_hash,
    authCode: typeof r.auth_code === 'string' ? r.auth_code : '',
    expiresAt: unixOrDurationToMs(typeof r.expires_in === 'number' ? r.expires_in : undefined, 5 * 60_000),
  };
}

export async function checkQr(session: QrSession, signal?: AbortSignal): Promise<QrCheck> {
  const json = await apiMethod(
    'auth.checkAuthCode',
    {
      anonymous_token: session.anonymToken,
      auth_hash: session.authHash,
      web_auth: '1',
      v: AUTH_API_VERSION,
    },
    undefined,
    signal,
  );
  const r = json.response;
  if (!isRecord(r) || typeof r.status !== 'number') throw new VkAuthError('Некорректный статус QR');
  if (r.status === 3) return { status: 3, declined: true };
  if (r.status === 4) return { status: 4, expired: true };
  if (r.status === 2) {
    if (r.is_partial === true) throw new VkAuthError('VK выдал неполный токен. Попробуйте SMS или пароль');
    const access = typeof r.access_token === 'string' ? r.access_token : undefined;
    const silent = typeof r.silent_token === 'string' ? r.silent_token : undefined;
    const token = await materializeKateToken({
      access_token: access,
      user_id: typeof r.user_id === 'number' ? r.user_id : undefined,
      silent_token: silent,
      silent_token_uuid: typeof r.silent_token_uuid === 'string' ? r.silent_token_uuid : undefined,
      uuid: typeof r.uuid === 'string' ? r.uuid : undefined,
    });
    return { status: 2, token };
  }
  return {
    status: r.status === 1 ? 1 : 0,
    expiresAt: unixOrDurationToMs(typeof r.expires_in === 'number' ? r.expires_in : undefined, 5 * 60_000),
  };
}

export async function startVkIdSession(uuid: string, signal?: AbortSignal): Promise<VkIdSession> {
  const cookies = new Map<string, string>();
  const url = new URL(ID_AUTH_URL);
  url.searchParams.set('app_id', VK_KATE_CLIENT_ID);
  url.searchParams.set('response_type', 'silent_token');
  url.searchParams.set('v', '1.46.0');
  url.searchParams.set('redirect_uri', 'https://oauth.vk.com/blank.html');
  url.searchParams.set('uuid', uuid);
  const res = await fetchFollow(
    url.toString(),
    { signal, headers: { 'User-Agent': BROWSER_UA, Referer: 'https://vk.com/', Origin: 'https://vk.com' } },
    cookies,
  );
  const html = await res.text();
  const anonymousToken = parseVkIdAnonymousToken(html);
  if (!anonymousToken) throw new VkAuthError('Не удалось начать сессию VK ID');
  let authToken = parseVkIdAuthToken(html) ?? '';
  if (!authToken) {
    try {
      const json = await vkIdRequest(
        `${LOGIN_URL}?act=connect_internal`,
        { app_id: VK_KATE_CLIENT_ID, oauth_version: '1', version: '1' },
        cookies,
        signal,
      );
      const data = isRecord(json.data) ? json.data : json;
      if (typeof data.access_token === 'string' && data.access_token) authToken = data.access_token;
      else if (typeof data.auth_token === 'string' && data.auth_token) authToken = data.auth_token;
    } catch {
      /* validateAccount идёт с anonymous_token, подставлять его в auth_token нельзя — VK отвечает flood */
    }
  }
  return { uuid, anonymousToken, authToken, cookies };
}

export function parseValidateAccount(json: Json): ValidateAccountResult {
  if (isRecord(json.error)) {
    const mapped = apiError(json);
    if (mapped?.robotCaptcha) return { kind: 'robot' };
    if (mapped?.captchaSid) {
      return { kind: 'captcha', captchaSid: mapped.captchaSid, captchaImg: mapped.captchaImg ?? '' };
    }
    if (mapped) throw mapped;
  }
  const r = json.response;
  if (!isRecord(r) || typeof r.sid !== 'string') throw new VkAuthError('VK не принял номер телефона');
  const next = isRecord(r.next_step) ? r.next_step : {};
  const verification = String(next.verification_method || next.name || '').toLowerCase();
  const profile = isRecord(r.profile) ? r.profile : {};
  const phoneMask = typeof profile.phone === 'string' ? profile.phone : undefined;
  return {
    kind: 'next',
    sid: r.sid,
    verification,
    phoneMask,
    canSkipPassword: r.can_skip_password === 1 || r.can_skip_password === true || /sms|otp|call/.test(verification),
  };
}

export async function validateAccount(
  session: VkIdSession,
  login: string,
  extra: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<ValidateAccountResult> {
  try {
    const json = await vkIdRequest(
      `${API_URL}/auth.validateAccount?v=${AUTH_API_VERSION}&client_id=${VK_KATE_CLIENT_ID}`,
      {
        login,
        sid: extra.sid,
        client_id: VK_KATE_CLIENT_ID,
        anonymous_token: session.anonymousToken,
        auth_token: extra.auth_token || session.authToken || undefined,
        supported_ways: 'password,passkey,push,email,sms,callreset',
        device_id: extra.device_id,
        uuid: session.uuid,
        captcha_sid: extra.captcha_sid,
        captcha_key: extra.captcha_key,
        flow_type: 'auth_without_password',
      },
      session.cookies,
      signal,
    );
    return parseValidateAccount(json);
  } catch (e) {
    if (e instanceof VkAuthError && e.robotCaptcha) return { kind: 'robot' };
    if (e instanceof VkAuthError && e.captchaSid) {
      return { kind: 'captcha', captchaSid: e.captchaSid, captchaImg: e.captchaImg ?? '' };
    }
    throw e;
  }
}

export async function sendPhoneOtp(session: VkIdSession, sid: string, phone: string, deviceId: string): Promise<{ sid: string; delay: number }> {
  const json = await vkIdRequest(
    `${API_URL}/auth.validatePhone?v=${AUTH_API_VERSION}&client_id=${VK_KATE_CLIENT_ID}`,
    {
      sid,
      phone,
      client_id: VK_KATE_CLIENT_ID,
      anonymous_token: session.anonymousToken,
      auth_token: session.authToken || undefined,
      allow_callreset: '1',
      device_id: deviceId,
      uuid: session.uuid,
    },
    session.cookies,
  );
  const r = isRecord(json.response) ? json.response : json;
  return {
    sid: typeof r.sid === 'string' ? r.sid : sid,
    delay: typeof r.delay === 'number' ? r.delay : 60,
  };
}

export function parseConnectAuthorize(json: Json): ConnectAuthSuccess {
  if (json.type === 'error' || json.error) {
    const type = String(json.error_type || json.error || '');
    const desc = String(json.error_description || json.error_text || '');
    if (/wrong_otp|invalid_otp|code/i.test(type) || /код/i.test(desc)) {
      throw new VkAuthError('Неверный код из SMS');
    }
    if (/password/i.test(type)) throw new VkAuthError('PASSWORD_REQUIRED');
    throw new VkAuthError(desc || 'VK отклонил вход по SMS');
  }
  const data = isRecord(json.data) ? json.data : json;
  return {
    accessToken: typeof data.access_token === 'string' ? data.access_token : undefined,
    userId: typeof data.user_id === 'number' ? data.user_id : undefined,
    silentToken: typeof data.silent_token === 'string' ? data.silent_token : undefined,
    silentUuid: typeof data.silent_token_uuid === 'string' ? data.silent_token_uuid : typeof data.uuid === 'string' ? data.uuid : undefined,
  };
}

export async function confirmSms(
  session: VkIdSession,
  opts: { phone: string; sid: string; code: string; deviceId: string; password?: string },
): Promise<VkTokenResponse> {
  const json = await vkIdRequest(
    `${LOGIN_URL}?act=connect_authorize`,
    {
      username: opts.phone,
      password: opts.password,
      auth_token: session.authToken || undefined,
      anonymous_token: session.anonymousToken,
      sid: opts.sid,
      uuid: session.uuid,
      v: AUTH_API_VERSION,
      device_id: opts.deviceId,
      version: '1',
      app_id: VK_KATE_CLIENT_ID,
      code: opts.code,
    },
    session.cookies,
  );
  const parsed = parseConnectAuthorize(json);
  return materializeKateToken({
    access_token: parsed.accessToken,
    user_id: parsed.userId,
    silent_token: parsed.silentToken,
    silent_token_uuid: parsed.silentUuid,
    uuid: session.uuid,
  });
}

export async function exchangeSilentToken(silentToken: string, uuid: string): Promise<VkTokenResponse> {
  const anonym = await getKateLoginAnonymToken().catch(() => getAndroidAnonymToken());
  const json = await apiMethod('auth.exchangeSilentAuthToken', {
    access_token: anonym,
    token: silentToken,
    uuid,
    v: AUTH_API_VERSION,
  });
  const r = json.response;
  if (!isRecord(r) || typeof r.access_token !== 'string') throw new VkAuthError('Не удалось обменять silent-токен VK');
  if (r.is_partial === true || r.is_service === true || r.additional_signup_required === true) {
    throw new VkAuthError('VK выдал неполный токен. Попробуйте QR-код или пароль');
  }
  const userId = typeof r.user_id === 'number' ? r.user_id : await fetchUserId(r.access_token);
  return asToken(r.access_token, userId);
}

export function deviceIdFromVault(get: (key: string) => string | null, set: (key: string, value: string) => void): string {
  const existing = get('vk_device_id');
  if (existing) return existing;
  const id = crypto.randomUUID();
  set('vk_device_id', id);
  return id;
}
