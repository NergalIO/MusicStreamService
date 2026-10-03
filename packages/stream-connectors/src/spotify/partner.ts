import type { ConnectDevice, LyricsLine, SearchHit } from "./types.js";

export const PATHFINDER_URLS = [
  "https://api-partner.spotify.com/pathfinder/v2/query",
  "https://api-partner.spotify.com/pathfinder/v1/query",
];

export const PATHFINDER_MUTATE_URLS = [
  "https://api-partner.spotify.com/pathfinder/v2/mutate",
  "https://api-partner.spotify.com/pathfinder/v1/mutate",
];

export const PUBLIC_API = "https://api.spotify.com/v1";
export const APRESOLVE_URL = "https://apresolve.spotify.com/?type=spclient";
export const DEFAULT_SPCLIENT = "https://gew1-spclient.spotify.com";

export const DEFAULT_QUERY_HASHES: Record<string, string> = {
  searchDesktop: "2aea208278ba99da84ae7401453e819af4e07769c3c23c11d38127955c6860ba",
  searchTracks: "1d021289df50166c61630e02f002ec91182b518e56bcd681ac6b0640390c0245",
  addToLibrary: "896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148",
  removeFromLibrary: "896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148",
  isInLibrary: "d410781eb8ea7e1edce7c51368d5d2b6dca3c5391bd26b9ebca1cc9e1fadaddc",
  areEntitiesInLibrary: "134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed",
};

export const SEARCH_OPERATIONS = ["searchDesktop", "searchV2", "searchTracks", "search", "searchModalResults"] as const;
export const ADD_LIBRARY_OPERATIONS = ["addToLibrary", "addItemsToLibrary", "saveToLibrary"] as const;
export const REMOVE_LIBRARY_OPERATIONS = ["removeFromLibrary", "removeItemsFromLibrary"] as const;
export const IN_LIBRARY_OPERATIONS = ["areEntitiesInLibrary", "isInLibrary"] as const;

export type GraphQLOperation = "searchDesktop" | "addToLibrary" | "removeFromLibrary" | "isInLibrary";

export interface PartnerTokens {
  accessToken: string;
  clientToken: string | null;
}

export interface LyricsResult {
  syncType: string;
  lines: LyricsLine[];
}

export interface PageFetchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PageFetchResult {
  ok: boolean;
  status: number;
  body: unknown;
}

const HASH_RE = /^[a-f0-9]{64}$/i;

export class QueryHashCache {
  private readonly hashes = new Map<string, string>();

  constructor(defaults: Record<string, string> = DEFAULT_QUERY_HASHES) {
    for (const [name, hash] of Object.entries(defaults)) this.remember(name, hash);
  }

  remember(operationName: string, sha256Hash: string): void {
    const name = operationName.trim();
    const hash = sha256Hash.trim();
    if (!name || !HASH_RE.test(hash)) return;
    this.hashes.set(name, hash);
  }

  get(operationName: string): string | null {
    return this.hashes.get(operationName) ?? null;
  }

  getAny(names: readonly string[]): string | null {
    return this.pick(names)?.sha256Hash ?? null;
  }

  pick(names: readonly string[]): { operationName: string; sha256Hash: string } | null {
    for (const name of names) {
      const hash = this.get(name);
      if (hash) return { operationName: name, sha256Hash: hash };
    }
    return null;
  }

  rememberFromPost(raw: string | unknown): boolean {
    const parsed = typeof raw === "string" ? parseJson(raw) : raw;
    if (Array.isArray(parsed)) {
      let any = false;
      for (const item of parsed) {
        if (this.rememberFromPost(item)) any = true;
      }
      return any;
    }
    const rec = asRecord(parsed);
    if (!rec) return false;
    const operationName = str(rec.operationName);
    const extensions = asRecord(rec.extensions);
    const persisted = asRecord(extensions?.persistedQuery);
    const hash = str(persisted?.sha256Hash);
    if (!operationName || !hash) return false;
    this.remember(operationName, hash);
    return true;
  }
}

