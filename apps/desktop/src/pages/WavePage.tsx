import type { WaveSettings } from '@mss/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Pause, Play, SkipForward, ThumbsDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Artwork } from '@/components/media/Artwork';
import { Button } from '@/components/ui/button';
import { useCoverPalette, WAVE_IDLE_PALETTE, type CoverPalette } from '@/hooks/useDominantColor';
import { useWaveAudioReactive } from '@/hooks/useWaveAudioReactive';
import { useYandexConnected } from '@/lib/connectors';
import { dislikeCurrent, skipNext, startWave, togglePlay } from '@/lib/player-actions';
import { cn } from '@/lib/utils';
import { usePlaybackStore } from '@/store/playback-store';
import { upcomingTracks, usePlayerStore } from '@/store/player-store';

type Option = { value: string | undefined; label: string };

const GROUPS: { key: keyof WaveSettings; title: string; options: Option[] }[] = [
  {
    key: 'diversity',
    title: 'Характер',
    options: [
      { value: undefined, label: 'Любой' },
      { value: 'favorite', label: 'Любимое' },
      { value: 'discover', label: 'Незнакомое' },
      { value: 'popular', label: 'Популярное' },
    ],
  },
  {
    key: 'moodEnergy',
    title: 'Настроение',
    options: [
      { value: undefined, label: 'Любое' },
      { value: 'active', label: 'Бодрое' },
      { value: 'fun', label: 'Весёлое' },
      { value: 'calm', label: 'Спокойное' },
      { value: 'sad', label: 'Грустное' },
    ],
  },
  {
    key: 'language',
    title: 'Язык',
    options: [
      { value: undefined, label: 'Любой' },
      { value: 'russian', label: 'Русский' },
      { value: 'not-russian', label: 'Иностранный' },
      { value: 'without-words', label: 'Без слов' },
    ],
  },
];

function boostPalette(p: CoverPalette, k = 1.32): CoverPalette {
  const boost = (s: string) => {
    const [r, g, b] = s.split(' ').map(Number);
    return `${Math.min(255, Math.round(r * k))} ${Math.min(255, Math.round(g * k))} ${Math.min(255, Math.round(b * k))}`;
  };
  return { a: boost(p.a), b: boost(p.b), c: boost(p.c) };
}

