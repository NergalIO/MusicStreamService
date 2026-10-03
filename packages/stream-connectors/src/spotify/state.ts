import type { PlaybackSnapshot, PlayUriKind, RepeatValue, ShuffleValue } from "./types.js";
import { UNAVAILABLE } from "./types.js";

const TRACK_ID_RE = /^[0-9A-Za-z]{22}$/;
const SPOTIFY_URI_RE = /^spotify:(track|album|playlist|artist|episode|show):([0-9A-Za-z]{22})$/i;
const SPOTIFY_USER_PLAYLIST_RE = /^spotify:user:[^:]+:playlist:([0-9A-Za-z]{22})$/i;
const PATH_KIND_RE = /\/(track|album|playlist|artist|episode|show)\/([0-9A-Za-z]{22})(?:[/?#]|$)/i;
const PATH_USER_PLAYLIST_RE = /\/user\/[^/]+\/playlist\/([0-9A-Za-z]{22})(?:[/?#]|$)/i;

function isSpotifyHost(hostname: string): boolean {
  return hostname === "open.spotify.com" || hostname.endsWith(".spotify.com");
}

export function parsePlayUri(input: string): { id: string; uri: string; kind: PlayUriKind } | null {
  const raw = input.trim();
  if (!raw) return null;

  const spotify = raw.match(SPOTIFY_URI_RE);
  if (spotify) {
    const kind = spotify[1].toLowerCase() as PlayUriKind;
    const id = spotify[2];
    return { id, uri: `spotify:${kind}:${id}`, kind };
  }

  const userPlaylist = raw.match(SPOTIFY_USER_PLAYLIST_RE);
  if (userPlaylist) {
    return { id: userPlaylist[1], uri: `spotify:playlist:${userPlaylist[1]}`, kind: "playlist" };
  }

  try {
    const url = new URL(raw);
    if (isSpotifyHost(url.hostname)) {
      const userPath = url.pathname.match(/\/user\/[^/]+\/playlist\/([0-9A-Za-z]{22})/i);
      if (userPath) {
        return { id: userPath[1], uri: `spotify:playlist:${userPath[1]}`, kind: "playlist" };
      }
      const pathMatch = url.pathname.match(/\/(track|album|playlist|artist|episode|show)\/([0-9A-Za-z]{22})/i);
      if (pathMatch) {
        const kind = pathMatch[1].toLowerCase() as PlayUriKind;
        const id = pathMatch[2];
        return { id, uri: `spotify:${kind}:${id}`, kind };
      }
    }
  } catch {
    // not a URL
  }

  const embedded = raw.match(PATH_KIND_RE);
  if (embedded && raw.includes("spotify.com")) {
    const kind = embedded[1].toLowerCase() as PlayUriKind;
    const id = embedded[2];
    return { id, uri: `spotify:${kind}:${id}`, kind };
  }

  const embeddedUser = raw.match(PATH_USER_PLAYLIST_RE);
  if (embeddedUser && raw.includes("spotify.com")) {
    return { id: embeddedUser[1], uri: `spotify:playlist:${embeddedUser[1]}`, kind: "playlist" };
  }

  if (TRACK_ID_RE.test(raw)) {
    return { id: raw, uri: `spotify:track:${raw}`, kind: "track" };
  }

  return null;
}

export function parseTrackUri(input: string): { id: string; uri: string } | null {
  const parsed = parsePlayUri(input);
  if (!parsed || parsed.kind !== "track") return null;
  return { id: parsed.id, uri: parsed.uri };
}

export function extrapolatePosition(
  positionMs: number,
  sampledAt: number,
  isPlaying: boolean,
  durationMs: number | null,
  now = Date.now(),
): number {
  const base = Number.isFinite(positionMs) ? positionMs : 0;
  let next = base;
  if (isPlaying) {
    const delta = Math.max(0, now - sampledAt);
    next = base + delta;
  }
  if (durationMs != null && Number.isFinite(durationMs)) {
    next = Math.min(next, durationMs);
  }
  return Math.max(0, next);
}

export function publicShuffle(value: unknown): ShuffleValue {
  return typeof value === "boolean" ? value : UNAVAILABLE;
}

export function publicRepeat(value: unknown): RepeatValue {
  return value === "off" || value === "context" || value === "track" ? value : UNAVAILABLE;
}

export function toPublicSnapshot(sample: PlaybackSnapshot, now = Date.now()): PlaybackSnapshot {
  return {
    ...sample,
    artists: [...sample.artists],
    shuffle: publicShuffle(sample.shuffle),
    repeat: publicRepeat(sample.repeat),
    positionMs: extrapolatePosition(
      sample.positionMs,
      sample.sampledAt,
      sample.isPlaying,
      sample.durationMs,
      now,
    ),
  };
}
