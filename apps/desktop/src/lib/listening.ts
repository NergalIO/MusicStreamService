import type { UnifiedTrack } from '@mss/shared';
import { apiFetch, currentAccessToken } from '@/lib/api';
import { log } from '@/lib/logger';
import { queryClient } from '@/lib/query-client';

const STORAGE_KEY = 'mss-play-buffer';
const MAX_BUFFER = 5000;
const BATCH = 200;
const FLUSH_DELAY = 15_000;
const MIN_PLAYED_SECONDS = 30;

interface PlayEvent {
  clientEventId: string;
  source: 'local' | 'yandex' | 'spotify';
  trackId: string;
  title: string;
  artist: string;
  artists?: { id: string; name: string }[];
  album?: string;
  albumId?: string;
  coverUrl?: string;
  durationMs?: number;
  playedMs: number;
  completed: boolean;
  playedAt: string;
}

function readBuffer(): PlayEvent[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as PlayEvent[];
  } catch {
    return [];
  }
}

function writeBuffer(events: PlayEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_BUFFER)));
}

let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function scheduleFlush(delay = FLUSH_DELAY): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushPlays();
  }, delay);
}

/**
 * Прослушивание засчитывается, если сыграно хотя бы 30 секунд или половина короткого трека.
 * Для внешних треков уходят только метаданные, как и в плейлистах.
 */
export function recordPlay(track: UnifiedTrack, playedSeconds: number, finished: boolean): void {
  const durationSec = (track.durationMs ?? 0) / 1000;
  const enough = playedSeconds >= MIN_PLAYED_SECONDS || (durationSec > 0 && playedSeconds >= durationSec / 2);
  if (!enough || (track.source !== 'local' && track.source !== 'yandex' && track.source !== 'spotify')) return;
  const event: PlayEvent = {
    clientEventId: crypto.randomUUID(),
    source: track.source,
    trackId: track.id.slice(0, 100),
    title: track.title.slice(0, 500) || 'Без названия',
    artist: track.artist.slice(0, 500),
    artists: track.artists?.slice(0, 20),
    album: track.album?.slice(0, 500),
    albumId: track.albumId?.slice(0, 100),
    coverUrl:
      /^https?:\/\//.test(track.coverUrl ?? '') ||
      track.coverUrl?.startsWith('/api/') ||
      track.coverUrl?.includes('/covers/')
        ? track.coverUrl
        : undefined,
    durationMs: track.durationMs ? Math.round(track.durationMs) : undefined,
    playedMs: Math.round(playedSeconds * 1000),
    completed: finished,
    playedAt: new Date().toISOString(),
  };
  writeBuffer([...readBuffer(), event]);
  scheduleFlush();
}

export async function flushPlays(): Promise<void> {
  if (flushing || !currentAccessToken() || !navigator.onLine) return;
  flushing = true;
  try {
    let sent = 0;
    for (;;) {
      const buffer = readBuffer();
      if (!buffer.length) break;
      const batch = buffer.slice(0, BATCH);
      await apiFetch('/me/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
      const sentIds = new Set(batch.map((e) => e.clientEventId));
      writeBuffer(readBuffer().filter((e) => !sentIds.has(e.clientEventId)));
      sent += batch.length;
    }
    if (sent) void queryClient.invalidateQueries({ queryKey: ['stats'] });
  } catch (e) {
    log('warn', 'listening events flush failed, will retry', e instanceof Error ? e.message : String(e));
    scheduleFlush(60_000);
  } finally {
    flushing = false;
  }
}

export function initListeningSync(): () => void {
  const onOnline = () => void flushPlays();
  window.addEventListener('online', onOnline);
  scheduleFlush(3000);
  return () => window.removeEventListener('online', onOnline);
}
