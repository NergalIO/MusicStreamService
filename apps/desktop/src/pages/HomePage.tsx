import type { FeedBlock, FeedItem, HomeFeedItem, StatsTopArtist, StatsTopTrack, UnifiedTrack } from '@mss/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Radio } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { CardRowSkeleton, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { Carousel, Shelf } from '@/components/media/Carousel';
import { MediaCard } from '@/components/media/MediaCard';
import { trackMenuGroups } from '@/components/tracks/TrackContextMenu';
import { TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { artistPath } from '@/lib/artists';
import { connectSource, useSpotifyConnected, useVkConnected, useYandexConnected } from '@/lib/connectors';
import { greeting } from '@/lib/format';
import { albumMenu, artistMenu, loadAlbumTracks, loadPlaylistTracks, playlistMenu } from '@/lib/card-menus';
import { statsArtistGroup, statsTrackToUnified, useShelves } from '@/lib/stats';
import { albumLink, playlistPath } from '@/lib/links';
import { playCollection, startWave, togglePlay } from '@/lib/player-actions';
import { libraryPath, MSS_HOME, SPOTIFY_HOME, SPOTIFY_WEB, YANDEX_HOME } from '@/lib/service-routes';
import {
  useLocalTracks,
  useMssListenNow,
  useSpotifyPlaylists,
  useVkPlaylists,
  useYandexChart,
  useYandexFeed,
  useYandexPlaylists,
} from '@/lib/queries';
import type { QueueItem } from '@/store/player-store';
import { usePlaybackStore } from '@/store/playback-store';
import { usePlayerStore, type PlayContext } from '@/store/player-store';

function WaveHero() {
  const radio = usePlayerStore((s) => s.radio);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlaybackStore((s) => s.playing);
  const active = !!radio;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.06] bg-gradient-to-br from-primary/40 via-primary/15 to-card p-7">
      <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-primary/40 blur-3xl motion-reduce:blur-none" />
      <div className="pointer-events-none absolute -bottom-24 right-40 h-60 w-60 rounded-full bg-primary/25 blur-3xl motion-reduce:blur-none" />
      <div className="relative flex items-center gap-6">
        <button
          type="button"
          onClick={() => (active ? togglePlay() : void startWave())}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-xl transition-transform hover:scale-105"
          aria-label="Моя волна"
        >
          {active && playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground/70">
            <Radio size={13} /> Моя волна
          </div>
          <div className="mt-1 truncate text-2xl font-bold tracking-tight">
            {active && current ? `${current.title} — ${current.artist}` : 'Музыка, которая подстраивается под вас'}
          </div>
        </div>
        <Link to="/wave" className="hidden text-sm font-medium text-foreground/80 hover:text-foreground md:block">
          Настроить
        </Link>
      </div>
    </div>
  );
}

function ConnectYandexCard() {
  const queryClient = useQueryClient();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
      <div>
        <div className="text-lg font-semibold">Подключите Яндекс Музыку</div>
        <p className="mt-1 text-sm text-muted">Моя волна, ваши плейлисты, лайки и тексты песен — прямо в MSS.</p>
      </div>
      <Button onClick={() => void connectSource('yandex', queryClient)}>Подключить</Button>
    </div>
  );
}

function feedCard(item: FeedItem) {
  switch (item.kind) {
    case 'album':
      return (
        <MediaCard
          title={item.album.title}
          subtitle={[item.album.artist, item.album.year].filter(Boolean).join(' · ')}
          coverUrl={item.album.coverUrl}
          to={albumLink(item.album)}
          menu={() => albumMenu(item.album)}
          onPlay={async () => {
            const album = await window.electronAPI.yandex.album(item.album.id);
            playCollection(album.tracks, { type: 'album', title: album.title, path: albumLink(album) });
          }}
        />
      );
    case 'playlist':
      return (
        <MediaCard
          title={item.playlist.title}
          subtitle={item.playlist.description || item.playlist.owner}
          coverUrl={item.playlist.coverUrl}
          to={playlistPath(item.playlist)}
          menu={() => playlistMenu(item.playlist)}
          onPlay={async () => {
            const p = await window.electronAPI.yandex.playlist(item.playlist.id);
            playCollection(p.tracks, { type: 'playlist', title: p.title, path: playlistPath(p) });
          }}
        />
      );
    case 'track':
      return (
        <MediaCard
          title={item.track.title}
          subtitle={item.track.artist}
          coverUrl={item.track.coverUrl}
          onPlay={() => usePlayerStore.getState().playTrack(item.track)}
        />
      );
  }
}

