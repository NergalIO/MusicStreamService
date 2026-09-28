import { describe, expect, it } from 'vitest';
import {
  normalizeVkPhone,
  parseConnectAuthorize,
  parseValidateAccount,
  parseVkIdAnonymousToken,
  unixOrDurationToMs,
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
