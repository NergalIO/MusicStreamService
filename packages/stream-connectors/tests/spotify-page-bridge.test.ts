import { describe, expect, it } from 'vitest';
import {
  advanceTrackEnd,
  emptyTrackEndWatch,
  fastPlayConfirmed,
  isLocalDeviceName,
  isPauseAriaLabel,
  isPickerRowActive,
  matchPickerRow,
  parseClock,
  parseConnectDeviceUrl,
  parsePickerRowName,
  pickConnectDevice,
  preferOwnDeviceUrls,
  remoteNameFromBanner,
  seekSliderValue,
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

describe('preferOwnDeviceUrls / pickConnectDevice', () => {
  const own = 'https://gew1-spclient.spotify.com/connect-state/v1/devices/hobs_aaaaaaaaaaaaaaaa';
  const other = 'https://gew1-spclient.spotify.com/connect-state/v1/devices/hobs_bbbbbbbbbbbbbbbb';

  it('puts the local player first and drops duplicates', () => {
    expect(preferOwnDeviceUrls([other, own], own)).toEqual([own, other]);
  });

  it('picks the own device even when it is not last in the list', () => {
    expect(pickConnectDevice([other, own], own)?.id).toBe('hobs_aaaaaaaaaaaaaaaa');
  });

  it('picks the first listed device when own is unknown', () => {
    expect(pickConnectDevice([own, other], null)?.id).toBe('hobs_aaaaaaaaaaaaaaaa');
  });
});

describe('parseClock', () => {
  it('reads mm:ss and h:mm:ss', () => {
    expect(parseClock('1:23')).toBe(83000);
    expect(parseClock('1:02:03')).toBe(3723000);
    expect(parseClock('')).toBe(0);
  });
});

describe('seekSliderValue', () => {
  it('uses millisecond max as-is', () => {
    expect(seekSliderValue(15000, 180000, 180000)).toBe(15000);
  });

  it('does not jump to percent max without a real duration', () => {
    expect(seekSliderValue(15000, 100, 0)).toBeNull();
    expect(seekSliderValue(15000, 100, 100)).toBeNull();
  });

  it('maps milliseconds onto a percent slider', () => {
    expect(seekSliderValue(30000, 100, 120000)).toBe(25);
  });
});

describe('isPauseAriaLabel', () => {
  it('treats pause labels across locales as playing', () => {
    expect(isPauseAriaLabel('Pause')).toBe(true);
    expect(isPauseAriaLabel('Пауза')).toBe(true);
    expect(isPauseAriaLabel('Pausar')).toBe(true);
    expect(isPauseAriaLabel('Pausa')).toBe(true);
    expect(isPauseAriaLabel('Приостановить')).toBe(true);
    expect(isPauseAriaLabel('Play')).toBe(false);
    expect(isPauseAriaLabel('Слушать')).toBe(false);
  });
});

describe('isLocalDeviceName / remoteNameFromBanner', () => {
  const chrome = 'Mozilla/5.0 Chrome/120.0.0.0';
  const firefox = 'Mozilla/5.0 Firefox/121.0';

  it('treats this-browser names as local', () => {
    expect(isLocalDeviceName('This Web Browser', chrome)).toBe(true);
    expect(isLocalDeviceName('Этот веб-браузер', chrome)).toBe(true);
  });

  it('treats this Chrome web player as local and another browser as remote', () => {
    expect(isLocalDeviceName('Web Player (Chrome)', chrome)).toBe(true);
    expect(isLocalDeviceName('Web Player (Firefox)', chrome)).toBe(false);
    expect(isLocalDeviceName('Web Player (Chrome)', firefox)).toBe(false);
  });

  it('reads a speaker from the now-playing banner', () => {
    expect(remoteNameFromBanner('Playing on Living Room', chrome)).toBe('Living Room');
    expect(remoteNameFromBanner('Воспроизводится на колонка', chrome)).toBe('колонка');
    expect(remoteNameFromBanner('Playing on This Web Browser', chrome)).toBeNull();
    expect(remoteNameFromBanner('Playing on Web Player (Chrome)', chrome)).toBeNull();
    expect(remoteNameFromBanner('Playing on Web Player (Firefox)', chrome)).toBe('Web Player (Firefox)');
  });
});

describe('picker rows', () => {
  it('uses the first title line, not a Connect subtitle', () => {
    expect(parsePickerRowName('This Web Browser\nSpotify Connect')).toBe('This Web Browser');
    expect(parsePickerRowName('Connect to this device\nKitchen')).toBe('Kitchen');
  });

  it('marks active from aria, with a header outside the list as fallback', () => {
    expect(isPickerRowActive({ ariaSelected: true, inList: true })).toBe(true);
    expect(isPickerRowActive({ ariaSelected: false, inList: false })).toBe(false);
    expect(isPickerRowActive({ inList: false })).toBe(true);
    expect(isPickerRowActive({ inList: true })).toBe(false);
  });

  it('selects an exact inactive row and ignores ambiguous partials', () => {
    const rows = [
      { name: 'Kitchen', active: true },
      { name: 'Kitchen Radio', active: false },
      { name: 'Kitten', active: false },
      { name: 'Bedroom', active: false },
    ];
    expect(matchPickerRow(rows, 'Bedroom')?.name).toBe('Bedroom');
    expect(matchPickerRow(rows, 'Kitchen')?.name).toBe('Kitchen');
    expect(matchPickerRow(rows, 'Kit')).toBeUndefined();
    expect(matchPickerRow(rows, 'Bed')?.name).toBe('Bedroom');
  });
});

describe('advanceTrackEnd', () => {
  const playing = {
    playing: true,
    ad: false,
    title: 'Song',
    trackId: 'abc123abc123',
    positionMs: 10000,
    durationMs: 60000,
  };

  it('emits ended for the expected track near the end', () => {
    let watch = emptyTrackEndWatch();
    watch = advanceTrackEnd(watch, playing, playing.trackId, 900).watch;
    expect(watch.armed).toBe(true);
    const near = advanceTrackEnd(
      watch,
      { ...playing, positionMs: 59500 },
      playing.trackId,
      900,
    );
    expect(near.emitTrackId).toBe(playing.trackId);
  });

  it('ignores another track id while armed', () => {
    let watch = emptyTrackEndWatch();
    watch = advanceTrackEnd(watch, playing, playing.trackId, 900).watch;
    const other = advanceTrackEnd(
      watch,
      { ...playing, trackId: 'otherother12', title: 'Other', positionMs: 59800, durationMs: 60000 },
      playing.trackId,
      900,
    );
    expect(other.emitTrackId).toBeNull();
  });

  it('emits when the title changes after a near-end sample', () => {
    let watch = emptyTrackEndWatch();
    watch = advanceTrackEnd(watch, playing, playing.trackId, 900).watch;
    watch = advanceTrackEnd(
      watch,
      { ...playing, positionMs: 56000 },
      playing.trackId,
      900,
    ).watch;
    expect(watch.lastNearEnd).toBe(true);
    const next = advanceTrackEnd(
      watch,
      { playing: true, ad: false, title: 'Next', trackId: 'nextrackid01', positionMs: 0, durationMs: 80000 },
      playing.trackId,
      900,
    );
    expect(next.emitTrackId).toBe(playing.trackId);
  });

  it('does not emit when a later foreign track itself reaches the end', () => {
    let watch = emptyTrackEndWatch();
    watch = advanceTrackEnd(watch, playing, playing.trackId, 900).watch;
    watch = advanceTrackEnd(
      watch,
      { playing: true, ad: false, title: 'Other', trackId: 'otherother12', positionMs: 1000, durationMs: 60000 },
      playing.trackId,
      900,
    ).watch;
    const later = advanceTrackEnd(
      watch,
      { playing: true, ad: false, title: 'Other', trackId: 'otherother12', positionMs: 59800, durationMs: 60000 },
      playing.trackId,
      900,
    );
    expect(later.emitTrackId).toBeNull();
  });

  it('does not emit after a seek', () => {
    let watch = emptyTrackEndWatch();
    watch = advanceTrackEnd(watch, playing, playing.trackId, 900).watch;
    const seeked = advanceTrackEnd(
      watch,
      { ...playing, positionMs: 59500 },
      playing.trackId,
      900,
      true,
    );
    expect(seeked.watch.armed).toBe(false);
    expect(seeked.emitTrackId).toBeNull();
  });
});

describe('fastPlayConfirmed', () => {
  it('requires the new track, not a leftover playing bar', () => {
    const before = 'Old';
    expect(
      fastPlayConfirmed({ playing: true, ad: false, title: 'Old', trackId: 'oldoldold01' }, before, 'newnewnew01'),
    ).toBe(false);
    expect(
      fastPlayConfirmed(
        { playing: true, ad: false, title: 'New', trackId: 'newnewnew01' },
        before,
        'newnewnew01',
      ),
    ).toBe(true);
    expect(
      fastPlayConfirmed({ playing: true, ad: true, title: 'Advertisement', trackId: null }, before, 'newnewnew01'),
    ).toBe(true);
  });
});

describe('SPOTIFY_PAGE_BRIDGE', () => {
  it('installs a versioned command queue', () => {
    expect(SPOTIFY_PAGE_BRIDGE).toContain('window.__mss');
    expect(SPOTIFY_PAGE_BRIDGE).toContain(`var VERSION = ${SPOTIFY_PAGE_BRIDGE_VERSION}`);
    expect(SPOTIFY_PAGE_BRIDGE).toContain('cancel:');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('fadeVolume:');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('location.assign');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('posted: !!extra.posted');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('function barTrackId');
    expect(SPOTIFY_PAGE_BRIDGE).toContain('trackId: extra.trackId');
    expect(SPOTIFY_PAGE_BRIDGE).toContain("notify('remote'");
    expect(SPOTIFY_PAGE_BRIDGE).not.toContain('performance.getEntriesByType');
  });
});

describe('html fixtures', () => {
  const chrome = 'Mozilla/5.0 Chrome/120.0.0.0';

  it('reads a speaker from now-playing bar copy', () => {
    const bar = ['Now playing: Song', 'Playing on Living Room', 'Pause'].join('\n');
    const found = bar
      .split('\n')
      .map((line) => remoteNameFromBanner(line, chrome))
      .find(Boolean);
    expect(found).toBe('Living Room');
  });

  it('reads a picker row title out of markup', () => {
    const html = `
      <div data-testid="device-picker-item" aria-selected="false">
        <span data-testid="list-row-title">This Web Browser</span>
        <span>Spotify Connect</span>
      </div>`;
    const titled = html.match(/data-testid="list-row-title"[^>]*>([^<]+)/)?.[1] || '';
    expect(parsePickerRowName(`${titled}\nSpotify Connect`)).toBe('This Web Browser');
    expect(isPickerRowActive({ ariaSelected: false, inList: true })).toBe(false);
  });
});