export function partnerHeaders(
  tokens: PartnerTokens,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${tokens.accessToken}`,
    "app-platform": "WebPlayer",
  };
  if (tokens.clientToken) headers["client-token"] = tokens.clientToken;
  Object.assign(headers, extra);
  return pageSafeHeaders(headers);
}

export function publicHeaders(tokens: PartnerTokens, hasBody = false): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${tokens.accessToken}`,
  };
  if (hasBody) headers["content-type"] = "application/json";
  return headers;
}

export function buildGraphQLBody(
  operationName: string,
  sha256Hash: string,
  variables: Record<string, unknown>,
): string {
  return JSON.stringify({
    operationName,
    variables,
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash,
      },
    },
  });
}

export function graphQLRequest(
  url: string,
  tokens: PartnerTokens,
  operationName: string,
  sha256Hash: string,
  variables: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): PageFetchRequest {
  return {
    url,
    method: "POST",
    headers: partnerHeaders(tokens, {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
    body: buildGraphQLBody(operationName, sha256Hash, variables),
  };
}

export function persistedQueryMissing(result: PageFetchResult): boolean {
  if (result.status === 404 || result.status === 412) return true;
  const rec = asRecord(result.body);
  const errors = rec?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((err) => {
    const message = str(asRecord(err)?.message) ?? "";
    return /persistedquerynotfound|unknown persisted|not found/i.test(message);
  });
}

export function graphQLOk(result: PageFetchResult): boolean {
  if (!result.ok || persistedQueryMissing(result)) return false;
  const rec = asRecord(result.body);
  if (!rec) return false;
  if (Array.isArray(rec.errors) && rec.errors.length > 0) return false;
  return rec.data != null;
}

export function graphQLLibraryWriteOk(result: PageFetchResult, liked: boolean): boolean {
  if (graphQLOk(result)) return true;
  if (persistedQueryMissing(result)) return false;
  const rec = asRecord(result.body);
  const errors = rec?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;
  const text = errors.map((err) => str(asRecord(err)?.message) ?? "").join(" ");
  if (liked && /already|exist|duplicate|in library|saved/i.test(text)) return true;
  if (!liked && /not (found|saved|in)|does not exist|isn't saved/i.test(text)) return true;
  return false;
}

export function restLibraryWriteOk(result: PageFetchResult, liked: boolean): boolean {
  if (result.ok || result.status === 200 || result.status === 201 || result.status === 204) return true;
  const rec = asRecord(result.body);
  const text = `${str(rec?.error) ?? ""} ${str(rec?.message) ?? ""} ${typeof result.body === "string" ? result.body : ""}`;
  if (liked && result.status >= 400 && result.status < 500 && /already|exist|duplicate/i.test(text)) return true;
  if (!liked && result.status === 404) return true;
  return false;
}

export function parseSearchResults(payload: unknown, limit = 20): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (hits.length >= limit || depth > 8 || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const rec = asRecord(value);
    if (!rec) return;
    const hit = searchHitFromRecord(rec);
    if (hit && !seen.has(hit.uri)) {
      seen.add(hit.uri);
      hits.push(hit);
      if (hits.length >= limit) return;
    }
    for (const nested of Object.values(rec)) {
      if (hits.length >= limit) return;
      if (nested && typeof nested === "object") walk(nested, depth + 1);
    }
  };
  walk(payload, 0);
  return hits.slice(0, limit);
}

export function parseLyrics(payload: unknown): LyricsResult | null {
  const rec = asRecord(payload);
  const lyrics = asRecord(rec?.lyrics) ?? rec;
  if (!lyrics) return null;
  const rawLines = lyrics.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) return null;
  const lines: LyricsLine[] = [];
  for (const row of rawLines) {
    const item = asRecord(row) ?? {};
    const words = str(item.words) ?? str(item.text) ?? "";
    if (!words || words === "♪") {
      lines.push({ startTimeMs: num(item.startTimeMs) ?? num(item.startTime) ?? 0, words: words || "" });
      continue;
    }
    lines.push({
      startTimeMs: num(item.startTimeMs) ?? num(item.startTime) ?? 0,
      words,
    });
  }
  if (lines.length === 0) return null;
  return {
    syncType: str(lyrics.syncType) ?? str(lyrics.sync_type) ?? "UNSYNCED",
    lines,
  };
}

export function parseDevices(payload: unknown): ConnectDevice[] {
  const devices: ConnectDevice[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown): void => {
    const device = deviceFromRecord(asRecord(raw));
    if (!device || seen.has(device.id)) return;
    seen.add(device.id);
    devices.push(device);
  };

  const rec = asRecord(payload);
  if (Array.isArray(payload)) {
    for (const item of payload) add(item);
    return devices;
  }
  if (!rec) return devices;

  const cluster = asRecord(rec.cluster);
  if (cluster && cluster !== rec) {
    const nested = parseDevices(cluster);
    if (nested.length > 0) return nested;
  }

  if (Array.isArray(rec.devices)) {
    for (const item of rec.devices) add(item);
    return devices;
  }

  const map = asRecord(rec.devices) ?? asRecord(rec.device);
  if (map) {
    for (const [key, value] of Object.entries(map)) {
      const nested = asRecord(value);
      const info = asRecord(nested?.device_info) ?? asRecord(nested?.deviceInfo) ?? nested;
      if (info && !str(info.id) && !str(info.device_id)) {
        add({ ...info, id: key });
      } else {
        add({ ...(info ?? {}), id: str(info?.id) ?? str(info?.device_id) ?? key });
      }
    }
  } else {
    add(rec);
  }

  const activeId = str(rec.active_device_id) ?? str(rec.activeDeviceId);
  if (activeId) {
    for (const device of devices) {
      if (device.id === activeId) device.isActive = true;
    }
  }
  return devices;
}

export function parseIsInLibrary(payload: unknown): boolean | null {
  if (typeof payload === "boolean") return payload;
  if (Array.isArray(payload)) return firstBoolean(payload);
  const rec = asRecord(payload);
  if (!rec) return null;
  if (typeof rec.liked === "boolean") return rec.liked;
  const data = asRecord(rec.data) ?? rec;
  if (Array.isArray(data.lookup)) return firstBoolean(data.lookup) ?? firstSaved(data.lookup);
  if (Array.isArray(data.isInLibrary)) return firstBoolean(data.isInLibrary) ?? firstSaved(data.isInLibrary);
  const lookup = asRecord(data.lookup) ?? asRecord(data.isInLibrary) ?? data;
  if (typeof lookup.saved === "boolean") return lookup.saved;
  if (typeof lookup.isInLibrary === "boolean") return lookup.isInLibrary;
  const values = lookup.values ?? lookup.isInLibrary ?? data.isInLibrary;
  if (Array.isArray(values)) return firstBoolean(values) ?? firstSaved(values);
  return null;
}

export function parseLikeBody(body: unknown): { uri?: string; liked: boolean } | { error: string } {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  let liked = true;
  if (rec.liked !== undefined) {
    if (typeof rec.liked !== "boolean") return { error: "invalid_liked" };
    liked = rec.liked;
  }
  if (rec.uri === undefined) return { liked };
  if (typeof rec.uri !== "string" || rec.uri.trim().length === 0) return { error: "invalid_uri" };
  return { uri: rec.uri.trim(), liked };
}

export function parseTransferBody(body: unknown): { deviceId: string; play: boolean } | { error: string } {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof rec.deviceId !== "string" || rec.deviceId.trim().length === 0) return { error: "invalid_device" };
  let play = true;
  if (rec.play !== undefined) {
    if (typeof rec.play !== "boolean") return { error: "invalid_play" };
    play = rec.play;
  }
  return { deviceId: rec.deviceId.trim(), play };
}

