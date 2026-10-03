import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  extrapolatePosition,
  parsePlayUri,
  parseTrackUri,
  publicRepeat,
  publicShuffle,
  toPublicSnapshot,
} from '../src/spotify/state.js';
import type { PlaybackSnapshot } from '../src/spotify/types.js';
import { installBridge, installBridgeSource } from '../src/spotify/bridge.js';

describe("installBridgeSource", () => {
  it("defines esbuild __name before the serialized installer", () => {
    const source = installBridgeSource();
    const helperAt = source.indexOf("const __name");
    const bodyAt = source.indexOf(installBridge.toString());
    assert.ok(helperAt >= 0);
    assert.ok(bodyAt > helperAt);
    assert.match(source, /location\.origin\s*!==\s*"https:\/\/open\.spotify.com"/);
    assert.match(source, /__spotifyAuthHooked/);
    assert.match(source, /get_access_token/);
  });
});

describe("parseTrackUri", () => {
  it("parses spotify:track URIs", () => {
    assert.deepEqual(parseTrackUri("spotify:track:4cOdK2wGLETKBW3PvgPWqT"), {
      id: "4cOdK2wGLETKBW3PvgPWqT",
      uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
    });
  });

  it("parses open.spotify.com track links", () => {
    assert.deepEqual(
      parseTrackUri("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc"),
      {
        id: "4cOdK2wGLETKBW3PvgPWqT",
        uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
      },
    );
  });

  it("parses localized open.spotify.com track links", () => {
    assert.deepEqual(
      parseTrackUri("https://open.spotify.com/intl-ru/track/4cOdK2wGLETKBW3PvgPWqT"),
      {
        id: "4cOdK2wGLETKBW3PvgPWqT",
        uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
      },
    );
  });

  it("parses a bare track id", () => {
    assert.deepEqual(parseTrackUri("  4cOdK2wGLETKBW3PvgPWqT  "), {
      id: "4cOdK2wGLETKBW3PvgPWqT",
      uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
    });
  });

  it("rejects invalid input", () => {
    assert.equal(parseTrackUri(""), null);
    assert.equal(parseTrackUri("not-a-track"), null);
    assert.equal(parseTrackUri("spotify:album:4cOdK2wGLETKBW3PvgPWqT"), null);
    assert.equal(parseTrackUri("https://example.com/track/4cOdK2wGLETKBW3PvgPWqT"), null);
  });
});

describe("parsePlayUri", () => {
  it("parses album, playlist and artist URIs", () => {
    assert.deepEqual(parsePlayUri("spotify:album:4cOdK2wGLETKBW3PvgPWqT"), {
      id: "4cOdK2wGLETKBW3PvgPWqT",
      uri: "spotify:album:4cOdK2wGLETKBW3PvgPWqT",
      kind: "album",
    });
    assert.deepEqual(parsePlayUri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"), {
      id: "37i9dQZF1DXcBWIGoYBM5M",
      uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
      kind: "playlist",
    });
    assert.deepEqual(parsePlayUri("spotify:artist:4NHQUGzhtTLFvgF5SZesLK"), {
      id: "4NHQUGzhtTLFvgF5SZesLK",
      uri: "spotify:artist:4NHQUGzhtTLFvgF5SZesLK",
      kind: "artist",
    });
  });

  it("parses localized open.spotify.com album links", () => {
    assert.deepEqual(
      parsePlayUri("https://open.spotify.com/intl-ru/album/4cOdK2wGLETKBW3PvgPWqT?si=abc"),
      {
        id: "4cOdK2wGLETKBW3PvgPWqT",
        uri: "spotify:album:4cOdK2wGLETKBW3PvgPWqT",
        kind: "album",
      },
    );
  });

  it("parses user playlist URIs and links", () => {
    assert.deepEqual(parsePlayUri("spotify:user:spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"), {
      id: "37i9dQZF1DXcBWIGoYBM5M",
      uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
      kind: "playlist",
    });
    assert.deepEqual(
      parsePlayUri("https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M"),
      {
        id: "37i9dQZF1DXcBWIGoYBM5M",
        uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
        kind: "playlist",
      },
    );
  });

  it("still parses tracks", () => {
    assert.deepEqual(parsePlayUri("spotify:track:4cOdK2wGLETKBW3PvgPWqT"), {
      id: "4cOdK2wGLETKBW3PvgPWqT",
      uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
      kind: "track",
    });
  });

  it("rejects invalid input", () => {
    assert.equal(parsePlayUri(""), null);
    assert.equal(parsePlayUri("not-a-uri"), null);
    assert.equal(parsePlayUri("https://example.com/album/4cOdK2wGLETKBW3PvgPWqT"), null);
  });
});

describe("extrapolatePosition", () => {
  it("keeps the sampled position while paused", () => {
    assert.equal(extrapolatePosition(1200, 1_000, false, 5000, 1_800), 1200);
  });

  it("adds elapsed time while playing", () => {
    assert.equal(extrapolatePosition(1200, 1_000, true, 5000, 1_800), 2000);
  });

  it("caps at duration", () => {
    assert.equal(extrapolatePosition(4800, 1_000, true, 5000, 2_000), 5000);
  });

  it("does not go below zero", () => {
    assert.equal(extrapolatePosition(-10, 1_000, false, 5000, 1_000), 0);
  });
});

describe("toPublicSnapshot", () => {
  it("returns an extrapolated copy", () => {
    const sample: PlaybackSnapshot = {
      ready: true,
      uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
      id: "4cOdK2wGLETKBW3PvgPWqT",
      title: "Never Gonna Give You Up",
      artists: ["Rick Astley"],
      album: null,
      durationMs: 213000,
      positionMs: 1000,
      isPlaying: true,
      liked: false,
      volume: 0.5,
      shuffle: false,
      repeat: "off",
      muted: false,
      sampledAt: 10_000,
      source: "dom",
    };
    const pub = toPublicSnapshot(sample, 10_500);
    assert.equal(pub.positionMs, 1500);
    assert.equal(sample.positionMs, 1000);
    assert.equal(pub.shuffle, false);
    assert.equal(pub.repeat, "off");
    assert.equal(pub.muted, false);
    assert.deepEqual(pub.artists, ["Rick Astley"]);
  });

  it("maps missing shuffle and repeat to Unavailable", () => {
    assert.equal(publicShuffle(null), "Unavailable");
    assert.equal(publicShuffle("Unavailable"), "Unavailable");
    assert.equal(publicShuffle(true), true);
    assert.equal(publicRepeat(null), "Unavailable");
    assert.equal(publicRepeat("off"), "off");
    assert.equal(publicRepeat("nope"), "Unavailable");
  });
});
