import type { ArtistProfile, SourceId, UnifiedAlbum, UnifiedArtist, UnifiedTrack } from '@mss/shared';
import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArtistAvatar } from '@/components/artists/ArtistCard';
import { CollectionHeader, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { Carousel, Shelf } from '@/components/media/Carousel';
import { MediaCard } from '@/components/media/MediaCard';
import { TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { Heart } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/states';
import { artistPath, loadLocalArtistAlbums, loadLocalArtistTracks, localArtistLikeId, resolveExternalArtist } from '@/lib/artists';
import { albumMenu, artistMenu, loadAlbumTracks } from '@/lib/card-menus';
import { formatTrackCount } from '@/lib/format';
import { albumLink } from '@/lib/links';
import { playCollection } from '@/lib/player-actions';
import { EXTERNAL_SOURCES, SOURCE_LABEL } from '@/lib/sources';
import { cn } from '@/lib/utils';
import type { PlayContext } from '@/store/player-store';
import { useArtistLikesStore, useIsArtistLiked } from '@/store/artist-likes-store';

const ARTIST_TRACKS_LIMIT = 500;
const SOURCE_ORDER: SourceId[] = ['local', 'yandex', 'spotify', 'vk'];
const PROFILE_SOURCES = ['yandex', 'spotify'] as const;

type TracksBySource = Record<SourceId, UnifiedTrack[] | null>;

const ALBUM_KIND: Record<string, string> = { single: 'Сингл', compilation: 'Сборник' };

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')} тыс.`;
  return String(n);
}

function AlbumShelf({ title, albums }: { title: string; albums: UnifiedAlbum[] }) {
  if (!albums.length) return null;
  return (
    <Shelf title={title}>
      <Carousel>
        {albums.map((a) => (
          <MediaCard
            key={`${a.source}:${a.id}`}
            title={a.title}
            subtitle={[a.year, ALBUM_KIND[a.type ?? ''], a.trackCount ? formatTrackCount(a.trackCount) : null]
              .filter(Boolean)
              .join(' · ')}
            coverUrl={a.coverUrl}
            to={albumLink(a)}
            menu={() => albumMenu(a)}
            onPlay={
              a.source === 'yandex' || a.source === 'spotify' || a.source === 'local'
                ? async () => {
                    const tracks = await loadAlbumTracks(a.id, a.source as 'yandex' | 'spotify' | 'local');
                    playCollection(tracks, { type: 'album', title: a.title, path: albumLink(a) });
                  }
                : undefined
            }
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
            key={`${a.source}:${a.id}`}
            shape="circle"
            title={a.name}
            subtitle={a.genres?.[0] ?? SOURCE_LABEL[a.source]}
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

interface PlatformInfo {
  source: SourceId;
  imageUrl?: string;
  monthlyListeners?: number;
  followers?: number;
  trackCount: number;
  releaseCount: number;
}

function PlatformCard({ info, name, active, onSelect }: { info: PlatformInfo; name: string; active: boolean; onSelect: () => void }) {
  const followersWord = info.source === 'yandex' ? 'лайков' : 'подписчиков';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-56 shrink-0 flex-col gap-2 rounded-xl border p-4 text-left transition-colors',
        active ? 'border-primary bg-primary/15' : 'border-border bg-foreground/[0.03] hover:bg-foreground/[0.06]',
      )}
    >
      <div className="flex items-center gap-3">
        <ArtistAvatar name={name} imageUrl={info.imageUrl} className="h-10 w-10 shrink-0 text-base" />
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            info.source === 'local' ? 'bg-primary/20 text-primary' : 'bg-foreground/10 text-muted',
          )}
        >
          {SOURCE_LABEL[info.source]}
        </span>
      </div>
      {info.monthlyListeners !== undefined && (
        <div>
          <div className="text-xl font-bold">{formatCount(info.monthlyListeners)}</div>
          <div className="text-xs text-muted">слушателей в месяц</div>
        </div>
      )}
      {info.followers !== undefined && (
        <div className="text-xs text-muted">
          {formatCount(info.followers)} {followersWord}
        </div>
      )}
      <div className="text-xs text-muted">
        {[info.trackCount ? formatTrackCount(info.trackCount) : null, info.releaseCount ? `${info.releaseCount} релизов` : null]
          .filter(Boolean)
          .join(' · ') || 'Нет треков'}
      </div>
    </button>
  );
}

export function ArtistPage() {
  const { name = '' } = useParams();
  const [params] = useSearchParams();
  const spotifyId = params.get('spotify');
  const yandexId = params.get('yandex');
  const vkId = params.get('vk');

  const [picked, setPicked] = useState<SourceId | null>(null);
  const [textFilter, setTextFilter] = useState('');
  const [showAllPopular, setShowAllPopular] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [refs, setRefs] = useState<Partial<Record<SourceId, UnifiedArtist>>>({});
  const emptyTracks = (): TracksBySource => ({ local: null, spotify: null, yandex: null, vk: null });
  const [tracks, setTracks] = useState<TracksBySource>(emptyTracks);
  const [localAlbums, setLocalAlbums] = useState<UnifiedAlbum[]>([]);
  const [failed, setFailed] = useState<SourceId[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRefs({});
    setTracks(emptyTracks());
    setLocalAlbums([]);
    setFailed([]);
    const specified = [spotifyId && 'spotify', yandexId && 'yandex', vkId && 'vk'].filter(Boolean) as SourceId[];
    setPicked(specified.length === 1 ? specified[0] : null);
    setTextFilter('');
    setShowAllPopular(false);
    setAboutOpen(false);

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
    loadLocalArtistAlbums(name)
      .then((albums) => {
        if (!cancelled) setLocalAlbums(albums);
      })
      .catch(() => {
        if (!cancelled) setLocalAlbums([]);
      });

    const ids: Record<(typeof EXTERNAL_SOURCES)[number], string | null> = {
      spotify: spotifyId,
      yandex: yandexId,
      vk: vkId,
    };
    for (const source of EXTERNAL_SOURCES) {
      resolveExternalArtist(source, name, ids[source])
        .then(async (artist) => {
          if (!artist) return put(source, []);
          if (!cancelled) setRefs((prev) => ({ ...prev, [source]: artist }));
          put(
            source,
            await window.electronAPI.connectors.artistTracks(source, artist.id, ARTIST_TRACKS_LIMIT, artist.name),
          );
        })
        .catch(() => fail(source));
    }
    return () => {
      cancelled = true;
    };
  }, [name, spotifyId, yandexId, vkId, reloadKey]);

  const profileQueries = useQueries({
    queries: PROFILE_SOURCES.map((source) => {
      const id = refs[source]?.id ?? (source === 'yandex' ? yandexId : spotifyId);
      return {
        queryKey: ['artist-profile', source, id],
        queryFn: () => window.electronAPI.connectors.artistProfile(source, id!),
        enabled: !!id && !!window.electronAPI,
        staleTime: 30 * 60_000,
        retry: false,
      };
    }),
  });
  const profiles = useMemo(() => {
    const out: Partial<Record<SourceId, ArtistProfile>> = {};
    PROFILE_SOURCES.forEach((s, i) => {
      const data = profileQueries[i]?.data;
      if (data) out[s] = data;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQueries[0]?.data, profileQueries[1]?.data]);

  const platforms = useMemo<PlatformInfo[]>(
    () =>
      SOURCE_ORDER.flatMap((source) => {
        const profile = profiles[source];
        const ref = refs[source];
        const list = tracks[source] ?? [];
        if (!profile && !ref && !list.length && !(source === 'local' && localAlbums.length)) return [];
        const releases =
          source === 'local'
            ? localAlbums.length
            : (profile?.albums.length ?? 0) + (profile?.singles.length ?? 0);
        return [
          {
            source,
            imageUrl: profile?.artist.imageUrl ?? ref?.imageUrl ?? (source === 'vk' ? list[0]?.coverUrl : undefined),
            monthlyListeners: profile?.artist.monthlyListeners,
            followers: profile?.artist.followers ?? ref?.followers,
            trackCount: Math.max(list.length, profile?.artist.trackCount ?? 0),
            releaseCount: releases,
          },
        ];
      }),
    [profiles, refs, tracks, localAlbums],
  );

  const loadingAny = SOURCE_ORDER.some((s) => tracks[s] === null);
  const missing = EXTERNAL_SOURCES.filter((s) => tracks[s] !== null && !platforms.some((p) => p.source === s));
  const selected: SourceId | undefined =
    (picked && platforms.some((p) => p.source === picked) ? picked : undefined) ??
    platforms.find((p) => p.source !== 'local')?.source ??
    platforms[0]?.source;

  const pinned = spotifyId && !yandexId ? 'spotify' : 'yandex';
  const headProfile = profiles[pinned] ?? profiles.yandex ?? profiles.spotify;
  const imageUrl =
    headProfile?.artist.imageUrl ?? refs[pinned]?.imageUrl ?? platforms.find((p) => p.imageUrl)?.imageUrl;
  const genres = [
    ...new Set([
      ...(profiles.yandex?.artist.genres ?? []),
      ...(profiles.spotify?.artist.genres ?? []),
      ...(refs.spotify?.genres ?? []),
      ...(refs.yandex?.genres ?? []),
    ]),
  ];
  const description = headProfile?.artist.description ?? profiles.yandex?.artist.description ?? profiles.spotify?.artist.description;
  const listeners = platforms.reduce((sum, p) => sum + (p.monthlyListeners ?? 0), 0);
  const similar = useMemo(() => {
    const seen = new Set<string>();
    return [...(profiles.yandex?.similar ?? []), ...(profiles.spotify?.similar ?? [])].filter((a) => {
      const key = a.name.toLowerCase();
      return seen.has(key) ? false : (seen.add(key), true);
    });
  }, [profiles]);

  const context: PlayContext = { type: 'artist', title: name, path: `/artist/${encodeURIComponent(name)}` };
  const selectedTracks = selected ? (tracks[selected] ?? []) : [];
  const selectedProfile = selected ? profiles[selected] : undefined;
  const popular =
    selected === 'local' ? [] : selectedProfile?.popularTracks.length ? selectedProfile.popularTracks : selectedTracks.slice(0, 10);
  const visible = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    return selectedTracks.filter(
      (t) => !q || t.title.toLowerCase().includes(q) || (t.album ?? '').toLowerCase().includes(q),
    );
  }, [selectedTracks, textFilter]);
  const allTracks = SOURCE_ORDER.flatMap((s) => tracks[s] ?? []);
  const label = selected ? SOURCE_LABEL[selected] : '';
  const mssArtist = useMemo<UnifiedArtist>(
    () => ({
      source: 'local',
      id: localArtistLikeId(name),
      name,
      imageUrl,
      genres,
      trackCount: (tracks.local ?? []).length || undefined,
    }),
    [name, imageUrl, genres, tracks.local],
  );
  const liked = useIsArtistLiked(mssArtist);
  const toggleArtistLike = useArtistLikesStore((s) => s.toggle);

  return (
    <div>
      <CollectionHeader
        kicker="Исполнитель"
        title={name}
        coverUrl={imageUrl}
        cover={<ArtistAvatar name={name} imageUrl={imageUrl} className="h-56 w-56 shrink-0 text-6xl shadow-artwork" />}
        subtitle={listeners > 0 ? `${listeners.toLocaleString('ru-RU')} слушателей в месяц` : undefined}
        meta={[
          allTracks.length ? formatTrackCount(allTracks.length) : null,
          genres.slice(0, 3).join(' · ') || null,
          platforms.length ? platforms.map((p) => SOURCE_LABEL[p.source]).join(', ') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        onPlay={() => playCollection(popular.length ? popular : allTracks, context)}
        onShuffle={() => playCollection(allTracks.length ? allTracks : popular, context, true)}
        actions={
          <Button
            size="icon"
            variant="ghost"
            aria-label={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
            aria-pressed={liked}
            title={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
            onClick={() => void toggleArtistLike(mssArtist)}
          >
            <Heart size={18} className={cn(liked && 'fill-primary text-primary')} />
          </Button>
        }
      />

      <div className="space-y-10">
        {platforms.length > 0 && (
          <Shelf title="Площадки">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {platforms.map((p) => (
                <PlatformCard key={p.source} info={p} name={name} active={p.source === selected} onSelect={() => setPicked(p.source)} />
              ))}
            </div>
            {(missing.length > 0 || loadingAny) && (
              <p className="mt-3 text-xs text-muted">
                {missing.length > 0 && `Нет на: ${missing.map((s) => SOURCE_LABEL[s]).join(', ')}`}
                {missing.length > 0 && loadingAny && ' · '}
                {loadingAny && 'Проверяем остальные площадки…'}
              </p>
            )}
          </Shelf>
        )}

        {description && (
          <Shelf title="Об исполнителе">
            <p className={cn('max-w-3xl whitespace-pre-line text-sm text-muted', !aboutOpen && 'line-clamp-4')}>{description}</p>
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAboutOpen((v) => !v)}>
              {aboutOpen ? 'Свернуть' : 'Подробнее'}
            </Button>
          </Shelf>
        )}

        {platforms.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <button
                key={p.source}
                type="button"
                onClick={() => setPicked(p.source)}
                className={cn(
                  'rounded-full border border-border px-4 py-1.5 text-sm transition-colors hover:bg-foreground/5',
                  p.source === selected && 'border-primary bg-primary/30',
                )}
              >
                {SOURCE_LABEL[p.source]}
                <span className="ml-1.5 text-muted">{tracks[p.source]?.length ?? '…'}</span>
              </button>
            ))}
          </div>
        )}

        {popular.length > 0 && (
          <Shelf title={`Популярные · ${label}`}>
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

        {selected === 'local' ? (
          <>
            <AlbumShelf
              title={`Альбомы · ${label}`}
              albums={localAlbums.filter((a) => a.type !== 'single' && a.type !== 'ep')}
            />
            <AlbumShelf
              title={`Синглы и EP · ${label}`}
              albums={localAlbums.filter((a) => a.type === 'single' || a.type === 'ep')}
            />
          </>
        ) : (
          <>
            {selectedProfile && <AlbumShelf title={`Альбомы · ${label}`} albums={selectedProfile.albums} />}
            {selectedProfile && <AlbumShelf title={`Синглы и EP · ${label}`} albums={selectedProfile.singles} />}
          </>
        )}

        <Shelf title={selected ? `Все треки · ${label}` : 'Все треки'}>
          <div className="mb-3 flex justify-end">
            <Input
              className="max-w-xs"
              placeholder="Фильтр по названию или альбому"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
            />
          </div>
          {(!selected && loadingAny) || (selected && tracks[selected] === null) ? (
            <TrackListSkeleton />
          ) : failed.length && !platforms.length ? (
            <ErrorState
              className="py-8"
              title="Не удалось загрузить треки"
              error={`Источники не ответили: ${failed.map((s) => SOURCE_LABEL[s]).join(', ')}`}
              onRetry={() => setReloadKey((k) => k + 1)}
            />
          ) : (
            <>
              <TrackList tracks={visible} context={context} header showSource={false} emptyText="Треки не найдены" />
              {!loadingAny && failed.length > 0 && (
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

        <SimilarShelf artists={similar} />
      </div>
    </div>
  );
}
