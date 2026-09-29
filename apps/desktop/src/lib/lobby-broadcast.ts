import { getAudioEngine } from '@/hooks/useAudioEngine';
import type { LobbyWsClient } from '@/lib/lobby-api';
import { useLobbyStore } from '@/store/lobby-store';

let recorder: MediaRecorder | null = null;
let captureStream: MediaStream | null = null;
let captureGeneration = 0;
let recorderGeneration = 0;
let capturePromise: Promise<MediaStream> | null = null;
const streamListeners = new Set<(stream: MediaStream | null) => void>();

function emitCaptureStream(stream: MediaStream | null): void {
  for (const listener of streamListeners) listener(stream);
}

function captureIsLive(): boolean {
  return !!captureStream?.getAudioTracks().some((track) => track.readyState === 'live');
}

async function resolveCaptureStream(): Promise<MediaStream> {
  try {
    const stream = await window.electronAPI?.lobby?.captureWindowAudio?.();
    if (stream?.getAudioTracks().length) return stream;
  } catch {
    /* захват окна недоступен — пишем выход Web Audio */
  }
  return getAudioEngine().createBroadcastStream();
}

async function ensureCaptureStream(): Promise<MediaStream> {
  if (captureIsLive() && captureStream) return captureStream;
  if (!capturePromise) {
    const gen = captureGeneration;
    capturePromise = resolveCaptureStream()
      .then((stream) => {
        capturePromise = null;
        if (gen !== captureGeneration) {
          stream.getTracks().forEach((track) => track.stop());
          if (captureIsLive() && captureStream) return captureStream;
          throw new Error('Захват эфира отменён');
        }
        captureStream = stream;
        emitCaptureStream(stream);
        return stream;
      })
      .catch((err) => {
        capturePromise = null;
        throw err;
      });
  }
  return capturePromise;
}

/** Тот же MediaStream, что пишет WebM: для WebRTC addTrack / replaceTrack. */
export async function getLobbyCaptureStream(): Promise<MediaStream> {
  return ensureCaptureStream();
}

export function subscribeLobbyCaptureStream(listener: (stream: MediaStream | null) => void): () => void {
  streamListeners.add(listener);
  if (captureStream) listener(captureStream);
  return () => {
    streamListeners.delete(listener);
  };
}

function stopRecorder(): void {
  recorderGeneration += 1;
  const rec = recorder;
  recorder = null;
  if (rec && rec.state !== 'inactive') {
    rec.ondataavailable = null;
    rec.stop();
  }
}

function haltCapture(): void {
  captureGeneration += 1;
  capturePromise = null;
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
  emitCaptureStream(null);
}

async function openRecorder(ws: LobbyWsClient): Promise<void> {
  const recGen = recorderGeneration;
  const capGen = captureGeneration;
  const stream = await ensureCaptureStream();
  if (recGen !== recorderGeneration || capGen !== captureGeneration) return;
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 96_000 });
  recorder = rec;
  rec.ondataavailable = (ev) => {
    if (recGen !== recorderGeneration || capGen !== captureGeneration || ev.data.size === 0) return;
    void ev.data.arrayBuffer().then((buf) => {
      if (recGen !== recorderGeneration || capGen !== captureGeneration) return;
      ws.sendAudioChunk(buf);
      useLobbyStore.getState().setLive(true);
    });
  };
  rec.start(300);
}

/** Пишет эфир только после открытия сокета, чтобы первый кадр (заголовок WebM) не потерялся. Не стопает захват. */
export async function startLobbyBroadcast(ws: LobbyWsClient): Promise<void> {
  stopRecorder();
  await openRecorder(ws);
}

/** Новый заголовок WebM — гости по нему заново открывают плеер. Дорожки захвата живы (WebRTC не рвётся). */
export async function restartLobbyBroadcast(ws: LobbyWsClient): Promise<void> {
  await startLobbyBroadcast(ws);
}

export function ensureLobbyBroadcast(ws: LobbyWsClient): void {
  void startLobbyBroadcast(ws).catch(() => undefined);
}

export function stopLobbyBroadcast(): void {
  stopRecorder();
  haltCapture();
  useLobbyStore.getState().setLive(false);
}