function WaveBackdropVisual({ palette, coverUrl, colorKey }: { palette: CoverPalette; coverUrl?: string; colorKey: string }) {
  return (
    <div key={colorKey} className="absolute inset-0 overflow-hidden">
      <AnimatePresence mode="wait">
        {coverUrl && (
          <motion.img
            key={coverUrl}
            src={coverUrl.replace('400x400', '800x800')}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.72 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="absolute inset-0 h-full w-full scale-[1.35] object-cover blur-[72px] saturate-[1.65] motion-reduce:blur-2xl"
          />
        )}
      </AnimatePresence>
      <div
        className="wave-blob wave-drift-a absolute -left-[25%] -top-[35%] h-[95%] w-[80%] rounded-full blur-[90px] motion-reduce:blur-3xl"
        style={{ background: `rgb(${palette.a})` }}
      />
      <div
        className="wave-blob wave-blob-mid wave-drift-b absolute -right-[20%] top-[0%] h-[90%] w-[75%] rounded-full blur-[90px] motion-reduce:blur-3xl"
        style={{ background: `rgb(${palette.b})` }}
      />
      <div
        className="wave-blob wave-blob-high wave-drift-c absolute -bottom-[35%] left-[5%] h-[85%] w-[85%] rounded-full blur-[100px] motion-reduce:blur-3xl"
        style={{ background: `rgb(${palette.c})` }}
      />
      <div
        className="absolute inset-0 mix-blend-screen motion-reduce:mix-blend-normal"
        style={{
          background: `linear-gradient(125deg, rgb(${palette.a} / 0.65) 0%, rgb(${palette.c} / 0.15) 35%, rgb(${palette.b} / 0.55) 68%, rgb(${palette.a} / 0.35) 100%)`,
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,rgb(255_255_255/0.08),transparent_55%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/5 via-background/35 to-background/88" />
    </div>
  );
}

function WavePageShell({
  children,
  palette,
  coverUrl,
  colorKey,
  audioReactive,
}: {
  children: ReactNode;
  palette: CoverPalette;
  coverUrl?: string;
  colorKey: string;
  audioReactive: boolean;
}) {
  const audioRef = useWaveAudioReactive(audioReactive);
  const boosted = useMemo(() => boostPalette(palette), [palette]);

  return (
    <div
      ref={audioRef}
      className="wave-audio-root relative overflow-hidden rounded-2xl border border-foreground/10 px-6 pb-8 pt-6 md:px-8"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <WaveBackdropVisual palette={boosted} coverUrl={coverUrl} colorKey={colorKey} />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function WaveOrb({ active, palette }: { active: boolean; palette: CoverPalette }) {
  const boosted = useMemo(() => boostPalette(palette), [palette]);

  return (
    <div className="relative h-64 w-64 md:h-72 md:w-72">
      <div
        className={cn('wave-blob wave-drift-a absolute inset-[-10%] rounded-full blur-3xl motion-reduce:blur-xl', !active && 'opacity-80')}
        style={{ background: `rgb(${boosted.a})` }}
      />
      <div
        className={cn(
          'wave-blob wave-blob-mid wave-drift-b absolute inset-[-6%] rounded-full blur-3xl motion-reduce:blur-xl',
          !active && 'opacity-75',
        )}
        style={{ background: `rgb(${boosted.b})` }}
      />
      <div
        className={cn(
          'wave-blob wave-blob-high wave-drift-c absolute inset-[-4%] rounded-full blur-2xl motion-reduce:blur-lg',
          !active && 'opacity-70',
        )}
        style={{ background: `rgb(${boosted.c})` }}
      />
      <motion.div
        className={cn('absolute inset-[10%] rounded-full motion-reduce:animate-none', active && 'animate-[spin_20s_linear_infinite]')}
        style={{
          background: `conic-gradient(from 200deg, rgb(${boosted.a}), rgb(${boosted.b}), rgb(${boosted.c}), rgb(${boosted.a}))`,
        }}
      />
      <div className="absolute inset-[18%] rounded-full border border-foreground/15 bg-background/20 shadow-[inset_0_0_48px_rgb(255_255_255/0.12)] backdrop-blur-2xl" />
    </div>
  );
}

export function WavePanel() {
  const connected = useYandexConnected();
  const player = usePlayerStore();
  const { radio, current } = player;
  const upcoming = upcomingTracks(player).slice(0, 8);
  const playing = usePlaybackStore((s) => s.playing);
  const [settings, setSettings] = useState<WaveSettings>(() => radio?.settings ?? {});
  const [starting, setStarting] = useState(false);
  const waveActive = !!radio;
  const palette = useCoverPalette(waveActive ? current?.coverUrl : undefined, WAVE_IDLE_PALETTE);
  const colorKey = current?.coverUrl ?? 'wave-idle';
  const audioReactive = waveActive && playing;

  if (!connected) return null;

  const start = async (next: WaveSettings) => {
    setStarting(true);
    await startWave(next);
    setStarting(false);
  };

  const choose = (key: keyof WaveSettings, value: string | undefined) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (waveActive) void start(next);
  };

  return (
    <WavePageShell
      palette={palette}
      coverUrl={waveActive ? current?.coverUrl : undefined}
      colorKey={colorKey}
      audioReactive={audioReactive}
    >
      <div className="space-y-10">
        <section className="flex flex-col items-center gap-8 md:flex-row md:items-center">
          <button
            type="button"
            disabled={starting}
            onClick={() => (waveActive ? togglePlay() : void start(settings))}
            className="group relative shrink-0"
            aria-label={waveActive && playing ? 'Пауза' : 'Слушать волну'}
          >
            <WaveOrb active={audioReactive} palette={palette} />
            <span className="absolute inset-0 flex items-center justify-center">
              <span
                className="wave-orb-core flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full text-background shadow-[0_12px_40px_-8px_rgb(0_0_0/0.55)] transition-[filter] duration-100 motion-reduce:transition-none group-hover:scale-105"
                style={{
                  background: `linear-gradient(145deg, rgb(${boostPalette(palette).a}), rgb(${boostPalette(palette).c}))`,
                  filter: 'brightness(calc(0.95 + var(--wave-pulse) * 0.4))',
                }}
              >
                {starting ? (
                  <Loader2 size={30} className="animate-spin" />
                ) : waveActive && playing ? (
                  <Pause size={30} fill="currentColor" />
                ) : (
                  <Play size={30} fill="currentColor" className="ml-1" />
                )}
              </span>
            </span>
          </button>

          <div className="min-w-0 flex-1 text-center md:text-left">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Яндекс Музыка</div>
            <h1 className="mt-1 text-4xl font-bold tracking-tight md:text-5xl">Моя волна</h1>
            {waveActive && current ? (
              <motion.div
                key={current.uid}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 flex items-center justify-center gap-3 md:justify-start"
              >
                <Artwork src={current.coverUrl} className="h-16 w-16 shadow-artwork" />
                <div className="min-w-0 text-left">
                  <div className="truncate text-lg font-semibold">{current.title}</div>
                  <div className="truncate text-sm text-muted">{current.artist}</div>
                </div>
                <div className="ml-1 flex gap-1">
                  <Button variant="secondary" size="icon" title="Не нравится" onClick={() => void dislikeCurrent()}>
                    <ThumbsDown size={16} />
                  </Button>
                  <Button variant="secondary" size="icon" title="Следующий" onClick={skipNext}>
                    <SkipForward size={16} fill="currentColor" />
                  </Button>
                </div>
              </motion.div>
            ) : (
              <p className="mt-3 max-w-lg text-muted">
                Персональный бесконечный поток: знакомые любимые треки вперемешку с новыми открытиями. Лайки и пропуски
                учитываются сразу.
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          {GROUPS.map((group) => (
            <div key={group.key} className="rounded-xl border border-foreground/10 bg-card/45 p-4 backdrop-blur-md">
              <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((o) => {
                  const selected = settings[group.key] === o.value;
                  const boosted = boostPalette(palette);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => choose(group.key, o.value)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        !selected && 'bg-foreground/10 text-foreground/85 hover:bg-foreground/15',
                      )}
                      style={
                        selected
                          ? {
                              background: `linear-gradient(135deg, rgb(${boosted.a}), rgb(${boosted.b}))`,
                              color: 'rgb(255 255 255)',
                              boxShadow: `0 0 24px rgb(${boosted.a} / 0.45)`,
                            }
                          : undefined
                      }
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {waveActive && upcoming.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-bold tracking-tight">Дальше в волне</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
              {upcoming.map((t) => (
                <div key={t.uid} className="min-w-0">
                  <Artwork src={t.coverUrl} className="aspect-square w-full shadow-artwork" />
                  <div className="mt-2 truncate text-xs font-medium">{t.title}</div>
                  <div className="truncate text-xs text-muted">{t.artist}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </WavePageShell>
  );
}
