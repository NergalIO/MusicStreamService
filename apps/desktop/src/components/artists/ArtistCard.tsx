import type { SourceId } from '@mss/shared';
import { MicVocal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { openContextMenu } from '@/components/ui/context-menu';
import { EmptyState } from '@/components/ui/states';
import { artistPath, type ArtistGroup } from '@/lib/artists';
import { cachedImageUrl } from '@/lib/cached-image';
import { artistMenu } from '@/lib/card-menus';
import { SOURCE_LABEL } from '@/lib/sources';
import { cn } from '@/lib/utils';

export function ArtistAvatar({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl?: string;
  className?: string;
}) {
  if (imageUrl) {
    return <img src={cachedImageUrl(imageUrl)} alt="" className={cn('rounded-full object-cover', className)} />;
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary font-semibold text-primary-foreground',
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}

function subtitle(group: ArtistGroup): string {
  const followers = group.refs.spotify?.followers;
  if (followers) return `${followers.toLocaleString('ru-RU')} подписчиков`;
  const tracks = group.refs.yandex?.trackCount ?? group.refs.local?.trackCount;
  if (tracks) return `${tracks} треков`;
  return group.genres[0] ?? 'Исполнитель';
}

export function ArtistCard({ group, description }: { group: ArtistGroup; description?: string }) {
  const sources = Object.keys(group.refs) as SourceId[];
  return (
    <Link
      to={artistPath(group.name, group.refs)}
      onContextMenu={(e) => openContextMenu(e, artistMenu(group))}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) openContextMenu(e, artistMenu(group));
      }}
      className="group flex flex-col items-center gap-3 rounded-xl p-3 text-center outline-none transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <ArtistAvatar
        name={group.name}
        imageUrl={group.imageUrl}
        className="aspect-square w-full max-w-[160px] text-4xl shadow-artwork transition-transform duration-300 motion-reduce:transition-none motion-reduce:group-hover:scale-100 group-hover:scale-[1.03]"
      />
      <div className="w-full min-w-0">
        <div className="truncate text-sm font-medium">{group.name}</div>
        <div className="truncate text-xs text-muted">{description ?? subtitle(group)}</div>
      </div>
      <div className="flex flex-wrap justify-center gap-1">
        {sources.map((s) => (
          <span
            key={s}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              s === 'local' ? 'bg-primary/20 text-primary' : 'bg-foreground/10 text-muted',
            )}
          >
            {SOURCE_LABEL[s]}
          </span>
        ))}
      </div>
    </Link>
  );
}

export function ArtistGrid<G extends ArtistGroup>({
  groups,
  describe,
  emptyTitle = 'Исполнители не найдены',
}: {
  groups: G[];
  describe?: (group: G) => string;
  emptyTitle?: string;
}) {
  if (!groups.length) return <EmptyState icon={MicVocal} title={emptyTitle} className="py-10" />;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
      {groups.map((g, i) => (
        <div key={g.key} className="animate-slide-up [animation-fill-mode:both]" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
          <ArtistCard group={g} description={describe?.(g)} />
        </div>
      ))}
    </div>
  );
}
