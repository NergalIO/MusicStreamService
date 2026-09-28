import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Heart, MoreHorizontal, Pause, Play, SkipBack, SkipForward, ThumbsDown } from 'lucide-react';
import { Fragment, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Artwork } from '@/components/media/Artwork';
import { LyricsView } from '@/components/player/LyricsView';
import { QueueView } from '@/components/player/QueueView';
import { SeekBar } from '@/components/player/SeekBar';
import { SimilarView } from '@/components/player/SimilarView';
import { Visualizer } from '@/components/player/Visualizer';
import { VolumeControl } from '@/components/player/VolumeControl';
import { openTrackMenu } from '@/components/tracks/TrackContextMenu';
import { Button } from '@/components/ui/button';
import { TOP_PLAYER_HEIGHT_CLASS } from '@/components/player/TopPlayer';
import { useDominantColor } from '@/hooks/useDominantColor';
import { trackAlbumPath, trackArtistLinks } from '@/lib/links';
import { dislikeCurrent, skipNext, skipPrev, toggleLike, togglePlay } from '@/lib/player-actions';
import { cn } from '@/lib/utils';
import { useIsLiked } from '@/store/likes-store';
import { usePlaybackStore, type NowPlayingTab } from '@/store/playback-store';
import { usePlayerStore } from '@/store/player-store';
import { useSettingsStore } from '@/store/settings-store';

const TAB_LABEL: Record<NowPlayingTab, string> = { lyrics: 'Текст', queue: 'Очередь', similar: 'Похожие' };

