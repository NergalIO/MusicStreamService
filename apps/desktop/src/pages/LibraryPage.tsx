import type { UnifiedTrack } from '@mss/shared';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { FolderOpen, ListMusic, Play, Plus, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CardRowSkeleton, PageTitle, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { MediaCard } from '@/components/media/MediaCard';
import { DownloadAllButton } from '@/components/tracks/DownloadAllButton';
import { TrackFilterInput, TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { UploadButton } from '@/components/uploads/UploadButton';
import { useTrackSort } from '@/hooks/useTrackSort';
import { loadPlaylistTracks, playlistMenu } from '@/lib/card-menus';
import { SpotifyReconnectButton } from '@/components/connectors/SpotifyReconnectButton';
import { useSpotifyConnected, useYandexConnected } from '@/lib/connectors';
import { formatBytes, formatTrackCount } from '@/lib/format';
import { playlistPath } from '@/lib/links';
import { createPlaylist, deleteUploadedTrack } from '@/lib/mss-library';
import { playCollection } from '@/lib/player-actions';
import { clearHistoryWithUndo, undoableToast } from '@/lib/undo';
import {
  mssPlaylistToUnified,
  useLocalLikedTracks,
  useMssPlaylists,
  useMyUploads,
  useSpotifyPlaylists,
  useSpotifySavedTracks,
  useYandexLikedTracks,
  useYandexPlaylists,
} from '@/lib/queries';
import { SourceFilter } from '@/components/SourceFilter';
import { matchesFilter, type SourceFilterId } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { useDownloadsStore } from '@/store/downloads-store';
import { useLikesStore } from '@/store/likes-store';
import { libraryPath, type ServiceScope } from '@/lib/service-routes';
import { usePlayerStore, type PlayContext } from '@/store/player-store';

const MSS_TABS = [
  { id: 'likes', label: 'Мне нравится' },
  { id: 'history', label: 'Недавно играли' },
  { id: 'playlists', label: 'Плейлисты' },
  { id: 'uploads', label: 'Мои треки' },
  { id: 'downloads', label: 'Скачанные' },
] as const;

const YANDEX_TABS = [
  { id: 'likes', label: 'Мне нравится' },
  { id: 'playlists', label: 'Плейлисты' },
] as const;

const SPOTIFY_TABS = [
  { id: 'likes', label: 'Мне нравится' },
  { id: 'playlists', label: 'Плейлисты' },
] as const;

const MEDIA_TABS = [
  { id: 'likes', label: 'Мне нравится' },
  { id: 'history', label: 'Недавно играли' },
  { id: 'playlists', label: 'Плейлисты' },
] as const;

type MssTabId = (typeof MSS_TABS)[number]['id'];
type YandexTabId = (typeof YANDEX_TABS)[number]['id'];
type SpotifyTabId = (typeof SPOTIFY_TABS)[number]['id'];
type MediaTabId = (typeof MEDIA_TABS)[number]['id'];
type TabId = MssTabId | YandexTabId | SpotifyTabId | MediaTabId;

function Tabs({ scope }: { scope: ServiceScope }) {
  const tabs =
    scope === 'mss' ? MSS_TABS : scope === 'yandex' ? YANDEX_TABS : scope === 'spotify' ? SPOTIFY_TABS : MEDIA_TABS;
  return (
    <div className="mb-6 flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <NavLink
          key={t.id}
          to={libraryPath(scope, t.id)}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors',
              isActive ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}

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
  const spotifyConnected = useSpotifyConnected();
  const yandex = useYandexLikedTracks();
  const spotifySaved = useSpotifySavedTracks();
  const local = useLocalLikedTracks();
  const spotifyTracks = useLikesStore((s) => s.spotifyTracks);
  const likedYandex = useLikesStore((s) => s.yandex);
  const likedLocal = useLikesStore((s) => s.local);
  const [mediaFilter, setMediaFilter] = useState<SourceFilterId>('all');
  const filter: SourceFilterId =
    scope === 'media' ? mediaFilter : scope === 'mss' ? 'local' : scope === 'spotify' ? 'spotify' : 'yandex';

  const bySource = useMemo(() => {
    const yIds = new Set(likedYandex);
    const lIds = new Set(likedLocal);
    return {
      local: (local.data ?? []).filter((t) => lIds.has(t.id)),
      yandex: (yandex.data ?? []).filter((t) => yIds.has(t.id.split(':')[0])),
      spotify: spotifyTracks,
    };
  }, [local.data, yandex.data, spotifyTracks, likedYandex, likedLocal]);

  const spotifyScopeTracks = useMemo(
    () => (scope === 'spotify' ? (spotifySaved.data ?? []) : bySource.spotify),
    [scope, spotifySaved.data, bySource.spotify],
  );

  const bySelectedSource = useMemo(() => {
    if (scope === 'spotify') return spotifyScopeTracks;
    return (['yandex', 'local', 'spotify'] as const).filter((s) => matchesFilter(filter, s)).flatMap((s) => bySource[s]);
  }, [scope, spotifyScopeTracks, bySource, filter]);
  const { view: visible, sort, cycle, filter: text, setFilter: setText } = useTrackSort(bySelectedSource);

  const context: PlayContext = { type: 'likes', title: 'Мне нравится', path: libraryPath(scope, 'likes') };
  const counts = {
    all: bySource.local.length + bySource.yandex.length + bySource.spotify.length,
    local: local.isLoading ? null : bySource.local.length,
    yandex: yandexConnected && yandex.isLoading ? null : bySource.yandex.length,
    spotify: bySource.spotify.length,
  };

  const loading =
    scope === 'mss'
      ? local.isLoading
      : scope === 'yandex'
        ? yandexConnected && yandex.isLoading
        : scope === 'spotify'
          ? spotifyConnected && spotifySaved.isLoading
          : (matchesFilter(filter, 'local') && local.isLoading) ||
            (matchesFilter(filter, 'yandex') && yandexConnected && yandex.isLoading);

  if (scope === 'spotify' && !spotifyConnected) {
    return (
      <EmptyState
        title="Подключите Spotify"
        description="Сохранённые треки появятся здесь после подключения аккаунта в настройках."
        className="py-16"
      />
    );
  }

  if (scope === 'yandex' && !yandexConnected) {
    return (
      <EmptyState
        title="Подключите Яндекс Музыку"
        description="Лайки Яндекса появятся здесь после подключения аккаунта в настройках."
        className="py-16"
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {scope === 'mss' && <p className="text-sm text-muted">Треки из внутренней библиотеки MSS</p>}
        {scope === 'yandex' && <p className="text-sm text-muted">Лайки из вашего аккаунта Яндекс Музыки</p>}
        {scope === 'spotify' && <p className="text-sm text-muted">Сохранённые треки из вашего аккаунта Spotify</p>}
        {scope === 'media' && <SourceFilter value={mediaFilter} onChange={setMediaFilter} counts={counts} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <TrackFilterInput value={text} onChange={setText} />
          <PlayButtons tracks={visible} context={context} />
          <DownloadAllButton tracks={visible} size="sm" />
        </div>
      </div>
      {((scope === 'mss' && local.isError) ||
        (scope === 'yandex' && yandex.isError) ||
        (scope === 'spotify' && spotifySaved.isError)) &&
      !visible.length ? (
        <ErrorState
          error={scope === 'mss' ? local.error : scope === 'spotify' ? spotifySaved.error : yandex.error}
          action={scope === 'spotify' ? <SpotifyReconnectButton error={spotifySaved.error} /> : undefined}
          onRetry={() => {
            if (scope === 'mss') void local.refetch();
            else if (scope === 'spotify') void spotifySaved.refetch();
            else void yandex.refetch();
          }}
        />
      ) : scope === 'media' && local.isError && yandex.isError && !visible.length ? (
        <ErrorState
          error={local.error ?? yandex.error}
          onRetry={() => {
            void local.refetch();
            void yandex.refetch();
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
    </>
  );
}

const UPLOADS_KEY: QueryKey = ['my-uploads'];

function UploadsTab() {
  const queryClient = useQueryClient();
  const { data: uploads = [], isLoading, isError, error, refetch } = useMyUploads();
  const [pendingDelete, setPendingDelete] = useState<UnifiedTrack | null>(null);
  const { view, sort, cycle, filter, setFilter } = useTrackSort(uploads);
  const ready = uploads.filter((t) => t.playable);
  const processing = uploads.filter((t) => t.status === 'processing').length;
  const context: PlayContext = { type: 'library', title: 'Мои треки', path: libraryPath('mss', 'uploads') };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const track = pendingDelete;
    setPendingDelete(null);
    const before = queryClient.getQueryData<UnifiedTrack[]>(UPLOADS_KEY) ?? uploads;
    queryClient.setQueryData(
      UPLOADS_KEY,
      before.filter((t) => t.id !== track.id),
    );
    undoableToast(`«${track.title}» удалён`, {
      undo: () => queryClient.setQueryData(UPLOADS_KEY, before),
      commit: () =>
        void deleteUploadedTrack(track.id).catch((e) => {
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
            : 'Загрузите свои аудиофайлы — они появятся в библиотеке MSS и их можно добавлять в плейлисты'}
        </p>
        <div className="flex items-center gap-2">
          {uploads.length > 0 && <TrackFilterInput value={filter} onChange={setFilter} />}
          <UploadButton />
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
          onRemove={(t) => setPendingDelete(t)}
          removeLabel="Удалить трек"
          emptyText="Перетащите файлы в окно или нажмите «Загрузить треки»"
        />
      )}
      <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} title="Удалить трек?">
        <p className="mb-5 text-sm text-muted">
          «{pendingDelete?.title}» будет удалён с сервера MSS и из всех плейлистов.
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
  const context: PlayContext = { type: 'downloads', title: 'Скачанные', path: libraryPath('mss', 'downloads') };

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
        emptyText="Скачивайте треки Яндекс Музыки через меню трека или кнопку «Скачать» у альбома и плейлиста — они будут играть без интернета"
      />
    </>
  );
}

function HistoryTab({ scope }: { scope: ServiceScope }) {
  const history = usePlayerStore((s) => s.history);
  const context: PlayContext = { type: 'history', title: 'Недавно играли', path: libraryPath(scope, 'history') };
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
      <TrackList tracks={history} context={context} emptyText="Вы ещё ничего не слушали" />
    </>
  );
}

function PlaylistsTab({ scope }: { scope: ServiceScope }) {
  const mss = useMssPlaylists();
  const yandex = useYandexPlaylists();
  const spotify = useSpotifyPlaylists();
  const yandexConnected = useYandexConnected();
  const spotifyConnected = useSpotifyConnected();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

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

  const grid = 'grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';

  if (scope === 'yandex' && !yandexConnected) {
    return (
      <EmptyState
        title="Подключите Яндекс Музыку"
        description="Плейлисты Яндекса появятся здесь после подключения аккаунта."
        className="py-16"
      />
    );
  }

  if (scope === 'spotify' && !spotifyConnected) {
    return (
      <EmptyState
        title="Подключите Spotify"
        description="Плейлисты Spotify появятся здесь после подключения аккаунта."
        className="py-16"
      />
    );
  }

  const showMss = scope === 'mss' || scope === 'media';
  const showYandex = (scope === 'yandex' || scope === 'media') && yandexConnected;
  const showSpotify = (scope === 'spotify' || scope === 'media') && spotifyConnected;

  return (
    <div className="space-y-10">
      {scope === 'media' && (
        <p className="text-sm text-muted">
          Чтобы быстро открыть плейлист из боковой панели, выберите «Закрепить в боковой панели» в меню плейлиста (⋯).
        </p>
      )}
      {showMss && (
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight">Плейлисты MSS</h2>
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> {scope === 'media' ? 'Новый плейлист MSS' : 'Новый плейлист'}
          </Button>
        </div>
        {mss.isError ? (
          <ErrorState className="py-8" title="Плейлисты MSS недоступны" error={mss.error} onRetry={() => void mss.refetch()} />
        ) : mss.isLoading ? (
          <CardRowSkeleton />
        ) : mss.data?.length ? (
          <div className={grid}>
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
      </section>
      )}

      {showYandex && (
        <section>
          <h2 className="mb-4 text-xl font-bold tracking-tight">Плейлисты Яндекс Музыки</h2>
          {yandex.isError ? (
            <ErrorState className="py-8" error={yandex.error} onRetry={() => void yandex.refetch()} />
          ) : yandex.isLoading ? (
            <CardRowSkeleton />
          ) : (
            <div className={grid}>
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

      {showSpotify && (
        <section>
          <h2 className="mb-4 text-xl font-bold tracking-tight">Плейлисты Spotify</h2>
          {spotify.isError ? (
            <ErrorState
              className="py-8"
              error={spotify.error}
              action={<SpotifyReconnectButton error={spotify.error} />}
              onRetry={() => void spotify.refetch()}
            />
          ) : spotify.isLoading ? (
            <CardRowSkeleton />
          ) : (
            <div className={grid}>
              {(spotify.data ?? []).map((p) => (
                <MediaCard
                  key={p.id}
                  title={p.title}
                  subtitle={p.trackCount !== undefined ? formatTrackCount(p.trackCount) : p.owner}
                  coverUrl={p.coverUrl}
                  to={playlistPath(p)}
                  menu={() => playlistMenu(p)}
                  onPlay={async () => {
                    const full = await window.electronAPI.connectors.getPlaylist('spotify', p.id);
                    playCollection(full.tracks, { type: 'playlist', title: full.title, path: playlistPath(p) });
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showMss && (
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
      )}
    </div>
  );
}

export function LibraryPage({ scope }: { scope: ServiceScope }) {
  const { tab } = useParams();
  const tabs =
    scope === 'mss' ? MSS_TABS : scope === 'yandex' ? YANDEX_TABS : scope === 'spotify' ? SPOTIFY_TABS : MEDIA_TABS;
  if (!tabs.some((t) => t.id === tab)) return <Navigate to={libraryPath(scope, 'likes')} replace />;
  const id = tab as TabId;
  const title =
    scope === 'mss' ? 'MSS' : scope === 'yandex' ? 'Яндекс Музыка' : scope === 'spotify' ? 'Spotify' : 'Медиатека';
  return (
    <div>
      <PageTitle title={title} />
      <Tabs scope={scope} />
      {id === 'likes' && <LikesTab scope={scope} />}
      {id === 'history' && (scope === 'mss' || scope === 'media') && <HistoryTab scope={scope} />}
      {id === 'playlists' && <PlaylistsTab scope={scope} />}
      {id === 'uploads' && scope === 'mss' && <UploadsTab />}
      {id === 'downloads' && scope === 'mss' && <DownloadsTab />}
    </div>
  );
}
