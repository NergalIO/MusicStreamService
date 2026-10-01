import type { UnifiedTrack } from '@mss/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Check, GripVertical, Heart, MoreHorizontal, Music, Pause, Play, Search, X } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useScrollContainer } from '@/components/layout/scroll-context';
import { Artwork } from '@/components/media/Artwork';
import { NowPlayingBars } from '@/components/media/NowPlayingBars';
import { DownloadBadge } from '@/components/tracks/DownloadBadge';
import { bulkTrackActions, openTrackMenu, openTracksMenu } from '@/components/tracks/TrackContextMenu';
import { EmptyState } from '@/components/ui/states';
import type { SortKey, TrackSort } from '@/hooks/useTrackSort';
import { formatDuration, formatTrackCount } from '@/lib/format';
import { trackAlbumPath, trackArtistLinks } from '@/lib/links';
import { toggleLike, togglePlay } from '@/lib/player-actions';
import { AVAILABILITY_LABEL, SOURCE_LABEL } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { useIsLiked } from '@/store/likes-store';
import { usePlaybackStore } from '@/store/playback-store';
import { usePlayerStore, type PlayContext } from '@/store/player-store';

type ListTrack = UnifiedTrack & { streamUrl?: string; entryId?: string };

const VIRTUALIZE_FROM = 80;

export interface TrackListProps<T extends ListTrack = ListTrack> {
  tracks: T[];
  context?: PlayContext;
  /** `album` — numbered rows without covers/album column; `compact` — no header. */
  variant?: 'default' | 'album';
  showCovers?: boolean;
  showAlbum?: boolean;
  showSource?: boolean;
  numbered?: boolean;
  header?: boolean;
  emptyText?: string;
  onRemove?: (track: T, index: number) => void;
  removeLabel?: string;
  /** Удаление нескольких выделенных строк из панели действий. */
  onRemoveMany?: (tracks: T[]) => void;
  sort?: TrackSort;
  onSort?: (key: SortKey) => void;
  /** Перетаскивание строк; включайте только когда список показан в исходном порядке. */
  onReorder?: (from: number, to: number) => void;
  selectable?: boolean;
}

