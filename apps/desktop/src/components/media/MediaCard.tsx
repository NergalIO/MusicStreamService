import { Loader2, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Artwork } from '@/components/media/Artwork';
import { openContextMenu, type MenuSpec } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

export function MediaCard({
  title,
  subtitle,
  coverUrl,
  to,
  onPlay,
  shape = 'square',
  badge,
  className,
  menu,
}: {
  title: string;
  subtitle?: ReactNode;
  coverUrl?: string;
  to?: string;
  onPlay?: () => void | Promise<void>;
  shape?: 'square' | 'circle';
  badge?: ReactNode;
  className?: string;
  /** Контекстное меню по правому клику и клавише меню; строится лениво при открытии. */
  menu?: () => MenuSpec;
}) {
  const [busy, setBusy] = useState(false);
  const rounded = shape === 'circle' ? 'rounded-full' : 'rounded-lg';

  const play = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onPlay || busy) return;
    setBusy(true);
    try {
      await onPlay();
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <div className="relative">
        <Artwork
          src={coverUrl}
          rounded={rounded}
          iconSize={32}
          className="aspect-square w-full shadow-artwork transition-[filter] duration-200 group-hover:brightness-[0.8]"
        />
        {badge && <div className="absolute left-2 top-2">{badge}</div>}
        {onPlay && (
          <button
            type="button"
            aria-label={`Слушать ${title}`}
            onClick={play}
            className={cn(
              'absolute flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-200 hover:scale-105',
              shape === 'circle' ? 'bottom-1 right-1' : 'bottom-2.5 right-2.5',
              busy ? 'opacity-100' : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
            )}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>
        )}
      </div>
      <div className={cn('mt-2.5 min-w-0', shape === 'circle' && 'text-center')}>
        <div className="truncate text-[13px] font-medium leading-snug">{title}</div>
        {subtitle && <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{subtitle}</div>}
      </div>
    </>
  );

  const cls = cn('group block min-w-0 select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/60', className);
  const menuProps = menu
    ? {
        onContextMenu: (e: React.MouseEvent) => openContextMenu(e, menu()),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) openContextMenu(e, menu());
        },
      }
    : {};
  return to ? (
    <Link to={to} className={cls} {...menuProps}>
      {body}
    </Link>
  ) : (
    <div className={cls} tabIndex={menu ? 0 : undefined} {...menuProps}>
      {body}
    </div>
  );
}
