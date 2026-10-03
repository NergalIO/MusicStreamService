import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  fillEmailCodeScript,
  fillEmailScript,
  fillPasswordScript,
  readOtpValueScript,
  readVisibleInputScript,
  waitForUsernameFieldScript,
} from '../src/spotify/login-dom.js';

describe('login fill scripts', () => {
  it('uses the native value setter so React controlled inputs update', () => {
    const script = fillEmailScript('user@example.com');
    assert.match(script, /getOwnPropertyDescriptor/);
    assert.match(script, /_valueTracker/);
    assert.match(script, /insertFromPaste/);
    assert.match(script, /insertText/);
    assert.match(script, /user@example\.com/);
    assert.match(script, /nativeSetter\.call/);
  });

  it('fills password the same way', () => {
    const script = fillPasswordScript('secret');
    assert.match(script, /getOwnPropertyDescriptor/);
    assert.match(script, /_valueTracker/);
  });

  it('waits for the username field before filling', () => {
    const script = waitForUsernameFieldScript(12_000);
    assert.match(script, /firstVisibleInput/);
    assert.match(script, /12000/);
  });

  it('reads back the visible input value', () => {
    const script = readVisibleInputScript(['input[type="email"]']);
    assert.match(script, /el\.value \?\? ''/);
  });

  it('fills OTP boxes via insertText and reads the concatenated value', () => {
    const script = fillEmailCodeScript('123456');
    assert.match(script, /execCommand/);
    assert.match(script, /typeOtpDigits/);
    assert.match(script, /123456/);
    assert.match(readOtpValueScript(), /readOtpValue/);
  });
});