export function parseSpclientHosts(payload: unknown): string[] {
  const rec = asRecord(payload);
  const list = rec?.spclient;
  if (!Array.isArray(list)) return [];
  const hosts: string[] = [];
  for (const item of list) {
    const host = str(item);
    if (!host) continue;
    hosts.push(host.startsWith("http") ? host.replace(/\/$/, "") : `https://${host}`);
  }
  return hosts;
}

export function lyricsUrl(spclient: string, trackId: string): string {
  const base = spclient.replace(/\/$/, "");
  return `${base}/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`;
}

export function publicTracksUrl(ids: string): string {
  return `${PUBLIC_API}/me/tracks?ids=${encodeURIComponent(ids)}`;
}

export function publicTrackUrl(id: string): string {
  return `${PUBLIC_API}/tracks/${encodeURIComponent(id)}`;
}

export function publicPlayerPlayUrl(deviceId?: string | null): string {
  const base = `${PUBLIC_API}/me/player/play`;
  if (!deviceId) return base;
  return `${base}?device_id=${encodeURIComponent(deviceId)}`;
}

export function publicPlayBody(contextUri: string, offsetUri: string, positionMs?: number): string {
  return JSON.stringify({
    context_uri: contextUri,
    offset: { uri: offsetUri },
    position_ms: Math.max(0, Math.floor(positionMs ?? 0)),
  });
}

