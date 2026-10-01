import { GripVertical, Loader2, Radio, X } from 'lucide-react';
import { useState } from 'react';
import { Artwork } from '@/components/media/Artwork';
import { NowPlayingBars } from '@/components/media/NowPlayingBars';
import { openTrackMenu } from '@/components/tracks/TrackContextMenu';
import { formatDuration } from '@/lib/format';
import { loadMoreWave } from '@/lib/player-actions';
import { clearHistoryWithUndo, clearQueueWithUndo } from '@/lib/undo';
import { cn } from '@/lib/utils';
import { usePlaybackStore } from '@/store/playback-store';
import { upcomingTracks, usePlayerStore, type QueueItem } from '@/store/player-store';

const MAX_VISIBLE = 150;

function Row({
  track,
  onClick,
  children,
  dim,
}: {
  track: QueueItem;
  onClick?: () => void;
  children?: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div
      onDoubleClick={onClick}
      onContextMenu={(e) => openTrackMenu(e, track)}
      className={cn('group flex h-14 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-foreground/10', dim && 'opacity-60')}
    >
      <button type="button" onClick={onClick} className="shrink-0" disabled={!onClick}>
        <Artwork src={track.coverUrl} className="h-10 w-10" rounded="rounded-md" iconSize={14} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{track.title}</div>
        <div className="truncate text-xs text-muted">{track.artist}</div>
      </div>
      <span className="text-xs tabular-nums text-muted group-hover:hidden">{formatDuration(track.durationMs)}</span>
      {children}
    </div>
  );
}

export function QueueView() {
  const current = usePlayerStore((s) => s.current);
  const radio = usePlayerStore((s) => s.radio);
  const context = usePlayerStore((s) => s.context);
  const historyAll = usePlayerStore((s) => s.history);
  const upNext = usePlayerStore((s) => s.upNext);
  const order = usePlayerStore((s) => s.order);
  const position = usePlayerStore((s) => s.position);
  const queue = usePlayerStore((s) => s.queue);
  const jumpToUpcoming = usePlayerStore((s) => s.jumpToUpcoming);
  const removeUpcoming = usePlayerStore((s) => s.removeUpcoming);
  const moveUpcoming = usePlayerStore((s) => s.moveUpcoming);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playing = usePlaybackStore((s) => s.playing);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const upcoming = upcomingTracks({ upNext, order, position, queue });
  const history = historyAll.filter((t) => t.uid !== current?.uid).slice(0, 30);

  const focusRow = (uid: string | undefined) => {
    if (!uid) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-queue-uid="${CSS.escape(uid)}"]`)?.focus());
  };

  const onRowKey = (e: React.KeyboardEvent, index: number, uid: string) => {
    const last = Math.min(upcoming.length, MAX_VISIBLE) - 1;
    const target = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
    if (target !== null) {
      e.preventDefault();
      e.stopPropagation();
      if (target < 0 || target > last) return;
      if (e.altKey) {
        moveUpcoming(index, target);
        focusRow(uid);
      } else {
        focusRow(upcoming[target].uid);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      jumpToUpcoming(index);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeUpcoming(uid);
      focusRow(upcoming[index + 1]?.uid ?? upcoming[index - 1]?.uid);
    }
  };

  return (
    <div className="no-scrollbar h-full space-y-6 overflow-y-auto pb-10 pr-1">
      {current && (
        <section>
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted">Сейчас играет</h3>
          <div className="flex h-14 items-center gap-3 rounded-lg bg-foreground/10 px-2">
            <Artwork src={current.coverUrl} className="h-10 w-10" rounded="rounded-md" iconSize={14} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{current.title}</div>
              <div className="truncate text-xs text-muted">{current.artist}</div>
            </div>
            <NowPlayingBars playing={playing} className="mr-2" />
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between px-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {radio ? 'Моя волна' : context?.title ? `Далее · ${context.title}` : 'Далее'}
          </h3>
          {upcoming.length > 0 && !radio && (
            <button type="button" onClick={clearQueueWithUndo} className="text-xs text-muted hover:text-foreground">
              Очистить
            </button>
          )}
        </div>
        {upcoming.length === 0 && !radio && <p className="px-2 text-sm text-muted">Очередь пуста</p>}
        <p id="queue-keys-hint" className="sr-only">
          Стрелки вверх и вниз — выбор трека, Alt со стрелкой — переместить, Enter — играть, Delete — убрать из очереди
        </p>
        {upcoming.slice(0, MAX_VISIBLE).map((track, i) => (
          <div
            key={track.uid}
            data-queue-uid={track.uid}
            tabIndex={0}
            aria-label={`${i + 1}. ${track.title} — ${track.artist}`}
            aria-describedby="queue-keys-hint"
            onKeyDown={(e) => onRowKey(e, i, track.uid)}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) moveUpcoming(dragFrom, i);
              setDragFrom(null);
              setDragOver(null);
            }}
            className={cn(
              'relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              dragOver === i && dragFrom !== null && dragFrom !== i && (dragFrom < i ? 'border-b-2 border-primary' : 'border-t-2 border-primary'),
              dragFrom === i && 'opacity-40',
            )}
          >
            <Row track={track} onClick={() => jumpToUpcoming(i)}>
              <div className="hidden items-center gap-1 group-hover:flex">
                <button
                  type="button"
                  aria-label="Убрать из очереди"
                  onClick={() => removeUpcoming(track.uid)}
                  className="rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
                >
                  <X size={14} />
                </button>
                <GripVertical size={14} className="cursor-grab text-muted" />
              </div>
            </Row>
          </div>
        ))}
        {upcoming.length > MAX_VISIBLE && (
          <p className="px-2 pt-2 text-xs text-muted">и ещё {upcoming.length - MAX_VISIBLE}</p>
        )}
        {radio && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              await loadMoreWave();
              setLoadingMore(false);
            }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground/10 py-2 text-sm text-foreground/80 hover:bg-foreground/15"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
            Подобрать ещё
          </button>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between px-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Ранее</h3>
            <button type="button" onClick={clearHistoryWithUndo} className="text-xs text-muted hover:text-foreground">
              Очистить
            </button>
          </div>
          {history.map((track) => (
            <Row
              key={track.uid}
              track={track}
              dim
              onClick={() => playTrack(track, { type: 'history', title: 'Недавно играли', path: '/media/library/history' })}
            />
          ))}
        </section>
      )}
    </div>
  );
}