function FeedShelf({ block }: { block: FeedBlock }) {
  const cards = block.items.filter((i) => i.kind !== 'track');
  if (!cards.length) return null;
  return (
    <Shelf title={block.title}>
      <Carousel>{cards.map((item) => feedCard(item))}</Carousel>
    </Shelf>
  );
}

function RecentShelf() {
  const history = usePlayerStore((s) => s.history);
  if (!history.length) return null;
  const context: PlayContext = { type: 'history', title: 'Недавно играли', path: libraryPath('media', 'history') };
  const recent = history.slice(0, 20);
  return (
    <Shelf title="Недавно играли" subtitle="Полная история — в медиатеке" moreTo={libraryPath('media', 'history')}>
      <Carousel itemClassName="w-[148px]">
        {recent.map((t, i) => (
          <MediaCard
            key={t.uid}
            title={t.title}
            subtitle={t.artist}
            coverUrl={t.coverUrl}
            onPlay={() => usePlayerStore.getState().playList(recent, i, context)}
          />
        ))}
      </Carousel>
    </Shelf>
  );
}

function StatsTrackShelf({ title, subtitle, items }: { title: string; subtitle?: string; items: StatsTopTrack[] }) {
  if (items.length < 3) return null;
  const tracks = items.map(statsTrackToUnified);
  const context: PlayContext = { type: 'other', title };
  return (
    <Shelf title={title} subtitle={subtitle} moreTo="/stats">
      <Carousel itemClassName="w-[148px]">
        {tracks.map((t, i) => (
          <MediaCard
            key={`${t.source}:${t.id}`}
            title={t.title}
            subtitle={t.artist}
            coverUrl={t.coverUrl}
            menu={() => ({ title: `${t.title} · ${t.artist}`, groups: trackMenuGroups(t) })}
            onPlay={() => usePlayerStore.getState().playList(tracks, i, context)}
          />
        ))}
      </Carousel>
    </Shelf>
  );
}

function MixesShelf({ artists }: { artists: StatsTopArtist[] }) {
  const mixes = artists.filter((a) => a.source === 'yandex' && a.id).slice(0, 10);
  if (mixes.length < 2) return null;
  return (
    <Shelf title="Ваши миксы" subtitle="Волны по исполнителям, которых вы слушаете чаще всего">
      <Carousel itemClassName="w-[148px]">
        {mixes.map((a) => {
          const group = statsArtistGroup(a);
          return (
            <MediaCard
              key={group.key}
              title={`Микс: ${a.name}`}
              subtitle="Волна по исполнителю"
              coverUrl={a.coverUrl ?? undefined}
              badge={
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background/50 text-foreground backdrop-blur">
                  <Radio size={13} />
                </span>
              }
              to={artistPath(group.name, group.refs)}
              menu={() => artistMenu(group)}
              onPlay={() => startWave({ seed: `artist:${a.id}`, seedTitle: a.name })}
            />
          );
        })}
      </Carousel>
    </Shelf>
  );
}

function PersonalShelves({ yandex }: { yandex: boolean }) {
  const { data } = useShelves();
  if (!data) return null;
  return (
    <>
      <StatsTrackShelf title="Часто слушаете" subtitle="Ваши треки за последний месяц" items={data.frequent} />
      {yandex && <MixesShelf artists={data.topArtists} />}
      <StatsTrackShelf title="Давно не слушали" subtitle="Любимое, что вы не включали больше полутора месяцев" items={data.forgotten} />
    </>
  );
}

function ChartGrid({ tracks, context }: { tracks: UnifiedTrack[]; context: PlayContext }) {
  return <TrackList tracks={tracks.slice(0, 10)} context={context} showSource={false} />;
}

