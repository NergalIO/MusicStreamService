import { describe, expect, it } from 'vitest';
import {
  kateAuthorizeUrl,
  vkSmsLoginUrl,
  vkQrDisplayCode,
  vkWebLoginStart,
  normalizeQrConfirmCode,
  normalizeVkPhone,
  oauthPayloadFromRedirectUrl,
  oauthRedirectError,
  parseConnectAuthorize,
  parseKateOAuthRedirect,
  parseValidateAccount,
  parseVkIdAnonymousToken,
  parseVkIdAuthToken,
  qrApprovedFields,
  unixOrDurationToMs,
  vkOtpAlreadySent,
} from '../src/vk-auth.js';

describe('normalizeVkPhone', () => {
  it('accepts russian formats', () => {
    expect(normalizeVkPhone('8 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizeVkPhone('+7 999 123 45 67')).toBe('+79991234567');
    expect(normalizeVkPhone('79991234567')).toBe('+79991234567');
    expect(normalizeVkPhone('9991234567')).toBe('+79991234567');
  });

  it('keeps international numbers', () => {
    expect(normalizeVkPhone('+380501112233')).toBe('+380501112233');
  });

  it('returns empty for blank input', () => {
    expect(normalizeVkPhone('   ')).toBe('');
  });
});

describe('parseVkIdAnonymousToken', () => {
  it('reads token from window.init', () => {
    const html = `window.init = {"auth":{"access_token":"","anonymous_token":"anonym.abc","host_app_id":2685278}};`;
    expect(parseVkIdAnonymousToken(html)).toBe('anonym.abc');
  });

  it('returns null when missing', () => {
    expect(parseVkIdAnonymousToken('<html></html>')).toBeNull();
  });
});

describe('unixOrDurationToMs', () => {
  it('treats large values as unix seconds', () => {
    expect(unixOrDurationToMs(1790625979, 1000)).toBe(1790625979 * 1000);
  });

  it('treats small values as duration', () => {
    const now = Date.now();
    const at = unixOrDurationToMs(30, 1000);
    expect(at).toBeGreaterThanOrEqual(now + 29_000);
    expect(at).toBeLessThan(now + 31_000);
  });
});

describe('parseValidateAccount', () => {
  it('reads sms next step', () => {
    const r = parseValidateAccount({
      response: {
        sid: 'sid-1',
        next_step: { verification_method: 'sms' },
        profile: { phone: '+7 *** ** 67' },
        can_skip_password: 1,
      },
    });
    expect(r).toMatchObject({ kind: 'next', sid: 'sid-1', verification: 'sms', canSkipPassword: true });
  });

  it('flags robot captcha', () => {
    const r = parseValidateAccount({
      error: {
        error_code: 14,
        error_msg: 'Captcha needed',
        redirect_uri: 'https://id.vk.com/not_robot_captcha?domain=vk.com',
      },
    });
    expect(r.kind).toBe('robot');
  });
});

describe('parseVkIdAuthToken', () => {
  it('ignores unrelated keys', () => {
    expect(parseVkIdAuthToken('{"mini_apps_sdk_get_auth_token":{"enabled":true}}')).toBeNull();
  });

  it('reads a real auth_token', () => {
    expect(parseVkIdAuthToken('{"auth_token":"vk1.a.abcdefghijklmnopqrstuvwxyz"}')).toBe('vk1.a.abcdefghijklmnopqrstuvwxyz');
  });
});

describe('vkOtpAlreadySent', () => {
  it('detects sms and call methods', () => {
    expect(vkOtpAlreadySent('sms')).toBe(true);
    expect(vkOtpAlreadySent('otp')).toBe(true);
    expect(vkOtpAlreadySent('callreset')).toBe(true);
    expect(vkOtpAlreadySent('password')).toBe(false);
  });
});

describe('parseKateOAuthRedirect', () => {
  it('reads access token from hash', () => {
    const r = parseKateOAuthRedirect('https://oauth.vk.com/blank.html#access_token=tok&user_id=42');
    expect(r).toMatchObject({ access_token: 'tok', user_id: 42 });
  });

  it('reads silent token payload', () => {
    const payload = encodeURIComponent(JSON.stringify({ token: 'st', uuid: 'u1', type: 'silent_token' }));
    const r = parseKateOAuthRedirect(`https://oauth.vk.com/blank.html#payload=${payload}`);
    expect(r).toMatchObject({ silent_token: 'st', uuid: 'u1' });
  });

  it('builds kate authorize url', () => {
    expect(kateAuthorizeUrl()).toContain('client_id=2685278');
    expect(kateAuthorizeUrl()).toContain('display=mobile');
  });

  it('builds sms login url on id.vk.com, not oauth authorize or qr deep-link', () => {
    const url = vkSmsLoginUrl({ authUrl: 'https://oauth.vk.com/authorize?client_id=2685278', authCode: 'abc' });
    expect(url).toContain('id.vk.com');
    expect(url).not.toContain('oauth.vk.com/authorize');
    const start = vkWebLoginStart(url);
    expect(start.start).toMatch(/vk\.com/);
    expect(start.start).not.toContain('qr.vk.ru');
    expect(start.confirm).toContain('qr.vk.ru/ca?q=abc');
  });

  it('does not load m.vk.com/login?to=qr.vk.ru as the window start', () => {
    const start = vkWebLoginStart('https://m.vk.com/login?to=https%3A%2F%2Fqr.vk.ru%2Fca%3Fq%3DtMLiLl');
    expect(start.start).toBe('https://vk.com/');
    expect(start.confirm).toContain('qr.vk.ru/ca?q=tMLiLl');
  });

  it('reads oauth tokens from a redirect location', () => {
    expect(oauthPayloadFromRedirectUrl('https://oauth.vk.com/blank.html#access_token=tok&user_id=9')).toMatchObject({
      accessToken: 'tok',
      userId: 9,
    });
  });

  it('keeps super_app_token even when the QR payload is partial', () => {
    const fields = qrApprovedFields({
      status: 2,
      is_partial: true,
      super_app_token: 'sat',
    });
    expect(fields).toMatchObject({ isPartial: true, superApp: 'sat' });
    expect(fields.access).toBeUndefined();
  });

  it('shows short qr codes only', () => {
    expect(vkQrDisplayCode('ab12cd')).toBe('AB12CD');
    expect(vkQrDisplayCode('this-is-a-very-long-auth-hash-value')).toBeUndefined();
  });

  it('strips spaces from vk id confirm codes', () => {
    expect(normalizeQrConfirmCode('449 542')).toBe('449542');
  });

  it('reads oauth error from blank.html', () => {
    expect(oauthRedirectError('https://oauth.vk.com/blank.html#error=access_denied&error_description=Access%20denied')).toMatch(
      /QR-код|пароль/i,
    );
  });

  it('maps direct-auth apps', () => {
    expect(
      oauthRedirectError(
        'https://oauth.vk.com/blank.html#error=invalid_request&error_description=incorrect%20app.%20Unavailable%20for%20apps%20with%20direct%20auth.',
      ),
    ).toMatch(/не разрешает/i);
  });

  it('reads token from oauth.vk.ru', () => {
    const r = parseKateOAuthRedirect('https://oauth.vk.ru/blank.html#access_token=tok&user_id=7');
    expect(r).toMatchObject({ access_token: 'tok', user_id: 7 });
  });
});

describe('parseConnectAuthorize', () => {
  it('reads silent token payload', () => {
    const r = parseConnectAuthorize({
      type: 'okay',
      data: { silent_token: 'st', uuid: 'u1', user_id: 42 },
    });
    expect(r).toEqual({ silentToken: 'st', silentUuid: 'u1', userId: 42, accessToken: undefined, authUserHash: undefined });
  });

  it('maps wrong otp', () => {
    expect(() => parseConnectAuthorize({ error: 'invalid_request', error_type: 'wrong_otp' })).toThrow(/код/i);
  });
});
