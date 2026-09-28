import {
  Heart,
  ListMusic,
  Loader2,
  MessageSquareQuote,
  MoreHorizontal,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { Artwork } from '@/components/media/Artwork';
import { SeekBar } from '@/components/player/SeekBar';
import { WindowControls } from '@/components/layout/WindowControls';
import { SoundSheet } from '@/components/player/SoundSheet';
import { VolumeControl } from '@/components/player/VolumeControl';
import { openTrackMenu } from '@/components/tracks/TrackContextMenu';
import { IconButton } from '@/components/ui/icon-button';
import { formatTime } from '@/lib/format';
import { trackArtistLinks } from '@/lib/links';
import { skipNext, skipPrev, toggleLike, togglePlay } from '@/lib/player-actions';
import { cn } from '@/lib/utils';
import { useIsLiked } from '@/store/likes-store';
import { useLobbyStore } from '@/store/lobby-store';
import { usePlaybackStore } from '@/store/playback-store';
import { usePlayerStore } from '@/store/player-store';

/** Высота верхней панели: строка управления + полоска прогресса. */
export const TOP_PLAYER_HEIGHT_CLASS = 'top-[82px]' as const;

function StreamBadge({ lobbyGuest }: { lobbyGuest?: boolean }) {
  const preview = usePlaybackStore((s) => s.preview);
  const codec = usePlaybackStore((s) => s.codec);
  const bitrate = usePlaybackStore((s) => s.bitrate);
  if (lobbyGuest) {
    return (
      <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
        эфир
      </span>
    );
  }
  if (preview) {
    return (
      <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
        превью
      </span>
    );
  }
  if (!codec) return null;
  const label = codec.toLowerCase().includes('flac') ? 'Lossless' : bitrate ? `${bitrate}` : codec;
  return (
    <span className="rounded bg-foreground/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted">
      {label}
    </span>
  );
}

export function TopPlayer() {
  const lobbyGuest = useLobbyStore((s) => s.role === 'guest');
  const current = usePlayerStore((s) => s.current);
  const context = usePlayerStore((s) => s.context);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const radio = usePlayerStore((s) => s.radio);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const playing = usePlaybackStore((s) => s.playing);
  const loading = usePlaybackStore((s) => s.loading);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const duration = usePlaybackStore((s) => s.duration);
  const nowPlayingOpen = usePlaybackStore((s) => s.nowPlayingOpen);
  const tab = usePlaybackStore((s) => s.nowPlayingTab);
  const setNowPlaying = usePlaybackStore((s) => s.setNowPlaying);
  const liked = useIsLiked(current);
  const [soundOpen, setSoundOpen] = useState(false);
  const hasTrack = !!current;

  const openTab = (t: 'lyrics' | 'queue') => {
    if (nowPlayingOpen && tab === t) setNowPlaying(false);
    else setNowPlaying(true, t);
  };

  return (
    <header className="relative z-30 flex shrink-0 flex-col border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="drag-region grid min-h-[56px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 pl-4 pr-1">
        <div className="no-drag flex items-center gap-1 self-center py-1.5">
          {lobbyGuest ? (
            <span className="px-2 text-xs text-muted">Эфир DJ</span>
          ) : (
            <>
              <IconButton label="Перемешать" active={shuffle} disabled={!!radio} onClick={toggleShuffle}>
                <Shuffle size={16} />
              </IconButton>
              <IconButton label="Предыдущий" disabled={!hasTrack} onClick={skipPrev}>
                <SkipBack size={20} fill="currentColor" />
              </IconButton>
              <IconButton
                label={playing ? 'Пауза' : 'Играть'}
                disabled={!hasTrack}
                onClick={togglePlay}
                className="h-10 w-10 text-foreground"
              >
                {loading && playing ? (
                  <Loader2 size={22} className="animate-spin" />
                ) : playing ? (
                  <Pause size={26} fill="currentColor" />
                ) : (
                  <Play size={26} fill="currentColor" className="ml-0.5" />
                )}
              </IconButton>
              <IconButton label="Следующий" disabled={!hasTrack} onClick={skipNext}>
                <SkipForward size={20} fill="currentColor" />
              </IconButton>
              <IconButton
                label={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}
                active={repeat !== 'off'}
                onClick={cycleRepeat}
              >
                {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </IconButton>
            </>
          )}
        </div>

        <div className="no-drag relative mx-auto flex min-h-12 w-full min-w-0 max-w-[640px] self-center rounded-lg border border-foreground/[0.06] bg-foreground/[0.05]">
          {current ? (
            <>
              <button
                type="button"
                aria-label="Открыть «Сейчас играет»"
                onClick={() => setNowPlaying(!nowPlayingOpen)}
                className="shrink-0 self-stretch"
              >
                <Artwork src={current.coverUrl} className="h-full min-h-12 w-12" rounded="rounded-none" iconSize={16} />
              </button>
              <div className="group relative flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1.5 pl-3 pr-10">
                <div className="flex min-w-0 items-center justify-center gap-2">
                  <span className="truncate text-center text-[13px] font-medium leading-tight">{current.title}</span>
                  <StreamBadge lobbyGuest={lobbyGuest} />
                </div>
                <p className="truncate text-center text-xs leading-snug text-muted">
                  {trackArtistLinks(current).map((a, i) => (
                    <Fragment key={`${a.name}-${i}`}>
                      {i > 0 && ', '}
                      <Link to={a.to} className="hover:text-foreground hover:underline">
                        {a.name}
                      </Link>
                    </Fragment>
                  ))}
                  {current.album && <span> — {current.album}</span>}
                  {context?.path && context.title && (
                    <>
                      {' · '}
                      <Link
                        to={context.path}
                        className="hover:text-foreground hover:underline"
                        title={`Источник: ${context.title}`}
                      >
                        из «{context.title}»
                      </Link>
                    </>
                  )}
                </p>
                <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <IconButton label="Ещё" onClick={(e) => openTrackMenu(e, current)}>
                    <MoreHorizontal size={16} />
                  </IconButton>
                </div>
              </div>
              <IconButton
                label={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
                active={liked}
                onClick={() => void toggleLike(current)}
                className="mr-2 self-center"
              >
                <Heart size={16} className={cn(liked && 'fill-current')} />
              </IconButton>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center gap-2 py-3 text-sm text-muted">
              <img src="/icon.png" alt="" className="h-5 w-5 rounded opacity-60" />
              MusicStreamService
            </div>
          )}
        </div>

        <div className="no-drag flex items-center gap-1 self-center py-1.5">
          <IconButton
            label="Текст"
            active={nowPlayingOpen && tab === 'lyrics'}
            disabled={!hasTrack}
            onClick={() => openTab('lyrics')}
          >
            <MessageSquareQuote size={17} />
          </IconButton>
          {!lobbyGuest && (
            <IconButton label="Очередь" active={nowPlayingOpen && tab === 'queue'} onClick={() => openTab('queue')}>
              <ListMusic size={17} />
            </IconButton>
          )}
          <IconButton label="Звук" onClick={() => setSoundOpen(true)}>
            <SlidersHorizontal size={16} />
          </IconButton>
          <IconButton label="Мини-плеер" onClick={() => window.electronAPI?.window.toggleMini()}>
            <PictureInPicture2 size={16} />
          </IconButton>
          <VolumeControl className="ml-2 hidden lg:flex" />
          <WindowControls className="-ml-1" />
        </div>
      </div>

      <div className="no-drag w-full shrink-0 border-t border-border/60 px-4 pb-2 pt-1.5">
        <SeekBar
          variant="lcd"
          readOnly={lobbyGuest}
          className={cn('w-full', !hasTrack && 'pointer-events-none opacity-40')}
        />
        {lobbyGuest && hasTrack && duration > 0 && (
          <div className="mt-0.5 flex justify-between text-[11px] tabular-nums text-muted">
            <span>{formatTime(currentTime)}</span>
            <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
          </div>
        )}
      </div>

      <SoundSheet open={soundOpen} onClose={() => setSoundOpen(false)} />
    </header>
  );
}
