import type { AudioModule, AudioModuleFactory } from './types.js';

export type EngineEvent =
  | 'play'
  | 'pause'
  | 'timeupdate'
  | 'durationchange'
  | 'ended'
  | 'nearend'
  | 'waiting'
  | 'playing'
  | 'error';

export interface PlayOptions {
  /** Seconds of overlap with the currently playing track; 0 = hard cut. */
  crossfade?: number;
  startAt?: number;
  /** Loudness correction for this track, dB (normalisation). */
  gainDb?: number;
}

interface Deck {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  /** Per-track loudness correction; separate from `gain`, which is used for crossfades. */
  norm: GainNode | null;
  gain: GainNode | null;
  url: string;
  gainDb: number;
}

type SinkAudioContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

type Listener = (engine: AudioEngine) => void;

const FORWARDED: EngineEvent[] = ['play', 'pause', 'timeupdate', 'durationchange', 'ended', 'waiting', 'playing', 'error'];

function createDeck(): Deck {
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  el.preservesPitch = true;
  return { el, source: null, norm: null, gain: null, url: '', gainDb: 0 };
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

/**
 * Two-deck Web Audio player. Each deck owns one MediaElementSource for its whole
 * lifetime (a media element can only ever be wrapped once), so the module chain
 * can be rewired freely without recreating sources or losing module settings.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private master: GainNode | null = null;
  private decks: [Deck, Deck] = [createDeck(), createDeck()];
  private activeIndex = 0;
  private modules = new Map<string, AudioModule>();
  private moduleOrder: string[] = [];
  private enabledModules = new Set<string>();
  private moduleNodes = new Map<string, { input: AudioNode; output: AudioNode }>();
  private listeners = new Map<EngineEvent, Set<Listener>>();
  private volume = 1;
  private muted = false;
  private crossfadeSeconds = 0;
  private nearEndFired = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: MediaError | null = null;
  private playbackRate = 1;
  private sinkId = '';
  private fadingOut = false;

  constructor() {
    this.decks.forEach((deck) => {
      for (const type of FORWARDED) {
        deck.el.addEventListener(type, () => {
          if (deck !== this.active) return;
          if (type === 'error') this.lastError = deck.el.error;
          if (type === 'timeupdate') this.checkNearEnd();
          this.emit(type);
        });
      }
    });
  }

  private get active(): Deck {
    return this.decks[this.activeIndex];
  }

  private get standby(): Deck {
    return this.decks[1 - this.activeIndex];
  }

  /** The currently audible element. Read-only access for diagnostics. */
  get element(): HTMLAudioElement {
    return this.active.el;
  }

  get currentUrl(): string {
    return this.active.url;
  }

  get error(): MediaError | null {
    return this.lastError;
  }

  on(event: EngineEvent, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  private emit(event: EngineEvent): void {
    this.listeners.get(event)?.forEach((l) => l(this));
  }

  registerModule(factory: AudioModuleFactory): AudioModule {
    const mod = factory();
    const prev = this.modules.get(mod.id);
    if (prev) {
      this.moduleNodes.get(mod.id)?.output.disconnect();
      this.moduleNodes.delete(mod.id);
      prev.dispose();
    }
    this.modules.set(mod.id, mod);
    this.rewire();
    return mod;
  }

  setModuleOrder(ids: string[]): void {
    this.moduleOrder = ids;
    this.rewire();
  }

  enableModule(id: string, on: boolean): void {
    if (on) this.enabledModules.add(id);
    else this.enabledModules.delete(id);
    this.rewire();
  }

  getModule<T extends AudioModule = AudioModule>(id: string): T | undefined {
    return this.modules.get(id) as T | undefined;
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.applyVolume();
    for (const deck of this.decks) {
      deck.source = ctx.createMediaElementSource(deck.el);
      deck.norm = ctx.createGain();
      deck.norm.gain.value = dbToGain(deck.gainDb);
      deck.gain = ctx.createGain();
      deck.gain.gain.value = deck === this.active ? 1 : 0;
      deck.source.connect(deck.norm);
      deck.norm.connect(deck.gain);
      deck.gain.connect(this.bus);
    }
    if (this.sinkId) void this.applySink();
    this.rewire();
    return ctx;
  }

  private setDeckNorm(deck: Deck, db: number): void {
    deck.gainDb = db;
    if (deck.norm && this.ctx) deck.norm.gain.setValueAtTime(dbToGain(db), this.ctx.currentTime);
  }

  private async applySink(): Promise<void> {
    const ctx = this.ctx as SinkAudioContext | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(this.sinkId);
    } catch {
      // Устройство отключили — возвращаемся к системному по умолчанию.
      this.sinkId = '';
      await ctx.setSinkId('').catch(() => undefined);
    }
  }

  /** Audio output device from `enumerateDevices()`; empty string = system default. */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    await this.applySink();
  }

  get outputDeviceSupported(): boolean {
    return typeof (AudioContext.prototype as SinkAudioContext).setSinkId === 'function';
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    for (const deck of this.decks) {
      deck.el.defaultPlaybackRate = this.playbackRate;
      deck.el.playbackRate = this.playbackRate;
    }
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  /** Smoothly fades the output to silence and pauses; volume is restored afterwards. */
  async fadeOutAndPause(seconds: number): Promise<void> {
    if (!this.master || !this.ctx || this.active.el.paused) {
      this.pause();
      return;
    }
    this.fadingOut = true;
    const param = this.master.gain;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0, now + seconds);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    this.pause();
    this.fadingOut = false;
    param.cancelScheduledValues(this.ctx.currentTime);
    this.applyVolume();
  }

  private rewire(): void {
    if (!this.ctx || !this.bus || !this.master) return;
    for (const mod of this.modules.values()) {
      if (!this.moduleNodes.has(mod.id)) this.moduleNodes.set(mod.id, mod.createNodes(this.ctx));
    }
    this.bus.disconnect();
    this.moduleNodes.forEach(({ output }) => output.disconnect());

    let chain: AudioNode = this.bus;
    for (const id of this.moduleOrder) {
      const nodes = this.moduleNodes.get(id);
      if (!nodes || !this.enabledModules.has(id)) continue;
      chain.connect(nodes.input);
      chain = nodes.output;
    }
    chain.connect(this.master);
  }

  private async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  private load(deck: Deck, url: string): void {
    if (deck.url === url && deck.el.src) return;
    deck.url = url;
    deck.el.src = url;
    deck.el.load();
    deck.el.playbackRate = this.playbackRate;
  }

  /** Buffers the next track on the standby deck so the switch is gapless. */
  preload(url: string): void {
    if (this.active.url === url) return;
    this.load(this.standby, url);
  }

  async play(url: string, options: PlayOptions = {}): Promise<void> {
    await this.resume();
    this.lastError = null;
    this.nearEndFired = false;
    const fade = Math.max(0, options.crossfade ?? 0);
    const current = this.active;
    const overlapping = fade > 0 && !current.el.paused && current.url !== '' && current.url !== url;

    if (!overlapping) {
      this.cancelFade();
      if (this.standby.url === url) {
        this.stopDeck(current);
        this.swapTo(this.standby, 1);
      } else {
        this.stopDeck(this.standby);
      }
      const deck = this.active;
      this.load(deck, url);
      if (options.startAt) deck.el.currentTime = options.startAt;
      this.setDeckNorm(deck, options.gainDb ?? 0);
      this.setDeckGain(deck, 1);
      this.emit('durationchange');
      await deck.el.play();
      return;
    }

    const next = this.standby;
    this.load(next, url);
    if (options.startAt) next.el.currentTime = options.startAt;
    this.setDeckNorm(next, options.gainDb ?? 0);
    this.setDeckGain(next, 0);
    await next.el.play();
    this.swapTo(next, null);
    this.rampDeck(next, 1, fade);
    this.rampDeck(current, 0, fade);
    this.cancelFade();
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      this.stopDeck(current);
    }, fade * 1000 + 100);
    this.emit('durationchange');
    this.emit('play');
  }

  private swapTo(deck: Deck, gain: number | null): void {
    this.activeIndex = this.decks.indexOf(deck);
    if (gain !== null) this.setDeckGain(deck, gain);
  }

  private stopDeck(deck: Deck): void {
    deck.el.pause();
    this.setDeckGain(deck, 0);
  }

  private cancelFade(): void {
    if (!this.fadeTimer) return;
    clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    this.stopDeck(this.standby);
  }

  private setDeckGain(deck: Deck, value: number): void {
    if (!deck.gain || !this.ctx) return;
    deck.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    deck.gain.gain.setValueAtTime(value, this.ctx.currentTime);
  }

  private rampDeck(deck: Deck, value: number, seconds: number): void {
    if (!deck.gain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const param = deck.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  private checkNearEnd(): void {
    if (this.nearEndFired || this.crossfadeSeconds <= 0) return;
    const el = this.active.el;
    if (!Number.isFinite(el.duration) || el.duration < this.crossfadeSeconds * 3) return;
    if (el.duration - el.currentTime <= this.crossfadeSeconds) {
      this.nearEndFired = true;
      this.emit('nearend');
    }
  }

  setCrossfade(seconds: number): void {
    this.crossfadeSeconds = Math.max(0, seconds);
  }

  getCrossfade(): number {
    return this.crossfadeSeconds;
  }

  async resumePlayback(): Promise<void> {
    if (!this.active.url) return;
    await this.resume();
    await this.active.el.play();
  }

  pause(): void {
    this.cancelFade();
    this.active.el.pause();
  }

  stop(): void {
    this.cancelFade();
    for (const deck of this.decks) {
      deck.el.pause();
      deck.el.removeAttribute('src');
      deck.el.load();
      deck.url = '';
    }
  }

  get paused(): boolean {
    return this.active.el.paused;
  }

  private applyVolume(): void {
    if (!this.master || this.fadingOut) return;
    const v = this.muted ? 0 : this.volume;
    this.master.gain.value = v * v;
  }

  /** Current track's normalisation correction, dB. */
  setTrackGain(db: number): void {
    this.setDeckNorm(this.active, db);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  seek(seconds: number): void {
    const el = this.active.el;
    if (!Number.isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.duration, seconds));
    if (el.duration - el.currentTime > this.crossfadeSeconds) this.nearEndFired = false;
  }

  getCurrentTime(): number {
    return this.active.el.currentTime;
  }

  getDuration(): number {
    const d = this.active.el.duration;
    return Number.isFinite(d) ? d : 0;
  }

  getBufferedEnd(): number {
    const b = this.active.el.buffered;
    return b.length ? b.end(b.length - 1) : 0;
  }

  /** Tap master output for lobby broadcast (parallel to speakers). */
  createBroadcastStream(): MediaStream {
    const ctx = this.ensureContext();
    const dest = ctx.createMediaStreamDestination();
    this.master!.connect(dest);
    return dest.stream;
  }

  dispose(): void {
    this.stop();
    this.modules.forEach((m) => m.dispose());
    this.modules.clear();
    this.moduleNodes.clear();
    this.ctx?.close();
    this.ctx = null;
    this.bus = null;
    this.master = null;
    this.listeners.clear();
  }
}
