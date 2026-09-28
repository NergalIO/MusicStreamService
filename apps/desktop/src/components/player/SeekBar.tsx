import { useRef, useState } from 'react';
import { formatTime } from '@/lib/format';
import { seekTo } from '@/lib/player-actions';
import { cn } from '@/lib/utils';
import { usePlaybackStore } from '@/store/playback-store';

/** Thin scrubber; `variant="lcd"` hugs the bottom of the top player panel, `full` shows times below. */
export function SeekBar({
  variant = 'full',
  className,
  readOnly = false,
}: {
  variant?: 'lcd' | 'full';
  className?: string;
  readOnly?: boolean;
}) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const duration = usePlaybackStore((s) => s.duration);
  const buffered = usePlaybackStore((s) => s.buffered);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const ratioAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly || !duration) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(ratioAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!duration) return;
    const r = ratioAt(e.clientX);
    setHover(r);
    if (drag !== null) setDrag(r);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag === null) return;
    seekTo(ratioAt(e.clientX) * duration);
    setDrag(null);
  };

  const ratio = drag ?? (duration ? currentTime / duration : 0);
  const bufferedRatio = duration ? Math.min(1, buffered / duration) : 0;
  const active = drag !== null;

  const track = (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      className={cn(
        'group/seek relative flex items-center',
        readOnly ? 'cursor-default' : 'cursor-pointer',
        variant === 'lcd' ? 'h-3' : 'h-4',
        className,
      )}
    >
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-foreground/15 transition-[height]',
          active ? 'h-1.5' : 'h-1 group-hover/seek:h-1.5',
        )}
      >
        <div className="absolute inset-y-0 left-0 bg-foreground/15" style={{ width: `${bufferedRatio * 100}%` }} />
        <div
          className={cn('absolute inset-y-0 left-0', active ? 'bg-primary' : 'bg-foreground/80 group-hover/seek:bg-primary')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {hover !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-elevated px-1.5 py-0.5 text-[10px] tabular-nums shadow-popover"
          style={{ left: `${(drag ?? hover) * 100}%` }}
        >
          {formatTime((drag ?? hover) * duration)}
        </div>
      )}
    </div>
  );

  if (variant === 'lcd') return track;

  return (
    <div>
      {track}
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted">
        <span>{formatTime(ratio * duration)}</span>
        <span>-{formatTime(Math.max(0, duration - ratio * duration))}</span>
      </div>
    </div>
  );
}
