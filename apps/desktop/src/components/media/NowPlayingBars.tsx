import { cn } from '@/lib/utils';

export function NowPlayingBars({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex h-3.5 items-end gap-[2px]', className)} aria-label="Сейчас играет">
      {[0, 0.2, 0.4, 0.1].map((delay, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] origin-bottom rounded-full bg-primary motion-reduce:animate-none',
            playing ? 'animate-equalize' : 'scale-y-[0.35]',
          )}
          style={{ height: '100%', animationDelay: `${delay}s`, animationDuration: `${0.8 + i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
