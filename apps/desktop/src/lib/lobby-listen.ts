import { getAudioEngine } from '@/hooks/useAudioEngine';

let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let audioEl: HTMLAudioElement | null = null;
let rtcAudioEl: HTMLAudioElement | null = null;
let rtcActive = false;
let outputVolume = 1;
let outputMuted = false;
const queue: ArrayBuffer[] = [];
let appending = false;
let effectsRouted = false;

function ensurePlayer(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);
  }
  return audioEl;
}

function applyOutput(el: HTMLAudioElement | null): void {
  if (!el) return;
  el.muted = outputMuted;
  el.volume = Math.min(1, Math.max(0, outputMuted ? 0 : outputVolume));
}

function flushQueue(): void {
  if (!sourceBuffer || appending || sourceBuffer.updating || !queue.length) return;
  appending = true;
  const chunk = queue.shift()!;
  try {
    sourceBuffer.appendBuffer(chunk);
  } catch (e) {
    appending = false;
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'InvalidStateError')) {
      startLobbyListen();
      queue.unshift(chunk);
      flushQueue();
    }
  }
}

function bindSourceBuffer(sb: SourceBuffer): void {
  sb.addEventListener('updateend', () => {
    appending = false;
    flushQueue();
  });
  sb.addEventListener('error', () => {
    startLobbyListen();
  });
}

function resetMsePlayer(): void {
  queue.length = 0;
  appending = false;
  sourceBuffer = null;
  if (mediaSource) {
    try {
      if (mediaSource.readyState === 'open') mediaSource.endOfStream();
    } catch {
      /* ignore */
    }
  }
  mediaSource = null;
  if (audioEl) {
    audioEl.pause();
    if (audioEl.src) URL.revokeObjectURL(audioEl.src);
    audioEl.removeAttribute('src');
    audioEl.load();
  }
}

export function startLobbyListen(): void {
  resetMsePlayer();
  const el = ensurePlayer();
  if (rtcActive) el.muted = true;
  mediaSource = new MediaSource();
  el.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener(
    'sourceopen',
    () => {
      if (!mediaSource) return;
      const sb = mediaSource.addSourceBuffer('audio/webm; codecs=opus');
      try {
        sb.mode = 'sequence';
      } catch {
        /* ignore */
      }
      sourceBuffer = sb;
      bindSourceBuffer(sb);
      flushQueue();
      if (!rtcActive) void el.play().catch(() => undefined);
    },
    { once: true },
  );
}

function isWebmHeader(chunk: ArrayBuffer): boolean {
  const bytes = new Uint8Array(chunk);
  return bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

export function ensureLobbyListenAudioEffects(): void {
  if (!audioEl || effectsRouted) return;
  getAudioEngine().attachExternalMediaElement(audioEl);
  effectsRouted = true;
}

export function detachLobbyListenAudioEffects(): void {
  if (!effectsRouted) return;
  getAudioEngine().detachExternalMediaElement();
  effectsRouted = false;
}

export function isLobbyRtcActive(): boolean {
  return rtcActive;
}

/** Прямой поток DJ. Пока он играет, WebM по сокету не кормим в MSE. */
export function setLobbyRtcStream(stream: MediaStream | null): void {
  if (!stream) {
    rtcActive = false;
    if (rtcAudioEl) {
      rtcAudioEl.pause();
      rtcAudioEl.srcObject = null;
      rtcAudioEl.remove();
      rtcAudioEl = null;
    }
    if (audioEl) {
      audioEl.muted = outputMuted;
      if (!outputMuted) void audioEl.play().catch(() => undefined);
    }
    return;
  }
  rtcActive = true;
  if (audioEl) audioEl.muted = true;
  if (!rtcAudioEl) {
    rtcAudioEl = document.createElement('audio');
    rtcAudioEl.autoplay = true;
    document.body.appendChild(rtcAudioEl);
  }
  rtcAudioEl.srcObject = stream;
  applyOutput(rtcAudioEl);
  void rtcAudioEl.play().catch(() => undefined);
}

export function appendLobbyAudioChunk(chunk: ArrayBuffer): void {
  if (rtcActive) return;
  if (isWebmHeader(chunk) || !mediaSource) startLobbyListen();
  ensureLobbyListenAudioEffects();
  queue.push(chunk);
  flushQueue();
  if (audioEl?.paused) void audioEl.play().catch(() => undefined);
}

export function resumeLobbyListen(): void {
  if (rtcAudioEl) void rtcAudioEl.play().catch(() => undefined);
  if (audioEl && !rtcActive) void audioEl.play().catch(() => undefined);
}

function activeListenEl(): HTMLAudioElement | null {
  return rtcActive && rtcAudioEl ? rtcAudioEl : audioEl;
}

export function getLobbyListenTiming(): { currentTime: number; duration: number; paused: boolean } {
  const el = activeListenEl();
  if (!el) return { currentTime: 0, duration: 0, paused: true };
  const duration = Number.isFinite(el.duration) ? el.duration : 0;
  return { currentTime: el.currentTime, duration, paused: el.paused };
}

export function setLobbyListenOutput(volume: number, muted: boolean): void {
  outputVolume = volume;
  outputMuted = muted;
  if (rtcActive) applyOutput(rtcAudioEl);
  if (effectsRouted) {
    const engine = getAudioEngine();
    engine.setVolume(volume);
    engine.setMuted(muted);
    if (audioEl) audioEl.muted = rtcActive ? true : muted;
    return;
  }
  if (audioEl) {
    audioEl.muted = rtcActive ? true : muted;
    audioEl.volume = Math.min(1, Math.max(0, muted ? 0 : volume));
  }
}

export function isLobbyListenPaused(): boolean {
  const el = activeListenEl();
  return !el || el.paused;
}

export function stopLobbyListen(): void {
  setLobbyRtcStream(null);
  detachLobbyListenAudioEffects();
  resetMsePlayer();
  if (audioEl) {
    audioEl.remove();
    audioEl = null;
  }
}

export function setLobbyListenPaused(paused: boolean): void {
  for (const el of [audioEl, rtcAudioEl]) {
    if (!el) continue;
    if (paused) el.pause();
    else if (el === rtcAudioEl || !rtcActive) void el.play().catch(() => undefined);
  }
}
