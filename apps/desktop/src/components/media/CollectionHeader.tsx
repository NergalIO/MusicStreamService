import { Play, Shuffle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Artwork } from '@/components/media/Artwork';
import { Button } from '@/components/ui/button';
import { useDominantColor } from '@/hooks/useDominantColor';
import { cn } from '@/lib/utils';

export function CollectionHeader({
  kicker,
  title,
  subtitle,
  meta,
  coverUrl,
  cover,
  round,
  onPlay,
  onShuffle,
  actions,
  description,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  coverUrl?: string;
  cover?: ReactNode;
  round?: boolean;
  onPlay?: () => void;
  onShuffle?: () => void;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  const color = useDominantColor(coverUrl);
  return (
    <header className="relative -mx-8 -mt-6 mb-8 px-8 pb-8 pt-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-60 transition-colors duration-700"
        style={{ background: `linear-gradient(to bottom, rgb(${color} / 0.55), transparent)` }}
      />
      <div className="relative flex flex-col items-center gap-8 md:flex-row md:items-end">
        {cover ?? (
          <Artwork
            src={coverUrl?.replace('400x400', '600x600')}
            rounded={round ? 'rounded-full' : 'rounded-xl'}
            iconSize={56}
            className="h-56 w-56 shadow-artwork"
          />
        )}
        <div className="min-w-0 flex-1 text-center md:text-left">
          {kicker && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground/70">{kicker}</div>}
          <h1 className={cn('font-bold tracking-tight', 'line-clamp-2 text-4xl lg:text-5xl')}>{title}</h1>
          {subtitle && <div className="mt-2 text-lg font-medium text-primary">{subtitle}</div>}
          {meta && <div className="mt-1 text-sm text-muted">{meta}</div>}
          {description && <p className="mt-3 line-clamp-2 max-w-2xl text-sm text-muted">{description}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 md:justify-start">
            {onPlay && (
              <Button size="lg" onClick={onPlay}>
                <Play size={16} fill="currentColor" /> Слушать
              </Button>
            )}
            {onShuffle && (
              <Button size="lg" variant="secondary" onClick={onShuffle}>
                <Shuffle size={16} /> Перемешать
              </Button>
            )}
            {actions}
          </div>
        </div>
      </div>
    </header>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 px-3">
          <div className="h-10 w-10 animate-pulse rounded-md bg-foreground/[0.07]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-foreground/[0.07]" />
            <div className="h-2.5 w-1/5 animate-pulse rounded bg-foreground/[0.05]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-[168px] shrink-0 space-y-2">
          <div className="aspect-square animate-pulse rounded-lg bg-foreground/[0.07]" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-foreground/[0.07]" />
        </div>
      ))}
    </div>
  );
}

export function shuffleArray<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
