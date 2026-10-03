import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  QueryHashCache,
  buildGraphQLBody,
  connectTransferBody,
  extractQueryHashes,
  graphQLLibraryWriteOk,
  graphQLOk,
  graphQLRequest,
  isPathfinderUrl,
  libraryVariableSets,
  libraryVariables,
  lyricsUrl,
  parseDevices,
  parseIsInLibrary,
  parseLikeBody,
  parseLyrics,
  parseSearchLimit,
  parseSearchResults,
  parseSpclientHosts,
  parseTransferBody,
  persistedQueryMissing,
  publicLibraryBody,
  publicLibraryEndpoint,
  publicTransferBody,
  publicPlayBody,
  parseAlbumUriFromTrack,
  connectPlayBody,
  pageSafeHeaders,
  rememberPathfinderPost,
  rememberPathfinderUrl,
  restLibraryWriteOk,
  searchVariables,
} from '../src/spotify/partner.js';

const HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("QueryHashCache", () => {
  it("keeps default hashes and overwrites from a pathfinder POST", () => {
    const cache = new QueryHashCache();
    assert.equal(cache.get("searchDesktop")?.length, 64);
    const body = buildGraphQLBody("searchV2", HASH, searchVariables("radiohead", 10));
    assert.equal(
      rememberPathfinderPost(cache, "https://api-partner.spotify.com/pathfinder/v1/query", body),
      true,
    );
    assert.deepEqual(cache.pick(["searchDesktop", "searchV2"]), {
      operationName: "searchDesktop",
      sha256Hash: cache.get("searchDesktop"),
    });
    assert.equal(cache.get("searchV2"), HASH);
    assert.equal(cache.pick(["searchV2"])?.operationName, "searchV2");
  });

  it("ignores non-pathfinder posts and invalid hashes", () => {
    const cache = new QueryHashCache({ searchDesktop: HASH });
    assert.equal(
      rememberPathfinderPost(cache, "https://api.spotify.com/v1/search", buildGraphQLBody("searchDesktop", HASH, {})),
      false,
    );
    cache.remember("searchDesktop", "not-a-hash");
    assert.equal(cache.get("searchDesktop"), HASH);
  });

  it("reads operationName and hash from a pathfinder GET URL", () => {
    const cache = new QueryHashCache({});
    const url =
      "https://api-partner.spotify.com/pathfinder/v1/query?operationName=searchTracks&extensions=" +
      encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: HASH } }));
    assert.equal(rememberPathfinderUrl(cache, url), true);
    assert.equal(cache.get("searchTracks"), HASH);
  });

  it("reads batched GraphQL posts", () => {
    const cache = new QueryHashCache({});
    const ok = cache.rememberFromPost([
      {
        operationName: "addToLibrary",
        extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
      },
    ]);
    assert.equal(ok, true);
    assert.equal(cache.get("addToLibrary"), HASH);
  });
});

describe("buildGraphQLBody / libraryVariables", () => {
  it("puts uris on addToLibrary variables", () => {
    const uri = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
    const body = JSON.parse(buildGraphQLBody("addToLibrary", HASH, libraryVariables([uri]))) as {
      operationName: string;
      variables: { uris: string[] };
      extensions: { persistedQuery: { sha256Hash: string; version: number } };
    };
    assert.equal(body.operationName, "addToLibrary");
    assert.deepEqual(body.variables.uris, [uri]);
    assert.equal(body.extensions.persistedQuery.sha256Hash, HASH);
    assert.equal(body.extensions.persistedQuery.version, 1);
  });

  it("uses libraryItemUris for current web-player mutations", () => {
    const uri = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
    const [current] = libraryVariableSets([uri]);
    assert.deepEqual(current, { libraryItemUris: [uri], interactionId: null });
  });

  it("builds a pathfinder request", () => {
    const req = graphQLRequest(
      "https://api-partner.spotify.com/pathfinder/v2/query",
      { accessToken: "tok", clientToken: "ct" },
      "isInLibrary",
      HASH,
      libraryVariables(["spotify:track:4cOdK2wGLETKBW3PvgPWqT"]),
    );
    assert.equal(req.method, "POST");
    assert.equal(req.headers.authorization, "Bearer tok");
    assert.equal(req.headers["client-token"], "ct");
    assert.equal(req.headers["app-platform"], "WebPlayer");
    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers.referer, undefined);
    assert.match(req.body ?? "", /isInLibrary/);
  });
});

