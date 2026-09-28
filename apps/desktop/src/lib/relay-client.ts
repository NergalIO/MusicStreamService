import { useRelayStore } from '@/store/relay-store';

type RelayEventPayload =
  | { phase: 'start'; sessionId: string; trackId: string; title: string }
  | { phase: 'uploading'; sessionId: string }
  | { phase: 'done'; sessionId: string; title: string }
  | { phase: 'failed'; sessionId: string; title: string; error: string; needFile?: boolean };

let subscribed = false;

function onRelayEvent(payload: RelayEventPayload): void {
  const store = useRelayStore.getState();
  switch (payload.phase) {
    case 'start':
      store.upsert({
        sessionId: payload.sessionId,
        trackId: payload.trackId,
        title: payload.title,
        status: 'uploading',
      });
      break;
    case 'uploading':
      store.patch(payload.sessionId, { status: 'uploading' });
      break;
    case 'done':
      store.patch(payload.sessionId, { status: 'done', error: undefined });
      break;
    case 'failed':
      store.patch(payload.sessionId, {
        status: payload.needFile ? 'need_file' : 'failed',
        error: payload.error,
      });
      break;
  }
}

export function initRelayClient(): void {
  if (subscribed || !window.electronAPI?.relay) return;
  subscribed = true;
  window.electronAPI.relay.onEvent(onRelayEvent);
}
