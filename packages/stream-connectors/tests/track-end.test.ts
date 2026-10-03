import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { advanceTrackEnd, emptyTrackEndWatch } from '../src/spotify/track-end.js';

describe('advanceTrackEnd', () => {
  it('emits when the expected track is playing near the end', () => {
    let watch = emptyTrackEndWatch();
    const first = advanceTrackEnd(
      watch,
      { playing: true, ad: false, title: 'Song', trackId: 'abc', positionMs: 1000, durationMs: 10_000 },
      'abc',
      900,
    );
    watch = first.watch;
    assert.equal(first.emitTrackId, null);
    assert.equal(watch.armed, true);
    const near = advanceTrackEnd(
      watch,
      { playing: true, ad: false, title: 'Song', trackId: 'abc', positionMs: 9500, durationMs: 10_000 },
      'abc',
      900,
    );
    assert.equal(near.emitTrackId, 'abc');
  });
});