describe("parseSearchResults", () => {
  it("reads GraphQL searchDesktop / searchV2 tracks and playlists", () => {
    const payload = {
      data: {
        searchV2: {
          tracksV2: {
            items: [
              {
                item: {
                  data: {
                    uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
                    name: "Never Gonna Give You Up",
                    artists: { items: [{ profile: { name: "Rick Astley" } }] },
                  },
                },
              },
            ],
          },
          playlists: {
            items: [
              {
                data: {
                  uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
                  name: "Today's Top Hits",
                  ownerV2: { data: { name: "Spotify" } },
                },
              },
            ],
          },
          artists: {
            items: [{ data: { uri: "spotify:artist:0TnOYISbd1XYRBk9myaseg", profile: { name: "Pitbull" } } }],
          },
        },
      },
    };
    const hits = parseSearchResults(payload, 10);
    assert.deepEqual(
      hits.map((hit) => ({ type: hit.type, title: hit.title, subtitle: hit.subtitle })),
      [
        { type: "track", title: "Never Gonna Give You Up", subtitle: "Rick Astley" },
        { type: "playlist", title: "Today's Top Hits", subtitle: "Spotify" },
        { type: "artist", title: "Pitbull", subtitle: "" },
      ],
    );
  });

  it("reads REST search payloads", () => {
    const hits = parseSearchResults(
      {
        tracks: {
          items: [
            {
              id: "4cOdK2wGLETKBW3PvgPWqT",
              uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
              name: "Never Gonna Give You Up",
              artists: [{ name: "Rick Astley" }],
            },
          ],
        },
        albums: {
          items: [
            {
              id: "3dB0bB19ywL4DXsp3wysfU",
              uri: "spotify:album:3dB0bB19ywL4DXsp3wysfU",
              name: "Whenever You Need Somebody",
              artists: [{ name: "Rick Astley" }],
            },
          ],
        },
      },
      20,
    );
    assert.equal(hits.length, 2);
    assert.equal(hits[0].type, "track");
    assert.equal(hits[1].type, "album");
    assert.equal(hits[1].subtitle, "Rick Astley");
  });
});

describe("parseLyrics", () => {
  it("reads color-lyrics lines", () => {
    const lyrics = parseLyrics({
      lyrics: {
        syncType: "LINE_SYNCED",
        lines: [
          { startTimeMs: "0", words: "We're no strangers to love" },
          { startTimeMs: 1500, words: "You know the rules" },
        ],
      },
    });
    assert.deepEqual(lyrics, {
      syncType: "LINE_SYNCED",
      lines: [
        { startTimeMs: 0, words: "We're no strangers to love" },
        { startTimeMs: 1500, words: "You know the rules" },
      ],
    });
  });

  it("returns null when there are no lines", () => {
    assert.equal(parseLyrics({ lyrics: { syncType: "UNSYNCED", lines: [] } }), null);
    assert.match(lyricsUrl("https://gew1-spclient.spotify.com/", "4cOdK2wGLETKBW3PvgPWqT"), /color-lyrics\/v2\/track/);
  });
});

describe("parseDevices / transfer JSON", () => {
  it("reads a connect-state cluster map", () => {
    const devices = parseDevices({
      cluster: {
        active_device_id: "web-1",
        device: {
          "web-1": {
            device_info: {
              name: "Web Player (Chrome)",
              device_type: "COMPUTER",
              volume: 32768,
            },
          },
          phone: {
            device_info: { id: "phone", name: "Pixel", type: "SMARTPHONE", volume: 65535, is_active: false },
          },
        },
      },
    });
    assert.equal(devices.length, 2);
    const web = devices.find((device) => device.id === "web-1");
    assert.ok(web);
    assert.equal(web.isActive, true);
    assert.equal(web.type, "COMPUTER");
    assert.ok(web.volume != null && Math.abs(web.volume - 0.5) < 0.01);
    const phone = devices.find((device) => device.id === "phone");
    assert.equal(phone?.volume, 1);
  });

  it("reads REST device lists", () => {
    const devices = parseDevices({
      devices: [
        { id: "abc", name: "Kitchen", type: "Speaker", is_active: true, volume_percent: 72 },
      ],
    });
    assert.deepEqual(devices, [
      { id: "abc", name: "Kitchen", type: "Speaker", isActive: true, volume: 0.72 },
    ]);
  });

  it("parses transfer body and public payload", () => {
    assert.deepEqual(parseTransferBody({ deviceId: "abc", play: false }), { deviceId: "abc", play: false });
    assert.deepEqual(parseTransferBody({}), { error: "invalid_device" });
    assert.equal(publicTransferBody("abc", true), JSON.stringify({ device_ids: ["abc"], play: true }));
    const command = JSON.parse(connectTransferBody(true)) as { command: { endpoint: string } };
    assert.equal(command.command.endpoint, "transfer");
  });

  it("builds connect play with album context and skip_to", () => {
    const album = "spotify:album:1DFixLWuPkv3KT3TnV35m3";
    const track = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
    const body = JSON.parse(connectPlayBody(album, track, 1500)) as {
      command: {
        endpoint: string;
        context: { uri: string };
        options: { skip_to: { track_uri: string }; seek_to: number };
      };
    };
    assert.equal(body.command.endpoint, "play");
    assert.equal(body.command.context.uri, album);
    assert.equal(body.command.options.skip_to.track_uri, track);
    assert.equal(body.command.options.seek_to, 1500);
    assert.equal(
      publicPlayBody(album, track, 0),
      JSON.stringify({ context_uri: album, offset: { uri: track }, position_ms: 0 }),
    );
  });

  it("reads album uri from public track and pathfinder payloads", () => {
    assert.equal(
      parseAlbumUriFromTrack({ album: { id: "1DFixLWuPkv3KT3TnV35m3" } }),
      "spotify:album:1DFixLWuPkv3KT3TnV35m3",
    );
    assert.equal(
      parseAlbumUriFromTrack({
        data: { trackUnion: { albumOfTrack: { uri: "spotify:album:1DFixLWuPkv3KT3TnV35m3" } } },
      }),
      "spotify:album:1DFixLWuPkv3KT3TnV35m3",
    );
    assert.equal(parseAlbumUriFromTrack({ name: "nope" }), null);
  });
});