export function NowPlaying() {
  const open = usePlaybackStore((s) => s.nowPlayingOpen);
  const tab = usePlaybackStore((s) => s.nowPlayingTab);
  const setNowPlaying = usePlaybackStore((s) => s.setNowPlaying);
  const playing = usePlaybackStore((s) => s.playing);
  const current = usePlayerStore((s) => s.current);
  const playContext = usePlayerStore((s) => s.context);
  const radio = usePlayerStore((s) => s.radio);
  const liked = useIsLiked(current);
  const visualizer = useSettingsStore((s) => s.visualizer);
  const color = useDominantColor(current?.coverUrl);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNowPlaying(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setNowPlaying]);

  const activeTab = tab ?? 'lyrics';
  const tabs: NowPlayingTab[] = current?.source === 'yandex' ? ['lyrics', 'queue', 'similar'] : ['lyrics', 'queue'];
  const shownTab = tabs.includes(activeTab) ? activeTab : 'lyrics';
  const albumTo = current ? trackAlbumPath(current) : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={cn('overlay-surface theme-dark absolute inset-x-0 bottom-0 z-20 overflow-hidden', TOP_PLAYER_HEIGHT_CLASS)}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        >
          <div className="absolute inset-0 transition-colors duration-700" style={{ backgroundColor: `rgb(${color})` }} />
          {current?.coverUrl && (
            <img
              key={current.coverUrl}
              src={current.coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full scale-125 animate-fade-in object-cover opacity-60 blur-[90px] saturate-150"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/45 to-black/70" />

          <Button
            variant="overlay"
            size="icon"
            aria-label="Свернуть"
            onClick={() => setNowPlaying(false)}
            className="absolute left-5 top-4 z-10 bg-foreground/10 backdrop-blur hover:bg-foreground/20"
          >
            <ChevronDown size={20} />
          </Button>

          {!current ? (
            <div className="relative flex h-full items-center justify-center text-muted">Ничего не играет</div>
          ) : (
            <div className="relative grid h-full grid-cols-1 gap-10 px-12 pb-8 pt-14 lg:grid-cols-[minmax(280px,440px)_1fr]">
              <div className="no-scrollbar flex min-h-0 flex-col justify-center overflow-y-auto">
                <motion.div
                  key={current.uid}
                  className="mx-auto w-full"
                  style={{ maxWidth: 'min(100%, 46vh)' }}
                  initial={{ scale: 0.94, opacity: 0 }}
                  animate={{ scale: playing ? 1 : 0.92, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                >
                  <Artwork
                    src={current.coverUrl?.replace('400x400', '800x800')}
                    className="aspect-square w-full shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
                    rounded="rounded-xl"
                    iconSize={64}
                  />
                </motion.div>

                <div className="mt-7 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold">{current.title}</div>
                    <div className="truncate text-base text-muted">
                      {trackArtistLinks(current).map((a, i) => (
                        <Fragment key={`${a.name}-${i}`}>
                          {i > 0 && ', '}
                          <Link to={a.to} className="hover:text-foreground hover:underline">
                            {a.name}
                          </Link>
                        </Fragment>
                      ))}
                      {current.album && (
                        <>
                          {' — '}
                          {albumTo ? (
                            <Link to={albumTo} className="hover:text-foreground hover:underline">
                              {current.album}
                            </Link>
                          ) : (
                            current.album
                          )}
                        </>
                      )}
                    </div>
                    {playContext?.path && playContext.title && (
                      <Link
                        to={playContext.path}
                        className="mt-1 inline-block truncate text-sm text-muted hover:text-foreground hover:underline"
                      >
                        из «{playContext.title}»
                      </Link>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {radio && current.source === 'yandex' && (
                      <Button variant="overlay" size="icon" aria-label="Не нравится" title="Не нравится" onClick={() => void dislikeCurrent()}>
                        <ThumbsDown size={18} />
                      </Button>
                    )}
                    <Button
                      variant="overlay"
                      size="icon"
                      aria-label={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
                      aria-pressed={liked}
                      title={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
                      onClick={() => void toggleLike(current)}
                    >
                      <Heart size={18} className={cn(liked && 'fill-current')} />
                    </Button>
                    <Button variant="overlay" size="icon" aria-label="Ещё" aria-haspopup="menu" title="Ещё" onClick={(e) => openTrackMenu(e, current)}>
                      <MoreHorizontal size={18} />
                    </Button>
                  </div>
                </div>

                <div className="mt-4">
                  <SeekBar />
                </div>

                <div className="mt-3 flex items-center justify-center gap-8">
                  <Button variant="overlay" size="icon" aria-label="Предыдущий" onClick={skipPrev} className="h-12 w-12 text-foreground/85">
                    <SkipBack size={30} fill="currentColor" />
                  </Button>
                  <Button
                    variant="overlay"
                    size="icon"
                    aria-label={playing ? 'Пауза' : 'Играть'}
                    onClick={togglePlay}
                    className="h-16 w-16 text-foreground motion-reduce:active:scale-100 active:scale-90"
                  >
                    {playing ? <Pause size={44} fill="currentColor" /> : <Play size={44} fill="currentColor" />}
                  </Button>
                  <Button variant="overlay" size="icon" aria-label="Следующий" onClick={skipNext} className="h-12 w-12 text-foreground/85">
                    <SkipForward size={30} fill="currentColor" />
                  </Button>
                </div>

                <VolumeControl className="mx-auto mt-5 [&_button]:text-foreground/70 [&_input]:w-56" />
                {visualizer && <Visualizer active={playing} className="mt-5 h-12 shrink-0 opacity-80" />}
              </div>

              <div className="flex min-h-0 flex-col">
                <div role="tablist" aria-label="Панель плеера" className="mb-4 flex justify-center gap-1 self-center rounded-full bg-background/40 p-1 backdrop-blur">
                  {tabs.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={shownTab === t}
                      onClick={() => setNowPlaying(true, t)}
                      className={cn(
                        'rounded-full px-4 py-1 text-sm font-medium transition-colors',
                        shownTab === t ? 'bg-foreground/20 text-foreground' : 'text-muted hover:text-foreground',
                      )}
                    >
                      {TAB_LABEL[t]}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1">
                  {shownTab === 'lyrics' ? (
                    <LyricsView track={current} />
                  ) : shownTab === 'similar' ? (
                    <SimilarView track={current} />
                  ) : (
                    <QueueView />
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
