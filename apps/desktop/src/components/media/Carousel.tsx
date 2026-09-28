import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

export function Shelf({
  title,
  subtitle,
  moreTo,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  moreTo?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {moreTo && (
          <Link to={moreTo} className="text-sm font-medium text-primary hover:underline">
            Все
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Horizontally scrolling row with paging arrows, Apple Music style. */
export function Carousel({
  children,
  itemClassName = 'w-[168px]',
  className,
}: {
  children: ReactNode[];
  itemClassName?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children.length]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  const arrow =
    'absolute top-[calc(50%-2.5rem)] z-10 flex h-9 w-9 items-center justify-center rounded-full glass border shadow-lg transition-opacity hover:bg-elevated';

  return (
    <div className={cn('group/carousel relative -mx-2', className)}>
      <div ref={ref} onScroll={update} className="no-scrollbar flex snap-x gap-4 overflow-x-auto scroll-smooth px-2 pb-1">
        {children.map((child, i) => (
          <div
            key={i}
            className={cn('shrink-0 snap-start animate-slide-up [animation-fill-mode:both]', itemClassName)}
            style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
          >
            {child}
          </div>
        ))}
      </div>
      {!edges.start && (
        <IconButton
          label="Назад"
          className={cn(arrow, 'left-0 h-9 w-9 opacity-0 group-hover/carousel:opacity-100')}
          onClick={() => page(-1)}
        >
          <ChevronLeft size={18} />
        </IconButton>
      )}
      {!edges.end && (
        <IconButton
          label="Вперёд"
          className={cn(arrow, 'right-0 h-9 w-9 opacity-0 group-hover/carousel:opacity-100')}
          onClick={() => page(1)}
        >
          <ChevronRight size={18} />
        </IconButton>
      )}
    </div>
  );
}
