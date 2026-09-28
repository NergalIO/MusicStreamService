import type { SourceId, UnifiedAlbum, UnifiedArtist, UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArtistAvatar } from '@/components/artists/ArtistCard';
import { CollectionHeader, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { Carousel, Shelf } from '@/components/media/Carousel';
import { MediaCard } from '@/components/media/MediaCard';
import { SourceFilter } from '@/components/SourceFilter';
import { TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/states';
import {
  artistPath,
  loadLocalArtistTracks,
  resolveExternalArtist,
  shouldSkipExternalArtistLookup,
} from '@/lib/artists';
import { albumMenu, artistMenu } from '@/lib/card-menus';
import { formatTrackCount } from '@/lib/format';
import { albumLink } from '@/lib/links';
import { playCollection } from '@/lib/player-actions';
import { EXTERNAL_SOURCES, SOURCE_LABEL, matchesFilter, type SourceFilterId } from '@/lib/sources';
import type { PlayContext } from '@/store/player-store';

const ARTIST_TRACKS_LIMIT = 500;
const SOURCE_ORDER: SourceId[] = ['local', 'yandex', 'spotify'];

type TracksBySource = Record<SourceId, UnifiedTrack[] | null>;

function AlbumShelf({ title, albums }: { title: string; albums: UnifiedAlbum[] }) {
  if (!albums.length) return null;
  return (
    <Shelf title={title}>
      <Carousel>
        {albums.map((a) => (
          <MediaCard
            key={a.id}
            title={a.title}
            subtitle={[a.year, a.trackCount ? formatTrackCount(a.trackCount) : null].filter(Boolean).join(' · ')}
            coverUrl={a.coverUrl}
            to={albumLink(a)}
            menu={() => albumMenu(a)}
            onPlay={async () => {
              const album = await window.electronAPI.yandex.album(a.id);
              playCollection(album.tracks, { type: 'album', title: album.title, path: albumLink(a) });
            }}
          />
        ))}
      </Carousel>
    </Shelf>
  );
}

function SimilarShelf({ artists }: { artists: UnifiedArtist[] }) {
  if (!artists.length) return null;
  return (
    <Shelf title="Похожие исполнители">
      <Carousel itemClassName="w-[148px]">
        {artists.map((a) => (
          <MediaCard
            key={a.id}
            shape="circle"
            title={a.name}
            subtitle={a.genres?.[0]}
            coverUrl={a.imageUrl}
            to={artistPath(a.name, { [a.source]: a })}
            menu={() =>
              artistMenu({ key: `${a.source}:${a.id}`, name: a.name, imageUrl: a.imageUrl, genres: a.genres ?? [], refs: { [a.source]: a } })
            }
          />
        ))}
      </Carousel>
    </Shelf>
  );
}

export function ArtistPage() {
  const { name = '' } = useParams();
  const [params] = useSearchParams();
  const spotifyId = params.get('spotify');
  const yandexId = params.get('yandex');

  const [filter, setFilter] = useState<SourceFilterId>('all');
  const [textFilter, setTextFilter] = useState('');
  const [showAllPopular, setShowAllPopular] = useState(false);
  const [refs, setRefs] = useState<Partial<Record<SourceId, UnifiedArtist>>>({});
  const [tracks, setTracks] = useState<TracksBySource>({ local: null, spotify: null, yandex: null });
  const [failed, setFailed] = useState<SourceId[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRefs({});
    setTracks({ local: null, spotify: null, yandex: null });
    setFailed([]);
    setFilter(
      spotifyId && !yandexId ? 'spotify' : yandexId && !spotifyId ? 'yandex' : 'all',
    );
    setTextFilter('');
    setShowAllPopular(false);

    const put = (source: SourceId, list: UnifiedTrack[]) => {
      if (!cancelled) setTracks((prev) => ({ ...prev, [source]: list }));
    };
    const fail = (source: SourceId) => {
      put(source, []);
      if (!cancelled) setFailed((prev) => [...prev, source]);
    };

    loadLocalArtistTracks(name)
      .then((list) => put('local', list))
      .catch(() => fail('local'));

    const ids: Record<(typeof EXTERNAL_SOURCES)[number], string | null> = { spotify: spotifyId, yandex: yandexId };
    for (const source of EXTERNAL_SOURCES) {
      if (shouldSkipExternalArtistLookup(source, ids)) {
        put(source, []);
        continue;
      }
      resolveExternalArtist(source, name, ids[source])
        .then(async (artist) => {
          if (!artist) return put(source, []);
          if (!cancelled) setRefs((prev) => ({ ...prev, [source]: artist }));
          put(source, await window.electronAPI.connectors.artistTracks(source, artist.id, ARTIST_TRACKS_LIMIT));
        })
        .catch(() => fail(source));
    }
    return () => {
      cancelled = true;
    };
  }, [name, spotifyId, yandexId, reloadKey]);

  const yandexArtistId = refs.yandex?.id ?? yandexId;
  const profile = useQuery({
    queryKey: ['artist-profile', 'yandex', yandexArtistId],
    queryFn: () => window.electronAPI.yandex.artistProfile(yandexArtistId!),
    enabled: !!yandexArtistId && !!window.electronAPI,
    staleTime: 30 * 60_000,
    retry: false,
  });

  const counts = useMemo(() => {
    const loaded = SOURCE_ORDER.map((s) => tracks[s]);
    return {
      all: loaded.every((l) => l === null) ? null : loaded.reduce((n, l) => n + (l?.length ?? 0), 0),
      local: tracks.local?.length ?? null,
      spotify: tracks.spotify?.length ?? null,
      yandex: tracks.yandex?.length ?? null,
    };
  }, [tracks]);

  const visible = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    return SOURCE_ORDER.filter((s) => matchesFilter(filter, s))
      .flatMap((s) => tracks[s] ?? [])
      .filter((t) => !q || t.title.toLowerCase().includes(q) || (t.album ?? '').toLowerCase().includes(q));
  }, [tracks, filter, textFilter]);

  const loading = SOURCE_ORDER.some((s) => matchesFilter(filter, s) && tracks[s] === null);
  const p = profile.data;
  const spotifyPinned = Boolean(spotifyId && !yandexId);
  const yandexPinned = Boolean(yandexId && !spotifyId);
  const imageUrl = spotifyPinned
    ? (refs.spotify?.imageUrl ?? refs.yandex?.imageUrl ?? p?.artist.imageUrl)
    : (p?.artist.imageUrl ?? refs.yandex?.imageUrl ?? refs.spotify?.imageUrl);
  const genres = [...new Set([...(p?.artist.genres ?? []), ...(refs.spotify?.genres ?? []), ...(refs.yandex?.genres ?? [])])];
  const followers = refs.spotify?.followers;
  const foundIn = SOURCE_ORDER.filter((s) => (tracks[s]?.length ?? 0) > 0);
  const context: PlayContext = { type: 'artist', title: name, path: `/artist/${encodeURIComponent(name)}` };
  const popular =
    spotifyPinned && tracks.spotify?.length
      ? tracks.spotify.slice(0, 10)
      : yandexPinned && p?.popularTracks?.length
        ? p.popularTracks
        : (p?.popularTracks ?? tracks.spotify?.slice(0, 10) ?? []);
  const allTracks = SOURCE_ORDER.flatMap((s) => tracks[s] ?? []);

  return (
    <div>
      <CollectionHeader
        kicker="Исполнитель"
        title={name}
        coverUrl={imageUrl}
        cover={<ArtistAvatar name={name} imageUrl={imageUrl} className="h-56 w-56 shrink-0 text-6xl shadow-artwork" />}
        meta={[
          counts.all !== null ? formatTrackCount(counts.all) : null,
          followers !== undefined ? `${followers.toLocaleString('ru-RU')} подписчиков в Spotify` : null,
          genres.slice(0, 3).join(' · ') || null,
          foundIn.length ? foundIn.map((s) => SOURCE_LABEL[s]).join(', ') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        onPlay={() => playCollection(popular.length ? popular : allTracks, context)}
        onShuffle={() => playCollection(allTracks.length ? allTracks : popular, context, true)}
      />

      <div className="space-y-10">
        {popular.length > 0 && (
          <Shelf title="Популярные треки">
            <TrackList
              tracks={showAllPopular ? popular : popular.slice(0, 5)}
              context={{ ...context, title: `${name}: популярное` }}
              showSource={false}
              showAlbum
            />
            {popular.length > 5 && (
              <Button variant="ghost" size="sm" onClick={() => setShowAllPopular((v) => !v)}>
                {showAllPopular ? 'Свернуть' : `Показать все (${popular.length})`}
              </Button>
            )}
          </Shelf>
        )}

        {p && <AlbumShelf title="Альбомы" albums={p.albums} />}
        {p && <AlbumShelf title="Синглы и EP" albums={p.singles} />}

        <Shelf title="Все треки">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SourceFilter value={filter} onChange={setFilter} counts={counts} />
            <Input
              className="max-w-xs"
              placeholder="Фильтр по названию или альбому"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
            />
          </div>
          {loading && !visible.length ? (
            <TrackListSkeleton />
          ) : failed.length && !visible.length ? (
            <ErrorState
              className="py-8"
              title="Не удалось загрузить треки"
              error={`Источники не ответили: ${failed.map((s) => SOURCE_LABEL[s]).join(', ')}`}
              onRetry={() => setReloadKey((k) => k + 1)}
            />
          ) : (
            <>
              <TrackList tracks={visible} context={context} header emptyText="Треки не найдены" />
              {loading && <p className="mt-3 text-xs text-muted">Загружаем остальные источники…</p>}
              {!loading && failed.length > 0 && (
                <p className="mt-3 text-xs text-muted">
                  Не ответили: {failed.map((s) => SOURCE_LABEL[s]).join(', ')} ·{' '}
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setReloadKey((k) => k + 1)}>
                    повторить
                  </button>
                </p>
              )}
            </>
          )}
        </Shelf>

        {p && <SimilarShelf artists={p.similar} />}
      </div>
    </div>
  );
}
