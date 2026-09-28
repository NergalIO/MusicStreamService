let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let audioEl: HTMLAudioElement | null = null;
const queue: ArrayBuffer[] = [];
let appending = false;

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
  } catch {
    appending = false;
  }
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
      sourceBuffer = mediaSource.addSourceBuffer('audio/webm; codecs=opus');
      sourceBuffer.addEventListener('updateend', () => {
        appending = false;
        flushQueue();
      });
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

export function appendLobbyAudioChunk(chunk: ArrayBuffer): void {
  if (isWebmHeader(chunk) || !mediaSource) startLobbyListen();
  queue.push(chunk);
  flushQueue();
  if (audioEl?.paused) void audioEl.play().catch(() => undefined);
}

export function stopLobbyListen(): void {
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
