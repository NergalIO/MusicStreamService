import type { ListeningStats } from '@mss/shared';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { ChevronLeft, ChevronRight, Gift, ListPlus, Play, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArtistAvatar } from '@/components/artists/ArtistCard';
import { Artwork } from '@/components/media/Artwork';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { plural } from '@/lib/format';
import { playCollection } from '@/lib/player-actions';
import { importToMss } from '@/lib/playlist-io';
import { SOURCE_LABEL } from '@/lib/sources';
import { formatMinutes, statsTrackToUnified, useStats } from '@/lib/stats';
import { cn } from '@/lib/utils';
import { formatPlays, SOURCE_COLOR } from '@/pages/StatsPage';

const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const BACKGROUNDS = [
  'from-primary/60 via-fuchsia-600/40 to-background',
  'from-sky-500/50 via-primary/30 to-background',
  'from-amber-500/50 via-rose-500/30 to-background',
  'from-emerald-500/45 via-teal-600/30 to-background',
  'from-rose-500/50 via-primary/30 to-background',
  'from-indigo-500/50 via-sky-500/25 to-background',
  'from-fuchsia-500/50 via-amber-500/25 to-background',
  'from-primary/60 via-emerald-500/25 to-background',
];

const item = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.15 + i * 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] } }),
};

function Reveal({ i = 0, children, className }: { i?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div variants={item} custom={i} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString('ru-RU'));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.3 });
    return () => controls.stop();
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}