export function MssHomePage() {
  const listenNow = useMssListenNow(30);
  const local = useLocalTracks(20);
  const localContext: PlayContext = { type: 'library', title: 'Новое в MSS', path: libraryPath('media', 'uploads') };
  const listenContext: PlayContext = { type: 'other', title: 'Слушать сейчас', path: MSS_HOME };

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold tracking-tight">{greeting()}</h1>

      {listenNow.isError && (
        <ErrorState
          className="py-8"
          title="Не удалось загрузить подборку"
          error={listenNow.error}
          onRetry={() => listenNow.refetch()}
        />
      )}

      {!listenNow.isError && (
        <>
          {listenNow.isLoading ? (
            <div className="h-32 animate-pulse rounded-2xl bg-foreground/[0.06]" />
          ) : (
            <ListenNowHero
              tracks={listenNow.tracks}
              homePath={MSS_HOME}
              idleSubtitle="То, что вы слушаете чаще всего, и свежие треки из библиотеки"
              trackInMix={(current) =>
                !!current && listenNow.tracks.some((t) => t.source === current.source && t.id === current.id)
              }
            />
          )}
          <Shelf title="Слушать сейчас" subtitle="Частое, недавнее и новое в MSS">
            {listenNow.isLoading ? (
              <TrackListSkeleton rows={8} />
            ) : (
              <TrackList
                tracks={listenNow.tracks}
                context={listenContext}
                showSource
                emptyText="Включите несколько треков — подборка соберётся из вашей статистики"
              />
            )}
          </Shelf>
        </>
      )}

      <RecentShelf />
      <PersonalShelves yandex={false} />
      <Shelf title="Новое в MSS" subtitle="Последние загрузки во внутреннюю библиотеку">
        {local.isError ? (
          <ErrorState className="py-8" title="Сервер MSS недоступен" error={local.error} onRetry={() => void local.refetch()} />
        ) : local.isLoading ? (
          <TrackListSkeleton rows={5} />
        ) : (
          <TrackList tracks={local.data ?? []} context={localContext} showSource={false} emptyText="В библиотеке пока нет треков" />
        )}
      </Shelf>
    </div>
  );
}

export function YandexHomePage() {
  const yandex = useYandexConnected();
  const feed = useYandexFeed();
  const chart = useYandexChart();
  const playlists = useYandexPlaylists();
  const chartContext: PlayContext = { type: 'chart', title: 'Чарт Яндекс Музыки', path: YANDEX_HOME };

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold tracking-tight">Яндекс Музыка</h1>

      {yandex ? <WaveHero /> : <ConnectYandexCard />}

      {yandex && <PersonalShelves yandex />}

      {yandex && (playlists.isLoading || (playlists.data?.length ?? 0) > 0) && (
        <Shelf title="Ваши плейлисты" moreTo={libraryPath('yandex', 'playlists')}>
          {playlists.isLoading ? (
            <CardRowSkeleton />
          ) : (
            <Carousel>
              {(playlists.data ?? []).map((p) => (
                <MediaCard
                  key={p.id}
                  title={p.title}
                  subtitle={p.trackCount !== undefined ? `${p.trackCount} треков` : p.owner}
                  coverUrl={p.coverUrl}
                  to={playlistPath(p)}
                  menu={() => playlistMenu(p)}
                  onPlay={async () => {
                    const full = await window.electronAPI.yandex.playlist(p.id);
                    playCollection(full.tracks, { type: 'playlist', title: full.title, path: playlistPath(p) });
                  }}
                />
              ))}
            </Carousel>
          )}
        </Shelf>
      )}

      {yandex && feed.isLoading && <CardRowSkeleton />}
      {yandex && feed.isError && (
        <ErrorState className="py-8" title="Не удалось загрузить подборки Яндекса" error={feed.error} onRetry={() => void feed.refetch()} />
      )}
      {yandex && (feed.data ?? []).map((block) => <FeedShelf key={block.id} block={block} />)}

      {yandex && (chart.isLoading || (chart.data?.length ?? 0) > 0) && (
        <Shelf title="Чарт" subtitle="Самое популярное в Яндекс Музыке">
          {chart.isLoading ? (
            <TrackListSkeleton rows={5} />
          ) : (
            <ChartGrid tracks={chart.data ?? []} context={chartContext} />
          )}
        </Shelf>
      )}
    </div>
  );
}