/** Ключи не зависят от позиции, чтобы выделение переживало сортировку; повторы трека различаются счётчиком. */
function rowKeys(tracks: ListTrack[]): string[] {
  const seen = new Map<string, number>();
  return tracks.map((t) => {
    const base = t.entryId ?? `${t.source}:${t.id}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

function listGrid(showCover: boolean, showAlbum: boolean, check: boolean): string {
  if (check) {
    if (showAlbum) return showCover ? 'grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_minmax(0,0.7fr)_auto]' : 'grid-cols-[1.5rem_2rem_minmax(0,1fr)_minmax(0,0.7fr)_auto]';
    return showCover ? 'grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_auto]' : 'grid-cols-[1.5rem_2rem_minmax(0,1fr)_auto]';
  }
  if (showAlbum) return showCover ? 'grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.7fr)_auto]' : 'grid-cols-[2rem_minmax(0,1fr)_minmax(0,0.7fr)_auto]';
  return showCover ? 'grid-cols-[2.5rem_minmax(0,1fr)_auto]' : 'grid-cols-[2rem_minmax(0,1fr)_auto]';
}

function SelectCheck({
  checked,
  indeterminate,
  label,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      title="Ctrl или Shift — несколько треков"
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border transition-colors',
        checked || indeterminate
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-foreground/35 bg-background/80 hover:border-primary',
      )}
    >
      {checked ? <Check size={11} strokeWidth={3} /> : indeterminate ? <span className="block h-0.5 w-2 rounded bg-primary-foreground" /> : null}
    </button>
  );
}

interface RowProps {
  track: ListTrack;
  index: number;
  isCurrent: boolean;
  playing: boolean;
  selected: boolean;
  showCover: boolean;
  showAlbum: boolean;
  showSource: boolean;
  numbered: boolean;
  draggable: boolean;
  dropMark: 'above' | 'below' | null;
  dragging: boolean;
  selectable: boolean;
  onPlay: (index: number) => void;
  onRowClick: (index: number, e: React.MouseEvent) => void;
  onToggleSelect: (index: number, e: React.MouseEvent) => void;
  onRowMenu: (index: number, e: React.MouseEvent | React.KeyboardEvent) => void;
  onDragStart: (index: number, e: React.DragEvent) => void;
  onDragOver: (index: number, e: React.DragEvent) => void;
  onDrop: (index: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  isCurrent,
  playing,
  selected,
  showCover,
  showAlbum,
  showSource,
  numbered,
  draggable,
  dropMark,
  dragging,
  selectable,
  onPlay,
  onRowClick,
  onToggleSelect,
  onRowMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: RowProps) {
  const liked = useIsLiked(track);
  const albumTo = trackAlbumPath(track);
  const artists = trackArtistLinks(track);
  const disabled = !track.playable;

  return (
    <div
      role="row"
      aria-selected={selected || isCurrent}
      tabIndex={-1}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart(index, e) : undefined}
      onDragOver={draggable ? (e) => onDragOver(index, e) : undefined}
      onDrop={draggable ? (e) => onDrop(index, e) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={(e) => onRowClick(index, e)}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        if (!disabled) onPlay(index);
      }}
      onContextMenu={(e) => onRowMenu(index, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !disabled) onPlay(index);
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) onRowMenu(index, e);
      }}
      className={cn(
        'group relative grid h-14 select-none items-center gap-3 rounded-lg px-3 outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary/50',
        isCurrent && 'bg-foreground/[0.04]',
        selected && 'bg-primary/15 hover:bg-primary/20',
        dragging && 'opacity-40',
        listGrid(showCover, showAlbum, selectable),
      )}
    >
      {selectable && (
        <div className="flex items-center justify-center">
          <SelectCheck checked={selected} label={selected ? `Снять выделение «${track.title}»` : `Выделить «${track.title}»`} onClick={(e) => onToggleSelect(index, e)} />
        </div>
      )}
      {draggable && (
        <GripVertical
          size={14}
          aria-hidden
          className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 text-muted opacity-0 group-hover:opacity-60"
        />
      )}
      {dropMark && (
        <span
          className={cn('pointer-events-none absolute inset-x-2 h-0.5 rounded bg-primary', dropMark === 'above' ? '-top-px' : '-bottom-px')}
        />
      )}
      <div className={cn('flex items-center justify-center text-sm tabular-nums text-muted', showCover ? 'h-10 w-10' : 'h-8 w-8')}>
        {showCover ? (
          <div className="relative h-10 w-10">
            <Artwork src={track.coverUrl} className="h-10 w-10" rounded="rounded-md" iconSize={14} />
            {isCurrent && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-background/55 group-hover:opacity-0">
                <NowPlayingBars playing={playing} />
              </div>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                if (isCurrent) togglePlay();
                else onPlay(index);
              }}
              title={disabled ? track.unplayableReason : isCurrent && playing ? 'Пауза' : 'Слушать'}
              aria-label={isCurrent && playing ? `Пауза «${track.title}»` : `Слушать «${track.title}»`}
              className="absolute inset-0 hidden items-center justify-center rounded-md bg-black/50 text-white group-hover:flex focus-visible:flex disabled:opacity-40"
            >
              {isCurrent && playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-px" />}
            </button>
          </div>
        ) : isCurrent ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="flex h-8 w-8 items-center justify-center group-hover:hidden"
              aria-label={playing ? 'Пауза' : 'Играть'}
            >
              <NowPlayingBars playing={playing} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="hidden h-8 w-8 items-center justify-center group-hover:flex"
              aria-label={playing ? 'Пауза' : 'Играть'}
            >
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-px" />}
            </button>
          </>
        ) : (
          <>
            {numbered && <span className="group-hover:hidden">{index + 1}</span>}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onPlay(index);
              }}
              title={disabled ? track.unplayableReason : 'Слушать'}
              aria-label={`Слушать «${track.title}»`}
              className={cn(
                'items-center justify-center text-foreground disabled:opacity-40',
                numbered ? 'hidden group-hover:flex' : 'flex',
              )}
            >
              <Play size={16} fill="currentColor" className="ml-px" />
            </button>
          </>
        )}
      </div>

      <div className={cn('min-w-0', showCover && 'pl-2')}>
        <div className={cn('flex items-center gap-1.5 truncate text-sm', isCurrent ? 'text-primary' : '', disabled && 'text-muted')}>
          <span className="truncate font-medium">{track.title}</span>
          {track.explicit && (
            <span className="shrink-0 rounded-[3px] bg-foreground/20 px-1 text-[9px] font-bold leading-[14px] text-foreground/80">E</span>
          )}
          {track.source !== 'local' && <DownloadBadge track={track} />}
        </div>
        <div className="truncate text-xs text-muted">
          {artists.map((a, i) => (
            <Fragment key={`${a.name}-${i}`}>
              {i > 0 && ', '}
              <Link to={a.to} onClick={(e) => e.stopPropagation()} className="hover:text-foreground hover:underline">
                {a.name}
              </Link>
            </Fragment>
          ))}
        </div>
      </div>

      {showAlbum && (
        <div className="truncate text-xs text-muted">
          {albumTo && track.album ? (
            <Link to={albumTo} className="hover:text-foreground hover:underline">
              {track.album}
            </Link>
          ) : (
            track.album
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {showSource && (
          <span
            className={cn(
              'hidden rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:inline',
              track.source === 'local' ? 'bg-primary/20 text-primary' : 'bg-foreground/10 text-muted',
            )}
          >
            {SOURCE_LABEL[track.source] ?? track.source}
          </span>
        )}
        {track.source === 'local' && track.availability && track.availability !== 'cached' && (
          <span
            className={cn(
              'hidden rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline',
              track.availability === 'online' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-foreground/10 text-muted',
            )}
            title={track.unplayableReason}
          >
            {AVAILABILITY_LABEL[track.availability]}
          </span>
        )}
        <button
          type="button"
          aria-label={liked ? 'Убрать лайк' : 'Мне нравится'}
          onClick={() => void toggleLike(track)}
          className={cn(
            'rounded-full p-1.5 transition hover:bg-foreground/10',
            liked ? 'text-primary' : 'text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Heart size={15} className={cn(liked && 'fill-current')} />
        </button>
        <span className="w-10 text-right text-xs tabular-nums text-muted">{formatDuration(track.durationMs)}</span>
        <button
          type="button"
          aria-label="Ещё"
          onClick={(e) => onRowMenu(index, e)}
          className="rounded-full p-1.5 text-muted opacity-0 transition hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
});

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort?: TrackSort;
  onSort?: (key: SortKey) => void;
  className?: string;
}) {
  if (!onSort) return <span className={className}>{label}</span>;
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Сортировать: ${label}`}
      className={cn('inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground', active && 'text-foreground', className)}
    >
      {label}
      {active && (sort?.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  );
}

export function TrackFilterInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn('relative w-56', className)}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder="Поиск в списке"
        aria-label="Поиск в списке"
        className="h-8 w-full rounded-full border border-border bg-foreground/5 pl-8 pr-7 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary/60"
      />
      {value && (
        <button
          type="button"
          aria-label="Очистить"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function SelectionBar({
  tracks,
  onClear,
  onRemove,
  removeLabel,
}: {
  tracks: ListTrack[];
  onClear: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const groups = bulkTrackActions(tracks, onRemove ? { onRemove, removeLabel: removeLabel ?? 'Удалить' } : {});
  return (
    <div className="pointer-events-none sticky bottom-4 z-10 mt-3 flex justify-center">
      <div
        role="toolbar"
        aria-label="Действия с выбранными треками"
        className="glass pointer-events-auto flex animate-scale-in items-center gap-1 rounded-full border px-2 py-1.5 shadow-popover"
      >
        <span className="px-2 text-sm font-medium tabular-nums">{formatTrackCount(tracks.length)}</span>
        {groups.flat().map((item) => (
          <button
            key={item.label}
            type="button"
            title={item.label}
            aria-label={item.label}
            disabled={item.disabled}
            onClick={() => {
              item.action(() => undefined);
              if (item.danger) onClear();
            }}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors hover:bg-foreground/10 disabled:opacity-40',
              item.danger && 'text-danger',
            )}
          >
            <item.icon size={14} />
            <span className="hidden xl:inline">{item.label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label="Снять выделение"
          onClick={onClear}
          className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-foreground/10 hover:text-foreground"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

export function TrackList<T extends ListTrack>({
  tracks,
  context,
  variant = 'default',
  showCovers,
  showAlbum,
  showSource,
  numbered,
  header = false,
  emptyText = 'Нет треков',
  onRemove,
  removeLabel,
  onRemoveMany,
  sort,
  onSort,
  onReorder,
  selectable = true,
}: TrackListProps<T>) {
  const isAlbum = variant === 'album';
  const cover = showCovers ?? !isAlbum;
  const album = showAlbum ?? !isAlbum;
  const source = showSource ?? !isAlbum;
  const nums = numbered ?? isAlbum;

  const playList = usePlayerStore((s) => s.playList);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlaybackStore((s) => s.playing);
  const scrollRef = useScrollContainer();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtual = tracks.length >= VIRTUALIZE_FROM && !!scrollRef;

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);

  // Выделение переживает обновление данных, но теряет строки, которых больше нет.
  const keys = useMemo(() => rowKeys(tracks), [tracks]);
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(keys);
      const next = new Set([...prev].filter((k) => alive.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [keys]);

  const selectedTracks = useMemo(() => tracks.filter((_, i) => selected.has(keys[i])), [tracks, keys, selected]);

  const [hotkeysArmed, setHotkeysArmed] = useState(false);

  useEffect(() => {
    if (!selectable) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape' && selected.size) setSelected(new Set());
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA' && !typing && hotkeysArmed) {
        e.preventDefault();
        setSelected(new Set(keys));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectable, keys, selected.size, hotkeysArmed]);

  useLayoutEffect(() => {
    if (!virtual || !listRef.current || !scrollRef?.current) return;
    const measure = () => {
      const list = listRef.current!.getBoundingClientRect();
      const scroller = scrollRef.current!.getBoundingClientRect();
      setScrollMargin(list.top - scroller.top + scrollRef.current!.scrollTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [virtual, scrollRef, tracks.length]);

  const virtualizer = useVirtualizer({
    count: virtual ? tracks.length : 0,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 56,
    overscan: 12,
    scrollMargin,
  });

  // Колбэки строк стабильны, а актуальные данные читают из ref — memo-строки не перерисовываются зря.
  const latest = useRef({ tracks, keys, selected, selectedTracks, onRemove, removeLabel, onRemoveMany, onReorder, context, drag });
  latest.current = { tracks, keys, selected, selectedTracks, onRemove, removeLabel, onRemoveMany, onReorder, context, drag };

  const play = useCallback((index: number) => playList(latest.current.tracks, index, latest.current.context ?? null), [playList]);

  const onRowClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (!selectable || (e.target as HTMLElement).closest('button, a')) return;
      const { keys } = latest.current;
      const key = keys[index];
      if (e.shiftKey && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        setSelected((prev) => {
          const next = e.ctrlKey || e.metaKey ? new Set(prev) : new Set<string>();
          for (let i = a; i <= b; i++) next.add(keys[i]);
          return next;
        });
        return;
      }
      anchor.current = index;
      if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      } else {
        setSelected((prev) => (prev.size === 1 && prev.has(key) ? prev : new Set([key])));
      }
    },
    [selectable],
  );

  const onToggleSelect = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const { keys } = latest.current;
    const key = keys[index];
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = a; i <= b; i++) next.add(keys[i]);
        return next;
      });
      return;
    }
    anchor.current = index;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onRowMenu = useCallback((index: number, e: React.MouseEvent | React.KeyboardEvent) => {
    const { tracks, keys, selected, selectedTracks, onRemove, removeLabel, onRemoveMany } = latest.current;
    if (selected.size > 1 && selected.has(keys[index])) {
      openTracksMenu(e, selectedTracks, onRemoveMany ? { onRemove: () => onRemoveMany(selectedTracks as T[]) } : undefined);
      return;
    }
    const t = tracks[index];
    openTrackMenu(e, t, onRemove ? { onRemove: () => onRemove(t, index), removeLabel } : undefined);
  }, []);

  const onDragStart = useCallback((index: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-mss-row', String(index));
    setDrag({ from: index, over: null });
  }, []);
  const onDragOver = useCallback((index: number, e: React.DragEvent) => {
    if (!latest.current.drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDrag((d) => (d && d.over !== index ? { ...d, over: index } : d));
  }, []);
  const onDrop = useCallback((index: number, e: React.DragEvent) => {
    e.preventDefault();
    const d = latest.current.drag;
    if (d && d.from !== index) latest.current.onReorder?.(d.from, index);
    setDrag(null);
  }, []);
  const onDragEnd = useCallback(() => setDrag(null), []);

  if (!tracks.length) return <EmptyState icon={Music} title={emptyText} className="py-10" />;

  const isCurrent = (t: ListTrack) => !!current && current.source === t.source && current.id === t.id;
  const row = (t: T, i: number) => (
    <TrackRow
      track={t}
      index={i}
      isCurrent={isCurrent(t)}
      playing={playing}
      selected={selected.has(keys[i])}
      showCover={cover}
      showAlbum={album}
      showSource={source}
      numbered={nums}
      draggable={!!onReorder}
      dragging={drag?.from === i}
      dropMark={drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'below' : 'above') : null}
      selectable={selectable}
      onPlay={play}
      onRowClick={onRowClick}
      onToggleSelect={onToggleSelect}
      onRowMenu={onRowMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    />
  );

  return (
    <div
      role="table"
      aria-rowcount={tracks.length}
      aria-multiselectable={selectable}
      onMouseEnter={() => setHotkeysArmed(true)}
      onMouseLeave={() => setHotkeysArmed(false)}
      onFocusCapture={() => setHotkeysArmed(true)}
    >
      {header && (
        <div
          role="row"
          className={cn(
            'mb-1 grid gap-3 border-b border-border px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted',
            listGrid(cover, album, selectable),
          )}
        >
          {selectable && (
            <span className="flex items-center justify-center">
              <SelectCheck
                checked={selected.size > 0 && selected.size === keys.length}
                indeterminate={selected.size > 0 && selected.size < keys.length}
                label={selected.size === keys.length ? 'Снять выделение' : 'Выделить все'}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(selected.size === keys.length ? new Set() : new Set(keys));
                }}
              />
            </span>
          )}
          <span className="text-center">#</span>
          <span className={cn('flex gap-3', cover && 'pl-2')}>
            <SortHeader label="Название" sortKey="title" sort={sort} onSort={onSort} />
            {onSort && <SortHeader label="Исполнитель" sortKey="artist" sort={sort} onSort={onSort} />}
          </span>
          {album && <SortHeader label="Альбом" sortKey="album" sort={sort} onSort={onSort} className="justify-self-start" />}
          <SortHeader label="Время" sortKey="duration" sort={sort} onSort={onSort} className="justify-self-end pr-10 text-right" />
        </div>
      )}
      {virtual ? (
        <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={keys[item.index]}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
            >
              {row(tracks[item.index], item.index)}
            </div>
          ))}
        </div>
      ) : (
        <div ref={listRef}>
          {tracks.map((t, i) => (
            <Fragment key={keys[i]}>{row(t, i)}</Fragment>
          ))}
        </div>
      )}
      {selected.size > 0 && (
        <SelectionBar
          tracks={selectedTracks}
          onClear={() => setSelected(new Set())}
          onRemove={onRemoveMany ? () => onRemoveMany(selectedTracks) : undefined}
          removeLabel={removeLabel}
        />
      )}
    </div>
  );
}