function buildSlides(stats: ListeningStats, year: number): ReactNode[] {
  const topArtist = stats.topArtists[0];
  const topTracks = stats.topTracks.slice(0, 5);
  const bestMonth = stats.timeline.reduce((best, s) => (s.minutes > best.minutes ? s : best), stats.timeline[0] ?? { bucket: '', minutes: 0 });
  const maxMonth = Math.max(1, ...stats.timeline.map((s) => s.minutes));
  const totalSources = stats.sources.reduce((sum, s) => sum + s.minutes, 0);
  const slides: ReactNode[] = [
    <div key="intro" className="text-center">
      <Reveal>
        <Gift size={56} className="mx-auto text-foreground/90" />
      </Reveal>
      <Reveal i={1}>
        <div className="mt-6 text-lg font-medium text-foreground/70">Ваши итоги</div>
      </Reveal>
      <Reveal i={2}>
        <div className="text-7xl font-black tracking-tight">{year}</div>
      </Reveal>
      <Reveal i={3}>
        <p className="mt-4 text-foreground/70">Давайте посмотрим, каким он был в музыке</p>
      </Reveal>
    </div>,
    <div key="minutes" className="text-center">
      <Reveal>
        <div className="text-lg font-medium text-foreground/70">За год вы слушали музыку</div>
      </Reveal>
      <Reveal i={1}>
        <div className="my-3 text-7xl font-black tabular-nums tracking-tight">
          <CountUp value={stats.totalMinutes} />
        </div>
      </Reveal>
      <Reveal i={2}>
        <div className="text-2xl font-semibold">{plural(stats.totalMinutes, 'минуту', 'минуты', 'минут')}</div>
      </Reveal>
      <Reveal i={3}>
        <p className="mt-6 text-foreground/70">
          Это {formatMinutes(stats.totalMinutes)} в {stats.activeDays} {plural(stats.activeDays, 'день', 'дня', 'дней')} и{' '}
          {formatPlays(stats.totalPlays)}
        </p>
      </Reveal>
    </div>,
  ];

  if (topArtist) {
    slides.push(
      <div key="artist" className="flex flex-col items-center text-center">
        <Reveal>
          <div className="text-lg font-medium text-foreground/70">Исполнитель года</div>
        </Reveal>
        <Reveal i={1}>
          <motion.div initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 12, delay: 0.25 }}>
            <ArtistAvatar name={topArtist.name} imageUrl={topArtist.coverUrl ?? undefined} className="my-6 h-48 w-48 text-6xl shadow-2xl" />
          </motion.div>
        </Reveal>
        <Reveal i={2}>
          <div className="text-4xl font-black tracking-tight">{topArtist.name}</div>
        </Reveal>
        <Reveal i={3}>
          <p className="mt-3 text-foreground/70">
            {formatPlays(topArtist.plays)} · {formatMinutes(topArtist.minutes)}
          </p>
        </Reveal>
      </div>,
    );
  }

  if (topTracks.length) {
    slides.push(
      <div key="tracks" className="w-full max-w-lg">
        <Reveal>
          <div className="mb-5 text-center text-3xl font-black tracking-tight">Треки года</div>
        </Reveal>
        <ol className="space-y-2">
          {topTracks.map((t, i) => (
            <Reveal key={`${t.source}:${t.trackId}`} i={i + 1}>
              <li className="flex items-center gap-4 rounded-xl bg-background/30 p-2.5 backdrop-blur">
                <span className="w-6 text-center text-2xl font-black tabular-nums text-foreground/60">{i + 1}</span>
                <Artwork src={t.coverUrl} rounded="rounded-lg" className="h-12 w-12" iconSize={18} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t.title}</div>
                  <div className="truncate text-sm text-foreground/70">{t.artist}</div>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-foreground/70">{t.plays}×</span>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>,
    );
  }

  if (stats.topArtists.length > 1) {
    slides.push(
      <div key="artists" className="w-full max-w-lg">
        <Reveal>
          <div className="mb-5 text-center text-3xl font-black tracking-tight">Любимые исполнители</div>
        </Reveal>
        <ol className="space-y-2">
          {stats.topArtists.slice(0, 5).map((a, i) => (
            <Reveal key={a.name} i={i + 1}>
              <li className="flex items-center gap-4 rounded-xl bg-background/30 p-2.5 backdrop-blur">
                <span className="w-6 text-center text-2xl font-black tabular-nums text-foreground/60">{i + 1}</span>
                <ArtistAvatar name={a.name} imageUrl={a.coverUrl ?? undefined} className="h-12 w-12 text-lg" />
                <div className="min-w-0 flex-1 truncate font-semibold">{a.name}</div>
                <span className="shrink-0 text-sm tabular-nums text-foreground/70">{formatMinutes(a.minutes)}</span>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>,
    );
  }

  if (bestMonth?.minutes) {
    slides.push(
      <div key="months" className="w-full max-w-xl text-center">
        <Reveal>
          <div className="text-lg font-medium text-foreground/70">Самый музыкальный месяц</div>
        </Reveal>
        <Reveal i={1}>
          <div className="mb-8 mt-1 text-5xl font-black capitalize tracking-tight">{MONTHS_FULL[Number(bestMonth.bucket.slice(5, 7)) - 1]}</div>
        </Reveal>
        <div className="flex h-40 items-end gap-1.5">
          {stats.timeline.map((s, i) => (
            <div key={s.bucket} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(2, (s.minutes / maxMonth) * 100)}%` }}
                transition={{ delay: 0.4 + i * 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={cn('w-full rounded-t-md', s === bestMonth ? 'bg-foreground' : 'bg-foreground/35')}
              />
              <span className="text-[10px] text-foreground/60">{MONTHS_FULL[i].slice(0, 3)}</span>
            </div>
          ))}
        </div>
        {stats.peakHour !== null && (
          <Reveal i={3}>
            <p className="mt-6 text-foreground/70">
              Чаще всего музыка звучала около {String(stats.peakHour).padStart(2, '0')}:00
            </p>
          </Reveal>
        )}
      </div>,
    );
  }

  if (totalSources && stats.sources.length > 1) {
    slides.push(
      <div key="sources" className="w-full max-w-md text-center">
        <Reveal>
          <div className="mb-8 text-3xl font-black tracking-tight">Откуда звучала музыка</div>
        </Reveal>
        <div className="space-y-4 text-left">
          {stats.sources.map((s, i) => (
            <Reveal key={s.source} i={i + 1}>
              <div className="mb-1.5 flex justify-between text-sm font-semibold">
                <span>{SOURCE_LABEL[s.source]}</span>
                <span className="tabular-nums">{Math.round((s.minutes / totalSources) * 100)}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-background/40">
                <motion.div
                  className={cn('h-full rounded-full', SOURCE_COLOR[s.source])}
                  initial={{ width: 0 }}
                  animate={{ width: `${(s.minutes / totalSources) * 100}%` }}
                  transition={{ delay: 0.4 + i * 0.15, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </Reveal>
          ))}
        </div>
      </div>,
    );
  }

  return slides;
}

function Outro({ stats, year }: { stats: ListeningStats; year: number }) {
  const tracks = useMemo(() => stats.topTracks.map(statsTrackToUnified), [stats]);
  const title = `Лучшее за ${year}`;
  return (
    <div className="text-center">
      <Reveal>
        <div className="text-5xl font-black tracking-tight">Спасибо, что слушали</div>
      </Reveal>
      <Reveal i={1}>
        <p className="mt-3 text-foreground/70">
          {stats.uniqueTracks} {plural(stats.uniqueTracks, 'трек', 'трека', 'треков')} и {stats.uniqueArtists}{' '}
          {plural(stats.uniqueArtists, 'исполнитель', 'исполнителя', 'исполнителей')} за год
        </p>
      </Reveal>
      <Reveal i={2} className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => playCollection(tracks, { type: 'other', title, path: '/stats/wrapped' })}>
          <Play size={16} fill="currentColor" /> Слушать треки года
        </Button>
        <Button size="lg" variant="secondary" onClick={() => void importToMss({ title, description: 'Самые частые треки года по статистике MSS' }, tracks)}>
          <ListPlus size={16} /> Сохранить плейлист
        </Button>
      </Reveal>
    </div>
  );
}

export function WrappedPage() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const stats = useStats({ year });
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const slides = useMemo(() => {
    if (!stats.data || !stats.data.totalPlays) return [];
    return [...buildSlides(stats.data, year), <Outro key="outro" stats={stats.data} year={year} />];
  }, [stats.data, year]);

  useEffect(() => setIndex(0), [year]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = Math.min(slides.length - 1, Math.max(0, i + delta));
        if (next !== i) setDirection(delta);
        return next;
      });
    },
    [slides.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Escape') navigate('/stats');
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, navigate]);

  const years = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[520px] flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                y === year ? 'bg-foreground text-background' : 'text-muted hover:bg-foreground/10 hover:text-foreground',
              )}
            >
              {y}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" aria-label="Закрыть итоги" onClick={() => navigate('/stats')}>
          <X size={18} />
        </Button>
      </div>

      {stats.isLoading ? (
        <div className="flex-1 animate-pulse rounded-3xl bg-foreground/[0.05]" />
      ) : stats.isError ? (
        <ErrorState title="Не удалось собрать итоги" error={stats.error} onRetry={() => void stats.refetch()} />
      ) : !slides.length ? (
        <EmptyState icon={Gift} title={`За ${year} год прослушиваний нет`} description="Итоги появятся, когда в статистике накопится музыка за этот год." />
      ) : (
        <div className={cn('relative flex-1 overflow-hidden rounded-3xl bg-gradient-to-br transition-[background] duration-700', BACKGROUNDS[index % BACKGROUNDS.length])}>
          <div className="absolute inset-x-6 top-4 z-10 flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Слайд ${i + 1}`}
                onClick={() => {
                  setDirection(i > index ? 1 : -1);
                  setIndex(i);
                }}
                className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/20"
              >
                <span className={cn('block h-full bg-foreground transition-[width] duration-500', i <= index ? 'w-full' : 'w-0')} />
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={`${year}-${index}`}
              custom={direction}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 80 }),
                center: { opacity: 1, x: 0 },
                exit: (d: number) => ({ opacity: 0, x: d * -80 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex items-center justify-center overflow-y-auto px-10 py-14"
            >
              {slides[index]}
            </motion.div>
          </AnimatePresence>

          {index > 0 && (
            <button
              type="button"
              aria-label="Предыдущий слайд"
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/40 backdrop-blur transition-colors hover:bg-background/60"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {index < slides.length - 1 && (
            <button
              type="button"
              aria-label="Следующий слайд"
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/40 backdrop-blur transition-colors hover:bg-background/60"
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
