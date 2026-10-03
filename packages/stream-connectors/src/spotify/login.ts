import type { AuthStep } from './types.js';

export const ACCOUNTS_ORIGIN = 'https://accounts.spotify.com';
export const SPOTIFY_ORIGIN = 'https://open.spotify.com';
export const LOGIN_URL = `${ACCOUNTS_ORIGIN}/en/login?continue=${encodeURIComponent(`${SPOTIFY_ORIGIN}/`)}`;

export function shouldResumeLogin(url: string, step: AuthStep): boolean {
  if (!isAccountsUrl(url)) return false;
  if (step === 'password' || step === 'code') return true;
  const fromUrl = authStepFromUrl(url);
  return fromUrl === 'password' || fromUrl === 'code';
}

/** Shared with in-page DETECT_AUTH_STEP — keep source in sync. */
export const LOGIN_CODE_COPY_SOURCE =
  'we sent.{0,60}code|code we sent|check your (email|inbox)|enter.{0,24}(6-digit|six.digit|one-time|login) code|resend code|one-time code|6-digit code|код.{0,40}(письм|почт|отправил)|одноразов|код, который мы отправили|введите код';

export function looksLikeCodeCopy(text: string): boolean {
  return new RegExp(LOGIN_CODE_COPY_SOURCE, 'i').test(text);
}

export function authStepFromUrl(url: string): AuthStep | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep raw
  }
  const p = path.toLowerCase();
  if (
    p.includes('/login/otp') ||
    p.includes('/login/code') ||
    p.includes('/magic-link') ||
    /\/otp(?:\/|$)/.test(p)
  ) {
    return 'code';
  }
  if (p.includes('/login/password')) return 'password';
  return null;
}

export function looksLikeLoginError(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return false;
  const informational = /we sent|code we sent|check your (email|inbox)|resent|resend code|отправ|please enter your email|enter your email address/i.test(t);
  const failed = /invalid|incorrect|wrong|expired|failed|unable|could(?:n't| not)|неверн|ошиб|не удалось|неправильн/i.test(t);
  if (informational && !failed) return false;
  return failed;
}

export function iframeLooksLikeCaptchaChallenge(frame: {
  src?: string | null;
  title?: string | null;
  name?: string | null;
  width: number;
  height: number;
}): boolean {
  const src = (frame.src ?? '').toLowerCase();
  const title = (frame.title ?? '').toLowerCase();
  const name = (frame.name ?? '').toLowerCase();
  const blob = `${src} ${title} ${name}`;
  const vendor =
    /recaptcha|hcaptcha|arkose|funcaptcha|turnstile|challenges\.cloudflare|\/captcha/.test(blob) ||
    name.includes('bframe');
  if (!vendor) return false;
  if (/badge=/.test(src) && frame.height < 80) return false;
  if (src.includes('/anchor')) {
    return frame.height >= 70 && frame.width >= 270;
  }
  const challenge = src.includes('bframe') || title.includes('challenge') || name.includes('bframe');
  if (challenge) return frame.width >= 100 && frame.height >= 100;
  return frame.width >= 160 && frame.height >= 70;
}

export function urlLooksLikeCaptcha(url: string): boolean {
  let href = url;
  let host = '';
  try {
    const parsed = new URL(url);
    href = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    host = parsed.hostname.toLowerCase();
  } catch {
    // keep raw
  }
  const u = href.toLowerCase();
  if (/\/login\/otp|\/login\/code|magic-link/.test(u)) return false;
  return (
    host.includes('arkoselabs') ||
    host.includes('funcaptcha') ||
    host.includes('hcaptcha') ||
    host.includes('recaptcha') ||
    host.includes('challenges.cloudflare') ||
    /(?:^|\.)challenge\.spotify\.com$/.test(host) ||
    /\/challenge(?:\/|$|\?)/.test(u) ||
    u.includes('captcha') ||
    u.includes('not_robot') ||
    u.includes('not-robot') ||
    u.includes('turnstile')
  );
}

export function pageTextLooksLikeCaptcha(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 8) return false;
  if (new RegExp(LOGIN_CODE_COPY_SOURCE, 'i').test(t)) return false;
  return /i['’]m not a robot|i am not a robot|я не робот|verify you are (a )?human|complete a security check|подтвердите,? что вы не робот|funcaptcha|hcaptcha|cloudflare/i.test(
    t,
  );
}

export function isAccountsUrl(url: string): boolean {
  return url.startsWith(ACCOUNTS_ORIGIN);
}

export function isOpenSpotifyUrl(url: string): boolean {
  return url.startsWith(SPOTIFY_ORIGIN);
}
