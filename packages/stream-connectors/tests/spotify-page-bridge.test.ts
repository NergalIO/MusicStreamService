import { describe, expect, it } from 'vitest';
import {
  parseConnectDeviceUrl,
  preferOwnDeviceUrls,
  SPOTIFY_PAGE_BRIDGE,
  SPOTIFY_PAGE_BRIDGE_VERSION,
} from '../src/spotify-page-bridge.js';

describe('parseConnectDeviceUrl', () => {
  it('reads origin and hobs id', () => {
    const parsed = parseConnectDeviceUrl(
      'https://gew1-spclient.spotify.com/connect-state/v1/devices/hobs_0123456789abcdef/extra',
    );
    expect(parsed?.origin).toBe('https://gew1-spclient.spotify.com');
    expect(parsed?.id).toBe('hobs_0123456789abcdef');
    expect(parsed?.url).toBe(
      'https://gew1-spclient.spotify.com/connect-state/v1/devices/hobs_0123456789abcdef',
    );
  });

  it('ignores unrelated urls', () => {
    expect(parseConnectDeviceUrl('https://open.spotify.com/track/abc')).toBeNull();
  });
});

describe('preferOwnDeviceUrls', () => {
  it('puts the local player first and drops duplicates', () => {
    const own = 'https://gew1-spclient.spotify.com/connect-state/v1/devices/hobs_aaaaaaaaaaaaaaaa';
    const other = 'https://gew1-spclient.spotify.com/connect-state/v1/devices/hobs_bbbbbbbbbbbbbbbb';
    expect(preferOwnDeviceUrls([other, own], own)).toEqual([own, other]);
  });
});

describe('SPOTIFY_PAGE_BRIDGE', () => {
  it('installs a versioned command queue', () => {
    expect(SPOTIFY_PAGE_BRIDGE).toContain('window.__mss');
    expect(SPOTIFY_PAGE_BRIDGE).toContain(`var VERSION = ${SPOTIFY_PAGE_BRIDGE_VERSION}`);
    expect(SPOTIFY_PAGE_BRIDGE).toContain('cancel:');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('fadeVolume:');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('location.assign');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('posted: true');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('web player|веб-плеер');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('function barTrackId');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('trackId: extra.trackId');
  });
});