function ListenNowHero({
  tracks,
  homePath,
  idleSubtitle,
  trackInMix,
}: {
  tracks: UnifiedTrack[];
  homePath: string;
  idleSubtitle: string;
  trackInMix: (current: QueueItem | null) => boolean;
}) {
  const current = usePlayerStore((s) => s.current);
  const playing = usePlaybackStore((s) => s.playing);
  const context: PlayContext = { type: 'other', title: 'Слушать сейчас', path: homePath };
  const active = trackInMix(current);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.06] bg-gradient-to-br from-primary/40 via-primary/15 to-card p-7">
      <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-primary/40 blur-3xl motion-reduce:blur-none" />
      <div className="relative flex items-center gap-6">
        <button
          type="button"
          onClick={() => (active ? togglePlay() : tracks.length && playCollection(tracks, context, false))}
          disabled={!tracks.length}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-xl transition-transform hover:scale-105 disabled:opacity-40"
          aria-label="Слушать сейчас"
        >
          {active && playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Слушать сейчас</div>
          <div className="mt-1 truncate text-2xl font-bold tracking-tight">
            {active && current
              ? `${current.title} — ${current.artist}`
              : tracks.length
                ? idleSubtitle
                : 'Загружаем подборку…'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function VkHomePage() {
  const vk = useVkConnected();
  const queryClient = useQueryClient();
  const playlists = useVkPlaylists();
  const home = useQuery({
    queryKey: ['vk', 'home'],
    queryFn: () => window.electronAPI.connectors.homeTracks('vk', 40),
    enabled: vk,
    staleTime: 2 * 60_000,
  });
  const context: PlayContext = { type: 'library', title: 'Моя музыка VK', path: libraryPath('vk', 'likes') };

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold tracking-tight">VK Музыка</h1>
      {vk ? null : (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <div className="text-lg font-semibold">Подключите VK</div>
            <p className="mt-1 text-sm text-muted">Моя музыка, плейлисты и поиск — токен остаётся только на этом устройстве.</p>
          </div>
          <Button onClick={() => void connectSource('vk', queryClient)}>Подключить</Button>
        </div>
      )}
      {vk && (
        <>
          <Shelf title="Моя музыка" moreTo={libraryPath('vk', 'likes')}>
            {home.isError ? (
              <ErrorState className="py-8" error={home.error} onRetry={() => void home.refetch()} />
            ) : home.isLoading ? (
              <TrackListSkeleton rows={8} />
            ) : (
              <TrackList tracks={home.data ?? []} context={context} emptyText="В «Моей музыке» пока пусто" />
            )}
          </Shelf>
          {(playlists.isLoading || (playlists.data?.length ?? 0) > 0) && (
            <Shelf title="Ваши плейлисты" moreTo={libraryPath('vk', 'playlists')}>
              {playlists.isLoading ? (
                <CardRowSkeleton />
              ) : (
                <Carousel>
                  {(playlists.data ?? []).map((p) => (
                    <MediaCard
                      key={p.id}
                      title={p.title}
                      subtitle={p.trackCount !== undefined ? `${p.trackCount} треков` : p.owner}
                      coverUrl={p.coverUrl}
                      to={playlistPath(p)}
                      menu={() => playlistMenu(p)}
                      onPlay={async () => {
                        const full = await window.electronAPI.connectors.getPlaylist('vk', p.id);
                        playCollection(full.tracks, { type: 'playlist', title: full.title, path: playlistPath(p) });
                      }}
                    />
                  ))}
                </Carousel>
              )}
            </Shelf>
          )}
        </>
      )}
    </div>
  );
}

function spotifyFeedCard(item: HomeFeedItem) {
  switch (item.kind) {
    case 'album':
      return (
        <MediaCard
          key={`a:${item.album.id}`}
          title={item.album.title}
          subtitle={item.album.artist}
          coverUrl={item.album.coverUrl}
          to={albumLink(item.album)}
          menu={() => albumMenu(item.album)}
          onPlay={async () => {
            const tracks = await loadAlbumTracks(item.album.id, 'spotify');
            playCollection(tracks, { type: 'album', title: item.album.title, path: albumLink(item.album) });
          }}
        />
      );
    case 'playlist':
      return (
        <MediaCard
          key={`p:${item.playlist.id}`}
          title={item.playlist.title}
          subtitle={item.playlist.description || item.playlist.owner}
          coverUrl={item.playlist.coverUrl}
          to={playlistPath(item.playlist)}
          menu={() => playlistMenu(item.playlist)}
          onPlay={async () => {
            const tracks = await loadPlaylistTracks(item.playlist);
            playCollection(tracks, { type: 'playlist', title: item.playlist.title, path: playlistPath(item.playlist) });
          }}
        />
      );
    case 'artist':
      return (
        <MediaCard
          key={`r:${item.artist.id}`}
          shape="circle"
          title={item.artist.name}
          subtitle="Исполнитель"
          coverUrl={item.artist.imageUrl}
          to={artistPath(item.artist.name, { spotify: item.artist })}
        />
      );
  }
}

export function SpotifyHomePage() {
  const spotify = useSpotifyConnected();
  const navigate = useNavigate();
  const playlists = useSpotifyPlaylists();
  const home = useQuery({
    queryKey: ['spotify', 'home'],
    queryFn: () => window.electronAPI.connectors.homeTracks('spotify', 40),
    enabled: spotify,
    staleTime: 2 * 60_000,
  });
  const feed = useQuery({
    queryKey: ['spotify', 'home-feed'],
    queryFn: () => window.electronAPI.connectors.homeFeed('spotify'),
    enabled: spotify,
    staleTime: 10 * 60_000,
  });
  const pick = feed.data?.flatMap((s) => s.items).find((i) => i.kind === 'playlist');
  const pickPlaylist = pick?.kind === 'playlist' ? pick.playlist : null;
  const picks = useQuery({
    queryKey: ['spotify', 'playlist', pickPlaylist?.id],
    queryFn: () => window.electronAPI.connectors.getPlaylist('spotify', pickPlaylist!.id),
    enabled: !!pickPlaylist,
    staleTime: 10 * 60_000,
  });
  const context: PlayContext = { type: 'library', title: 'Spotify', path: SPOTIFY_HOME };

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Spotify</h1>
        <Link to={SPOTIFY_WEB} className="text-sm font-medium text-muted hover:text-foreground">
          Веб-плеер
        </Link>
      </div>
      {spotify ? null : (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <div className="text-lg font-semibold">Войдите в Spotify</div>
            <p className="mt-1 text-sm text-muted">
              Вход во встроенном веб-плеере. После этого треки, плейлисты и управление — прямо в MSS, звук идёт через веб-плеер.
            </p>
          </div>
          <Button onClick={() => navigate(SPOTIFY_WEB)}>Открыть веб-плеер</Button>
        </div>
      )}
      {spotify && (
        <>
          {pickPlaylist && (
            <Shelf title={`Треки для вас · ${pickPlaylist.title}`} moreTo={playlistPath(pickPlaylist)}>
              {picks.isError ? (
                <ErrorState className="py-8" error={picks.error} onRetry={() => void picks.refetch()} />
              ) : picks.isLoading ? (
                <TrackListSkeleton rows={8} />
              ) : (
                <TrackList
                  tracks={(picks.data?.tracks ?? []).slice(0, 10)}
                  context={{ type: 'playlist', title: pickPlaylist.title, path: playlistPath(pickPlaylist) }}
                />
              )}
            </Shelf>
          )}
          {feed.isError ? (
            <ErrorState className="py-8" title="Не удалось загрузить главную Spotify" error={feed.error} onRetry={() => void feed.refetch()} />
          ) : feed.isLoading ? (
            <CardRowSkeleton />
          ) : (
            (feed.data ?? []).map((section) => (
              <Shelf key={section.id} title={section.title}>
                <Carousel itemClassName={section.items.every((i) => i.kind === 'artist') ? 'w-[148px]' : undefined}>
                  {section.items.map((item) => spotifyFeedCard(item))}
                </Carousel>
              </Shelf>
            ))
          )}
          <Shelf title="Любимые треки" moreTo={libraryPath('spotify', 'likes')}>
            {home.isError ? (
              <ErrorState className="py-8" error={home.error} onRetry={() => void home.refetch()} />
            ) : home.isLoading ? (
              <TrackListSkeleton rows={8} />
            ) : (
              <TrackList tracks={home.data ?? []} context={context} emptyText="Отметьте треки сердечком — они появятся здесь" />
            )}
          </Shelf>
          {(playlists.isLoading || (playlists.data?.length ?? 0) > 0) && (
            <Shelf title="Ваши плейлисты" moreTo={libraryPath('spotify', 'playlists')}>
              {playlists.isLoading ? (
                <CardRowSkeleton />
              ) : (
                <Carousel>
                  {(playlists.data ?? []).map((p) => (
                    <MediaCard
                      key={p.id}
                      title={p.title}
                      subtitle={p.trackCount !== undefined ? `${p.trackCount} треков` : p.owner}
                      coverUrl={p.coverUrl}
                      to={playlistPath(p)}
                      menu={() => playlistMenu(p)}
                      onPlay={async () => {
                        const full = await window.electronAPI.connectors.getPlaylist('spotify', p.id);
                        playCollection(full.tracks, { type: 'playlist', title: full.title, path: playlistPath(p) });
                      }}
                    />
                  ))}
                </Carousel>
              )}
            </Shelf>
          )}
        </>
      )}
    </div>
  );
}

export function HomePage() {
  return <MssHomePage />;
}

