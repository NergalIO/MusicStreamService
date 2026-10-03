import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseTrackUri } from '../src/spotify/state.js';

/** Mirror of the post-play id contract used by session/connect. */
function playSucceeded(expectedUri: string, state: { id: string | null; isPlaying: boolean; uri?: string | null }): boolean {
  const parsed = parseTrackUri(expectedUri);
  if (!parsed) return false;
  if (!state.isPlaying) return false;
  return state.id === parsed.id || state.uri === parsed.uri;
}

describe('spotify play id verification', () => {
  it('accepts only the requested playing track', () => {
    const uri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';
    assert.equal(
      playSucceeded(uri, { id: '4cOdK2wGLETKBW3PvgPWqT', isPlaying: true, uri }),
      true,
    );
  });

  it('rejects a different playing track (album auto-skip)', () => {
    const uri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';
    assert.equal(
      playSucceeded(uri, {
        id: '7ouMYWpwJ422jRcDASZB7P',
        isPlaying: true,
        uri: 'spotify:track:7ouMYWpwJ422jRcDASZB7P',
      }),
      false,
    );
  });

  it('rejects paused matching id', () => {
    const uri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';
    assert.equal(
      playSucceeded(uri, { id: '4cOdK2wGLETKBW3PvgPWqT', isPlaying: false, uri }),
      false,
    );
  });
});
