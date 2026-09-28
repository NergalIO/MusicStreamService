import type { UnifiedPlaylist, UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { Clock, Disc3, ListMusic, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArtistGrid } from '@/components/artists/ArtistCard';
import { CardRowSkeleton, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { Shelf } from '@/components/media/Carousel';
import { MediaCard } from '@/components/media/MediaCard';
import { SourceFilter } from '@/components/SourceFilter';
import { TrackList } from '@/components/tracks/TrackList';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { apiFetch } from '@/lib/api';
import { searchArtistsEverywhere } from '@/lib/artists';
import { albumMenu, loadPlaylistTracks, playlistMenu } from '@/lib/card-menus';
import { useSpotifyConnected, useYandexConnected } from '@/lib/connectors';
import { formatTrackCount } from '@/lib/format';
import { albumLink, playlistPath } from '@/lib/links';
import { playCollection } from '@/lib/player-actions';
import { mssPlaylistToUnified, useMssPlaylists } from '@/lib/queries';
import { EXTERNAL_SOURCES, mapLocalTrack, matchesFilter, type LocalTrackDto, type SourceFilterId } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { normalizeSearch } from '@/hooks/useTrackSort';
import { searchPath, type ServiceScope } from '@/lib/service-routes';
import { useSearchHistory } from '@/store/search-history';

type SearchKind = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';

const KINDS: { value: SearchKind; label: string }[] = [
  { value: 'all', label: 'Всё' },
  { value: 'tracks', label: 'Треки' },
  { value: 'artists', label: 'Исполнители' },
  { value: 'albums', label: 'Альбомы' },
  { value: 'playlists', label: 'Плейлисты' },
];

const GRID = 'grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';

async function searchTracks(q: string, filter: SourceFilterId, limit: number): Promise<UnifiedTrack[]> {
  const tasks: Promise<UnifiedTrack[]>[] = [];
  if (matchesFilter(filter, 'local')) {
    tasks.push(
      apiFetch<{ items: LocalTrackDto[] }>(`/tracks?query=${encodeURIComponent(q)}&limit=${limit}`).then((d) =>
        d.items.map((t) => mapLocalTrack(t)),
      ),
    );
  }
  for (const source of EXTERNAL_SOURCES) {
    if (window.electronAPI && matchesFilter(filter, source)) {
      tasks.push(window.electronAPI.connectors.search(source, q, limit));
    }
  }
  if (tasks.length === 1) return tasks[0];
  const settled = await Promise.allSettled(tasks);
  const items = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!items.length) {
    const rejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected) throw rejected.reason;
  }
  return items;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function SearchBox({ q, onSubmit, scope }: { q: string; onSubmit: (value: string) => void; scope: ServiceScope }) {
  const [input, setInput] = useState(q);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const yandex = useYandexConnected();
  const history = useSearchHistory();
  const boxRef = useRef<HTMLFormElement>(null);
  const typed = useDebounced(input.trim(), 250);

  useEffect(() => setInput(q), [q]);

  const suggest = useQuery({
    queryKey: ['search', 'suggest', typed],
    queryFn: () => window.electronAPI.yandex.suggest(typed),
    enabled: scope !== 'spotify' && (scope === 'yandex' || scope === 'media') && yandex && typed.length >= 2 && typed !== q,
    staleTime: 10 * 60_000,
  });

  const needle = normalizeSearch(input);
  const pastMatches = history.items.filter((h) => !needle || normalizeSearch(h).includes(needle)).slice(0, needle ? 4 : 8);
  const suggestions = (typed.length >= 2 ? (suggest.data ?? []) : []).filter(
    (s) => !pastMatches.some((p) => p.toLowerCase() === s.toLowerCase()),
  );
  const options = [...pastMatches.map((v) => ({ value: v, past: true })), ...suggestions.map((v) => ({ value: v, past: false }))];
  const showList = open && options.length > 0;

  const submit = (value: string) => {
    setInput(value);
    setOpen(false);
    setActive(-1);
    onSubmit(value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <form
      ref={boxRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(active >= 0 && options[active] ? options[active].value : input);
      }}
      className="relative mb-5"
      role="search"
    >
      <Search size={18} className="pointer-events-none absolute left-4 top-[24px] -translate-y-1/2 text-muted" />
      <input
        autoFocus
        data-search-input
        value={input}
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `search-opt-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (showList) {
              e.stopPropagation();
              setOpen(false);
            } else setInput('');
          } else if (e.key === 'ArrowDown' && options.length) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % options.length);
          } else if (e.key === 'ArrowUp' && options.length) {
            e.preventDefault();
            setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
          }
        }}
        placeholder="Треки, исполнители, альбомы, плейлисты"
        className="h-12 w-full rounded-xl border border-border bg-foreground/[0.05] pl-12 pr-10 text-base outline-none transition-colors placeholder:text-muted focus:border-primary/60"
      />
      {input && (
        <button
          type="button"
          aria-label="Очистить"
          onClick={() => {
            setInput('');
            onSubmit('');
          }}
          className="absolute right-3 top-[24px] -translate-y-1/2 rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
        >
          <X size={16} />
        </button>
      )}
      {showList && (
        <ul
          id="search-suggestions"
          role="listbox"
          className="glass absolute inset-x-0 top-[52px] z-30 max-h-80 overflow-y-auto rounded-xl border p-1.5 shadow-popover"
        >
          {options.map((o, i) => (
            <li
              key={`${o.past}-${o.value}`}
              id={`search-opt-${i}`}
              role="option"
              aria-selected={active === i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => submit(o.value)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'group flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                active === i && 'bg-foreground/[0.08]',
              )}
            >
              {o.past ? <Clock size={14} className="text-muted" /> : <Search size={14} className="text-muted" />}
              <span className="flex-1 truncate">{o.value}</span>
              {o.past && (
                <button
                  type="button"
                  aria-label="Удалить из истории"
                  onClick={(e) => {
                    e.stopPropagation();
                    history.remove(o.value);
                  }}
                  className="rounded-full p-0.5 text-muted opacity-0 hover:text-foreground group-hover:opacity-100"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
          {pastMatches.length > 0 && !needle && (
            <li className="px-3 pb-1 pt-2 text-right">
              <button type="button" onClick={history.clear} className="text-xs text-muted hover:text-foreground">
                Очистить историю
              </button>
            </li>
          )}
        </ul>
      )}
    </form>
  );
}

function PlaylistResults({
  q,
  kind,
  scope,
  filter,
}: {
  q: string;
  kind: SearchKind;
  scope: ServiceScope;
  filter: SourceFilterId;
}) {
  const yandex = useYandexConnected();
  const mss = useMssPlaylists();
  const wantYandex = (scope === 'yandex' || scope === 'media') && matchesFilter(filter, 'yandex');
  const wantLocal = (scope === 'mss' || scope === 'media') && matchesFilter(filter, 'local');
  const external = useQuery({
    queryKey: ['search', 'playlists', q],
    queryFn: () => window.electronAPI.yandex.searchPlaylists(q, kind === 'playlists' ? 36 : 12),
    enabled: wantYandex && yandex && !!q,
    staleTime: 5 * 60_000,
  });
  const needle = normalizeSearch(q);
  const own = wantLocal
    ? (mss.data ?? []).filter((p) => normalizeSearch(p.name).includes(needle)).map(mssPlaylistToUnified)
    : [];
  const items: UnifiedPlaylist[] = scope === 'mss' ? own : [...own, ...(wantYandex ? (external.data ?? []) : [])];

  if (scope === 'spotify') {
    return <p className="text-sm text-muted">Поиск плейлистов Spotify пока недоступен — откройте раздел «Все плейлисты».</p>;
  }
  if (scope === 'yandex' && !yandex) {
    return <p className="text-sm text-muted">Подключите Яндекс Музыку в настройках, чтобы искать плейлисты</p>;
  }
  if (wantLocal && mss.isError) return <ErrorState className="py-8" error={mss.error} onRetry={() => void mss.refetch()} />;
  if (wantYandex && external.isError && !items.length) {
    return <ErrorState className="py-8" error={external.error} onRetry={() => void external.refetch()} />;
  }
  if (((wantYandex && external.isLoading) || (wantLocal && mss.isLoading)) && !items.length) return <CardRowSkeleton />;
  if (!items.length) return <EmptyState icon={ListMusic} title="Плейлисты не найдены" className="py-10" />;
  return (
    <div className={GRID}>
      {items.slice(0, kind === 'all' ? 6 : undefined).map((p) => (
        <MediaCard
          key={`${p.source}:${p.id}`}
          title={p.title}
          subtitle={[p.source === 'local' ? 'MSS' : p.owner, p.trackCount ? formatTrackCount(p.trackCount) : null].filter(Boolean).join(' · ')}
          coverUrl={p.coverUrl}
          to={playlistPath(p)}
          menu={() => playlistMenu(p)}
          onPlay={async () => playCollection(await loadPlaylistTracks(p), { type: 'playlist', title: p.title, path: playlistPath(p) })}
        />
      ))}
    </div>
  );
}

function AlbumResults({ q, kind }: { q: string; kind: SearchKind }) {
  const yandex = useYandexConnected();
  const albums = useQuery({
    queryKey: ['search', 'albums', q],
    queryFn: () => window.electronAPI.yandex.searchAlbums(q, kind === 'albums' ? 36 : 12),
    enabled: yandex && !!q,
    staleTime: 5 * 60_000,
  });
  if (!yandex) return <p className="text-sm text-muted">Поиск альбомов работает через Яндекс Музыку — подключите её в настройках</p>;
  if (albums.isError) return <ErrorState className="py-8" error={albums.error} onRetry={() => void albums.refetch()} />;
  if (albums.isLoading) return <CardRowSkeleton />;
  const items = albums.data ?? [];
  if (!items.length) return <EmptyState icon={Disc3} title="Альбомы не найдены" className="py-10" />;
  return (
    <div className={GRID}>
      {items.slice(0, kind === 'all' ? 6 : undefined).map((a) => (
        <MediaCard
          key={a.id}
          title={a.title}
          subtitle={[a.artist, a.year].filter(Boolean).join(' · ')}
          coverUrl={a.coverUrl}
          to={albumLink(a)}
          menu={() => albumMenu(a)}
          onPlay={async () => {
            const album = await window.electronAPI.yandex.album(a.id);
            playCollection(album.tracks, { type: 'album', title: album.title, path: albumLink(a) });
          }}
        />
      ))}
    </div>
  );
}

const MSS_KINDS = KINDS.filter((k) => k.value !== 'albums');

export function SearchPage({ scope }: { scope: ServiceScope }) {
  const spotifyConnected = useSpotifyConnected();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const [filter, setFilter] = useState<SourceFilterId>(
    scope === 'mss' ? 'local' : scope === 'yandex' ? 'yandex' : scope === 'spotify' ? 'spotify' : 'all',
  );
  const [kind, setKind] = useState<SearchKind>('all');
  const addHistory = useSearchHistory((s) => s.add);
  const kindOptions = scope === 'mss' || scope === 'spotify' ? MSS_KINDS : KINDS;
  const searchContextPath = searchPath(scope, q);
  const showAlbums = (scope === 'yandex' || scope === 'media') && matchesFilter(filter, 'yandex');
  const showSourceFilter = scope === 'media';

  useEffect(() => {
    if (q) addHistory(q);
  }, [q, addHistory]);

  const spotifySearchReady = scope !== 'spotify' || spotifyConnected;
  const tracks = useQuery({
    queryKey: ['search', 'tracks', q, filter, kind],
    queryFn: () => searchTracks(q, filter, kind === 'tracks' ? 40 : 15),
    enabled: !!q && spotifySearchReady && (kind === 'all' || kind === 'tracks'),
    staleTime: 5 * 60_000,
  });
  const artists = useQuery({
    queryKey: ['search', 'artists', q, filter, kind],
    queryFn: () => searchArtistsEverywhere(q, filter, kind === 'artists' ? 24 : 8),
    enabled: !!q && spotifySearchReady && (kind === 'all' || kind === 'artists'),
    staleTime: 5 * 60_000,
  });

  const submit = (value: string) => setParams(value.trim() ? { q: value.trim() } : {}, { replace: true });
  const show = (k: SearchKind) => kind === 'all' || kind === k;

  const emptyDescription =
    scope === 'mss'
      ? 'Ищите треки, исполнителей и плейлисты во внутренней библиотеке MSS.'
      : scope === 'yandex'
        ? 'Ищите в каталоге Яндекс Музыки: треки, альбомы, плейлисты и исполнители.'
        : scope === 'spotify'
          ? 'Ищите треки и исполнителей в каталоге Spotify.'
          : 'Ищите по всей медиатеке — MSS, Яндекс Музыка и другие источники. Ctrl+F открывает поиск.';

  const pageTitle =
    scope === 'mss'
      ? 'Поиск в MSS'
      : scope === 'yandex'
        ? 'Поиск в Яндекс Музыке'
        : scope === 'spotify'
          ? 'Поиск в Spotify'
          : 'Поиск';

  return (
    <div>
      <h1 className="mb-5 text-3xl font-bold tracking-tight">{pageTitle}</h1>
      <SearchBox q={q} onSubmit={submit} scope={scope} />

      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={kind} options={kindOptions} onChange={setKind} />
        {showSourceFilter && kind !== 'albums' && kind !== 'playlists' && (
          <SourceFilter value={filter} onChange={setFilter} />
        )}
      </div>

      {!q ? (
        <EmptyState icon={Search} title="Что будем слушать?" description={emptyDescription} className="py-20" />
      ) : scope === 'spotify' && !spotifyConnected ? (
        <p className="text-sm text-muted">Подключите Spotify в настройках, чтобы искать треки и исполнителей.</p>
      ) : (
        <div className="space-y-10">
          {show('artists') && (
            <Shelf title={kind === 'all' ? 'Исполнители' : `Исполнители по запросу «${q}»`}>
              {artists.isError ? (
                <ErrorState className="py-8" error={artists.error} onRetry={() => void artists.refetch()} />
              ) : artists.isLoading ? (
                <CardRowSkeleton />
              ) : (
                <ArtistGrid groups={artists.data ?? []} />
              )}
            </Shelf>
          )}
          {show('tracks') && (
            <Shelf title={kind === 'all' ? 'Треки' : `Треки по запросу «${q}»`}>
              {tracks.isError ? (
                <ErrorState className="py-8" error={tracks.error} onRetry={() => void tracks.refetch()} />
              ) : tracks.isLoading ? (
                <TrackListSkeleton />
              ) : (
                <TrackList
                  tracks={tracks.data ?? []}
                  context={{ type: 'search', title: `Поиск: ${q}`, path: searchContextPath }}
                  emptyText="Ничего не найдено"
                />
              )}
            </Shelf>
          )}
          {showAlbums && show('albums') && (
            <Shelf title={kind === 'all' ? 'Альбомы' : `Альбомы по запросу «${q}»`}>
              <AlbumResults q={q} kind={kind} />
            </Shelf>
          )}
          {show('playlists') && (
            <Shelf title={kind === 'all' ? 'Плейлисты' : `Плейлисты по запросу «${q}»`}>
              <PlaylistResults q={q} kind={kind} scope={scope} filter={filter} />
            </Shelf>
          )}
        </div>
      )}
    </div>
  );
}
