import type { FeedBlock, FeedItem, StatsTopArtist, StatsTopTrack, UnifiedTrack } from '@mss/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CardRowSkeleton, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { Carousel, Shelf } from '@/components/media/Carousel';
import { MediaCard } from '@/components/media/MediaCard';
import { trackMenuGroups } from '@/components/tracks/TrackContextMenu';
import { TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { SpotifyReconnectButton } from '@/components/connectors/SpotifyReconnectButton';
import { ErrorState } from '@/components/ui/states';
import { artistPath } from '@/lib/artists';
import { connectSource, useSpotifyAvailable, useSpotifyConnected, useYandexConnected } from '@/lib/connectors';
import { greeting } from '@/lib/format';
import { albumMenu, artistMenu, playlistMenu } from '@/lib/card-menus';
import { statsArtistGroup, statsTrackToUnified, useShelves } from '@/lib/stats';
import { albumLink, playlistPath } from '@/lib/links';
import { playCollection, startWave, togglePlay } from '@/lib/player-actions';
import { libraryPath, YANDEX_HOME } from '@/lib/service-routes';
import {
  useLocalTracks,
  useSpotifyPlaylists,
  useSpotifySavedTracks,
  useYandexChart,
  useYandexFeed,
  useYandexPlaylists,
} from '@/lib/queries';
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
  const context: PlayContext = { type: 'history', title: 'Недавно играли', path: libraryPath('mss', 'history') };
  const recent = history.slice(0, 20);
  return (
    <Shelf title="Недавно играли" subtitle="Полная история — в библиотеке MSS" moreTo={libraryPath('mss', 'history')}>
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
  const local = useLocalTracks(20);
  const localContext: PlayContext = { type: 'library', title: 'Новое в MSS', path: libraryPath('mss', 'uploads') };

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold tracking-tight">{greeting()}</h1>
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

function ConnectSpotifyCard() {
  const queryClient = useQueryClient();
  const available = useSpotifyAvailable();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
      <div>
        <div className="text-lg font-semibold">Подключите Spotify</div>
        <p className="mt-1 text-sm text-muted">
          {available
            ? 'Сохранённые треки и плейлисты из вашего аккаунта Spotify.'
            : import.meta.env.DEV
              ? 'Добавьте SPOTIFY_CLIENT_ID в корневой .env и перезапустите pnpm dev:desktop.'
              : 'Установите свежий .exe с GitHub Releases (CI) или положите SPOTIFY_CLIENT_ID в .env рядом с программой.'}
        </p>
      </div>
      {available && <Button onClick={() => void connectSource('spotify', queryClient)}>Подключить</Button>}
    </div>
  );
}

export function SpotifyHomePage() {
  const spotify = useSpotifyConnected();
  const playlists = useSpotifyPlaylists();
  const saved = useSpotifySavedTracks(20);
  const savedContext: PlayContext = { type: 'likes', title: 'Сохранённые треки', path: libraryPath('spotify', 'likes') };

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold tracking-tight">Spotify</h1>

      {spotify ? null : <ConnectSpotifyCard />}

      {spotify && (
        <Shelf title="Ваши плейлисты" moreTo={libraryPath('spotify', 'playlists')}>
          {playlists.isError ? (
            <ErrorState
              className="py-8"
              title="Не удалось загрузить плейлисты"
              error={playlists.error}
              action={<SpotifyReconnectButton error={playlists.error} />}
              onRetry={() => void playlists.refetch()}
            />
          ) : playlists.isLoading ? (
            <CardRowSkeleton />
          ) : !(playlists.data?.length ?? 0) ? (
            <p className="text-sm text-muted">Плейлистов пока нет или они недоступны для этого аккаунта.</p>
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

      {spotify && (
        <Shelf title="Сохранённые треки" moreTo={libraryPath('spotify', 'likes')}>
          {saved.isError ? (
            <ErrorState
              className="py-8"
              title="Не удалось загрузить сохранённые треки"
              error={saved.error}
              action={<SpotifyReconnectButton error={saved.error} />}
              onRetry={() => void saved.refetch()}
            />
          ) : saved.isLoading ? (
            <TrackListSkeleton rows={5} />
          ) : (
            <TrackList
              tracks={saved.data ?? []}
              context={savedContext}
              showSource={false}
              emptyText="В Spotify пока нет сохранённых треков"
            />
          )}
        </Shelf>
      )}
    </div>
  );
}

export function HomePage() {
  return <MssHomePage />;
}
