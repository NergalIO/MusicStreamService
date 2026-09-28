import { describe, expect, it } from 'vitest';
import {
  androidAuthorizeUrl,
  kateAuthorizeUrl,
  normalizeVkPhone,
  oauthRedirectError,
  parseConnectAuthorize,
  parseKateOAuthRedirect,
  parseValidateAccount,
  parseVkIdAnonymousToken,
  parseVkIdAuthToken,
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

  it('builds official android authorize url for SMS', () => {
    expect(androidAuthorizeUrl()).toContain('client_id=2274003');
    expect(androidAuthorizeUrl()).not.toContain('client_id=2685278');
  });

  it('reads oauth error from blank.html', () => {
    expect(oauthRedirectError('https://oauth.vk.com/blank.html#error=access_denied&error_description=Access%20denied')).toMatch(
      /QR-код|пароль/i,
    );
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
    expect(r).toEqual({ silentToken: 'st', silentUuid: 'u1', userId: 42, accessToken: undefined });
  });

  it('maps wrong otp', () => {
    expect(() => parseConnectAuthorize({ error: 'invalid_request', error_type: 'wrong_otp' })).toThrow(/код/i);
  });
});
