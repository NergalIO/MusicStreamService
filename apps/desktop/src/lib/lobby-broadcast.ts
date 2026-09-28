import { getAudioEngine } from '@/hooks/useAudioEngine';
import type { LobbyWsClient } from '@/lib/lobby-api';
import { useLobbyStore } from '@/store/lobby-store';

let recorder: MediaRecorder | null = null;
let captureStream: MediaStream | null = null;
let generation = 0;

async function resolveCaptureStream(): Promise<MediaStream> {
  try {
    const stream = await window.electronAPI?.lobby?.captureWindowAudio?.();
    if (stream?.getAudioTracks().length) return stream;
  } catch {
    /* захват окна недоступен — пишем выход Web Audio */
  }
  return getAudioEngine().createBroadcastStream();
}

function haltRecorder(): void {
  generation += 1;
  const rec = recorder;
  recorder = null;
  if (rec && rec.state !== 'inactive') {
    rec.ondataavailable = null;
    rec.stop();
  }
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
}

async function openRecorder(ws: LobbyWsClient): Promise<void> {
  const gen = generation;
  const stream = await resolveCaptureStream();
  if (gen !== generation) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  captureStream = stream;
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 96_000 });
  recorder = rec;
  rec.ondataavailable = (ev) => {
    if (gen !== generation || ev.data.size === 0) return;
    void ev.data.arrayBuffer().then((buf) => {
      if (gen !== generation) return;
      ws.sendAudioChunk(buf);
      useLobbyStore.getState().setLive(true);
    });
  };
  rec.start(300);
}

/** Пишет эфир только после открытия сокета, чтобы первый кадр (заголовок WebM) не потерялся. */
export async function startLobbyBroadcast(ws: LobbyWsClient): Promise<void> {
  haltRecorder();
  useLobbyStore.getState().setLive(false);
  await openRecorder(ws);
}

/** Новый заголовок WebM — гости по нему заново открывают плеер. */
export async function restartLobbyBroadcast(ws: LobbyWsClient): Promise<void> {
  await startLobbyBroadcast(ws);
}

export function ensureLobbyBroadcast(ws: LobbyWsClient): void {
  void startLobbyBroadcast(ws).catch(() => undefined);
}

export function stopLobbyBroadcast(): void {
  haltRecorder();
  useLobbyStore.getState().setLive(false);
}
