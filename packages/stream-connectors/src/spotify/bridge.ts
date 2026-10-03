/**
 * tsx/esbuild keepNames inserts `__name(fn, "fn")` after inner function
 * declarations. Puppeteer sends Function.toString() into the page, where that
 * helper does not exist, so the injected source must define it first.
 */
export function installBridgeSource(): string {
  return `(() => {
    const __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true });
    (${installBridge.toString()})();
  })()`;
}

/**
 * Runs inside the Spotify tab (main world). Must not close over Node imports:
 * Puppeteer serializes this function with Function.prototype.toString().
 */
export function installBridge(): void {
  if (location.origin !== "https://open.spotify.com") return;
  const w = window as Window & {
    __spotifyBridge?: SpotifyPageBridge;
    webpackChunkclient_web?: unknown[];
    webpackChunkopen?: unknown[];
    webpackChunkspotify?: unknown[];
    Spicetify?: {
      Player?: Record<string, unknown>;
      Platform?: {
        PlayerAPI?: Record<string, unknown>;
        PlaybackAPI?: Record<string, unknown>;
        AuthorizationAPI?: Record<string, unknown>;
        Session?: Record<string, unknown>;
        ProductStateAPI?: Record<string, unknown>;
        UserAPI?: Record<string, unknown>;
      };
    };
    __spotifyAuthCapture?: { accessToken: string | null; clientToken: string | null };
    __spotifyAuthHooked?: boolean;
  };

  type CommandResult = { ok: true } | { ok: false; error: string };
  type Source = "player" | "dom";
  type RepeatMode = "off" | "context" | "track";
  type UnavailableStatus = "Unavailable";
  type ShuffleValue = boolean | UnavailableStatus;
  type RepeatValue = RepeatMode | UnavailableStatus;

  interface PlayCommand {
    uri: string;
    offsetUri?: string;
    positionMs?: number;
  }

  interface Snapshot {
    ready: boolean;
    uri: string | null;
    id: string | null;
    title: string | null;
    artists: string[];
    album: string | null;
    durationMs: number | null;
    positionMs: number;
    isPlaying: boolean;
    liked: boolean | null;
    volume: number | null;
    shuffle: ShuffleValue;
    repeat: RepeatValue;
    muted: boolean | null;
    sampledAt: number;
    source: Source;
  }

  interface SpotifyPageBridge {
    getState(): Snapshot;
    pause(): Promise<CommandResult>;
    resume(): Promise<CommandResult>;
    next(): Promise<CommandResult>;
    previous(): Promise<CommandResult>;
    play(opts: PlayCommand): Promise<CommandResult>;
    setVolume(level: number): Promise<CommandResult>;
    seek(positionMs: number): Promise<CommandResult>;
    setShuffle(enabled: boolean): Promise<CommandResult>;
    setRepeat(mode: RepeatMode): Promise<CommandResult>;
    setMute(muted: boolean): Promise<CommandResult>;
    queue(uri: string): Promise<CommandResult>;
    getAuth(): Promise<{
      loggedIn: boolean;
      hasPremium: boolean;
      email: string | null;
      accessToken: string | null;
      expiresAt: number | null;
      tokenType: "Bearer" | null;
      clientToken: string | null;
    }>;
    getMethods(): { found: boolean; methods: string[]; chunks: string[]; hasRequire: boolean; cacheSize: number };
    getPlaybackDebug(): {
      mediaSession: string | null;
      positionClock: string | null;
      durationClock: string | null;
      playPauseLabel: string | null;
      progress: { testid: string | null; now: string | null; max: string | null } | null;
      playerKeys: string[];
      stateSummary: Record<string, string>;
      liveSummary: Record<string, string>;
      livePosition: number | null;
      livePaused: boolean | null;
    };
    getDomDebug(): {
      title: string;
      widgetAria: string | null;
      testids: string[];
      hrefs: string[];
      sliders: { testid: string | null; now: string | null; max: string | null }[];
      hasPlayer: boolean;
      hasRequire: boolean;
      treeTrack: {
        uri: string | null;
        title: string | null;
        artists: string[];
        album: string | null;
      } | null;
    };
  }

  const previous = w.__spotifyBridge as (SpotifyPageBridge & { dispose?: () => void }) | undefined;
  previous?.dispose?.();

  function readHeaderBag(headers: unknown, name: string): string | null {
    if (!headers) return null;
    const lower = name.toLowerCase();
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return headers.get(name) ?? headers.get(lower);
    }
    if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (Array.isArray(pair) && String(pair[0]).toLowerCase() === lower) return String(pair[1]);
      }
      return null;
    }
    const rec = asRecord(headers);
    if (!rec) return null;
    for (const [key, value] of Object.entries(rec)) {
      if (key.toLowerCase() === lower && typeof value === "string") return value;
    }
    return null;
  }

  function captureFromHeaders(headers: unknown): void {
    const auth = readHeaderBag(headers, "authorization");
    if (auth && /^bearer\s+\S{20,}/i.test(auth)) {
      if (!w.__spotifyAuthCapture) w.__spotifyAuthCapture = { accessToken: null, clientToken: null };
      w.__spotifyAuthCapture.accessToken = auth.replace(/^bearer\s+/i, "").trim();
    }
    const client = readHeaderBag(headers, "client-token");
    if (client && client.length > 10) {
      if (!w.__spotifyAuthCapture) w.__spotifyAuthCapture = { accessToken: null, clientToken: null };
      w.__spotifyAuthCapture.clientToken = client;
    }
  }

  function hookAuthHeaders(): void {
    if (w.__spotifyAuthHooked) return;
    w.__spotifyAuthHooked = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (init?.headers) captureFromHeaders(init.headers);
        if (typeof Request !== "undefined" && input instanceof Request) captureFromHeaders(input.headers);
      } catch {
        // ignore
      }
      return origFetch(input as RequestInfo, init);
    };
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function hookedSetHeader(name: string, value: string) {
      try {
        captureFromHeaders({ [name]: value });
      } catch {
        // ignore
      }
      return origSetHeader.call(this, name, value);
    };
  }

  hookAuthHeaders();

  const ALIASES = {
    pause: ["pause", "pausePlayback"],
    resume: ["resume", "resumePlayback", "unpause"],
    play: ["play", "playUri", "playTrack", "playFromUri", "playContext", "playItem", "playDefault", "playUris"],
    next: ["skipToNext", "nextTrack", "skipNext", "next"],
    previous: ["skipToPrevious", "previousTrack", "skipPrevious", "previous", "back"],
    seek: ["seekTo", "seek", "seekToPosition"],
    setVolume: ["setVolume", "setVolumeLevel"],
    getVolume: ["getVolume", "getVolumeLevel", "getVolumeState"],
    getState: ["getState", "getCurrentState", "getPlayerState", "getProgressState"],
    setShuffle: ["setShuffle", "setShufflingContext"],
    toggleShuffle: ["toggleShuffle"],
    setRepeat: ["setRepeat", "setRepeatMode"],
    setMute: ["setMute", "setMuted"],
    toggleMute: ["toggleMute"],
    queue: ["addToQueue", "enqueue", "queue", "addToEndOfQueue"],
  };

  let playerApi: Record<string, unknown> | null = null;
  let playbackApi: Record<string, unknown> | null = null;
  let authApi: Record<string, unknown> | null = null;
  let productApi: Record<string, unknown> | null = null;
  const timers: number[] = [];
  const observers: MutationObserver[] = [];
  const observedNodes = new WeakSet<Element>();

  let lastProgress: { value: number; at: number } | null = null;
  let domPlaying = false;
  let explicitPlaying: boolean | null = null;
  let lastDomSample: Snapshot | null = null;
  let lastTreeTrack: {
    uri: string | null;
    title: string | null;
    artists: string[];
    album: string | null;
    durationMs: number | null;
  } | null = null;
  let lastTreeVolume: number | null = null;
  let lastApiVolume: number | null = null;
  let lastApiShuffle: boolean | null = null;

  function asRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    return null;
  }

  function collectFunctionNames(obj: object): Set<string> {
    const names = new Set<string>();
    let current: object | null = obj;
    let depth = 0;
    while (current && current !== Object.prototype && depth < 6) {
      let props: string[] = [];
      try {
        props = Object.getOwnPropertyNames(current);
      } catch {
        break;
      }
      for (const name of props) {
        if (name === "constructor") continue;
        try {
          if (typeof (current as Record<string, unknown>)[name] === "function") names.add(name);
        } catch {
          // getter threw
        }
      }
      current = Object.getPrototypeOf(current);
      depth += 1;
    }
    return names;
  }

  function pickMethod(obj: Record<string, unknown> | null, aliases: string[]): ((...args: unknown[]) => unknown) | null {
    if (!obj) return null;
    for (const name of aliases) {
      const fn = obj[name];
      if (typeof fn === "function") return (fn as (...args: unknown[]) => unknown).bind(obj);
    }
    const names = collectFunctionNames(obj);
    for (const alias of aliases) {
      const lower = alias.toLowerCase();
      for (const name of names) {
        if (name.toLowerCase() === lower) {
          const fn = obj[name];
          if (typeof fn === "function") return (fn as (...args: unknown[]) => unknown).bind(obj);
        }
      }
    }
    return null;
  }

  function scorePlayer(obj: Record<string, unknown>): number {
    const fns = collectFunctionNames(obj);
    let score = 0;
    if (fns.has("pause")) score += 3;
    if (fns.has("resume")) score += 2;
    if (fns.has("play")) score += 3;
    if (fns.has("skipToNext") || fns.has("nextTrack") || fns.has("next")) score += 3;
    if (fns.has("seekTo") || fns.has("seek")) score += 2;
    if (fns.has("setShuffle") || fns.has("setRepeat")) score += 1;
    if (fns.has("playUri") || fns.has("playTrack")) score += 2;
    return score;
  }

  function scorePlayback(obj: Record<string, unknown>): number {
    const fns = collectFunctionNames(obj);
    let score = 0;
    if (fns.has("setVolume")) score += 4;
    if (fns.has("getVolume")) score += 2;
    if (fns.has("setMute") || fns.has("toggleMute")) score += 2;
    if (fns.has("setShuffle")) score += 1;
    if (fns.has("setRepeat")) score += 1;
    return score;
  }

  function looksLikePlayerApi(obj: Record<string, unknown>): boolean {
    const fns = collectFunctionNames(obj);
    const hasPlay =
      fns.has("play") ||
      fns.has("playUri") ||
      fns.has("playTrack") ||
      fns.has("playFromUri") ||
      fns.has("playContext");
    const hasPause = fns.has("pause") || fns.has("pausePlayback");
    const hasNext = fns.has("skipToNext") || fns.has("nextTrack") || fns.has("skipNext") || fns.has("next");
    return (hasPause && (hasPlay || hasNext)) || (hasPlay && hasNext);
  }

  const rememberStack = new Set<object>();
  const authStack = new Set<object>();
  const productStack = new Set<object>();

  function rememberPlayer(obj: Record<string, unknown> | null): void {
    if (!obj || rememberStack.has(obj)) return;
    rememberStack.add(obj);
    try {
      if (looksLikePlayerApi(obj)) {
        const score = scorePlayer(obj);
        if (!playerApi || score >= scorePlayer(playerApi)) playerApi = obj;
      }
      const vol = scorePlayback(obj);
      if (vol >= 4 && (!playbackApi || vol > scorePlayback(playbackApi))) {
        playbackApi = obj;
      }
      rememberAuth(obj);
      rememberProduct(obj);
      const nested = asRecord(obj.PlayerAPI) ?? asRecord(obj.playerApi) ?? asRecord(obj.origin);
      if (nested && nested !== obj) rememberPlayer(nested);
      const playback = asRecord(obj.PlaybackAPI) ?? asRecord(obj.playbackApi);
      if (playback && playback !== obj) rememberPlayer(playback);
    } finally {
      rememberStack.delete(obj);
    }
  }

  function scoreAuth(obj: Record<string, unknown>): number {
    const fns = collectFunctionNames(obj);
    let score = 0;
    if (fns.has("getToken") || fns.has("getAccessToken") || fns.has("getAuthToken")) score += 4;
    if ("accessToken" in obj || "access_token" in obj) score += 3;
    if ("accessTokenExpirationTimestampMs" in obj) score += 3;
    if (fns.has("refreshToken") || fns.has("refreshAuth")) score += 1;
    return score;
  }

  function rememberAuth(obj: Record<string, unknown> | null): void {
    if (!obj || authStack.has(obj)) return;
    authStack.add(obj);
    try {
      const score = scoreAuth(obj);
      if (score >= 3 && (!authApi || score > scoreAuth(authApi))) authApi = obj;
      const nested =
        asRecord(obj.AuthorizationAPI) ??
        asRecord(obj.authorizationAPI) ??
        asRecord(obj.Session) ??
        asRecord(obj.session);
      if (nested && nested !== obj) rememberAuth(nested);
    } finally {
      authStack.delete(obj);
    }
  }

  function scoreProduct(obj: Record<string, unknown>): number {
    const fns = collectFunctionNames(obj);
    const hasFields =
      "product" in obj ||
      "ads" in obj ||
      "catalogue" in obj ||
      "isPremium" in obj ||
      "hasPremium" in obj ||
      Boolean(asRecord(obj.productState));
    let score = 0;
    if (fns.has("getProductState")) score += 4;
    if (hasFields) score += 3;
    if (fns.has("getState") && hasFields) score += 2;
    if (fns.has("getValues") && hasFields) score += 1;
    return score;
  }

  function rememberProduct(obj: Record<string, unknown> | null): void {
    if (!obj || productStack.has(obj)) return;
    productStack.add(obj);
    try {
      const score = scoreProduct(obj);
      if (score >= 3 && (!productApi || score > scoreProduct(productApi))) productApi = obj;
      const nested =
        asRecord(obj.ProductStateAPI) ??
        asRecord(obj.productStateAPI) ??
        asRecord(obj.productState) ??
        asRecord(obj.UserAPI) ??
        asRecord(obj.userAPI);
      if (nested && nested !== obj) rememberProduct(nested);
    } finally {
      productStack.delete(obj);
    }
  }

  function takePlatform(platform: Record<string, unknown> | null): void {
    if (!platform) return;
    rememberPlayer(asRecord(platform.PlayerAPI));
    rememberPlayer(asRecord(platform.PlaybackAPI));
    rememberPlayer(asRecord(platform.Player));
    rememberAuth(asRecord(platform.AuthorizationAPI));
    rememberAuth(asRecord(platform.Session));
    rememberAuth(platform);
    rememberProduct(asRecord(platform.ProductStateAPI));
    rememberProduct(asRecord(platform.UserAPI));
    rememberProduct(platform);
    rememberPlayer(platform);
  }

  function walkExport(value: unknown, depth: number, seen: Set<unknown>): void {
    if (!value || depth > 4) return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    if (value instanceof Node || value === window) return;
    seen.add(value);
    const rec = asRecord(value);
    if (!rec) return;
    takePlatform(asRecord(rec.Platform));
    rememberPlayer(asRecord(rec.PlayerAPI));
    rememberPlayer(asRecord(rec.PlaybackAPI));
    rememberPlayer(rec);
    rememberTrackMeta(rec);
    rememberVolumeMeta(rec);
    if (depth >= 3) return;
    for (const key of [
      "default",
      "Platform",
      "PlayerAPI",
      "PlaybackAPI",
      "Player",
      "player",
      "AuthorizationAPI",
      "Session",
      "ProductStateAPI",
      "UserAPI",
      "origin",
      "item",
      "track",
      "_state",
      "state",
    ]) {
      walkExport(rec[key], depth + 1, seen);
    }
  }

  type WebpackRequire = ((id: string) => unknown) & {
    c?: Record<string, { exports?: unknown }>;
    m?: Record<string, unknown>;
  };

  let webpackRequire: WebpackRequire | null = null;

  function webpackChunkNames(): string[] {
    const names = new Set<string>(["webpackChunkclient_web", "webpackChunkopen", "webpackChunkspotify"]);
    try {
      for (const key of Object.getOwnPropertyNames(window)) {
        if (key.startsWith("webpackChunk")) names.add(key);
      }
    } catch {
      // ignore
    }
    return [...names].filter((name) => Array.isArray((w as unknown as Record<string, unknown>)[name]));
  }

  function webpackChunkArrays(): unknown[][] {
    const arrays: unknown[][] = [];
    const seen = new Set<unknown[]>();
    for (const name of webpackChunkNames()) {
      const value = (w as unknown as Record<string, unknown>)[name];
      if (Array.isArray(value) && !seen.has(value)) {
        seen.add(value);
        arrays.push(value);
      }
    }
    return arrays;
  }

  function captureWebpackRequire(): WebpackRequire | null {
    if (webpackRequire?.c || webpackRequire?.m) return webpackRequire;
    for (const chunks of webpackChunkArrays()) {
      const id = `si${Math.random().toString(36).slice(2, 10)}`;
      try {
        chunks.push([
          [id],
          {
            [id](_module: unknown, _exports: unknown, req: WebpackRequire) {
              webpackRequire = req;
            },
          },
          (req: WebpackRequire) => {
            webpackRequire = req;
          },
        ]);
      } catch {
        // try runtime-only push
      }
      if (webpackRequire?.c || webpackRequire?.m) return webpackRequire;
      try {
        chunks.push([
          [Symbol.for("spotify-injector")],
          {},
          (req: WebpackRequire) => {
            webpackRequire = req;
          },
        ]);
      } catch {
        // next array
      }
      if (webpackRequire?.c || webpackRequire?.m) return webpackRequire;
    }
    return webpackRequire;
  }

  function factoryLooksLikePlayer(src: string): boolean {
    return (
      src.includes("skipToNext") ||
      src.includes("PlayerAPI") ||
      src.includes("PlaybackAPI") ||
      (src.includes("setVolume") && src.includes("pause")) ||
      (src.includes("playUri") && src.includes("pause"))
    );
  }

  function factoryLooksLikeAuth(src: string): boolean {
    return (
      src.includes("AuthorizationAPI") ||
      src.includes("accessTokenExpirationTimestampMs") ||
      (src.includes("getToken") && src.includes("accessToken"))
    );
  }

  function factoryLooksLikeProduct(src: string): boolean {
    return (
      src.includes("ProductStateAPI") ||
      src.includes("getProductState") ||
      (src.includes("catalogue") && src.includes("ads") && src.includes("product"))
    );
  }

  function scanFactories(req: WebpackRequire): void {
    const factories = req.m;
    if (!factories) return;
    for (const id of Object.keys(factories)) {
      let src = "";
      try {
        src = Function.prototype.toString.call(factories[id]);
      } catch {
        continue;
      }
      if (!factoryLooksLikePlayer(src) && !factoryLooksLikeAuth(src) && !factoryLooksLikeProduct(src)) continue;
      try {
        walkExport(req(id), 0, new Set());
      } catch {
        // module threw on evaluate
      }
      if (playerApi && authApi && productApi) return;
    }
  }

  function fiberFromNode(node: Element): unknown {
    const rec = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$") ||
        key.startsWith("__reactContainer$")
      ) {
        return rec[key];
      }
    }
    return null;
  }

  function inspectValue(value: unknown, seen: Set<unknown>, depth: number): void {
    if (!value || depth > 4) return;
    if (typeof value !== "object") return;
    if (value instanceof Node || value === window) return;
    walkExport(value, depth, seen);
  }

  function scanReactFibers(): void {
    const roots = [
      document.getElementById("main"),
      document.querySelector('[data-testid="now-playing-widget"]'),
      document.querySelector('[data-testid="player-controls"]'),
      document.querySelector('[data-testid="playback-progressbar"]'),
      document.getElementById("root"),
    ];
    const seen = new Set<unknown>();
    let budget = 6000;
    for (const node of roots) {
      if (!node || playerApi) continue;
      let current = fiberFromNode(node);
      for (let i = 0; i < 50 && current; i += 1) {
        const rec = asRecord(current);
        if (!rec) break;
        inspectValue(rec.memoizedProps, seen, 0);
        inspectValue(rec.memoizedState, seen, 0);
        inspectValue(rec.stateNode, seen, 0);
        inspectValue(rec.pendingProps, seen, 0);
        current = rec.return;
      }
      const stack: unknown[] = [fiberFromNode(node)];
      while (stack.length && budget > 0 && !playerApi) {
        budget -= 1;
        const fiber = stack.pop();
        if (!fiber || typeof fiber !== "object" || seen.has(fiber)) continue;
        seen.add(fiber);
        const rec = asRecord(fiber);
        if (!rec) continue;
        inspectValue(rec.memoizedProps, seen, 0);
        inspectValue(rec.memoizedState, seen, 0);
        inspectValue(rec.stateNode, seen, 0);
        if (rec.child) stack.push(rec.child);
        if (rec.sibling) stack.push(rec.sibling);
      }
    }
  }

  function patchLoadPrototype(ctor: unknown): void {
    if (typeof ctor !== "function") return;
    const proto = (ctor as { prototype?: Record<string, unknown> }).prototype;
    if (!proto) return;
    let names: string[] = [];
    try {
      names = Object.getOwnPropertyNames(proto);
    } catch {
      return;
    }
    const hasLoad = names.includes("load");
    const hasPlay = names.includes("play") || names.includes("pause");
    if (!hasLoad || !hasPlay) return;
    const original = proto.load;
    if (typeof original !== "function") return;
    const flagged = original as { __spotifyBridgePatched?: boolean };
    if (flagged.__spotifyBridgePatched) return;
    proto.load = function patchedLoad(this: Record<string, unknown>, ...args: unknown[]) {
      rememberPlayer(this);
      return original.apply(this, args);
    };
    (proto.load as { __spotifyBridgePatched?: boolean }).__spotifyBridgePatched = true;
  }

  function scanWebpack(): void {
    const spicetify = w.Spicetify;
    if (spicetify) {
      takePlatform(asRecord(spicetify.Platform));
      rememberPlayer(asRecord(spicetify.Player));
    }

    const req = captureWebpackRequire();
    if (!req) return;
    const seen = new Set<unknown>();
    const cache = req.c;
    if (cache) {
      for (const id of Object.keys(cache)) {
        const mod = cache[id];
        if (!mod) continue;
        walkExport(mod.exports, 0, seen);
        const exp = asRecord(mod.exports);
        if (exp) {
          patchLoadPrototype(exp.default);
          patchLoadPrototype(mod.exports);
        }
        if (playerApi && authApi && productApi) return;
      }
    }
    if (!playerApi || !authApi || !productApi) scanFactories(req);
  }

  function discoverPlayers(): void {
    scanWebpack();
    if (!playerApi) scanReactFibers();
  }

  function idFromUri(uri: string | null): string | null {
    if (!uri) return null;
    const match = uri.match(/spotify:track:([0-9A-Za-z]{22})/i);
    return match ? match[1] : null;
  }

  function uriFromHref(href: string | null): string | null {
    if (!href) return null;
    const match = href.match(/\/track\/([0-9A-Za-z]{22})/);
    return match ? `spotify:track:${match[1]}` : null;
  }

  function asString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  function asNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function elementVisible(selector: string): boolean {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function parsePremiumValue(value: unknown, depth = 0, seen?: Set<object>): boolean | null {
    if (value == null) return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 0) return false;
      if (value === 1) return true;
      return null;
    }
    if (typeof value === "string") {
      const v = value.toLowerCase().trim();
      if (
        v.includes("premium") ||
        v === "duo" ||
        v === "family" ||
        v === "student" ||
        v === "mini" ||
        v === "individual" ||
        v === "unlimited"
      ) {
        return true;
      }
      if (v === "free" || v === "open" || v === "basic") return false;
      if (v === "true" || v === "yes") return true;
      if (v === "false" || v === "no") return false;
      return null;
    }
    if (typeof value !== "object" || depth > 5) return null;
    if (value instanceof Map) {
      return parsePremiumValue(Object.fromEntries(value as Map<unknown, unknown>), depth + 1, seen);
    }
    const rec = value as Record<string, unknown>;
    const visited = seen ?? new Set<object>();
    if (visited.has(rec)) return null;
    visited.add(rec);
    if ("value" in rec && rec.value != null) {
      const keys = Object.keys(rec);
      if (
        keys.length <= 4 &&
        (typeof rec.value === "string" || typeof rec.value === "boolean" || typeof rec.value === "number")
      ) {
        const wrapped = parsePremiumValue(rec.value, depth + 1, visited);
        if (wrapped != null) return wrapped;
      }
    }
    const named =
      parsePremiumValue(rec.isPremium, depth + 1, visited) ??
      parsePremiumValue(rec.hasPremium, depth + 1, visited) ??
      parsePremiumValue(rec.premium, depth + 1, visited) ??
      parsePremiumValue(rec.product, depth + 1, visited) ??
      parsePremiumValue(rec.productType, depth + 1, visited) ??
      parsePremiumValue(rec.plan, depth + 1, visited) ??
      parsePremiumValue(rec.catalogue, depth + 1, visited) ??
      parsePremiumValue(rec.accountType, depth + 1, visited);
    if (named != null) return named;
    const type = parsePremiumValue(rec.type, depth + 1, visited);
    if (type != null) return type;
    const ads = rec.ads;
    if (ads === "0" || ads === 0) return true;
    if (ads === "1" || ads === 1) return false;
    return parsePremiumValue(rec.productState, depth + 1, visited) ?? parsePremiumValue(rec.state, depth + 1, visited);
  }

  function emailFromValue(value: unknown, depth = 0, seen?: Set<object>): string | null {
    if (value == null || depth > 5) return null;
    if (typeof value === "string") {
      const v = value.trim();
      const match = v.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      return match ? match[0] : null;
    }
    if (typeof value !== "object") return null;
    const rec = asRecord(value);
    if (!rec) return null;
    const visited = seen ?? new Set<object>();
    if (visited.has(rec)) return null;
    visited.add(rec);
    return (
      emailFromValue(rec.email, depth + 1, visited) ??
      emailFromValue(rec.userEmail, depth + 1, visited) ??
      emailFromValue(rec.username, depth + 1, visited) ??
      emailFromValue(rec.userName, depth + 1, visited) ??
      emailFromValue(rec.login, depth + 1, visited) ??
      emailFromValue(rec.user, depth + 1, visited) ??
      emailFromValue(rec.profile, depth + 1, visited) ??
      emailFromValue(rec.account, depth + 1, visited) ??
      emailFromValue(rec.me, depth + 1, visited)
    );
  }

  function emailFromDom(): string | null {
    const nodes = [
      document.querySelector('[data-testid="user-widget-link"]'),
      document.querySelector('[data-testid="user-widget"]'),
      document.querySelector('[data-testid="user-widget-name"]'),
    ];
    for (const el of nodes) {
      if (!el) continue;
      const found = emailFromValue(
        [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent].filter(Boolean).join(" "),
      );
      if (found) return found;
    }
    return null;
  }

  function durationOf(value: unknown): number | null {
    const rec = asRecord(value);
    if (!rec) return asNumber(value);
    return (
      asNumber(rec.milliseconds) ??
      asNumber(rec.ms) ??
      asNumber(rec.duration_ms) ??
      asNumber(rec.durationMs) ??
      asNumber(rec.duration)
    );
  }

  function artistsOf(value: unknown): string[] {
    if (!Array.isArray(value)) {
      const name = asString(value);
      return name ? [name] : [];
    }
    const names: string[] = [];
    for (const item of value) {
      const rec = asRecord(item);
      const name = rec ? asString(rec.name) : asString(item);
      if (name) names.push(name);
    }
    return names;
  }

  function albumOf(value: unknown): string | null {
    const rec = asRecord(value);
    if (rec) return asString(rec.name) ?? asString(rec.title);
    return asString(value);
  }

  function pickTrack(source: Record<string, unknown> | null): {
    uri: string | null;
    title: string | null;
    artists: string[];
    album: string | null;
    durationMs: number | null;
  } | null {
    if (!source) return null;
    const item =
      asRecord(source.item) ??
      asRecord(source.track) ??
      asRecord(source.current) ??
      asRecord(asRecord(source.track_window)?.current_track) ??
      asRecord(asRecord(source.item)?.metadata) ??
      source;
    const meta = asRecord(item.metadata);
    const rawUri =
      asString(item.uri) ??
      asString(item.track_uri) ??
      asString(meta?.uri);
    const uri =
      rawUri && /spotify:track:/i.test(rawUri)
        ? rawUri
        : uriFromHref(rawUri) ?? (rawUri && /spotify:track:/i.test(rawUri) ? rawUri : null);
    const title =
      asString(item.name) ??
      asString(item.title) ??
      asString(meta?.title) ??
      asString(meta?.name);
    if (!uri && !title) return null;
    if (rawUri && !uri && !title) return null;
    return {
      uri,
      title,
      artists: artistsOf(item.artists ?? item.artist ?? meta?.artist_name ?? meta?.artists),
      album: albumOf(item.album) ?? asString(meta?.album_title) ?? asString(meta?.album_name),
      durationMs:
        durationOf(item.duration) ??
        asNumber(item.duration_ms) ??
        asNumber(item.durationMs) ??
        asNumber(item.duration) ??
        durationOf(meta?.duration) ??
        asNumber(meta?.duration),
    };
  }

  function trackScore(track: { title: string | null; artists: string[]; album: string | null; uri: string | null }): number {
    return (track.uri ? 4 : 0) + (track.title ? 2 : 0) + (track.artists.length > 0 ? 1 : 0) + (track.album ? 1 : 0);
  }

  function rememberTrackMeta(obj: Record<string, unknown>): void {
    const picked = pickTrack(obj);
    if (!picked?.uri || !/spotify:track:/i.test(picked.uri)) return;
    if (!lastTreeTrack || trackScore(picked) >= trackScore(lastTreeTrack)) {
      lastTreeTrack = picked;
    }
  }

  function rememberVolumeMeta(obj: Record<string, unknown>): void {
    const fns = collectFunctionNames(obj);
    const stateish =
      looksLikePlayerApi(obj) ||
      fns.has("setVolume") ||
      fns.has("getVolume") ||
      "isPaused" in obj ||
      "paused" in obj ||
      "positionAsOfTimestamp" in obj;
    if (!stateish) return;
    let value = coerceVolume(obj.volume) ?? coerceVolume(obj.volumePercent) ?? coerceVolume(obj.volume_percent);
    if (value == null) return;
    lastTreeVolume = value;
  }

  function asBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
  }

  function asFlag(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true" || value === "on") return true;
    if (value === 0 || value === "0" || value === "false" || value === "off") return false;
    return undefined;
  }

  function knownBoolean(...values: unknown[]): boolean | undefined {
    for (const value of values) {
      if (typeof value === "boolean") return value;
    }
    return undefined;
  }

  function knownVolume(...values: unknown[]): number | undefined {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
  }

  function knownRepeat(...values: unknown[]): RepeatMode | undefined {
    for (const value of values) {
      if (value === "off" || value === "context" || value === "track") return value;
    }
    return undefined;
  }

  function playbackSlices(state: Record<string, unknown>): Record<string, unknown>[] {
    const slices = [
      state,
      asRecord(state._state),
      asRecord(state.state),
      asRecord(state.playback),
      asRecord(state.playbackState),
      asRecord(state.playback_state),
      asRecord(state.playerState),
      asRecord(state.data),
      asRecord(state.options),
      asRecord(state.settings),
      asRecord(state.playerOptions),
    ];
    const positionObj = asRecord(state.position);
    if (positionObj) slices.push(positionObj);
    return slices.filter((slice): slice is Record<string, unknown> => slice != null);
  }

  function readExplicitPaused(state: Record<string, unknown>): boolean | undefined {
    for (const slice of playbackSlices(state)) {
      const paused =
        asBoolean(slice.isPaused) ?? asBoolean(slice.is_paused) ?? asBoolean(slice.paused);
      if (paused === true) return true;
    }
    for (const slice of playbackSlices(state)) {
      const paused =
        asBoolean(slice.isPaused) ?? asBoolean(slice.is_paused) ?? asBoolean(slice.paused);
      if (paused !== undefined) return paused;
    }
    return undefined;
  }

  function readPaused(state: Record<string, unknown>): boolean | undefined {
    const explicit = readExplicitPaused(state);
    if (explicit !== undefined) return explicit;
    const slices = playbackSlices(state);
    for (const slice of slices) {
      const playing =
        asBoolean(slice.isPlaying) ?? asBoolean(slice.is_playing) ?? asBoolean(slice.playing);
      if (playing === false) return true;
    }
    for (const slice of slices) {
      const playing =
        asBoolean(slice.isPlaying) ?? asBoolean(slice.is_playing) ?? asBoolean(slice.playing);
      if (playing !== undefined) return !playing;
    }
    return undefined;
  }

  function readLikedFromRecord(source: Record<string, unknown> | null): boolean | null {
    if (!source) return null;
    const item =
      asRecord(source.item) ??
      asRecord(source.track) ??
      asRecord(asRecord(source.track_window)?.current_track) ??
      asRecord(asRecord(source.data)?.item) ??
      asRecord(asRecord(source.data)?.track) ??
      source;
    const meta = asRecord(item.metadata);
    const candidates = [
      item.saved,
      item.isSaved,
      item.is_saved,
      item.inLibrary,
      item.in_library,
      item.isInLibrary,
      meta?.saved,
      meta?.["collection.in_library"],
      meta?.collection_in_library,
      meta?.in_library,
    ];
    for (const candidate of candidates) {
      const flag = asFlag(candidate);
      if (flag !== undefined) return flag;
    }
    return null;
  }

  function asRepeatMode(value: unknown): RepeatMode | undefined {
    if (value === "off" || value === "none" || value === "NO_REPEAT" || value === 0 || value === "0") return "off";
    if (value === "context" || value === "playlist" || value === "CONTEXT" || value === 1 || value === "1") {
      return "context";
    }
    if (value === "track" || value === "one" || value === "song" || value === "TRACK" || value === 2 || value === "2") {
      return "track";
    }
    return undefined;
  }

  function readShuffle(state: Record<string, unknown> | null): boolean | undefined {
    if (!state) return undefined;
    for (const slice of playbackSlices(state)) {
      const options = asRecord(slice.options) ?? asRecord(slice.playbackOptions);
      const nestedShuffle = asRecord(slice.shuffle);
      const candidates = [
        slice.shuffle,
        slice.shuffling,
        slice.isShuffling,
        slice.is_shuffling,
        slice.shuffleState,
        slice.shuffle_state,
        slice.shufflingContext,
        slice.shuffling_context,
        slice.smartShuffle,
        slice.smart_shuffle,
        options?.shuffling_context,
        options?.shufflingContext,
        options?.shuffled,
        options?.shuffle,
        nestedShuffle?.state,
        nestedShuffle?.enabled,
        nestedShuffle?.value,
      ];
      for (const candidate of candidates) {
        const flag = asFlag(candidate);
        if (flag !== undefined) return flag;
      }
      const mode = asNumber(slice.shuffleMode) ?? asNumber(slice.shuffle_mode) ?? asNumber(options?.shuffle_mode);
      if (mode != null) return mode > 0;
      const modeStr = asString(slice.shuffleMode) ?? asString(slice.shuffle_mode) ?? asString(options?.shuffle_mode);
      if (modeStr) {
        if (/off|none|disabled/i.test(modeStr)) return false;
        if (/smart|normal|on|context/i.test(modeStr)) return true;
      }
    }
    return undefined;
  }

  function findShuffleInTree(root: Record<string, unknown> | null): boolean | undefined {
    if (!root) return undefined;
    const seen = new Set<unknown>();
    const stack: Array<{ obj: unknown; depth: number }> = [{ obj: root, depth: 0 }];
    let visited = 0;
    while (stack.length && visited < 400) {
      const item = stack.pop();
      if (!item) break;
      visited += 1;
      if (item.obj instanceof Node || item.obj === window) continue;
      const rec = asRecord(item.obj);
      if (!rec || seen.has(rec)) continue;
      seen.add(rec);
      const direct = readShuffle(rec);
      if (direct !== undefined) return direct;
      if (item.depth >= 6) continue;
      let names: string[] = [];
      try {
        names = Object.getOwnPropertyNames(rec);
      } catch {
        continue;
      }
      for (const key of names) {
        if (/token|auth|cookie|secret|password/i.test(key)) continue;
        try {
          const value = rec[key];
          if (value && typeof value === "object") stack.push({ obj: value, depth: item.depth + 1 });
        } catch {
          // getter threw
        }
      }
    }
    return undefined;
  }

  function coerceVolume(value: unknown, depth = 0): number | null {
    if (depth > 3) return null;
    const n = asNumber(value);
    if (n != null) return normalizeVolume(n);
    const rec = asRecord(value);
    if (!rec) return null;
    for (const key of ["volume", "value", "actual", "published", "percent", "level", "volumePercent", "volume_percent"]) {
      if (!(key in rec)) continue;
      const nested = coerceVolume(rec[key], depth + 1);
      if (nested != null) return nested;
    }
    return null;
  }

  function readVolume(state: Record<string, unknown> | null): number | null {
    if (!state) return null;
    for (const slice of playbackSlices(state)) {
      const value =
        coerceVolume(slice.volume) ??
        coerceVolume(slice.volumePercent) ??
        coerceVolume(slice.volume_percent) ??
        coerceVolume(slice.outputVolume) ??
        coerceVolume(slice.output_volume) ??
        coerceVolume(slice._volume);
      if (value != null) return value;
    }
    return null;
  }

  function readRepeat(state: Record<string, unknown> | null): RepeatMode | undefined {
    if (!state) return undefined;
    for (const slice of playbackSlices(state)) {
      const options = asRecord(slice.options);
      const repeatingTrack =
        asBoolean(slice.repeatingTrack) ??
        asBoolean(slice.repeating_track) ??
        asBoolean(options?.repeating_track) ??
        asBoolean(options?.repeatingTrack);
      const repeatingContext =
        asBoolean(slice.repeatingContext) ??
        asBoolean(slice.repeating_context) ??
        asBoolean(options?.repeating_context) ??
        asBoolean(options?.repeatingContext);
      if (repeatingTrack) return "track";
      if (repeatingContext) return "context";
      if (repeatingTrack === false && repeatingContext === false) return "off";
      const fromValue =
        asRepeatMode(slice.repeat) ??
        asRepeatMode(slice.repeatMode) ??
        asRepeatMode(slice.repeat_mode) ??
        asRepeatMode(options?.repeat);
      if (fromValue) return fromValue;
    }
    return undefined;
  }

  function readMuted(state: Record<string, unknown> | null): boolean | undefined {
    if (!state) return undefined;
    for (const slice of playbackSlices(state)) {
      const muted =
        asBoolean(slice.isMuted) ??
        asBoolean(slice.is_muted) ??
        asBoolean(slice.muted) ??
        asBoolean(slice.mute);
      if (muted !== undefined) return muted;
    }
    return undefined;
  }

  function readPositionMs(state: Record<string, unknown>): number {
    const keys = [
      "positionAsOfTimestamp",
      "position_as_of_timestamp",
      "positionMs",
      "position_ms",
      "progressMs",
      "progress_ms",
      "playbackPosition",
      "playback_position",
      "position",
      "progress",
    ];
    for (const slice of playbackSlices(state)) {
      for (const key of keys) {
        const value = slice[key];
        const nested = asRecord(value);
        const n = nested
          ? asNumber(nested.position) ??
            asNumber(nested.positionMs) ??
            asNumber(nested.position_ms) ??
            asNumber(nested.milliseconds)
          : asNumber(value);
        if (n != null) return n;
      }
    }
    return 0;
  }

  function readTimestamp(state: Record<string, unknown>): number {
    for (const slice of playbackSlices(state)) {
      const n =
        asNumber(slice.timestamp) ??
        asNumber(slice.positionEpoch) ??
        asNumber(slice.position_epoch) ??
        asNumber(slice.updatedAt) ??
        asNumber(slice.updated_at) ??
        asNumber(slice.updateTime) ??
        asNumber(slice.update_time);
      if (n != null) return n;
    }
    return Date.now();
  }

  function findLivePlaybackState(root: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!root) return null;
    const seen = new Set<unknown>();
    const stack: Array<{ obj: unknown; depth: number }> = [{ obj: root, depth: 0 }];
    let visited = 0;
    let best: Record<string, unknown> | null = null;
    let bestScore = 0;
    while (stack.length && visited < 500) {
      const item = stack.pop();
      if (!item) break;
      visited += 1;
      const { obj, depth } = item;
      if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
      if (obj instanceof Node || obj === window) continue;
      seen.add(obj);
      const rec = asRecord(obj);
      if (!rec) continue;
      const hasPosKey = [
        "position_as_of_timestamp",
        "positionAsOfTimestamp",
        "positionMs",
        "position_ms",
        "progressMs",
        "progress_ms",
      ].some((key) => key in rec);
      const paused = readPaused(rec);
      const explicitPause = ["isPaused", "is_paused", "paused"].some((key) => typeof rec[key] === "boolean");
      const position = readPositionMs(rec);
      const score =
        (explicitPause ? 8 : 0) + (hasPosKey ? 4 : 0) + (paused !== undefined ? 2 : 0) + (position > 0 ? 2 : 0);
      if (score > bestScore) {
        best = rec;
        bestScore = score;
      }
      if (depth >= 5) continue;
      let names: string[] = [];
      try {
        names = Object.getOwnPropertyNames(rec);
      } catch {
        continue;
      }
      for (const key of names) {
        if (/token|auth|cookie|secret|password/i.test(key)) continue;
        try {
          const value = rec[key];
          if (value && typeof value === "object") stack.push({ obj: value, depth: depth + 1 });
        } catch {
          // getter threw
        }
      }
    }
    return bestScore >= 2 ? best : null;
  }

  function describeValue(value: unknown): string {
    if (value === null) return "null";
    const kind = typeof value;
    if (kind === "boolean" || kind === "number") return `${kind}:${String(value)}`;
    if (typeof value === "string") {
      return value.length > 48 ? `string:${value.slice(0, 40)}…` : `string:${value}`;
    }
    if (kind === "function") return "function";
    if (Array.isArray(value)) return `array(${value.length})`;
    if (kind === "object") return "object";
    return kind;
  }

  function summarizeObject(obj: Record<string, unknown> | null, limit = 50): Record<string, string> {
    if (!obj) return {};
    const out: Record<string, string> = {};
    let names: string[] = [];
    try {
      names = Object.getOwnPropertyNames(obj);
    } catch {
      return out;
    }
    for (const key of names.slice(0, limit)) {
      if (/token|auth|cookie|secret|password/i.test(key)) {
        out[key] = "redacted";
        continue;
      }
      try {
        out[key] = describeValue(obj[key]);
      } catch {
        out[key] = "throws";
      }
    }
    return out;
  }

  function readPlayerState(): Snapshot | null {
    if (!playerApi && !playbackApi) {
      explicitPlaying = null;
      return null;
    }
    let raw: unknown = null;
    const getter = pickMethod(playerApi, ALIASES.getState);
    if (getter) {
      try {
        raw = getter();
      } catch {
        raw = null;
      }
    }
    if (raw && typeof raw === "object" && "then" in (raw as object)) {
      raw = null;
    }
    const listed =
      asRecord(raw) ??
      asRecord(playerApi?._state) ??
      asRecord(playerApi?.state) ??
      asRecord(playerApi?._playerState) ??
      asRecord(playerApi?.data) ??
      asRecord(playerApi);
    const live = findLivePlaybackState(playerApi) ?? findLivePlaybackState(listed);
    const state = live ?? listed;

    if (!state) {
      explicitPlaying = null;
      return null;
    }
    const track = pickTrack(listed) ?? pickTrack(state) ?? pickTrack(asRecord(state.data));
    const explicitPaused = readExplicitPaused(state);
    explicitPlaying = typeof explicitPaused === "boolean" ? !explicitPaused : null;
    const paused = explicitPaused ?? readPaused(state);
    let position = readPositionMs(state);
    const getPos = pickMethod(playerApi, ["getProgress", "getPosition", "getCurrentPosition"]);
    if (getPos) {
      try {
        const value = getPos();
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) position = value;
      } catch {
        // ignore
      }
    }
    const timestamp = readTimestamp(state);
    const listedRec = listed;
    let volume =
      readVolume(listedRec) ??
      readVolume(state) ??
      readVolume(asRecord(playbackApi)) ??
      lastApiVolume;
    const getVol = pickMethod(playbackApi ?? playerApi, ALIASES.getVolume);
    if (volume == null && getVol) {
      try {
        const v = getVol();
        if (v && typeof v === "object" && "then" in (v as object)) {
          void Promise.resolve(v).then((resolved) => {
            const n = coerceVolume(resolved);
            if (n != null) lastApiVolume = n;
          });
        } else {
          const n = coerceVolume(v);
          if (n != null) volume = n;
        }
      } catch {
        // ignore
      }
    }

    const shuffle = knownBoolean(
      readShuffle(listedRec),
      readShuffle(state),
      readShuffle(asRecord(playbackApi)),
      lastApiShuffle,
      findShuffleInTree(listedRec),
      findShuffleInTree(asRecord(playerApi)),
      findShuffleInTree(asRecord(playbackApi)),
    );

    const uri = track?.uri ?? null;
    return {
      ready: Boolean(uri || track?.title || playerApi),
      uri,
      id: idFromUri(uri),
      title: track?.title ?? null,
      artists: track?.artists ?? [],
      album: track?.album ?? null,
      durationMs: track?.durationMs ?? asNumber(state.duration) ?? asNumber(state.durationMs),
      positionMs: position,
      isPlaying: explicitPlaying ?? (typeof paused === "boolean" ? !paused : domPlaying),
      liked: readLikedFromRecord(listedRec) ?? readLikedFromRecord(state),
      volume: knownVolume(volume, lastApiVolume) ?? null,
      shuffle: shuffle ?? "Unavailable",
      repeat: knownRepeat(readRepeat(listedRec), readRepeat(state)) ?? "Unavailable",
      muted: readMuted(listedRec) ?? readMuted(state) ?? readMuted(asRecord(playbackApi)) ?? null,
      sampledAt: timestamp,
      source: "player",
    };
  }

  function parseClock(text: string | null): number | null {
    if (!text) return null;
    const match = text.trim().match(/(\d+):([0-5]\d)/);
    if (!match) return null;
    return (Number(match[1]) * 60 + Number(match[2])) * 1000;
  }

  function progressToMs(current: number, max: number | null, durationHint: number | null): number {
    if (max != null && max > 1000) return current;
    if (max != null && max > 1 && max <= 100 && durationHint) return (current / max) * durationHint;
    if (max != null && max > 0 && max <= 1 && durationHint) return current * durationHint;
    return current;
  }

  function normalizeVolume(value: number): number | null {
    let next = value;
    if (next > 1 && next <= 100) next = next / 100;
    if (next < 0 || next > 1) return null;
    return next;
  }

  function playerRoot(): Element | null {
    return (
      document.querySelector('[data-testid="now-playing-bar"]') ??
      document.querySelector("footer") ??
      document.querySelector('[data-testid="now-playing-widget"]')
    );
  }

  function hrefMatching(root: Element | null, fragment: string): string | null {
    if (!root) return null;
    const links = Array.from(root.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = link.getAttribute("href");
      if (href && href.includes(fragment)) return href;
    }
    return null;
  }

  function parseNowPlayingLabel(label: string | null): { title: string | null; artists: string[] } {
    if (!label) return { title: null, artists: [] };
    const patterns = [
      /^Now playing:\s*(.+?)\s+by\s+(.+)$/i,
      /^Playing:\s*(.+?)\s+by\s+(.+)$/i,
      /^Сейчас играет:\s*(.+?)\s+(?:от|—|–|-)\s+(.+)$/i,
      /^Reproduciendo:\s*(.+?)\s+de\s+(.+)$/i,
    ];
    for (const pattern of patterns) {
      const match = label.trim().match(pattern);
      if (match) return { title: match[1].trim(), artists: [match[2].trim()] };
    }
    return { title: null, artists: [] };
  }

  function parseDocumentTitle(): { title: string | null; artists: string[] } {
    const stripped = document.title.replace(/\s*[\-|•·—]\s*Spotify\s*$/i, "").trim();
    if (!stripped || /^spotify$/i.test(stripped) || /advertisement|^реклама$/i.test(stripped)) {
      return { title: null, artists: [] };
    }
    const parts = stripped.split(/\s+[•·]\s+/);
    if (parts.length >= 2) {
      return { title: parts[0].trim(), artists: parts.slice(1).map((part) => part.trim()).filter(Boolean) };
    }
    return { title: stripped, artists: [] };
  }

  function volumeFromElement(el: Element | null): number | null {
    if (!el) return null;
    const direct = asNumber(el.getAttribute("aria-valuenow"));
    if (direct != null) return normalizeVolume(direct);
    const inner = el.querySelector("[aria-valuenow], [role='slider'], input[type='range']");
    if (inner) {
      const value =
        asNumber(inner.getAttribute("aria-valuenow")) ??
        asNumber((inner as HTMLInputElement).value);
      if (value != null) return normalizeVolume(value);
    }
    if (el instanceof HTMLInputElement) {
      const value = asNumber(el.value);
      if (value != null) return normalizeVolume(value);
    }
    const fromTransform = fractionFromTranslate(el);
    if (fromTransform != null) return fromTransform;
    const fromCss = volumeFromCssVar(el);
    if (fromCss != null) return fromCss;
    return null;
  }

  function volumeFromCssVar(el: Element): number | null {
    let node: Element | null = el;
    for (let i = 0; i < 6 && node; i += 1) {
      const value = getComputedStyle(node).getPropertyValue("--progress-bar-transform");
      const match = /translateX\((-?\d+(?:\.\d+)?)%\)/.exec(value);
      if (match) {
        const fraction = 1 + Number(match[1]) / 100;
        if (fraction >= 0 && fraction <= 1) return fraction;
      }
      node = node.parentElement;
    }
    return null;
  }

  function fractionFromTranslate(el: Element): number | null {
    const nodes = [el, ...Array.from(el.querySelectorAll("*")).slice(0, 24)];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const inline = node.style.transform || node.getAttribute("style") || "";
      const match = /translateX\((-?\d+(?:\.\d+)?)%\)/.exec(inline);
      if (!match) continue;
      const fraction = 1 + Number(match[1]) / 100;
      if (fraction >= 0 && fraction <= 1) return fraction;
    }
    return null;
  }

  function isPlaybackProgress(el: Element): boolean {
    const progress = document.querySelector('[data-testid="playback-progressbar"]');
    return Boolean(progress && (el === progress || progress.contains(el)));
  }

  function findVolumeContainer(): HTMLElement | null {
    const selectors = [
      '[data-testid="volume-bar"]',
      '[data-testid="volume-slider"]',
      '[data-testid="volume-bar-slider"]',
      ".volume-bar__slider-container",
      ".volume-bar",
      ".main-nowPlayingBar-volumeBar",
      '[class*="volume-bar"]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) return el;
    }
    let node = muteButton()?.parentElement ?? null;
    for (let i = 0; i < 5 && node; i += 1) {
      if (trackInside(node)) return node;
      node = node.parentElement;
    }
    return muteButton()?.parentElement instanceof HTMLElement ? muteButton()?.parentElement ?? null : null;
  }

  function trackInside(scope: Element): HTMLElement | null {
    const range = Array.from(scope.querySelectorAll("input[type='range']"));
    for (const el of range) {
      if (el instanceof HTMLInputElement && !isPlaybackProgress(el)) return el;
    }

    const named = scope.querySelector(
      ".volume-bar__slider-container, [data-testid='volume-slider'], [data-testid='volume-bar-slider']",
    );
    if (named instanceof HTMLElement && !isPlaybackProgress(named)) return named;

    const sliders = Array.from(scope.querySelectorAll("[role='slider'], [aria-valuenow]"));
    for (const el of sliders) {
      if (!(el instanceof HTMLElement) || isPlaybackProgress(el)) continue;
      if (el.getAttribute("data-testid") === "volume-bar-toggle-mute-button") continue;
      const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
      if (/progress|position|playback/.test(label)) continue;
      return el;
    }
    return null;
  }

  function findVolumeElement(): HTMLElement | null {
    const container = findVolumeContainer();
    if (container) {
      const track = trackInside(container);
      if (track) return track;
    }
    const root = playerRoot();
    if (root) {
      const track = trackInside(root);
      if (track) return track;
    }
    return container;
  }

  function ariaChecked(el: Element | null): boolean | null {
    const value = el?.getAttribute("aria-checked");
    if (value === "true" || value === "mixed") return true;
    if (value === "false") return false;
    return null;
  }

  function readToggleState(el: HTMLElement | null): boolean | null {
    if (!el) return null;
    const checked = ariaChecked(el);
    if (checked !== null) return checked;
    const pressed = el.getAttribute("aria-pressed");
    if (pressed === "true") return true;
    if (pressed === "false") return false;
    const active = el.getAttribute("data-active");
    if (active === "true") return true;
    if (active === "false") return false;
    if (/(?:^|[^-])(?:is-active|active|--on)(?:$|[^-])/.test(el.className)) return true;
    const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
    if (/disable shuffle|выключить перемеш|smart shuffle is on|shuffle is on|shuffle on/.test(label)) return true;
    if (/enable shuffle|включить перемеш|enable smart shuffle/.test(label)) return false;
    return null;
  }

  function controlRoot(el: Element | null): HTMLElement | null {
    if (!el) return null;
    const host = el.closest("button, [role='button'], [aria-checked], [aria-pressed]");
    if (host instanceof HTMLElement) return host;
    return el instanceof HTMLElement ? el : null;
  }

  function isControlDisabled(el: HTMLElement | null): boolean {
    if (!el) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (el.hasAttribute("disabled")) return true;
    if (el.getAttribute("data-disabled") === "true") return true;
    const cls = typeof el.className === "string" ? el.className : "";
    return /(?:^|\s)disabled(?:\s|$)/.test(cls);
  }

  function shuffleFeatureAvailable(): boolean {
    if (pickMethod(playerApi, ALIASES.setShuffle) || pickMethod(playbackApi, ALIASES.setShuffle)) return true;
    if (pickMethod(playerApi, ALIASES.toggleShuffle) || pickMethod(playbackApi, ALIASES.toggleShuffle)) return true;
    const button = shuffleButton();
    return Boolean(button && !isControlDisabled(button));
  }

  function repeatFeatureAvailable(): boolean {
    if (pickMethod(playerApi, ALIASES.setRepeat) || pickMethod(playbackApi, ALIASES.setRepeat)) return true;
    const button = repeatButton();
    return Boolean(button && !isControlDisabled(button));
  }

  function unavailable(): CommandResult {
    return { ok: false, error: "Unavailable" };
  }

  function shuffleButton(): HTMLElement | null {
    const selectors = [
      '[data-testid="control-button-shuffle"]',
      '[data-testid="control-button-smartshuffle"]',
      '[data-testid="control-button-shuffle-on"]',
      '[data-testid="shuffle-button"]',
    ];
    for (const selector of selectors) {
      const host = controlRoot(document.querySelector(selector));
      if (host) return host;
    }
    const root = playerRoot() ?? document;
    const labeled = Array.from(root.querySelectorAll("button[aria-label], [role='button'][aria-label]"));
    for (const el of labeled) {
      if (!(el instanceof HTMLElement)) continue;
      const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
      if (/shuffle|перемеш/.test(label)) return controlRoot(el) ?? el;
    }
    return null;
  }

  function repeatButton(): HTMLElement | null {
    const one = controlRoot(document.querySelector('[data-testid="control-button-repeat-one"]'));
    if (one) return one;
    return controlRoot(document.querySelector('[data-testid="control-button-repeat"]'));
  }

  function muteButton(): HTMLElement | null {
    const el = document.querySelector('[data-testid="volume-bar-toggle-mute-button"]');
    return el instanceof HTMLElement ? el : null;
  }

  function readShuffleFromDom(): boolean | null {
    return readToggleState(shuffleButton());
  }

  function readRepeatFromDom(): RepeatMode | null {
    const btn = repeatButton();
    if (!btn) return null;
    if (btn.getAttribute("data-testid") === "control-button-repeat-one") return "track";
    const checked = btn.getAttribute("aria-checked");
    const label = (btn.getAttribute("aria-label") ?? "").toLowerCase();
    if (checked === "mixed") return "track";
    if (/one|track|этот трек|один трек|cette piste|este tema/.test(label) && checked !== "false") {
      return "track";
    }
    if (checked === "true") return "context";
    if (checked === "false") return "off";
    return null;
  }

  function isShown(el: Element | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizedLabel(el: Element | null): string {
    if (!el) return "";
    const own = el.getAttribute("aria-label") ?? el.getAttribute("title");
    if (own && own.trim()) return own.toLowerCase();
    const nested = el.querySelector("[aria-label]");
    return (nested?.getAttribute("aria-label") ?? "").toLowerCase();
  }

  function labelIsPause(label: string): boolean {
    return /pause|пауз|pausar|pausa\b|pauzeren|wstrzymaj|duraklat|일시|暂停|一時停止/.test(label);
  }

  function labelIsPlay(label: string): boolean {
    return /(?:^|[^a-z])play(?:[^a-z]|$)|играть|воспроиз|відтвор|слушать|wiedergabe|reproduc|lecture|reproduzir|riproduc|odtwórz|odtworz|afspelen|spela upp|再生|播放|재생/.test(label);
  }

  function readPlayingFromControls(): boolean | null {
    const combined = document.querySelector('[data-testid="control-button-playpause"]');
    const label = normalizedLabel(combined);
    if (label) {
      const pause = labelIsPause(label);
      const play = labelIsPlay(label);
      if (pause && !play) return true;
      if (play && !pause) return false;
    }
    const pauseBtn = document.querySelector('[data-testid="control-button-pause"]');
    const playBtn = document.querySelector('[data-testid="control-button-play"]');
    const pauseShown = isShown(pauseBtn);
    const playShown = isShown(playBtn);
    if (pauseShown && !playShown) return true;
    if (playShown && !pauseShown) return false;
    return null;
  }

  function isTransportToggle(el: Element): boolean {
    const testid = el.getAttribute("data-testid") ?? "";
    if (/shuffle|repeat|play|mute|volume|queue|lyrics|pip|fullscreen|skip/.test(testid)) return true;
    const label = normalizedLabel(el);
    return /shuffle|repeat|перемеш|повтор/.test(label);
  }

  function looksLikeLibrarySave(el: Element): boolean {
    const testid = el.getAttribute("data-testid") ?? "";
    if (/add-button|remove-button|heart|save/.test(testid)) return true;
    const label = normalizedLabel(el);
    // Saved state shortens the Russian label to "Добавить в плейлист" and drops «Любимые треки».
    return /любим|liked song|your library|медиатек|liebling|me gusta|curtidas|polubion|bibliotheek|biblioteca|titres lik|добавить в плейлист|add to playlist/.test(
      label,
    );
  }

  function likedFromButton(el: Element): boolean | null {
    const checked = ariaChecked(el);
    if (checked !== null) return checked;
    const label = normalizedLabel(el);
    if (/удал|убра|remove/.test(label)) return true;
    if (/добав|сохран|add to|save to/.test(label)) return false;
    return null;
  }

  function likedInScope(scope: Element | null): boolean | null {
    if (!scope) return null;
    const remove = scope.querySelector('[data-testid="remove-button"]');
    const add = scope.querySelector('[data-testid="add-button"]');
    if (isShown(remove) && !isShown(add)) return true;
    if (isShown(add) && !isShown(remove)) return false;
    const candidates = Array.from(scope.querySelectorAll("button[aria-checked], [role='checkbox'][aria-checked]")).filter(
      (el) => !isTransportToggle(el) && isShown(el),
    );
    const library = candidates.filter(looksLikeLibrarySave);
    const pick = library[0] ?? (candidates.length === 1 ? candidates[0] : null);
    return pick ? likedFromButton(pick) : null;
  }

  function readLikedFromDom(): boolean | null {
    return (
      likedInScope(document.querySelector('[data-testid="now-playing-widget"]')) ??
      likedInScope(document.querySelector('[data-testid="now-playing-bar"]'))
    );
  }

  function readMutedFromDom(): boolean | null {
    const btn = muteButton();
    if (!btn) return null;
    const pressed = btn.getAttribute("aria-pressed");
    if (pressed === "true") return true;
    if (pressed === "false") return false;
    const label = (btn.getAttribute("aria-label") ?? "").toLowerCase();
    if (/unmute|включить звук|activar audio|ativar o som/.test(label)) return true;
    if (/mute|без звука|выключить звук|silenciar|desativar o som/.test(label)) return false;
    return null;
  }

  function findProgressElement(): HTMLElement | null {
    const progress = document.querySelector('[data-testid="playback-progressbar"]');
    if (!(progress instanceof HTMLElement)) return null;
    const range = progress.querySelector("input[type='range']");
    if (range instanceof HTMLInputElement) return range;
    const slider = progress.querySelector("[role='slider'], [aria-valuenow]");
    if (slider instanceof HTMLElement) return slider;
    return progress;
  }

  function sampleDom(): Snapshot {
    const root = playerRoot();
    const widget =
      root?.querySelector('[data-testid="now-playing-widget"]') ??
      document.querySelector('[data-testid="now-playing-widget"]');
    const searchRoot = widget ?? root;
    const trackHref =
      hrefMatching(searchRoot, "/track/") ??
      hrefMatching(root, "/track/");
    const albumHref =
      hrefMatching(searchRoot, "/album/") ??
      hrefMatching(root, "/album/");
    const trackLink =
      (searchRoot?.querySelector('[data-testid="context-item-link"]') as HTMLAnchorElement | null) ??
      (searchRoot?.querySelector('a[href*="/track/"]') as HTMLAnchorElement | null);
    const titleEl =
      searchRoot?.querySelector('[data-testid="context-item-info-title"]') ??
      searchRoot?.querySelector('[data-testid="context-item-info-show"]') ??
      trackLink;
    const albumEl =
      searchRoot?.querySelector('[data-testid="context-item-info-album"]') ??
      (searchRoot?.querySelector('a[href*="/album/"]') as HTMLAnchorElement | null);
    const artistLinks = searchRoot
      ? (Array.from(searchRoot.querySelectorAll('a[href*="/artist/"]')) as HTMLAnchorElement[])
      : [];
    const progress = document.querySelector('[data-testid="playback-progressbar"]');
    const volumeEl = findVolumeElement();
    const now = Date.now();
    const fromAria = parseNowPlayingLabel(
      widget?.getAttribute("aria-label") ?? root?.getAttribute("aria-label") ?? null,
    );
    const fromTitle = parseDocumentTitle();

    const uri = uriFromHref(trackLink?.getAttribute("href") ?? trackHref);
    const title =
      titleEl?.textContent?.trim() ||
      fromAria.title ||
      fromTitle.title;
    const artists = artistLinks
      .map((a) => a.textContent?.trim() ?? "")
      .filter((name) => name.length > 0);
    const album =
      albumEl?.textContent?.trim() ||
      (albumHref && albumEl ? albumEl.textContent?.trim() : null) ||
      null;

    let positionMs = 0;
    let durationMs: number | null = null;
    const innerBar = progress?.querySelector("[aria-valuenow]") ?? progress;
    const current = asNumber(innerBar?.getAttribute("aria-valuenow") ?? null);
    const max = asNumber(innerBar?.getAttribute("aria-valuemax") ?? null);
    const durationClock = parseClock(
      document.querySelector('[data-testid="playback-duration"]')?.textContent ?? null,
    );
    if (durationClock != null) durationMs = durationClock;
    else if (max != null && max > 1000) durationMs = max;
    const positionClock = parseClock(
      document.querySelector('[data-testid="playback-position"]')?.textContent ?? null,
    );
    if (positionClock != null) positionMs = positionClock;
    else if (current != null) {
      positionMs = progressToMs(current, max, durationMs);
    }

    const fromButton = readPlayingFromControls();
    const mediaState = navigator.mediaSession?.playbackState;
    if (fromButton !== null) {
      domPlaying = fromButton;
    } else if (mediaState === "paused") {
      domPlaying = false;
    } else if (mediaState === "playing") {
      domPlaying = true;
    }
    const mediaKnown = mediaState === "playing" || mediaState === "paused";
    if (fromButton === null && !mediaKnown && (progress || positionClock != null)) {
      const currentPos = positionMs;
      if (lastProgress) {
        if (currentPos + 500 < lastProgress.value) {
          // new track or seek backwards
        } else if (currentPos > lastProgress.value + 50) {
          domPlaying = true;
        } else if (now - lastProgress.at >= 900 && currentPos <= lastProgress.value + 50) {
          domPlaying = false;
        }
      }
    }
    lastProgress = { value: positionMs, at: now };

    const snapshot: Snapshot = {
      ready: Boolean(uri || title),
      uri,
      id: idFromUri(uri),
      title,
      artists: artists.length > 0 ? artists : fromAria.artists.length > 0 ? fromAria.artists : fromTitle.artists,
      album,
      durationMs,
      positionMs,
      isPlaying: readPlayingFromControls() ?? domPlaying,
      liked: readLikedFromDom(),
      volume: volumeFromElement(volumeEl),
      shuffle: readShuffleFromDom() ?? "Unavailable",
      repeat: readRepeatFromDom() ?? "Unavailable",
      muted: readMutedFromDom(),
      sampledAt: now,
      source: "dom",
    };
    lastDomSample = snapshot;
    return snapshot;
  }

  function mergeState(): Snapshot {
    const fromPlayer = readPlayerState();
    const fromDom = lastDomSample ?? sampleDom();
    const fromTree = lastTreeTrack;
    const uri = fromPlayer?.uri ?? fromTree?.uri ?? fromDom.uri;
    const title = fromPlayer?.title ?? fromTree?.title ?? fromDom.title;
    const artists =
      fromPlayer && fromPlayer.artists.length > 0
        ? fromPlayer.artists
        : fromTree && fromTree.artists.length > 0
          ? fromTree.artists
          : fromDom.artists;
    return {
      ready: Boolean(uri || title || fromPlayer?.ready),
      uri,
      id: idFromUri(uri) ?? fromPlayer?.id ?? fromDom.id,
      title,
      artists,
      album: fromPlayer?.album ?? fromTree?.album ?? fromDom.album,
      durationMs: fromPlayer?.durationMs ?? fromTree?.durationMs ?? fromDom.durationMs,
      positionMs: Math.max(fromPlayer?.positionMs ?? 0, fromDom.positionMs),
      isPlaying: readPlayingFromControls() ?? explicitPlaying ?? fromDom.isPlaying,
      liked: readLikedFromDom() ?? fromPlayer?.liked ?? null,
      volume: knownVolume(fromPlayer?.volume, lastApiVolume, lastTreeVolume, fromDom.volume) ?? null,
      shuffle: knownBoolean(fromPlayer?.shuffle, lastApiShuffle, fromDom.shuffle) ?? "Unavailable",
      repeat: knownRepeat(fromPlayer?.repeat, fromDom.repeat) ?? "Unavailable",
      muted: fromPlayer?.muted ?? fromDom.muted,
      sampledAt: fromPlayer?.sampledAt ?? fromDom.sampledAt,
      source: fromPlayer ? "player" : fromTree?.uri ? "player" : "dom",
    };
  }

  function clickElement(el: Element | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    el.click();
    return true;
  }

  function playPauseButton(): HTMLElement | null {
    const combined = document.querySelector('[data-testid="control-button-playpause"]');
    if (combined instanceof HTMLElement) return combined;
    const pause = document.querySelector('[data-testid="control-button-pause"]');
    if (pause instanceof HTMLElement) return pause;
    const play = document.querySelector('[data-testid="control-button-play"]');
    if (play instanceof HTMLElement) return play;
    return null;
  }

  async function clickPlayPause(wantPlaying: boolean): Promise<CommandResult> {
    const button = playPauseButton();
    if (!button) return { ok: false, error: "dom_control_missing" };
    const state = mergeState();
    if (state.isPlaying === wantPlaying) return { ok: true };
    if (!clickElement(button)) return { ok: false, error: "dom_control_missing" };
    return { ok: true };
  }

  async function waitForPlayApi(): Promise<void> {
    for (let i = 0; i < 12; i += 1) {
      discoverPlayers();
      if (pickMethod(playerApi, ALIASES.play)) return;
      await sleep(250);
    }
  }

  function dismissPlayToasts(): void {
    const nodes = document.querySelectorAll('[role="alert"], [role="status"], [data-testid*="toast"]');
    for (const node of nodes) {
      const close = node.querySelector('button, [aria-label]');
      if (close instanceof HTMLElement) clickElement(close);
    }
  }

  function playRejected(): boolean {
    const nodes = document.querySelectorAll(
      '[role="alert"], [role="status"], [data-testid*="toast"], [data-encore-id="banner"]',
    );
    for (const el of nodes) {
      if (
        /этот трек недоступен|this track is unavailable|track is unavailable|недоступен в вашем|isn't available/i.test(
          el.textContent ?? "",
        )
      ) {
        return true;
      }
    }
    return false;
  }

  async function softPausePlayers(): Promise<void> {
    try {
      if (!playerApi) discoverPlayers();
      if (await callFirst(playerApi, ALIASES.pause, [[]])) return;
      await clickPlayPause(false);
    } catch {
      /* best-effort stop after failed play */
    }
  }

  /**
   * Wait until the requested track is playing, or fail early on unavailable toast /
   * a different track already playing (album auto-skip).
   */
  async function playingRequested(uri: string): Promise<"ok" | "unavailable" | "mismatch" | "timeout"> {
    const id = idFromUri(uri);
    for (let i = 0; i < 16; i += 1) {
      if (playRejected()) return "unavailable";
      const state = mergeState();
      if (id && (state.id === id || state.uri === uri) && state.isPlaying) return "ok";
      if (
        id &&
        state.isPlaying &&
        state.id &&
        state.id !== id &&
        state.uri &&
        !state.uri.includes(":ad:")
      ) {
        return "mismatch";
      }
      await sleep(200);
    }
    return "timeout";
  }

  async function tryPlayUris(opts: PlayCommand): Promise<boolean> {
    const fn = pickMethod(playerApi, ALIASES.play);
    if (!fn) return false;
    const requested = opts.offsetUri ?? opts.uri;
    for (const args of playArgLists(opts)) {
      try {
        await fn(...args);
        await sleep(280);
        if (playRejected()) {
          await softPausePlayers();
          return false;
        }
        const outcome = await playingRequested(requested);
        if (outcome === "ok") return true;
        if (outcome === "unavailable" || outcome === "mismatch") {
          await softPausePlayers();
          return false;
        }
        // timeout — try next signature, but stop whatever started
        await softPausePlayers();
      } catch {
        // try next signature
      }
    }
    return false;
  }

  function trackHeaderPlayButton(id: string | null): HTMLElement | null {
    const main = document.querySelector("main") ?? document.body;
    const buttons = main.querySelectorAll(
      '[data-testid="play-button"], [data-testid="entity-action-play"], [data-testid="action-bar-row"] button',
    );
    for (const el of buttons) {
      if (!(el instanceof HTMLElement)) continue;
      const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
      if (/pause|пауза/.test(label)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width >= 24 && rect.height >= 24) return el;
    }
    if (id && location.pathname.includes(`/track/${id}`)) {
      const entity = document.querySelector('[data-testid="play-button"]');
      if (entity instanceof HTMLElement) return entity;
    }
    return null;
  }

  async function playViaDom(opts: PlayCommand): Promise<CommandResult> {
    const requested = opts.offsetUri ?? opts.uri;
    const id = idFromUri(requested);
    const mapOutcome = async (outcome: "ok" | "unavailable" | "mismatch" | "timeout"): Promise<CommandResult | null> => {
      if (outcome === "ok") return { ok: true };
      if (outcome === "unavailable" || outcome === "mismatch") {
        await softPausePlayers();
        return { ok: false, error: "track_unavailable" };
      }
      return null;
    };
    if (id && location.pathname.includes(`/track/${id}`)) {
      const header = trackHeaderPlayButton(id);
      if (clickElement(header)) {
        const mapped = await mapOutcome(await playingRequested(requested));
        if (mapped) return mapped;
      }
      return { ok: false, error: playRejected() ? "track_unavailable" : "player_method_missing" };
    }
    if (id) {
      const link = document.querySelector(`a[href*="/track/${id}"]`);
      if (link instanceof HTMLAnchorElement) {
        link.click();
        await sleep(900);
        const header = trackHeaderPlayButton(id);
        if (clickElement(header)) {
          const mapped = await mapOutcome(await playingRequested(requested));
          if (mapped) return mapped;
        }
      }
    }
    return { ok: false, error: "player_method_missing" };
  }

  function setRangeFraction(track: HTMLInputElement, fraction: number): void {
    const min = Number(track.min);
    const max = Number(track.max);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) && max > lo ? max : 1;
    const value = String(lo + (hi - lo) * fraction);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(track, value);
    if (!setter) track.value = value;
    track.dispatchEvent(new Event("input", { bubbles: true }));
    track.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pointerClickAt(el: HTMLElement, fraction: number): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1) return false;
    const inset = Math.max(2, Math.min(6, rect.width * 0.02));
    const usable = Math.max(1, rect.width - inset * 2);
    const x = rect.left + inset + usable * fraction;
    const y = rect.top + rect.height / 2;
    const down: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      buttons: 1,
    };
    const up: PointerEventInit = { ...down, buttons: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", down));
    el.dispatchEvent(new MouseEvent("mousedown", down));
    el.dispatchEvent(new PointerEvent("pointermove", down));
    el.dispatchEvent(new MouseEvent("mousemove", down));
    el.dispatchEvent(new PointerEvent("pointerup", up));
    el.dispatchEvent(new MouseEvent("mouseup", up));
    el.dispatchEvent(new MouseEvent("click", up));
    return true;
  }

  function clickSlider(track: HTMLElement, fraction: number): CommandResult {
    const clamped = Math.min(1, Math.max(0, fraction));
    if (track instanceof HTMLInputElement && track.type === "range") {
      setRangeFraction(track, clamped);
      return { ok: true };
    }
    if (!pointerClickAt(track, clamped)) return { ok: false, error: "dom_control_missing" };
    return { ok: true };
  }

  function clickVolume(level: number): CommandResult {
    const track = findVolumeElement();
    if (!(track instanceof HTMLElement)) return { ok: false, error: "dom_control_missing" };
    return clickSlider(track, level);
  }

  function clickSeek(positionMs: number, durationMs: number | null): CommandResult {
    const track = findProgressElement();
    if (!(track instanceof HTMLElement)) return { ok: false, error: "dom_control_missing" };
    const duration = durationMs != null && durationMs > 0 ? durationMs : null;
    const fraction = duration ? Math.min(1, Math.max(0, positionMs / duration)) : 0;
    return clickSlider(track, fraction);
  }

  async function callFirst(
    obj: Record<string, unknown> | null,
    aliases: string[],
    argsList: unknown[][],
  ): Promise<boolean> {
    const fn = pickMethod(obj, aliases);
    if (!fn) return false;
    let lastError: unknown;
    for (const args of argsList) {
      try {
        await fn(...args);
        return true;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;
    return false;
  }

  function wrapError(err: unknown, fallback: string): CommandResult {
    const message = err instanceof Error ? err.message : String(err ?? fallback);
    return { ok: false, error: message || fallback };
  }

  async function callOnPlayers(aliases: string[], argsList: unknown[][]): Promise<boolean> {
    if (await callFirst(playerApi, aliases, argsList)) return true;
    if (playbackApi && playbackApi !== playerApi) {
      if (await callFirst(playbackApi, aliases, argsList)) return true;
    }
    return false;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function playArgLists(opts: PlayCommand): unknown[][] {
    const { uri, offsetUri, positionMs } = opts;
    const isTrack = /^spotify:track:/i.test(uri);
    const origin = {
      featureIdentifier: "open.spotify.com",
      referrerIdentifier: "open.spotify.com",
    };
    const seek =
      positionMs != null && Number.isFinite(positionMs) && positionMs > 0 ? { seekTo: positionMs } : {};
    const lists: unknown[][] = [];
    // Cosmo PlayerAPI treats a bare track URI as an invalid context and shows
    // «Этот трек недоступен». Play the album/playlist and skip to the track.
    if (isTrack && !offsetUri) {
      const page = { uri, pages: [{ items: [{ uri }] }] };
      lists.push([page, { skipTo: { uri }, licensed: true, ...seek }, origin]);
      lists.push([{ uri, pages: [{ tracks: [{ uri }] }] }, { skipTo: { uri }, ...seek }, origin]);
      return lists;
    }
    if (offsetUri) {
      lists.push([{ uri }, { skipTo: { uri: offsetUri }, licensed: true, ...seek }, origin]);
      lists.push([{ uri }, { skipTo: { uri: offsetUri }, ...seek }, origin]);
      lists.push([{ uri }, { skip_to: { track_uri: offsetUri }, ...seek }, origin]);
      lists.push([{ uri, url: `context://${uri}` }, { skipTo: { uri: offsetUri }, ...seek }, origin]);
      return lists;
    }
    lists.push([{ uri }, { licensed: true, ...seek }, origin]);
    lists.push([{ uri }, seek, origin]);
    return lists;
  }

  async function clickShuffle(enabled: boolean): Promise<CommandResult> {
    const button = shuffleButton();
    if (!button || isControlDisabled(button)) return unavailable();
    const current = readToggleState(button);
    if (current === enabled) return { ok: true };
    if (!clickElement(button)) return unavailable();
    return { ok: true };
  }

  async function clickRepeatUntil(mode: RepeatMode): Promise<CommandResult> {
    if (!repeatFeatureAvailable()) return unavailable();
    for (let i = 0; i < 3; i += 1) {
      if (readRepeatFromDom() === mode) return { ok: true };
      const button = repeatButton();
      if (!button || isControlDisabled(button) || !clickElement(button)) return unavailable();
      await sleep(80);
    }
    return readRepeatFromDom() === mode ? { ok: true } : { ok: false, error: "repeat_unmatched" };
  }

  async function clickMute(muted: boolean): Promise<CommandResult> {
    const button = muteButton();
    if (!button) return { ok: false, error: "dom_control_missing" };
    const current = readMutedFromDom();
    if (current === muted) return { ok: true };
    if (!clickElement(button)) return { ok: false, error: "dom_control_missing" };
    return { ok: true };
  }

  const REPEAT_ARGS: Record<RepeatMode, unknown[][]> = {
    off: [[0], ["off"], ["none"], [{ repeating_context: false, repeating_track: false }]],
    context: [[1], ["context"], ["playlist"], [{ repeating_context: true, repeating_track: false }]],
    track: [[2], ["track"], ["one"], ["song"], [{ repeating_context: false, repeating_track: true }]],
  };

  const bridge: SpotifyPageBridge & { dispose: () => void } = {
    getState() {
      if (!playerApi) discoverPlayers();
      return mergeState();
    },
    async pause() {
      try {
        if (!playerApi) discoverPlayers();
        if (await callFirst(playerApi, ALIASES.pause, [[]])) return { ok: true };
        return clickPlayPause(false);
      } catch (err) {
        return wrapError(err, "pause_failed");
      }
    },
    async resume() {
      try {
        if (!playerApi) discoverPlayers();
        if (await callFirst(playerApi, ALIASES.resume, [[]])) return { ok: true };
        if (await callFirst(playerApi, ALIASES.play, [[]])) return { ok: true };
        return clickPlayPause(true);
      } catch (err) {
        return wrapError(err, "resume_failed");
      }
    },
    async next() {
      try {
        if (!playerApi) discoverPlayers();
        if (await callFirst(playerApi, ALIASES.next, [[]])) return { ok: true };
        const skip = document.querySelector('[data-testid="control-button-skip-forward"]');
        if (clickElement(skip)) return { ok: true };
        return { ok: false, error: "dom_control_missing" };
      } catch (err) {
        return wrapError(err, "next_failed");
      }
    },
    async previous() {
      try {
        if (!playerApi) discoverPlayers();
        if (await callFirst(playerApi, ALIASES.previous, [[]])) return { ok: true };
        const skip = document.querySelector('[data-testid="control-button-skip-back"]');
        if (clickElement(skip)) return { ok: true };
        return { ok: false, error: "dom_control_missing" };
      } catch (err) {
        return wrapError(err, "previous_failed");
      }
    },
    async play(opts: PlayCommand) {
      try {
        await waitForPlayApi();
        // Do not dismiss toasts before attempts — we need «track unavailable» banners.
        if (await tryPlayUris(opts)) {
          if (opts.positionMs && Number.isFinite(opts.positionMs) && opts.positionMs > 0) {
            await callOnPlayers(ALIASES.seek, [[opts.positionMs], [{ positionMs: opts.positionMs }]]).catch(() => false);
          }
          dismissPlayToasts();
          return { ok: true };
        }
        if (playRejected()) {
          await softPausePlayers();
          return { ok: false, error: "track_unavailable" };
        }
        const viaDom = await playViaDom(opts);
        if (viaDom.ok) {
          dismissPlayToasts();
          return viaDom;
        }
        if (playRejected()) {
          await softPausePlayers();
          return { ok: false, error: "track_unavailable" };
        }
        return viaDom;
      } catch (err) {
        const viaDom = await playViaDom(opts).catch(() => ({ ok: false, error: "play_failed" }) as CommandResult);
        if (viaDom.ok) {
          dismissPlayToasts();
          return viaDom;
        }
        if (playRejected()) {
          await softPausePlayers();
          return { ok: false, error: "track_unavailable" };
        }
        return wrapError(err, "play_failed");
      }
    },
    async setVolume(level: number) {
      try {
        if (!playbackApi && !playerApi) discoverPlayers();
        const target = playbackApi ?? playerApi;
        if (await callFirst(target, ALIASES.setVolume, [[level], [{ volume: level }]])) {
          return { ok: true };
        }
        return clickVolume(level);
      } catch (err) {
        return wrapError(err, "volume_failed");
      }
    },
    async seek(positionMs: number) {
      try {
        if (!playerApi) discoverPlayers();
        const duration = mergeState().durationMs;
        const clamped =
          duration != null && Number.isFinite(duration)
            ? Math.min(Math.max(0, positionMs), duration)
            : Math.max(0, positionMs);
        if (await callOnPlayers(ALIASES.seek, [[clamped], [{ position: clamped }], [{ positionMs: clamped }]])) {
          return { ok: true };
        }
        return clickSeek(clamped, duration);
      } catch (err) {
        return wrapError(err, "seek_failed");
      }
    },
    async setShuffle(enabled: boolean) {
      try {
        if (!playerApi && !playbackApi) discoverPlayers();
        const current = mergeState().shuffle;
        if (await callOnPlayers(ALIASES.setShuffle, [[enabled], [{ shuffling: enabled }], [{ shuffle: enabled }]])) {
          return { ok: true };
        }
        if (typeof current === "boolean" && current !== enabled && (await callOnPlayers(ALIASES.toggleShuffle, [[]]))) {
          return { ok: true };
        }
        if (!shuffleFeatureAvailable()) return unavailable();
        return clickShuffle(enabled);
      } catch (err) {
        return wrapError(err, "shuffle_failed");
      }
    },
    async setRepeat(mode: RepeatMode) {
      try {
        if (!playerApi && !playbackApi) discoverPlayers();
        if (await callOnPlayers(ALIASES.setRepeat, REPEAT_ARGS[mode] ?? REPEAT_ARGS.off)) {
          return { ok: true };
        }
        if (!repeatFeatureAvailable()) return unavailable();
        return clickRepeatUntil(mode);
      } catch (err) {
        return wrapError(err, "repeat_failed");
      }
    },
    async setMute(muted: boolean) {
      try {
        if (!playbackApi && !playerApi) discoverPlayers();
        const current = mergeState().muted;
        if (await callOnPlayers(ALIASES.setMute, [[muted], [{ muted }], [{ mute: muted }]])) {
          return { ok: true };
        }
        if (typeof current === "boolean" && current !== muted && (await callOnPlayers(ALIASES.toggleMute, [[]]))) {
          return { ok: true };
        }
        return clickMute(muted);
      } catch (err) {
        return wrapError(err, "mute_failed");
      }
    },
    async queue(uri: string) {
      if (!playerApi && !playbackApi) discoverPlayers();
      if (!pickMethod(playerApi, ALIASES.queue) && !pickMethod(playbackApi, ALIASES.queue)) {
        return { ok: false, error: "player_method_missing" };
      }
      try {
        const ok = await callOnPlayers(ALIASES.queue, [
          [[{ uri }]],
          [{ uri }],
          [{ uris: [uri] }],
          [uri],
        ]);
        return ok ? { ok: true } : { ok: false, error: "player_method_missing" };
      } catch (err) {
        return wrapError(err, "queue_failed");
      }
    },
    async getAuth() {
      if (!authApi || !productApi) discoverPlayers();
      const tokenFromValue = (value: unknown): { accessToken: string; expiresAt: number | null } | null => {
        if (typeof value === "string" && value.length >= 20) return { accessToken: value, expiresAt: null };
        const rec = asRecord(value);
        if (!rec) return null;
        const nested = asRecord(rec.body) ?? asRecord(rec.data) ?? rec;
        const access =
          asString(nested.accessToken) ?? asString(nested.access_token) ?? asString(nested.token);
        if (!access || access.length < 20) return null;
        const expiresIn = asNumber(nested.expiresIn) ?? asNumber(nested.expires_in);
        const expiresAt =
          asNumber(nested.accessTokenExpirationTimestampMs) ??
          asNumber(nested.expiresAt) ??
          asNumber(nested.expires_at) ??
          (expiresIn != null ? Date.now() + expiresIn * 1000 : null);
        return { accessToken: access, expiresAt };
      };
      const tokenFromStorage = (storage: Storage): { accessToken: string; expiresAt: number | null } | null => {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (!key || !/token|auth|session/i.test(key)) continue;
          const raw = storage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = tokenFromValue(JSON.parse(raw) as unknown);
            if (parsed) return parsed;
          } catch {
            const parsed = tokenFromValue(raw);
            if (parsed) return parsed;
          }
        }
        return null;
      };
      let token = tokenFromValue(authApi);
      if (authApi) {
        token =
          token ??
          tokenFromValue(authApi.accessToken) ??
          tokenFromValue(authApi.access_token) ??
          tokenFromValue(authApi.token) ??
          tokenFromValue(authApi.credentials) ??
          tokenFromValue(authApi.tokenProvider) ??
          tokenFromValue(authApi.session);
        const getter = pickMethod(authApi, ["getToken", "getAccessToken", "getAuthToken", "getState"]);
        if (getter) {
          try {
            token = tokenFromValue(await getter()) ?? token;
          } catch {
            // ignore
          }
        }
      }
      if (!token) {
        try {
          token = tokenFromStorage(window.localStorage) ?? tokenFromStorage(window.sessionStorage);
        } catch {
          // storage blocked
        }
      }
      if (!token) {
        try {
          const res = await fetch(`${location.origin}/get_access_token?reason=transport&productType=web_player`, {
            credentials: "same-origin",
          });
          if (res.ok) token = tokenFromValue(await res.json());
        } catch {
          // endpoint removed or blocked
        }
      }
      const captured = w.__spotifyAuthCapture;
      const clientToken =
        (authApi && (asString(authApi.clientToken) ?? asString(authApi.client_token))) ||
        captured?.clientToken ||
        null;
      const accessToken = token?.accessToken ?? captured?.accessToken ?? null;
      const loginCta = elementVisible('[data-testid="login-button"]') || elementVisible('[data-testid="signup-button"]');
      const userMenu =
        elementVisible('[data-testid="user-widget-link"]') ||
        elementVisible('[data-testid="user-widget-avatar"]') ||
        elementVisible('[data-testid="user-widget"]');
      const sessionCookie = /(?:^|;\s*)sp_dc=/.test(document.cookie);
      const loggedIn = loginCta ? false : Boolean(accessToken) || sessionCookie || userMenu;

      let hasPremium = false;
      if (loggedIn) {
        const premiumFromStorage = (storage: Storage): boolean | null => {
          let foundFalse = false;
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (!key || !/product|premium|user|session/i.test(key)) continue;
            const raw = storage.getItem(key);
            if (!raw) continue;
            try {
              const parsed = parsePremiumValue(JSON.parse(raw) as unknown);
              if (parsed === true) return true;
              if (parsed === false) foundFalse = true;
            } catch {
              const parsed = parsePremiumValue(raw);
              if (parsed === true) return true;
              if (parsed === false) foundFalse = true;
            }
          }
          return foundFalse ? false : null;
        };
        const premiumFromApi = async (api: Record<string, unknown> | null): Promise<boolean | null> => {
          if (!api) return null;
          let foundFalse = false;
          const consider = (parsed: boolean | null): boolean => {
            if (parsed === true) return true;
            if (parsed === false) foundFalse = true;
            return false;
          };
          const resolveMaybe = async (value: unknown): Promise<unknown> => {
            if (value && typeof (value as { then?: unknown }).then === "function") {
              try {
                return await value;
              } catch {
                return null;
              }
            }
            return value;
          };
          if (typeof api.get === "function") {
            const getter = api.get as (key: string) => unknown;
            for (const key of ["product", "catalogue", "plan", "type", "ads", "account-type"]) {
              try {
                const parsed = parsePremiumValue(await resolveMaybe(getter.call(api, key)));
                if (consider(parsed)) return true;
              } catch {
                // ignore
              }
            }
          }
          const getter = pickMethod(api, ["getProductState", "getState", "getUser", "getValues"]);
          if (getter) {
            try {
              const parsed = parsePremiumValue(await resolveMaybe(getter()));
              if (consider(parsed)) return true;
            } catch {
              // ignore
            }
          }
          const looksLikeState =
            typeof api.product === "string" ||
            typeof api.catalogue === "string" ||
            typeof api.plan === "string" ||
            typeof api.ads === "string" ||
            typeof api.ads === "number";
          if (looksLikeState && consider(parsePremiumValue(api))) return true;
          if (consider(parsePremiumValue(asRecord(api.productState) ?? asRecord(api.state)))) return true;
          return foundFalse ? false : null;
        };
        let premium = await premiumFromApi(productApi);
        if (premium == null) {
          try {
            premium = premiumFromStorage(window.localStorage) ?? premiumFromStorage(window.sessionStorage);
          } catch {
            // storage blocked
          }
        }
        hasPremium = premium === true;
      }

      let email: string | null = null;
      if (loggedIn) {
        const emailFromStorage = (storage: Storage): string | null => {
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (!key || !/user|account|profile|session|auth|login/i.test(key)) continue;
            const raw = storage.getItem(key);
            if (!raw) continue;
            try {
              const parsed = emailFromValue(JSON.parse(raw) as unknown);
              if (parsed) return parsed;
            } catch {
              const parsed = emailFromValue(raw);
              if (parsed) return parsed;
            }
          }
          return null;
        };
        const emailFromApi = async (api: Record<string, unknown> | null): Promise<string | null> => {
          if (!api) return null;
          const direct = emailFromValue(api);
          if (direct) return direct;
          const getter = pickMethod(api, ["getUser", "getSession", "getState", "getProfile", "getMe"]);
          if (getter) {
            try {
              const parsed = emailFromValue(await getter());
              if (parsed) return parsed;
            } catch {
              // ignore
            }
          }
          return null;
        };
        email =
          (await emailFromApi(authApi)) ??
          (await emailFromApi(productApi)) ??
          emailFromValue(w.Spicetify?.Platform) ??
          emailFromDom();
        if (!email) {
          try {
            email = emailFromStorage(window.localStorage) ?? emailFromStorage(window.sessionStorage);
          } catch {
            // storage blocked
          }
        }
      }

      return {
        loggedIn,
        hasPremium,
        email,
        accessToken,
        expiresAt: token?.expiresAt ?? null,
        tokenType: accessToken ? ("Bearer" as const) : null,
        clientToken,
      };
    },
    getMethods() {
      if (!playerApi) discoverPlayers();
      const methods = new Set<string>();
      if (playerApi) for (const name of collectFunctionNames(playerApi)) methods.add(name);
      if (playbackApi) for (const name of collectFunctionNames(playbackApi)) methods.add(name);
      const cache = webpackRequire?.c;
      return {
        found: methods.size > 0,
        methods: [...methods].sort(),
        chunks: webpackChunkNames(),
        hasRequire: Boolean(webpackRequire?.c || webpackRequire?.m),
        cacheSize: cache ? Object.keys(cache).length : 0,
      };
    },
    getDomDebug() {
      if (!playerApi && !lastTreeTrack) discoverPlayers();
      const root = playerRoot();
      const testids = [
        ...new Set(
          Array.from(root?.querySelectorAll("[data-testid]") ?? [])
            .map((el) => el.getAttribute("data-testid"))
            .filter((id): id is string => Boolean(id)),
        ),
      ].slice(0, 80);
      const hrefs = Array.from(root?.querySelectorAll("a[href]") ?? [])
        .map((el) => el.getAttribute("href"))
        .filter((href): href is string => Boolean(href))
        .slice(0, 40);
      const sliders = Array.from(document.querySelectorAll("[aria-valuenow]"))
        .slice(0, 20)
        .map((el) => ({
        testid: el.getAttribute("data-testid"),
        now: el.getAttribute("aria-valuenow"),
        max: el.getAttribute("aria-valuemax"),
      }));
      return {
        title: document.title,
        widgetAria:
          document.querySelector('[data-testid="now-playing-widget"]')?.getAttribute("aria-label") ?? null,
        testids,
        hrefs,
        sliders,
        hasPlayer: Boolean(playerApi),
        hasRequire: Boolean(webpackRequire?.c || webpackRequire?.m),
        treeTrack: lastTreeTrack
          ? {
              uri: lastTreeTrack.uri,
              title: lastTreeTrack.title,
              artists: lastTreeTrack.artists,
              album: lastTreeTrack.album,
            }
          : null,
      };
    },
    getPlaybackDebug() {
      if (!playerApi) discoverPlayers();
      const listed =
        asRecord(playerApi?._state) ??
        asRecord(playerApi?.state) ??
        asRecord(playerApi);
      const live = findLivePlaybackState(playerApi) ?? findLivePlaybackState(listed);
      const progress = document.querySelector('[data-testid="playback-progressbar"]');
      const valued = progress?.querySelector("[aria-valuenow]") ?? progress;
      let playerKeys: string[] = [];
      try {
        playerKeys = playerApi ? Object.getOwnPropertyNames(playerApi).slice(0, 60) : [];
      } catch {
        playerKeys = [];
      }
      return {
        mediaSession: navigator.mediaSession?.playbackState ?? null,
        positionClock: document.querySelector('[data-testid="playback-position"]')?.textContent?.trim() ?? null,
        durationClock: document.querySelector('[data-testid="playback-duration"]')?.textContent?.trim() ?? null,
        playPauseLabel:
          document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute("aria-label") ?? null,
        progress: progress
          ? {
              testid: valued?.getAttribute("data-testid") ?? progress.getAttribute("data-testid"),
              now: valued?.getAttribute("aria-valuenow") ?? null,
              max: valued?.getAttribute("aria-valuemax") ?? null,
            }
          : null,
        playerKeys,
        stateSummary: summarizeObject(listed),
        liveSummary: summarizeObject(live),
        livePosition: live ? readPositionMs(live) : null,
        livePaused: live ? (readPaused(live) ?? null) : null,
      };
    },
    dispose() {
      for (const id of timers) window.clearInterval(id);
      timers.length = 0;
      for (const observer of observers) observer.disconnect();
      observers.length = 0;
    },
  };

  function ensureObservers(): void {
    const nodes = [
      document.querySelector('[data-testid="playback-progressbar"]'),
      document.querySelector('[data-testid="playback-position"]'),
      document.querySelector('[data-testid="now-playing-bar"]'),
      document.querySelector('[data-testid="now-playing-widget"]'),
      document.querySelector('[data-testid="volume-bar"]'),
      document.querySelector('[data-testid="control-button-shuffle"]'),
      document.querySelector('[data-testid="control-button-repeat"]'),
      document.querySelector('[data-testid="volume-bar-toggle-mute-button"]'),
      findVolumeElement(),
    ];
    if (observers.length === 0) {
      const observer = new MutationObserver(() => {
        sampleDom();
      });
      observers.push(observer);
    }
    const observer = observers[0];
    for (const node of nodes) {
      if (node && !observedNodes.has(node)) {
        observer.observe(node, { attributes: true, childList: true, subtree: true });
        observedNodes.add(node);
      }
    }
  }

  async function refreshCachedApi(): Promise<void> {
    const volFn = pickMethod(playbackApi ?? playerApi, ALIASES.getVolume);
    if (volFn) {
      try {
        const n = coerceVolume(await volFn());
        if (n != null) lastApiVolume = n;
      } catch {
        // ignore
      }
    }
    const shuffleFn = pickMethod(playerApi ?? playbackApi, [
      "getShuffle",
      "getShuffleState",
      "isShuffling",
      "getShufflingContext",
    ]);
    if (shuffleFn) {
      try {
        const value = await shuffleFn();
        const flag = asFlag(value);
        if (flag !== undefined) {
          lastApiShuffle = flag;
        } else {
          const rec = asRecord(value);
          const nested = rec
            ? asFlag(rec.shuffle) ??
              asFlag(rec.shuffling_context) ??
              asFlag(rec.shufflingContext) ??
              asFlag(rec.state)
            : undefined;
          if (nested !== undefined) lastApiShuffle = nested;
        }
      } catch {
        // ignore
      }
    }
    const scanned =
      findShuffleInTree(asRecord(playerApi)) ?? findShuffleInTree(asRecord(playbackApi));
    if (scanned !== undefined) lastApiShuffle = scanned;
  }

  discoverPlayers();
  sampleDom();
  ensureObservers();
  void refreshCachedApi();
  timers.push(
    window.setInterval(() => {
      if (!playerApi) discoverPlayers();
      sampleDom();
      ensureObservers();
      void refreshCachedApi();
    }, 500),
  );

  w.__spotifyBridge = bridge;
}
