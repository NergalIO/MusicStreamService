import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  cookieNamesIndicateLogin,
  emptyAuthResult,
  parseLoginBody,
} from '../src/spotify/auth.js';
import { looksLikeCodeCopy, looksLikeLoginError, shouldResumeLogin, authStepFromUrl } from '../src/spotify/login.js';

describe('parseLoginBody', () => {
  it('accepts email-only start', () => {
    const body = parseLoginBody({ email: 'user@example.com' });
    assert.equal('error' in body, false);
    if (!('error' in body)) assert.equal(body.email, 'user@example.com');
  });

  it('rejects invalid email', () => {
    assert.equal(parseLoginBody({ email: 'bad' }).error, 'invalid_email');
  });
});

describe('shouldResumeLogin', () => {
  it('resumes on password step', () => {
    assert.equal(
      shouldResumeLogin('https://accounts.spotify.com/login/password', 'password'),
      true,
    );
  });
});

describe('cookieNamesIndicateLogin', () => {
  it('detects sp_dc', () => {
    assert.equal(cookieNamesIndicateLogin(['sp_dc']), true);
    assert.equal(cookieNamesIndicateLogin(['sp_t']), false);
  });
});

describe('looksLikeLoginError', () => {
  it('ignores informational code messages', () => {
    assert.equal(looksLikeLoginError('We sent a code to your email'), false);
    assert.equal(looksLikeLoginError('Please enter your email address.'), false);
    assert.equal(looksLikeLoginError('Invalid email or password'), true);
  });
});

describe('looksLikeCodeCopy', () => {
  it('detects the email-code screen copy', () => {
    assert.equal(looksLikeCodeCopy('We sent a code to your email'), true);
    assert.equal(looksLikeCodeCopy('Enter the 6-digit code sent to you'), true);
    assert.equal(looksLikeCodeCopy('Введите код из письма'), true);
    assert.equal(looksLikeCodeCopy('Welcome back'), false);
  });
});

describe('authStepFromUrl', () => {
  it('maps otp and password paths, not captcha challenge', () => {
    assert.equal(authStepFromUrl('https://accounts.spotify.com/en/login/otp'), 'code');
    assert.equal(authStepFromUrl('https://accounts.spotify.com/login/challenge'), null);
    assert.equal(authStepFromUrl('https://accounts.spotify.com/en/login/password'), 'password');
    assert.equal(authStepFromUrl('https://accounts.spotify.com/en/login'), null);
  });
});

describe('emptyAuthResult', () => {
  it('marks code step', () => {
    const result = emptyAuthResult('code');
    assert.equal(result.codeRequired, true);
    assert.equal(result.loggedIn, false);
  });
});
