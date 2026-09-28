import type { UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CollectionHeader, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { DownloadAllButton } from '@/components/tracks/DownloadAllButton';
import { TrackFilterInput, TrackList } from '@/components/tracks/TrackList';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useTrackSort } from '@/hooks/useTrackSort';
import { formatTotalDuration, formatTrackCount } from '@/lib/format';
import { loadAlbum } from '@/lib/card-menus';
import { trackArtistLinks } from '@/lib/links';
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
  const meta = [
    album.genre,
    album.year,
    formatTrackCount(album.tracks.length),
    album.durationMs ? formatTotalDuration(album.durationMs) : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
