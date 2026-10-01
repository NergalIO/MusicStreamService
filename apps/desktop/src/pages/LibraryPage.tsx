import type { SourceId, UnifiedAlbum, UnifiedTrack } from '@mss/shared';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { FolderOpen, ListMusic, Play, Plus, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ServiceNav } from '@/components/layout/ServiceNav';
import { toast } from 'sonner';
import { ArtistGrid } from '@/components/artists/ArtistCard';
import { CardRowSkeleton, PageTitle, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { MediaCard } from '@/components/media/MediaCard';
import { DownloadAllButton } from '@/components/tracks/DownloadAllButton';
import { TrackFilterInput, TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { UploadButton } from '@/components/uploads/UploadButton';
import { normalizeSearch, useTrackSort } from '@/hooks/useTrackSort';
import { albumMenu, loadAlbumTracks, loadPlaylistTracks, playlistMenu } from '@/lib/card-menus';
import { favoriteArtistGroups, favoriteArtistSubtitle } from '@/lib/favorite-artists';
import { useSpotifyConnected, useVkConnected, useYandexConnected } from '@/lib/connectors';
import { formatBytes, formatTrackCount } from '@/lib/format';
import { albumLink, playlistPath } from '@/lib/links';
import { createPlaylist, deleteUploadedTrack } from '@/lib/mss-library';
import { playCollection } from '@/lib/player-actions';
import { SOURCE_LABEL, matchesFilter, type SourceFilterId } from '@/lib/sources';
import { syncListeningHistory } from '@/lib/listening';
import { clearHistoryWithUndo, undoableToast } from '@/lib/undo';
import {
  mssPlaylistToUnified,
  useLocalLikedTracks,
  useMssPlaylists,
  useMyAlbums,
  useMyUploads,
  useSpotifyPlaylists,
  useSpotifySavedTracks,
  useVkPlaylists,
  useVkSavedTracks,
  useYandexLikedTracks,
  useYandexPlaylists,
} from '@/lib/queries';
import { SourceFilter } from '@/components/SourceFilter';
import { useDownloadsStore } from '@/store/downloads-store';
import { useLikesStore } from '@/store/likes-store';
import { useAlbumLikesStore } from '@/store/album-likes-store';
import { libraryPath, MSS_PLAYLISTS, MSS_UPLOADS, SPOTIFY_WEB, type CatalogScope, type ServiceScope } from '@/lib/service-routes';
import { usePlayerStore, type PlayContext } from '@/store/player-store';

const MSS_TABS = [{ id: 'likes' }, { id: 'uploads' }] as const;
const SERVICE_LIBRARY_TABS = [{ id: 'likes' }, { id: 'playlists' }] as const;
const MEDIA_TABS = [{ id: 'likes' }, { id: 'history' }, { id: 'downloads' }] as const;

type TabId = 'likes' | 'uploads' | 'playlists' | 'history' | 'downloads';

function tabsFor(scope: ServiceScope): readonly { id: TabId }[] {
  if (scope === 'mss') return MSS_TABS;
  if (scope === 'yandex' || scope === 'vk' || scope === 'spotify') return SERVICE_LIBRARY_TABS;
  return MEDIA_TABS;
}

const ALBUM_GRID = 'grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';

function PlayButtons({
  tracks,
  context,
  size = 'sm',
}: {
  tracks: UnifiedTrack[];
  context: PlayContext;
  size?: 'sm' | 'md' | 'lg';
}) {
  const disabled = !tracks.some((t) => t.playable);
  const icon = size === 'sm' ? 14 : 15;
  return (
    <>
      <Button size={size} disabled={disabled} onClick={() => playCollection(tracks, context)}>
        <Play size={icon} fill="currentColor" /> Слушать
      </Button>
      <Button size={size} variant="secondary" disabled={disabled} onClick={() => playCollection(tracks, context, true)}>
        <Shuffle size={icon} /> Перемешать
      </Button>
    </>
  );
}

function LikesTab({ scope }: { scope: ServiceScope }) {
  const yandexConnected = useYandexConnected();
  const vkConnected = useVkConnected();
  const spotifyConnected = useSpotifyConnected();
  const yandex = useYandexLikedTracks();
  const vk = useVkSavedTracks();
  const spotify = useSpotifySavedTracks();
  const local = useLocalLikedTracks();
  const spotifyTracks = useLikesStore((s) => s.spotifyTracks);
  const likedSpotify = useLikesStore((s) => s.spotify);
  const likedYandex = useLikesStore((s) => s.yandex);
  const likedLocal = useLikesStore((s) => s.local);
  const likedVk = useLikesStore((s) => s.vk);
  const [mediaFilter, setMediaFilter] = useState<SourceFilterId>('all');
  const filter: SourceFilterId =
    scope === 'media'
      ? mediaFilter
      : scope === 'mss'
        ? 'local'
        : scope === 'vk'
          ? 'vk'
          : scope === 'spotify'
            ? 'spotify'
            : 'yandex';

  const bySource = useMemo(() => {
    const yIds = new Set(likedYandex);
    const lIds = new Set(likedLocal);
    const vIds = new Set(likedVk);
    const spIds = new Set(likedSpotify);
    const deviceOnly = spotifyTracks.filter((t) => !(spotify.data ?? []).some((s) => s.id === t.id));
    const saved = (spotify.data ?? []).filter((t) => spIds.size === 0 || spIds.has(t.id));
    return {
      local: (local.data ?? []).filter((t) => lIds.has(t.id)),
      yandex: (yandex.data ?? []).filter((t) => yIds.has(t.id.split(':')[0])),
      spotify: [...deviceOnly, ...saved],
      vk: scope === 'vk' ? (vk.data ?? []) : (vk.data ?? []).filter((t) => vIds.has(t.id.split('_').slice(0, 2).join('_'))),
    };
  }, [local.data, yandex.data, vk.data, spotify.data, spotifyTracks, likedSpotify, likedYandex, likedLocal, likedVk, scope]);

  const bySelectedSource = useMemo(() => {
    return (['yandex', 'local', 'spotify', 'vk'] as const).filter((s) => matchesFilter(filter, s)).flatMap((s) => bySource[s]);
  }, [bySource, filter]);
  const { view: visible, sort, cycle, filter: text, setFilter: setText } = useTrackSort(bySelectedSource);

  const context: PlayContext = { type: 'likes', title: 'Мне нравится', path: libraryPath(scope, 'likes') };
  const counts = {
    all: bySource.local.length + bySource.yandex.length + bySource.spotify.length + bySource.vk.length,
    local: local.isLoading ? null : bySource.local.length,
    yandex: yandexConnected && yandex.isLoading ? null : bySource.yandex.length,
    spotify: spotifyConnected && spotify.isLoading ? null : bySource.spotify.length,
    vk: vkConnected && vk.isLoading ? null : bySource.vk.length,
  };

  const loading =
    scope === 'mss'
      ? local.isLoading
      : scope === 'yandex'
        ? yandexConnected && yandex.isLoading
        : scope === 'vk'
          ? vkConnected && vk.isLoading
          : scope === 'spotify'
            ? spotifyConnected && spotify.isLoading
            : (matchesFilter(filter, 'local') && local.isLoading) ||
              (matchesFilter(filter, 'yandex') && yandexConnected && yandex.isLoading) ||
              (matchesFilter(filter, 'spotify') && spotifyConnected && spotify.isLoading) ||
              (matchesFilter(filter, 'vk') && vkConnected && vk.isLoading);

  if (scope === 'yandex' && !yandexConnected) {
    return (
      <EmptyState
        title="Подключите Яндекс Музыку"
        description="Лайки Яндекса появятся здесь после подключения аккаунта в настройках."
        className="py-16"
      />
    );
  }
  if (scope === 'vk' && !vkConnected) {
    return (
      <EmptyState
        title="Подключите VK Музыку"
        description="Лайки из VK появятся здесь после входа в аккаунт."
        className="py-16"
      />
    );
  }
  if (scope === 'spotify' && !spotifyConnected) {
    return <SpotifyLoginState what="Лайки Spotify" />;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {scope === 'mss' && <p className="text-sm text-muted">Треки, альбомы и исполнители из внутренней библиотеки MSS</p>}
        {scope === 'spotify' && <p className="text-sm text-muted">Лайки вашего аккаунта Spotify</p>}
        {scope === 'yandex' && <p className="text-sm text-muted">Лайки из вашего аккаунта Яндекс Музыки</p>}
        {scope === 'vk' && <p className="text-sm text-muted">Лайки из вашего аккаунта VK</p>}
        {scope === 'media' && <SourceFilter value={mediaFilter} onChange={setMediaFilter} counts={counts} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <TrackFilterInput value={text} onChange={setText} />
          <PlayButtons tracks={visible} context={context} />
          <DownloadAllButton tracks={visible} size="sm" />
        </div>
      </div>
      {((scope === 'mss' && local.isError) ||
        (scope === 'yandex' && yandex.isError) ||
        (scope === 'vk' && vk.isError) ||
        (scope === 'spotify' && spotify.isError)) &&
      !visible.length ? (
        <ErrorState
          error={scope === 'mss' ? local.error : scope === 'vk' ? vk.error : scope === 'spotify' ? spotify.error : yandex.error}
          onRetry={() => {
            if (scope === 'mss') void local.refetch();
            else if (scope === 'vk') void vk.refetch();
            else if (scope === 'spotify') void spotify.refetch();
            else void yandex.refetch();
          }}
        />
      ) : scope === 'media' && local.isError && yandex.isError && vk.isError && !visible.length ? (
        <ErrorState
          error={local.error ?? yandex.error}
          onRetry={() => {
            void local.refetch();
            void yandex.refetch();
            void vk.refetch();
          }}
        />
      ) : loading && !visible.length ? (
        <TrackListSkeleton />
      ) : (
        <TrackList
          tracks={visible}
          context={context}
          header
          sort={sort}
          onSort={cycle}
          emptyText={text ? 'Ничего не найдено' : 'Здесь появятся треки, которые вам понравились'}
        />
      )}
      <LikedAlbumsSection filter={filter} />
      <ArtistsSection filter={filter} />
    </>
  );
}

function ArtistsSection({ filter }: { filter: SourceFilterId }) {
  const yandexConnected = useYandexConnected();
  const vkConnected = useVkConnected();
  const spotifyConnected = useSpotifyConnected();
  const want = (s: SourceId) => matchesFilter(filter, s);
  const local = useLocalLikedTracks();
  const yandex = useYandexLikedTracks();
  const vk = useVkSavedTracks();
  const spotify = useSpotifySavedTracks();
  const spotifyDevice = useLikesStore((s) => s.spotifyTracks);
  const likedYandex = useLikesStore((s) => s.yandex);
  const likedLocal = useLikesStore((s) => s.local);
  const yandexFollowed = useQuery({
    queryKey: ['yandex', 'favorite-artists'],
    queryFn: () => window.electronAPI.connectors.favoriteArtists('yandex'),
    enabled: want('yandex') && yandexConnected,
    staleTime: 5 * 60_000,
  });
  const spotifyFollowed = useQuery({
    queryKey: ['spotify', 'favorite-artists'],
    queryFn: () => window.electronAPI.connectors.favoriteArtists('spotify'),
    enabled: want('spotify') && spotifyConnected,
    staleTime: 5 * 60_000,
  });
  const [text, setText] = useState('');

  const groups = useMemo(() => {
    const yIds = new Set(likedYandex);
    const lIds = new Set(likedLocal);
    const tracks: UnifiedTrack[] = [
      ...(want('local') ? (local.data ?? []).filter((t) => lIds.has(t.id)) : []),
      ...(want('yandex') ? (yandex.data ?? []).filter((t) => yIds.size === 0 || yIds.has(t.id.split(':')[0])) : []),
      ...(want('vk') ? (vk.data ?? []) : []),
      ...(want('spotify')
        ? [...(spotify.data ?? []), ...spotifyDevice.filter((t) => !(spotify.data ?? []).some((s) => s.id === t.id))]
        : []),
    ];
    const followed = [
      ...(want('yandex') ? (yandexFollowed.data ?? []) : []),
      ...(want('spotify') ? (spotifyFollowed.data ?? []) : []),
    ];
    return favoriteArtistGroups(followed, tracks);
    // want зависит только от filter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, local.data, yandex.data, vk.data, spotify.data, spotifyDevice, likedYandex, likedLocal, yandexFollowed.data, spotifyFollowed.data]);

  const needle = normalizeSearch(text);
  const visible = needle ? groups.filter((g) => normalizeSearch(g.name).includes(needle)) : groups;
  const loading =
    (want('local') && local.isLoading) ||
    (want('yandex') && yandexConnected && (yandex.isLoading || yandexFollowed.isLoading)) ||
    (want('vk') && vkConnected && vk.isLoading) ||
    (want('spotify') && spotifyConnected && (spotify.isLoading || spotifyFollowed.isLoading));

  if (!loading && !groups.length) return null;

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Исполнители</h2>
        {groups.length > 0 && <TrackFilterInput value={text} onChange={setText} />}
      </div>
      {loading && !groups.length ? (
        <CardRowSkeleton />
      ) : (
        <ArtistGrid
          groups={visible}
          describe={favoriteArtistSubtitle}
          emptyTitle={text ? 'Ничего не найдено' : 'Отметьте треки или исполнителей — они появятся здесь'}
        />
      )}
    </section>
  );
}

const UPLOADS_KEY: QueryKey = ['my-uploads'];

function UploadsTab() {
  const queryClient = useQueryClient();
  const { data: uploads = [], isLoading, isError, error, refetch } = useMyUploads();
  const [pendingDelete, setPendingDelete] = useState<UnifiedTrack[] | null>(null);
  const { view, sort, cycle, filter, setFilter } = useTrackSort(uploads);
  const ready = uploads.filter((t) => t.playable);
  const processing = uploads.filter((t) => t.status === 'processing').length;
  const context: PlayContext = { type: 'library', title: 'Мои треки', path: MSS_UPLOADS };

  const confirmDelete = () => {
    if (!pendingDelete?.length) return;
    const items = pendingDelete;
    setPendingDelete(null);
    const ids = new Set(items.map((t) => t.id));
    const before = queryClient.getQueryData<UnifiedTrack[]>(UPLOADS_KEY) ?? uploads;
    queryClient.setQueryData(
      UPLOADS_KEY,
      before.filter((t) => !ids.has(t.id)),
    );
    undoableToast(items.length === 1 ? `«${items[0].title}» удалён` : `Удалено: ${formatTrackCount(items.length)}`, {
      undo: () => queryClient.setQueryData(UPLOADS_KEY, before),
      commit: () =>
        void Promise.all(items.map((t) => deleteUploadedTrack(t.id))).catch((e) => {
          queryClient.setQueryData(UPLOADS_KEY, before);
          toast.error(e instanceof Error ? e.message : 'Не удалось удалить');
        }),
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {uploads.length
            ? [formatTrackCount(ready.length), processing ? `ещё ${processing} в обработке` : null].filter(Boolean).join(' · ')
            : 'Загрузите свои аудиофайлы — они появятся в библиотеке MSS. Папку альбома можно добавить кнопкой «Загрузить альбом»'}
        </p>
        <div className="flex items-center gap-2">
          {uploads.length > 0 && <TrackFilterInput value={filter} onChange={setFilter} />}
          <UploadButton />
          <UploadButton album variant="secondary" label="Загрузить альбом" />
          <PlayButtons tracks={ready} context={context} />
        </div>
      </div>
      {isError ? (
        <ErrorState title="Не удалось загрузить ваши треки" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <TrackListSkeleton />
      ) : (
        <TrackList
          tracks={view}
          context={context}
          header
          showSource={false}
          sort={sort}
          onSort={cycle}
          onRemove={(t) => setPendingDelete([t])}
          onRemoveMany={(tracks) => setPendingDelete(tracks)}
          removeLabel="Удалить трек"
          emptyText="Перетащите файлы в окно или нажмите «Добавить треки»"
        />
      )}
      <Dialog open={!!pendingDelete?.length} onClose={() => setPendingDelete(null)} title={pendingDelete?.length === 1 ? 'Удалить трек?' : 'Удалить треки?'}>
        <p className="mb-5 text-sm text-muted">
          {pendingDelete?.length === 1
            ? `«${pendingDelete[0].title}» будет удалён с сервера MSS и из всех плейлистов.`
            : `${formatTrackCount(pendingDelete?.length ?? 0)} будут удалены с сервера MSS и из всех плейлистов.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>
            Отмена
          </Button>
          <Button variant="danger" onClick={() => void confirmDelete()}>
            Удалить
          </Button>
        </div>
      </Dialog>
      <UploadedAlbumsSection />
      <MssPlaylistsSection />
    </>
  );
}

function DownloadsTab() {
  const items = useDownloadsStore((s) => s.items);
  const records = useMemo(
    () => Object.values(items).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt)),
    [items],
  );
  const allTracks = useMemo(() => records.map((r) => r.track), [records]);
  const { view: tracks, sort, cycle, filter: text, setFilter: setText } = useTrackSort(allTracks);
  const totalSize = records.reduce((sum, r) => sum + r.size, 0);
  const context: PlayContext = { type: 'downloads', title: 'Скачанные', path: libraryPath('media', 'downloads') };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {records.length ? `${formatTrackCount(records.length)} · ${formatBytes(totalSize)}` : 'Пока ничего не скачано'}
        </p>
        <div className="flex items-center gap-2">
          {records.length > 0 && <TrackFilterInput value={text} onChange={setText} />}
          <Button variant="ghost" onClick={() => void window.electronAPI.downloads.openDir()}>
            <FolderOpen size={15} /> Открыть папку
          </Button>
          <PlayButtons tracks={tracks} context={context} />
        </div>
      </div>
      <TrackList
        tracks={tracks}
        context={context}
        header
        sort={sort}
        onSort={cycle}
        onRemove={(t) => void useDownloadsStore.getState().remove(t)}
        onRemoveMany={(list) => void useDownloadsStore.getState().removeMany(list)}
        removeLabel="Удалить загрузку"
        emptyText="Скачивайте треки Яндекс Музыки и VK через меню трека или кнопку «Скачать» — они будут играть без интернета"
      />
    </>
  );
}

function HistoryTab({ scope }: { scope: ServiceScope }) {
  const history = usePlayerStore((s) => s.history);
  const context: PlayContext = { type: 'history', title: 'Недавно играли', path: libraryPath(scope, 'history') };
  useEffect(() => {
    void syncListeningHistory();
  }, []);
  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        {history.length > 0 && (
          <Button variant="ghost" onClick={clearHistoryWithUndo}>
            Очистить историю
          </Button>
        )}
        <PlayButtons tracks={history} context={context} />
      </div>
      <TrackList tracks={history} context={context} emptyText="Здесь появятся треки, которые вы слушали на телефоне или компьютере" />
    </>
  );
}

function SpotifyLoginState({ what }: { what: string }) {
  const navigate = useNavigate();
  return (
    <EmptyState
      title="Войдите в Spotify"
      description={`${what} появятся здесь после входа во встроенном веб-плеере.`}
      className="py-16"
      action={
        <Button size="sm" onClick={() => navigate(SPOTIFY_WEB)}>
          Открыть веб-плеер
        </Button>
      }
    />
  );
}

function MssPlaylistsSection() {
  const mss = useMssPlaylists();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ref = useRef<HTMLElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (params.get('section') === 'playlists') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [params, mss.data]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const playlist = await createPlaylist(name.trim());
      setName('');
      setCreating(false);
      navigate(`/playlists/${playlist.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать плейлист');
    }
  };

  return (
    <section ref={ref} id="playlists" className="mt-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Мои плейлисты</h2>
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Новый плейлист
        </Button>
      </div>
      {mss.isError ? (
        <ErrorState className="py-8" title="Плейлисты MSS недоступны" error={mss.error} onRetry={() => void mss.refetch()} />
      ) : mss.isLoading ? (
        <CardRowSkeleton />
      ) : mss.data?.length ? (
        <div className={ALBUM_GRID}>
          {mss.data.map((p) => {
            const u = mssPlaylistToUnified(p);
            return (
              <MediaCard
                key={p.id}
                title={p.name}
                subtitle={[p.author, formatTrackCount(p.trackCount)].filter(Boolean).join(' · ')}
                coverUrl={u.coverUrl}
                to={playlistPath(u)}
                menu={() => playlistMenu(u)}
                onPlay={
                  p.trackCount
                    ? async () => {
                        const tracks = await loadPlaylistTracks(u);
                        playCollection(tracks, { type: 'playlist', title: p.name, path: playlistPath(u) });
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={ListMusic}
          title="Плейлистов пока нет"
          description="Соберите плейлист из треков вашей внутренней библиотеки MSS"
          className="py-10"
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Создать плейлист
            </Button>
          }
        />
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="Новый плейлист">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-4"
        >
          <Input autoFocus placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Создать
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function PlaylistsTab({ scope }: { scope: ServiceScope }) {
  const yandex = useYandexPlaylists();
  const vk = useVkPlaylists();
  const spotify = useSpotifyPlaylists();
  const yandexConnected = useYandexConnected();
  const vkConnected = useVkConnected();
  const spotifyConnected = useSpotifyConnected();

  if (scope === 'yandex' && !yandexConnected) {
    return (
      <EmptyState
        title="Подключите Яндекс Музыку"
        description="Плейлисты Яндекса появятся здесь после подключения аккаунта."
        className="py-16"
      />
    );
  }

  if (scope === 'vk' && !vkConnected) {
    return (
      <EmptyState
        title="Подключите VK Музыку"
        description="Плейлисты VK появятся здесь после входа в аккаунт."
        className="py-16"
      />
    );
  }

  if (scope === 'spotify' && !spotifyConnected) return <SpotifyLoginState what="Плейлисты Spotify" />;

  return (
    <div className="space-y-10">
      {scope === 'yandex' && (
        <section>
          {yandex.isError ? (
            <ErrorState className="py-8" error={yandex.error} onRetry={() => void yandex.refetch()} />
          ) : yandex.isLoading ? (
            <CardRowSkeleton />
          ) : (
            <div className={ALBUM_GRID}>
              {(yandex.data ?? []).map((p) => (
                <MediaCard
                  key={p.id}
                  title={p.title}
                  subtitle={p.trackCount !== undefined ? formatTrackCount(p.trackCount) : p.owner}
                  coverUrl={p.coverUrl}
                  to={playlistPath(p)}
                  menu={() => playlistMenu(p)}
                  onPlay={async () => {
                    const full = await window.electronAPI.yandex.playlist(p.id);
                    playCollection(full.tracks, { type: 'playlist', title: full.title, path: playlistPath(p) });
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {scope === 'vk' && (
        <section>
          {vk.isError ? (
            <ErrorState className="py-8" error={vk.error} onRetry={() => void vk.refetch()} />
          ) : vk.isLoading ? (
            <CardRowSkeleton />
          ) : (
            <div className={ALBUM_GRID}>
              {(vk.data ?? []).map((p) => (
                <MediaCard
                  key={p.id}
                  title={p.title}
                  subtitle={p.trackCount !== undefined ? formatTrackCount(p.trackCount) : p.owner}
                  coverUrl={p.coverUrl}
                  to={playlistPath(p)}
                  menu={() => playlistMenu(p)}
                  onPlay={async () => {
                    const full = await window.electronAPI.connectors.getPlaylist('vk', p.id);
                    playCollection(full.tracks, { type: 'playlist', title: full.title, path: playlistPath(p) });
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {scope === 'spotify' && (
        <section>
          {spotify.isError ? (
            <ErrorState className="py-8" error={spotify.error} onRetry={() => void spotify.refetch()} />
          ) : spotify.isLoading ? (
            <CardRowSkeleton />
          ) : spotify.data?.length ? (
            <div className={ALBUM_GRID}>
              {spotify.data.map((p) => (
                <MediaCard
                  key={p.id}
                  title={p.title}
                  subtitle={p.trackCount !== undefined ? formatTrackCount(p.trackCount) : p.owner}
                  coverUrl={p.coverUrl}
                  to={playlistPath(p)}
                  menu={() => playlistMenu(p)}
                  onPlay={async () => {
                    playCollection(await loadPlaylistTracks(p), { type: 'playlist', title: p.title, path: playlistPath(p) });
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={ListMusic} title="Плейлистов пока нет" className="py-10" />
          )}
        </section>
      )}
    </div>
  );
}

function albumPlaySource(album: UnifiedAlbum): 'yandex' | 'spotify' | 'local' {
  return album.source === 'spotify' || album.source === 'local' ? album.source : 'yandex';
}

function AlbumCards({ albums }: { albums: UnifiedAlbum[] }) {
  return (
    <div className={ALBUM_GRID}>
      {albums.map((a) => (
        <MediaCard
          key={`${a.source}:${a.id}`}
          title={a.title}
          subtitle={[a.artist, a.source !== 'local' ? SOURCE_LABEL[a.source] : null, a.year, a.trackCount ? formatTrackCount(a.trackCount) : null]
            .filter(Boolean)
            .join(' · ')}
          coverUrl={a.coverUrl}
          to={albumLink(a)}
          menu={() => albumMenu(a)}
          onPlay={
            a.trackCount
              ? async () => {
                  const tracks = await loadAlbumTracks(a.id, albumPlaySource(a));
                  playCollection(tracks, { type: 'album', title: a.title, path: albumLink(a) });
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}

function LikedAlbumsSection({ filter }: { filter: SourceFilterId }) {
  const liked = useAlbumLikesStore((s) => s.items);
  const albums = useMemo(
    () => liked.filter((a) => matchesFilter(filter, a.source)),
    [liked, filter],
  );
  if (!albums.length) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-semibold">Альбомы</h2>
      <AlbumCards albums={albums} />
    </section>
  );
}

function UploadedAlbumsSection() {
  const { data: albums = [], isLoading, isError, error, refetch } = useMyAlbums();
  if (isError) {
    return (
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">Альбомы</h2>
        <ErrorState title="Не удалось загрузить альбомы" error={error} onRetry={() => void refetch()} />
      </section>
    );
  }
  if (isLoading && !albums.length) {
    return (
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">Альбомы</h2>
        <CardRowSkeleton />
      </section>
    );
  }
  if (!albums.length) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-semibold">Альбомы</h2>
      <AlbumCards albums={albums} />
    </section>
  );
}

export function LibraryPage({ scope }: { scope: ServiceScope }) {
  const { tab } = useParams();
  if (tab === 'artists') return <Navigate to={libraryPath(scope, 'likes')} replace />;
  if (scope === 'mss' && tab === 'playlists') return <Navigate to={MSS_PLAYLISTS} replace />;
  if (scope === 'media' && (tab === 'albums' || tab === 'uploads')) return <Navigate to={MSS_UPLOADS} replace />;
  if (scope === 'media' && tab === 'playlists') return <Navigate to={MSS_PLAYLISTS} replace />;
  const tabs = tabsFor(scope);
  if (!tabs.some((t) => t.id === tab)) return <Navigate to={libraryPath(scope, 'likes')} replace />;
  const id = tab as TabId;
  const catalog = scope !== 'media';
  const mediaTitle = id === 'history' ? 'Недавно играли' : id === 'downloads' ? 'Скачанные' : 'Мне нравится';
  return (
    <div>
      {catalog ? <ServiceNav scope={scope as CatalogScope} /> : <PageTitle title={mediaTitle} />}
      {id === 'likes' && <LikesTab scope={scope} />}
      {id === 'history' && scope === 'media' && <HistoryTab scope={scope} />}
      {id === 'playlists' && <PlaylistsTab scope={scope} />}
      {id === 'uploads' && scope === 'mss' && <UploadsTab />}
      {id === 'downloads' && scope === 'media' && <DownloadsTab />}
    </div>
  );
}
