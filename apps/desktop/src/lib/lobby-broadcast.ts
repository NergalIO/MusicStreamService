import { getAudioEngine } from '@/hooks/useAudioEngine';
import { isSpotifyPlaybackActive } from '@/lib/spotify-web-player';
import type { LobbyWsClient } from '@/lib/lobby-api';

let recorder: MediaRecorder | null = null;
let captureStream: MediaStream | null = null;

async function resolveCaptureStream(): Promise<MediaStream> {
  if (isSpotifyPlaybackActive()) {
    const stream = await window.electronAPI?.lobby?.captureWindowAudio?.();
    if (stream) return stream;
  }
  return getAudioEngine().createBroadcastStream();
}

export async function startLobbyBroadcast(ws: LobbyWsClient): Promise<void> {
  stopLobbyBroadcast();
  captureStream = await resolveCaptureStream();
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  recorder = new MediaRecorder(captureStream, { mimeType: mime, audioBitsPerSecond: 128_000 });
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) {
      void ev.data.arrayBuffer().then((buf) => ws.sendAudioChunk(buf));
    }
  };
  recorder.start(400);
}

export function stopLobbyBroadcast(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  captureStream?.getTracks().forEach((t) => t.stop());
  captureStream = null;
}