export function connectPlayBody(contextUri: string, trackUri: string, positionMs?: number): string {
  const options: Record<string, unknown> = {
    license: "on_demand",
    skip_to: { track_uri: trackUri },
    player_options_override: {},
  };
  if (positionMs != null && Number.isFinite(positionMs) && positionMs > 0) {
    options.seek_to = Math.floor(positionMs);
  }
  return JSON.stringify({
    command: {
      context: {
        uri: contextUri,
        url: `context://${contextUri}`,
        metadata: {},
      },
      play_origin: {
        feature_identifier: "harmony",
        feature_version: "web-player",
        referrer_identifier: "harmony",
      },
      options,
      logging_params: {
        page_instance_ids: [],
        interaction_ids: [],
      },
      endpoint: "play",
    },
  });
}

export function parseAlbumUriFromTrack(payload: unknown): string | null {
  const rec = asRecord(payload);
  if (!rec) return null;
  const fromAlbum = (album: Record<string, unknown> | null): string | null => {
    if (!album) return null;
    const uri = str(album.uri);
    if (uri) {
      const id = idFromSpotifyUri(uri);
      if (id && /^spotify:album:/i.test(uri)) return `spotify:album:${id}`;
    }
    const id = str(album.id);
    if (id && /^[0-9A-Za-z]{22}$/.test(id)) return `spotify:album:${id}`;
    return null;
  };
  const direct = fromAlbum(asRecord(rec.album));
  if (direct) return direct;
  const data = asRecord(rec.data);
  const trackUnion = asRecord(data?.trackUnion) ?? asRecord(data?.track);
  if (trackUnion) {
    const ofTrack = fromAlbum(asRecord(trackUnion.albumOfTrack));
    if (ofTrack) return ofTrack;
    const nested = fromAlbum(asRecord(trackUnion.album));
    if (nested) return nested;
  }
  return fromAlbum(asRecord(rec.albumOfTrack));
}

export function publicContainsUrl(ids: string): string {
  return `${PUBLIC_API}/me/tracks/contains?ids=${encodeURIComponent(ids)}`;
}

export function publicLibraryUrl(uris: string): string {
  return `${PUBLIC_API}/me/library?uris=${encodeURIComponent(uris)}`;
}

export function publicLibraryEndpoint(): string {
  return `${PUBLIC_API}/me/library`;
}

export function publicLibraryBody(uris: string[]): string {
  return JSON.stringify({ uris });
}

export function publicLibraryContainsUrl(uris: string): string {
  return `${PUBLIC_API}/me/library/contains?uris=${encodeURIComponent(uris)}`;
}

