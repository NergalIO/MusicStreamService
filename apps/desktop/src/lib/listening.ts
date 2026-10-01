import type { ListeningHistoryItem, SourceId, UnifiedTrack } from '@mss/shared';
import { apiFetch, currentAccessToken } from '@/lib/api';
import { log } from '@/lib/logger';
import { queryClient } from '@/lib/query-client';
import { toQueueItem, trackKey, usePlayerStore, type QueueItem } from '@/store/player-store';

const STORAGE_KEY = 'mss-play-buffer';
const CLEARED_KEY = 'mss-history-cleared-at';
const HISTORY_LIMIT = 200;
const MAX_BUFFER = 5000;
const BATCH = 200;
const FLUSH_DELAY = 15_000;
const MIN_PLAYED_SECONDS = 30;

interface PlayEvent {
  clientEventId: string;
  source: SourceId;
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
  if (!enough) return;
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
    if (sent) {
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void syncListeningHistory();
    }
  } catch (e) {
    log('warn', 'listening events flush failed, will retry', e instanceof Error ? e.message : String(e));
    scheduleFlush(60_000);
  } finally {
    flushing = false;
  }
}

function atMillis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Скрывает историю только на этом устройстве: статистика на сервере остаётся. */
export function noteHistoryCleared(): string | null {
  const prev = localStorage.getItem(CLEARED_KEY);
  localStorage.setItem(CLEARED_KEY, new Date().toISOString());
  return prev;
}

export function restoreHistoryCleared(prev: string | null): void {
  if (prev) localStorage.setItem(CLEARED_KEY, prev);
  else localStorage.removeItem(CLEARED_KEY);
}

function mergeHistory(local: QueueItem[], remote: ListeningHistoryItem[], clearedAt: string | null): QueueItem[] {
  const clearedMs = clearedAt ? atMillis(clearedAt) : 0;
  const byKey = new Map<string, { at: number; track: QueueItem }>();
  const consider = (key: string, atIso: string | undefined, track: QueueItem) => {
    if (!atIso) return;
    const at = atMillis(atIso);
    if (clearedMs && at <= clearedMs) return;
    const prev = byKey.get(key);
    if (!prev || at > prev.at) byKey.set(key, { at, track: { ...track, listenedAt: atIso } });
  };
  for (const item of remote) {
    consider(
      `${item.source}:${item.trackId}`,
      item.playedAt,
      toQueueItem({
        source: item.source,
        id: item.trackId,
        title: item.title,
        artist: item.artist,
        artists: item.artists ?? undefined,
        album: item.album ?? undefined,
        albumId: item.albumId ?? undefined,
        coverUrl: item.coverUrl ?? undefined,
        durationMs: item.durationMs ?? undefined,
        playable: true,
      }),
    );
  }
  for (const track of local) consider(trackKey(track), track.listenedAt, track);
  const timed = [...byKey.values()].sort((a, b) => b.at - a.at).map((row) => row.track);
  const seen = new Set(timed.map(trackKey));
  const legacy = local.filter((track) => !track.listenedAt && !seen.has(trackKey(track)));
  return [...timed, ...legacy].slice(0, HISTORY_LIMIT);
}

export async function syncListeningHistory(): Promise<void> {
  if (!currentAccessToken()) return;
  try {
    const data = await apiFetch<{ items: ListeningHistoryItem[] }>('/me/history');
    const clearedAt = localStorage.getItem(CLEARED_KEY);
    usePlayerStore.setState((s) => ({ history: mergeHistory(s.history, data.items, clearedAt) }));
  } catch (e) {
    log('warn', 'listening history sync failed', e instanceof Error ? e.message : String(e));
  }
}

export function initListeningSync(): () => void {
  const onOnline = () => {
    void flushPlays();
    void syncListeningHistory();
  };
  window.addEventListener('online', onOnline);
  const pull = window.setInterval(() => void syncListeningHistory(), 60_000);
  scheduleFlush(3000);
  void syncListeningHistory();
  return () => {
    window.removeEventListener('online', onOnline);
    window.clearInterval(pull);
  };
}