describe("parseLikeBody / parseIsInLibrary", () => {
  it("defaults liked to true and keeps optional uri", () => {
    assert.deepEqual(parseLikeBody({}), { liked: true });
    assert.deepEqual(parseLikeBody({ uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT", liked: false }), {
      uri: "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
      liked: false,
    });
    assert.deepEqual(parseLikeBody({ uri: "" }), { error: "invalid_uri" });
  });

  it("reads GraphQL and REST contains payloads", () => {
    assert.equal(parseIsInLibrary([true]), true);
    assert.equal(parseIsInLibrary({ data: { isInLibrary: [false] } }), false);
    assert.equal(parseIsInLibrary({ data: { lookup: [{ saved: true }] } }), true);
    assert.equal(parseIsInLibrary({ data: { lookup: [{ data: { saved: false } }] } }), false);
  });
});

describe("persisted query / apresolve helpers", () => {
  it("detects missing persisted queries", () => {
    assert.equal(persistedQueryMissing({ ok: false, status: 404, body: {} }), true);
    assert.equal(persistedQueryMissing({ ok: false, status: 412, body: {} }), true);
    assert.equal(
      persistedQueryMissing({
        ok: false,
        status: 200,
        body: { errors: [{ message: "PersistedQueryNotFound" }] },
      }),
      true,
    );
    assert.equal(graphQLOk({ ok: true, status: 200, body: { data: { searchV2: {} } } }), true);
    assert.equal(graphQLOk({ ok: true, status: 200, body: { errors: [{ message: "nope" }] } }), false);
    assert.equal(
      graphQLLibraryWriteOk(
        { ok: false, status: 200, body: { errors: [{ message: "Item is already saved in library" }] } },
        true,
      ),
      true,
    );
    assert.equal(restLibraryWriteOk({ ok: false, status: 204, body: {} }, true), true);
    assert.equal(publicLibraryEndpoint(), "https://api.spotify.com/v1/me/library");
    assert.equal(publicLibraryBody(["spotify:track:abc"]), JSON.stringify({ uris: ["spotify:track:abc"] }));
  });

  it("extracts persisted query hashes from web-player bundles", () => {
    const hash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const compact = `"addToLibrary","mutation","${hash}"`;
    const ctor = `new aJ.l("removeFromLibrary","mutation","${HASH}",null)`;
    const found = extractQueryHashes(`${compact}\n${ctor}`);
    const byName = Object.fromEntries(found.map((item) => [item.operationName, item.sha256Hash]));
    assert.equal(byName.addToLibrary, hash);
    assert.equal(byName.removeFromLibrary, HASH);
  });

  it("parses spclient hosts and search limit", () => {
    assert.deepEqual(parseSpclientHosts({ spclient: ["gew1-spclient.spotify.com", "https://spclient.wg.spotify.com/"] }), [
      "https://gew1-spclient.spotify.com",
      "https://spclient.wg.spotify.com",
    ]);
    assert.equal(parseSearchLimit(null), 20);
    assert.deepEqual(parseSearchLimit("0"), { error: "invalid_limit" });
    assert.equal(isPathfinderUrl("https://api-partner.spotify.com/pathfinder/v2/query"), true);
    assert.equal(
      pageSafeHeaders({ origin: "https://open.spotify.com", referer: "https://open.spotify.com/", accept: "application/json" })
        .origin,
      undefined,
    );
    assert.deepEqual(pageSafeHeaders({ accept: "application/json", origin: "https://evil" }), { accept: "application/json" });
  });
});
