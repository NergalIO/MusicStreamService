import type { UnifiedTrack } from '@mss/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CollectionHeader, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { DownloadAllButton } from '@/components/tracks/DownloadAllButton';
import { TrackFilterInput, TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { SOURCE_LABEL } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useTrackSort } from '@/hooks/useTrackSort';
import { formatTotalDuration, formatTrackCount } from '@/lib/format';
import { loadAlbum } from '@/lib/card-menus';
import { albumMatchKey, findAlbumAlternatives } from '@/lib/album-match';
import { albumPath, trackArtistLinks } from '@/lib/links';
import { playCollection } from '@/lib/player-actions';

const NO_TRACKS: UnifiedTrack[] = [];

const TYPE_LABEL: Record<string, string> = {
  single: 'Сингл',
  compilation: 'Сборник',
  podcast: 'Подкаст',
};

export function AlbumPage() {
  const { source = '', id = '' } = useParams();
  const supported = source === 'yandex' || source === 'spotify';
  const { data: album, isLoading, error, refetch } = useQuery({
    queryKey: ['album', source, id],
    queryFn: () => loadAlbum(source as 'yandex' | 'spotify', id),
    enabled: supported && !!id,
    staleTime: 30 * 60_000,
  });
  const { view, sort, cycle, filter, setFilter, isNatural } = useTrackSort(album?.tracks ?? NO_TRACKS);
  const [aboutOpen, setAboutOpen] = useState(false);
  const navigate = useNavigate();
  const alternatives = useQuery({
    queryKey: ['album-alternatives', album ? albumMatchKey(album) : ''],
    queryFn: () => findAlbumAlternatives(album!),
    enabled: !!album,
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  if (!supported) return <EmptyState title="Страницы альбомов доступны для Яндекс Музыки и Spotify" />;
  if (error) return <ErrorState title="Не удалось загрузить альбом" error={error} onRetry={() => void refetch()} />;
  if (isLoading || !album) {
    return (
      <>
        <div className="mb-8 flex items-end gap-8">
          <div className="h-56 w-56 animate-pulse rounded-xl bg-foreground/[0.07]" />
          <div className="flex-1 space-y-3">
            <div className="h-8 w-1/2 animate-pulse rounded bg-foreground/[0.07]" />
            <div className="h-5 w-1/4 animate-pulse rounded bg-foreground/[0.05]" />
          </div>
        </div>
        <TrackListSkeleton />
      </>
    );
  }

  const context = { type: 'album' as const, title: album.title, path: `/album/${source}/${id}` };
  const artists = trackArtistLinks({ source: album.source, artist: album.artist, artists: album.artists });
  const tags = [
    album.year ? String(album.year) : null,
    ...(album.genre ?? '')
      .split(/[,/]/)
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((g) => g[0].toUpperCase() + g.slice(1)),
    album.tracks.some((t) => t.explicit) ? '18+' : null,
    formatTrackCount(album.trackCount ?? album.tracks.length),
    album.durationMs ? formatTotalDuration(album.durationMs) : null,
    album.label ? `℗ ${album.label}` : null,
  ].filter((t): t is string => !!t);
  const platforms = (alternatives.data ?? []).some((a) => a.source === album.source && a.id === album.id)
    ? alternatives.data!
    : [];
  const meta = (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 md:justify-start">
      <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">{SOURCE_LABEL[album.source]}</span>
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-xs font-medium text-foreground/80">
          {tag}
        </span>
      ))}
    </div>
  );

  return (
    <div>
      <CollectionHeader
        kicker={TYPE_LABEL[album.type ?? ''] ?? 'Альбом'}
        title={album.title}
        subtitle={artists.map((a, i) => (
          <Fragment key={a.to}>
            {i > 0 && ', '}
            <Link to={a.to} className="hover:underline">
              {a.name}
            </Link>
          </Fragment>
        ))}
        meta={meta}
        coverUrl={album.coverUrl}
        onPlay={() => playCollection(album.tracks, context)}
        onShuffle={album.tracks.length > 1 ? () => playCollection(album.tracks, context, true) : undefined}
        actions={<DownloadAllButton tracks={album.tracks} />}
      />
      {(platforms.length > 1 || alternatives.isFetching) && (
        <section className="-mt-4 mb-6 flex flex-wrap items-center gap-2" aria-label="Альбом на других площадках">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Слушать на</span>
          {platforms.map((p) => {
            const active = p.source === album.source;
            return (
              <button
                key={p.source}
                type="button"
                aria-pressed={active}
                disabled={active}
                onClick={() => navigate(albumPath(p.source, p.id), { replace: true })}
                className={cn(
                  'rounded-full px-3 py-1 text-sm transition-colors',
                  active ? 'bg-foreground/15 font-medium text-foreground' : 'bg-foreground/5 text-muted hover:bg-foreground/10 hover:text-foreground',
                )}
              >
                {SOURCE_LABEL[p.source]}
                {p.trackCount ? <span className="ml-1.5 text-xs text-muted">{p.trackCount} тр.</span> : null}
              </button>
            );
          })}
          {alternatives.isFetching && <Loader2 size={14} className="animate-spin text-muted" aria-label="Ищем на других площадках" />}
        </section>
      )}
      {album.description && (
        <section className="mb-8 max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold">Описание</h2>
          <p className={cn('whitespace-pre-line text-sm text-muted', !aboutOpen && 'line-clamp-4')}>{album.description}</p>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAboutOpen((v) => !v)}>
            {aboutOpen ? 'Свернуть' : 'Подробнее'}
          </Button>
        </section>
      )}
      {album.tracks.length > 12 && (
        <div className="mb-3 flex justify-end">
          <TrackFilterInput value={filter} onChange={setFilter} />
        </div>
      )}
      <TrackList
        tracks={view}
        context={context}
        variant="album"
        header
        sort={sort}
        onSort={cycle}
        numbered={isNatural}
        emptyText="Ничего не найдено"
      />
      {album.label && (
        <p className="mt-8 text-xs text-muted">
          {album.year ? `℗ ${album.year} ` : ''}
          {album.label}
        </p>
      )}
    </div>
  );
}
