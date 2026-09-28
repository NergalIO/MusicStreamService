import { getAudioEngine } from '@/hooks/useAudioEngine';

let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let audioEl: HTMLAudioElement | null = null;
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

export function startLobbyListen(): void {
  stopLobbyListen();
  const el = ensurePlayer();
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
      void el.play().catch(() => undefined);
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

export function appendLobbyAudioChunk(chunk: ArrayBuffer): void {
  if (isWebmHeader(chunk) || !mediaSource) startLobbyListen();
  ensureLobbyListenAudioEffects();
  queue.push(chunk);
  flushQueue();
  if (audioEl?.paused) void audioEl.play().catch(() => undefined);
}

export function resumeLobbyListen(): void {
  if (!audioEl) return;
  void audioEl.play().catch(() => undefined);
}

export function getLobbyListenTiming(): { currentTime: number; duration: number; paused: boolean } {
  if (!audioEl) return { currentTime: 0, duration: 0, paused: true };
  const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
  return { currentTime: audioEl.currentTime, duration, paused: audioEl.paused };
}

export function setLobbyListenOutput(volume: number, muted: boolean): void {
  if (effectsRouted) {
    const engine = getAudioEngine();
    engine.setVolume(volume);
    engine.setMuted(muted);
    return;
  }
  if (!audioEl) return;
  audioEl.muted = muted;
  audioEl.volume = Math.min(1, Math.max(0, muted ? 0 : volume));
}

export function isLobbyListenPaused(): boolean {
  return !audioEl || audioEl.paused;
}

export function stopLobbyListen(): void {
  detachLobbyListenAudioEffects();
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
    URL.revokeObjectURL(audioEl.src);
    audioEl.remove();
    audioEl = null;
  }
}

export function setLobbyListenPaused(paused: boolean): void {
  if (!audioEl) return;
  if (paused) void audioEl.pause();
  else void audioEl.play().catch(() => undefined);
}