export function publicSearchUrl(query: string, limit: number): string {
  const params = new URLSearchParams({
    q: query,
    type: "track,album,playlist,artist",
    limit: String(limit),
  });
  return `${PUBLIC_API}/search?${params.toString()}`;
}

export function publicDevicesUrl(): string {
  return `${PUBLIC_API}/me/player/devices`;
}

export function publicTransferUrl(): string {
  return `${PUBLIC_API}/me/player`;
}

export function connectTransferUrl(spclient: string, fromId: string, toId: string): string {
  const base = spclient.replace(/\/$/, "");
  return `${base}/connect-state/v1/connect/transfer/from/${encodeURIComponent(fromId)}/to/${encodeURIComponent(toId)}`;
}

export function connectDevicesUrl(spclient: string): string {
  const base = spclient.replace(/\/$/, "");
  return `${base}/connect-state/v1/devices`;
}

export function connectClusterUrl(spclient: string, deviceId: string): string {
  const base = spclient.replace(/\/$/, "");
  const id = deviceId.startsWith("hobs_") ? deviceId : `hobs_${deviceId}`;
  return `${base}/connect-state/v1/devices/${encodeURIComponent(id)}`;
}

export function connectClusterBody(): string {
  return JSON.stringify({
    member_type: "CONNECT_STATE",
    device: {
      device_info: {
        capabilities: {
          can_be_player: false,
          hidden: true,
          needs_full_player_state: true,
          is_observable: true,
        },
      },
    },
  });
}

export function idFromSpotifyUri(uri: string): string | null {
  const match = uri.trim().match(/^spotify:(track|album|playlist|artist|episode|show):([0-9A-Za-z]{22})$/i);
  return match ? match[2] : null;
}

function searchHitFromRecord(rec: Record<string, unknown>): SearchHit | null {
  const data = asRecord(rec.data) ?? rec;
  const uri = str(data.uri) ?? str(rec.uri);
  if (!uri || !uri.startsWith("spotify:")) return null;
  const kind = uri.split(":")[1]?.toLowerCase();
  if (kind !== "track" && kind !== "album" && kind !== "playlist" && kind !== "artist") return null;
  const profile = asRecord(data.profile);
  const title =
    str(data.name) ??
    str(data.title) ??
    str(profile?.name) ??
    str(rec.name) ??
    str(rec.title);
  if (!title) return null;
  const id = idFromSpotifyUri(uri) ?? str(data.id) ?? str(rec.id) ?? uri;
  return {
    type: kind,
    uri,
    id,
    title,
    subtitle: subtitleOf(kind, data, rec),
  };
}

function subtitleOf(
  kind: SearchHit["type"],
  data: Record<string, unknown>,
  rec: Record<string, unknown>,
): string {
  if (kind === "artist") return "";
  const artists = artistNames(data.artists) || artistNames(rec.artists);
  if (artists) return artists;
  const owner =
    str(asRecord(asRecord(data.ownerV2)?.data)?.name) ??
    str(asRecord(data.owner)?.display_name) ??
    str(asRecord(data.owner)?.name);
  return owner ?? "";
}

function artistNames(value: unknown): string | null {
  if (Array.isArray(value)) {
    const names = value
      .map((item) => str(asRecord(item)?.name) ?? str(asRecord(asRecord(item)?.profile)?.name) ?? str(item))
      .filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(", ") : null;
  }
  const rec = asRecord(value);
  if (!rec) return null;
  if (Array.isArray(rec.items)) return artistNames(rec.items);
  return str(rec.name);
}

