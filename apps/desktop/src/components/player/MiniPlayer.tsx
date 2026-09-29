import {
  Heart,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PlayerSnapshot } from '../../../electron/preload/index';
import { Artwork } from '@/components/media/Artwork';
import { Visualizer } from '@/components/player/Visualizer';
import { Range } from '@/components/ui/controls';
import { useApplyAppearance } from '@/lib/appearance';
import { cn } from '@/lib/utils';

const EMPTY: PlayerSnapshot = {
  title: 'Ничего не играет',
  artist: '',
  playing: false,
  hasTrack: false,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  radio: false,
};

const REPEAT_TITLE = { off: 'Повтор выключен', all: 'Повтор списка', one: 'Повтор трека' } as const;
const BUTTON = 32;
const GAP = 4;

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export function MiniPlayer() {
  const [state, setState] = useState<PlayerSnapshot>(EMPTY);
  const [volume, setVolume] = useState(EMPTY.volume);
  const dragging = useRef(false);
  const api = window.electronAPI;
  const { w, h } = useWindowSize();
  useApplyAppearance(state.coverUrl);

  useEffect(
    () =>
      api?.player.onState((s) => {
        setState(s);
        if (!dragging.current) setVolume(s.volume);
      }),
    [api],
  );

  const [spectrum, setSpectrum] = useState<Float32Array | null>(null);
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const off = api?.player.onSpectrum((raw) => {
      setSpectrum(Float32Array.from(raw, (v) => v / 255));
      clearTimeout(idle);
      idle = setTimeout(() => setSpectrum(null), 400);
    });
    return () => {
      off?.();
      clearTimeout(idle);
    };
  }, [api]);

  const changeVolume = (v: number) => {
    const next = Math.max(0, Math.min(1, v));
    setVolume(next);
    setState((s) => ({ ...s, muted: false }));
    api.player.changeVolume({ volume: next });
  };

  const effective = state.muted ? 0 : volume;
  const VolumeIcon = effective === 0 ? VolumeX : effective < 0.33 ? Volume : effective < 0.66 ? Volume1 : Volume2;
  const tall = h >= 220 && h >= w * 0.55;
  const cover = tall ? Math.max(96, Math.min(w - 48, h - 180)) : Math.max(56, Math.min(h - 24, 180));
  const withShuffle = !state.radio;

  // В компактном виде всё в одну строку: считаем, что влезает рядом с обложкой.
  const infoWidth = w - 24 - cover - 12;
  const rowButtons = (n: number) => n * BUTTON + (n - 1) * GAP;
  const modeCount = withShuffle ? 2 : 1;
  const compactModes = infoWidth >= rowButtons(4 + modeCount) + 36;
  const compactSlider = infoWidth - rowButtons(compactModes ? 4 + modeCount : 4) - 40 >= 64;

  const btn =
    'no-drag flex shrink-0 items-center justify-center rounded-full text-foreground/80 transition hover:bg-foreground/10 hover:text-foreground disabled:opacity-30';
  const size = { width: BUTTON, height: BUTTON };

  const shuffleButton = (
    <button
      type="button"
      title={state.shuffle ? 'Не перемешивать' : 'Перемешать'}
      aria-label={state.shuffle ? 'Не перемешивать' : 'Перемешать'}
      aria-pressed={state.shuffle}
      className={cn(btn, state.shuffle && 'text-primary hover:text-primary')}
      style={size}
      disabled={!state.hasTrack}
      onClick={() => api.player.sendCommand('shuffle')}
    >
      <Shuffle size={15} />
    </button>
  );
  const repeatButton = (
    <button
      type="button"
      title={REPEAT_TITLE[state.repeat]}
      aria-label={REPEAT_TITLE[state.repeat]}
      className={cn(btn, state.repeat !== 'off' && 'text-primary hover:text-primary')}
      style={size}
      disabled={!state.hasTrack}
      onClick={() => api.player.sendCommand('repeat')}
    >
      {state.repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
    </button>
  );
  const likeButton = (
    <button
      type="button"
      title="Мне нравится"
      aria-label="Мне нравится"
      aria-pressed={!!state.liked}
      className={btn}
      style={size}
      disabled={!state.hasTrack}
      onClick={() => api.player.sendCommand('like')}
    >
      <Heart size={16} className={cn(state.liked && 'fill-primary text-primary')} />
    </button>
  );
  const transport = (
    <>
      <button type="button" title="Предыдущий" aria-label="Предыдущий" className={btn} style={size} disabled={!state.hasTrack} onClick={() => api.player.sendCommand('prev')}>
        <SkipBack size={16} fill="currentColor" />
      </button>
      <button
        type="button"
        title={state.playing ? 'Пауза' : 'Играть'}
        aria-label={state.playing ? 'Пауза' : 'Играть'}
        className={cn(btn, 'bg-foreground text-background hover:bg-foreground/90 hover:text-background')}
        style={size}
        disabled={!state.hasTrack}
        onClick={() => api.player.sendCommand('toggle')}
      >
        {state.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>
      <button type="button" title="Следующий" aria-label="Следующий" className={btn} style={size} disabled={!state.hasTrack} onClick={() => api.player.sendCommand('next')}>
        <SkipForward size={16} fill="currentColor" />
      </button>
    </>
  );

  const volumeControl = (slider: boolean, className?: string) => (
    <div className={cn('no-drag flex min-w-0 items-center gap-1.5', className)}>
      <button
        type="button"
        title={state.muted ? 'Включить звук' : 'Выключить звук'}
        aria-label={state.muted ? 'Включить звук' : 'Выключить звук'}
        className={btn}
        style={size}
        onClick={() => {
          setState((s) => ({ ...s, muted: !s.muted }));
          api.player.changeVolume({ muted: !state.muted });
        }}
      >
        <VolumeIcon size={16} />
      </button>
      {slider && (
        <Range
          aria-label="Громкость"
          min={0}
          max={1}
          step={0.01}
          value={effective}
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={() => (dragging.current = false)}
          onChange={(e) => changeVolume(Number(e.target.value))}
          className="min-w-[48px] flex-1"
        />
      )}
    </div>
  );

  return (
    <div
      className={cn(
        'drag-region group relative flex h-screen select-none overflow-hidden bg-background p-3',
        tall ? 'flex-col items-center justify-center gap-3 px-5' : 'items-center gap-3',
      )}
      onWheel={(e) => changeVolume(effective + (e.deltaY < 0 ? 0.05 : -0.05))}
    >
      {state.coverUrl && (
        <img
          src={state.coverUrl}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover opacity-40 blur-3xl"
        />
      )}
      <div className="relative shrink-0" style={{ width: cover, height: cover }}>
        <Artwork src={state.coverUrl} className="h-full w-full shadow-artwork" iconSize={Math.round(cover / 3)} />
      </div>

      {tall ? (
        <div className="relative w-full min-w-0 space-y-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2">
              <div className="truncate text-base font-semibold">{state.title}</div>
              {state.ad && (
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-500">
                  реклама
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted">{state.artist}</div>
          </div>
          {/* Боковые колонки одинаковой ширины держат кнопки воспроизведения ровно по центру. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            <div className="flex justify-end">{withShuffle && shuffleButton}</div>
            <div className="flex items-center gap-1">{transport}</div>
            <div className="flex items-center justify-between gap-1">
              {repeatButton}
              {likeButton}
            </div>
          </div>
          {volumeControl(true, 'mx-auto w-full max-w-[280px]')}
        </div>
      ) : (
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2 pr-14">
            <div className="truncate text-sm font-semibold">{state.title}</div>
            {state.ad && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-500">
                реклама
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted">{state.artist}</div>
          <div className="mt-2 flex items-center gap-1">
            {compactModes && withShuffle && shuffleButton}
            {transport}
            {compactModes && repeatButton}
            {likeButton}
            {volumeControl(compactSlider, 'ml-1 flex-1')}
          </div>
        </div>
      )}

      {spectrum && (
        <Visualizer
          bands={spectrum}
          barCount={spectrum.length}
          color="hsl(var(--primary) / 0.55)"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-4"
        />
      )}

      <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" title="Открыть MSS" aria-label="Открыть MSS" className={cn(btn, 'h-7 w-7')} onClick={() => api.player.sendCommand('show')}>
          <Maximize2 size={13} />
        </button>
        <button type="button" title="Закрыть" aria-label="Закрыть мини-плеер" className={cn(btn, 'h-7 w-7')} onClick={() => api.window.closeMini()}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