function deviceFromRecord(rec: Record<string, unknown> | null): ConnectDevice | null {
  if (!rec) return null;
  const info = asRecord(rec.device_info) ?? asRecord(rec.deviceInfo) ?? rec;
  const id = str(info.id) ?? str(info.device_id) ?? str(info.deviceId) ?? str(rec.id);
  if (!id) return null;
  const volumeRaw = num(info.volume_percent) ?? num(info.volumePercent) ?? num(info.volume);
  const volume = normalizeVolume(volumeRaw);
  return {
    id,
    name: str(info.name) ?? str(info.device_name) ?? str(info.deviceName) ?? id,
    type: str(info.type) ?? str(info.device_type) ?? str(info.deviceType) ?? "unknown",
    isActive: Boolean(
      info.is_active ?? info.isActive ?? rec.is_active ?? rec.isActive ?? rec.is_active_device,
    ),
    volume,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstBoolean(values: unknown[]): boolean | null {
  for (const item of values) {
    if (typeof item === "boolean") return item;
    const rec = asRecord(item);
    if (!rec) continue;
    if (typeof rec.saved === "boolean") return rec.saved;
    if (typeof rec.isInLibrary === "boolean") return rec.isInLibrary;
    const nested = asRecord(rec.data);
    if (typeof nested?.saved === "boolean") return nested.saved;
    if (typeof nested?.isInLibrary === "boolean") return nested.isInLibrary;
  }
  return null;
}

function firstSaved(values: unknown[]): boolean | null {
  return firstBoolean(values);
}

function normalizeVolume(volumeRaw: number | null): number | null {
  if (volumeRaw == null) return null;
  if (volumeRaw > 100) return Math.min(1, volumeRaw / 65535);
  if (volumeRaw > 1) return volumeRaw / 100;
  return volumeRaw;
}

export function extractQueryHashes(source: string): { operationName: string; sha256Hash: string }[] {
  const found: { operationName: string; sha256Hash: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, hash: string): void => {
    const operationName = name.trim();
    const sha256Hash = hash.trim();
    if (!operationName || !HASH_RE.test(sha256Hash)) return;
    const key = `${operationName}:${sha256Hash}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ operationName, sha256Hash });
  };

  const forward =
    /operationName["'\s:=]+["']([A-Za-z][A-Za-z0-9_]*)["'][\s\S]{0,500}?sha256Hash["'\s:=]+["']([a-f0-9]{64})["']/gi;
  const reverse =
    /sha256Hash["'\s:=]+["']([a-f0-9]{64})["'][\s\S]{0,500}?operationName["'\s:=]+["']([A-Za-z][A-Za-z0-9_]*)["']/gi;
  const named =
    /["'](addToLibrary|removeFromLibrary|isInLibrary|areEntitiesInLibrary|addItemsToLibrary|removeItemsFromLibrary|searchDesktop|searchV2|searchTracks)["']\s*:\s*["']([a-f0-9]{64})["']/g;
  const nameValue =
    /name:\s*["']([A-Za-z][A-Za-z0-9_]+)["'][\s\S]{0,300}?sha256Hash["'\s:=]+["']([a-f0-9]{64})["']/gi;
  const compact = /"([A-Za-z][A-Za-z0-9_]*)","(?:query|mutation)","([a-f0-9]{64})"/g;

  let match: RegExpExecArray | null;
  while ((match = forward.exec(source))) push(match[1], match[2]);
  while ((match = reverse.exec(source))) push(match[2], match[1]);
  while ((match = named.exec(source))) push(match[1], match[2]);
  while ((match = nameValue.exec(source))) push(match[1], match[2]);
  while ((match = compact.exec(source))) push(match[1], match[2]);
  return found;
}

export function isPathfinderUrl(url: string): boolean {
  return url.includes("api-partner.spotify.com/pathfinder");
}

export function rememberPathfinderPost(cache: QueryHashCache, url: string, postData: string | undefined): boolean {
  if (!isPathfinderUrl(url) || !postData) return false;
  return cache.rememberFromPost(postData);
}

export function rememberPathfinderUrl(cache: QueryHashCache, url: string): boolean {
  if (!isPathfinderUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const operationName = parsed.searchParams.get("operationName");
    const extensionsRaw = parsed.searchParams.get("extensions");
    if (!operationName || !extensionsRaw) return false;
    const extensions = JSON.parse(extensionsRaw) as unknown;
    const hash = str(asRecord(asRecord(extensions)?.persistedQuery)?.sha256Hash);
    if (!hash) return false;
    cache.remember(operationName, hash);
    return true;
  } catch {
    return false;
  }
}

export function rememberPathfinderRequest(
  cache: QueryHashCache,
  url: string,
  postData: string | undefined,
): boolean {
  const fromPost = rememberPathfinderPost(cache, url, postData);
  const fromUrl = rememberPathfinderUrl(cache, url);
  return fromPost || fromUrl;
}

export function captureConnectionId(headers: Record<string, string>): string | undefined {
  const id =
    headers["x-spotify-connection-id"] ??
    headers["X-Spotify-Connection-Id"] ??
    headers["spotify-connection-id"] ??
    headers["Spotify-Connection-Id"];
  const trimmed = id?.trim();
  return trimmed ? trimmed : undefined;
}

export function searchVariables(query: string, limit: number): Record<string, unknown> {
  return {
    searchTerm: query,
    offset: 0,
    limit,
    numberOfTopResults: Math.min(5, limit),
    includeAudiobooks: false,
    includeArtistHasConcertsField: false,
    includePreReleases: false,
    includeLocalConcertsField: false,
    includeAuthors: false,
  };
}

export function libraryVariables(uris: string[]): Record<string, unknown> {
  return { uris };
}

export function libraryMutationVariables(uris: string[]): Record<string, unknown> {
  return { libraryItemUris: uris, interactionId: null };
}

export function libraryVariableSets(uris: string[]): Record<string, unknown>[] {
  return [
    { libraryItemUris: uris, interactionId: null },
    { libraryItemUris: uris },
    { uris },
    { input: { uris } },
  ];
}

export function parseSearchLimit(raw: string | null | undefined, fallback = 20): number | { error: string } {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) return { error: "invalid_limit" };
  return n;
}

export function isUnauthorized(result: PageFetchResult): boolean {
  return result.status === 401 || result.status === 403;
}

export function connectCommandUrl(spclient: string, fromId: string, toId: string): string {
  const base = spclient.replace(/\/$/, "");
  return `${base}/connect-state/v1/player/command/from/${encodeURIComponent(fromId)}/to/${encodeURIComponent(toId)}`;
}

export function connectTransferBody(play: boolean): string {
  return JSON.stringify({
    command: {
      endpoint: "transfer",
      options: { restore_paused: play ? "error" : "restore" },
    },
  });
}

export function publicTransferBody(deviceId: string, play: boolean): string {
  return JSON.stringify({ device_ids: [deviceId], play });
}

export function jsonRequest(
  url: string,
  method: string,
  tokens: PartnerTokens,
  body?: string,
  extraHeaders?: Record<string, string>,
): PageFetchRequest {
  const hasBody = body != null && method !== "GET" && method !== "HEAD";
  return {
    url,
    method,
    headers: partnerHeaders(tokens, {
      ...(hasBody ? { "content-type": "application/json; charset=utf-8" } : {}),
      ...extraHeaders,
    }),
    body: hasBody ? body : undefined,
  };
}

export function publicJsonRequest(
  url: string,
  method: string,
  tokens: PartnerTokens,
  body?: string,
): PageFetchRequest {
  const hasBody = body != null && method !== "GET" && method !== "HEAD";
  return {
    url,
    method,
    headers: publicHeaders(tokens, hasBody),
    body: hasBody ? body : undefined,
  };
}

const FORBIDDEN_PAGE_HEADERS = new Set([
  "origin",
  "referer",
  "host",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "via",
]);

export function pageSafeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (FORBIDDEN_PAGE_HEADERS.has(key.toLowerCase())) continue;
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

export function fallbackSpclientHosts(): string[] {
  return [DEFAULT_SPCLIENT, "https://spclient.wg.spotify.com"];
}
