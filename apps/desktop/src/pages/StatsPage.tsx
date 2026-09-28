import type { ListeningPeriod, ListeningStats, SourceId, StatsTopArtist, StatsTopTrack } from '@mss/shared';
import { BarChart3, Gift, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArtistAvatar } from '@/components/artists/ArtistCard';
import { PageTitle, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { Artwork } from '@/components/media/Artwork';
import { openTrackMenu } from '@/components/tracks/TrackContextMenu';
import { Button } from '@/components/ui/button';
import { openContextMenu } from '@/components/ui/context-menu';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { artistPath } from '@/lib/artists';
import { artistMenu } from '@/lib/card-menus';
import { plural } from '@/lib/format';
import { SOURCE_LABEL } from '@/lib/sources';
import { formatMinutes, statsArtistGroup, statsTrackToUnified, useStats } from '@/lib/stats';
import { cn } from '@/lib/utils';
import { usePlayerStore, type PlayContext } from '@/store/player-store';

const PERIODS: { value: ListeningPeriod; label: string }[] = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
  { value: 'all', label: 'Всё время' },
];

export const SOURCE_COLOR: Record<SourceId, string> = {
  local: 'bg-primary',
  yandex: 'bg-amber-400',
  spotify: 'bg-emerald-500',
};

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function bucketLabel(bucket: string, unit: 'day' | 'month', long = false): string {
  const [y, m, d] = bucket.split('-').map(Number);
  if (unit === 'day') return long ? `${d} ${MONTHS[m - 1]}` : String(d);
  return long ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}

export function formatPlays(n: number): string {
  return `${n} ${plural(n, 'прослушивание', 'прослушивания', 'прослушиваний')}`;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function TimelineChart({ stats, className }: { stats: ListeningStats; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = stats.timeline;
  const max = Math.max(1, ...series.map((s) => s.minutes));
  const every = series.length > 16 ? Math.ceil(series.length / 10) : 1;
  const active = hover !== null ? series[hover] : null;

  if (!series.length) return null;
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold">Минуты прослушивания</div>
        <div className="text-xs tabular-nums text-muted">
          {active ? `${bucketLabel(active.bucket, stats.timelineUnit, true)} · ${formatMinutes(active.minutes)}` : `пик — ${formatMinutes(max)}`}
        </div>
      </div>
      <div className="flex h-36 items-end gap-[3px]" onMouseLeave={() => setHover(null)} role="img" aria-label="График минут прослушивания">
        {series.map((s, i) => (
          <div key={s.bucket} className="flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
            <div
              className={cn('w-full rounded-t-[3px] transition-colors', hover === i ? 'bg-primary' : 'bg-primary/55')}
              style={{ height: `${Math.max(s.minutes ? 3 : 1, (s.minutes / max) * 100)}%`, opacity: s.minutes ? 1 : 0.35 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {series.map((s, i) => (
          <div key={s.bucket} className="min-w-0 flex-1 text-center text-[10px] text-muted">
            {i % every === 0 ? bucketLabel(s.bucket, stats.timelineUnit) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SourceShare({ stats }: { stats: ListeningStats }) {
  const total = stats.sources.reduce((sum, s) => sum + s.minutes, 0);
  if (!total) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-semibold">Источники</div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-foreground/[0.07]">
        {stats.sources.map((s) => (
          <div key={s.source} className={SOURCE_COLOR[s.source]} style={{ width: `${(s.minutes / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {stats.sources.map((s) => (
          <div key={s.source} className="flex items-center gap-2 text-xs">
            <span className={cn('h-2 w-2 rounded-full', SOURCE_COLOR[s.source])} />
            <span className="font-medium">{SOURCE_LABEL[s.source]}</span>
            <span className="tabular-nums text-muted">{Math.round((s.minutes / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopTracks({ items, context }: { items: StatsTopTrack[]; context: PlayContext }) {
  const tracks = useMemo(() => items.map(statsTrackToUnified), [items]);
  return (
    <ol className="space-y-0.5">
      {tracks.map((t, i) => (
        <li key={`${t.source}:${t.id}`}>
          <button
            type="button"
            onClick={() => usePlayerStore.getState().playList(tracks, i, context)}
            onContextMenu={(e) => openTrackMenu(e, t)}
            className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.05]"
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
            <div className="relative">
              <Artwork src={t.coverUrl} rounded="rounded-md" className="h-10 w-10" iconSize={16} />
              <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Play size={14} fill="white" className="text-white" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.title}</div>
              <div className="truncate text-xs text-muted">{t.artist}</div>
            </div>
            <div className="shrink-0 text-right text-xs tabular-nums text-muted">
              <div className="font-medium text-foreground/80">{items[i].plays}×</div>
              <div>{formatMinutes(items[i].minutes)}</div>
            </div>
          </button>
        </li>
      ))}
    </ol>
  );
}

function TopArtists({ items }: { items: StatsTopArtist[] }) {
  return (
    <ol className="space-y-0.5">
      {items.map((a, i) => {
        const group = statsArtistGroup(a);
        return (
          <li key={group.key}>
            <Link
              to={artistPath(group.name, group.refs)}
              onContextMenu={(e) => openContextMenu(e, artistMenu(group))}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-foreground/[0.05]"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
              <ArtistAvatar name={a.name} imageUrl={a.coverUrl ?? undefined} className="h-10 w-10 text-sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="truncate text-xs text-muted">{formatPlays(a.plays)}</div>
              </div>
              <div className="shrink-0 text-xs tabular-nums text-muted">{formatMinutes(a.minutes)}</div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-xl bg-foreground/[0.05]" />
        ))}
      </div>
      <div className="h-52 animate-pulse rounded-xl bg-foreground/[0.05]" />
      <TrackListSkeleton rows={6} />
    </div>
  );
}

export function StatsPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<ListeningPeriod>('month');
  const stats = useStats({ period });
  const data = stats.data;
  const periodLabel = PERIODS.find((p) => p.value === period)!.label.toLowerCase();
  const context: PlayContext = { type: 'other', title: `Топ за ${period === 'all' ? 'всё время' : periodLabel}`, path: '/stats' };
  const year = new Date().getFullYear();

  return (
    <div>
      <PageTitle
        title="Статистика"
        subtitle="Что и сколько вы слушаете во всех источниках"
        actions={
          <Button variant="secondary" onClick={() => navigate('/stats/wrapped')}>
            <Gift size={15} /> Итоги {year}
          </Button>
        }
      />
      <Segmented value={period} options={PERIODS} onChange={setPeriod} className="mb-6" />

      {stats.isLoading ? (
        <StatsSkeleton />
      ) : stats.isError ? (
        <ErrorState title="Не удалось загрузить статистику" error={stats.error} onRetry={() => void stats.refetch()} />
      ) : !data || data.totalPlays === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Пока нет прослушиваний"
          description="Статистика появится, когда вы послушаете что-нибудь дольше 30 секунд. Прослушивания без сети сохранятся и отправятся позже."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Время" value={formatMinutes(data.totalMinutes)} hint={`${data.activeDays} ${plural(data.activeDays, 'день', 'дня', 'дней')} с музыкой`} />
            <StatCard label="Прослушивания" value={String(data.totalPlays)} />
            <StatCard label="Треки" value={String(data.uniqueTracks)} hint={`${data.uniqueArtists} ${plural(data.uniqueArtists, 'исполнитель', 'исполнителя', 'исполнителей')}`} />
            <StatCard
              label="Любимое время"
              value={data.peakHour === null ? '—' : `${String(data.peakHour).padStart(2, '0')}:00`}
              hint={data.peakHour === null ? undefined : `до ${String((data.peakHour + 1) % 24).padStart(2, '0')}:00`}
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <TimelineChart stats={data} />
            <SourceShare stats={data} />
          </div>
          <div className="grid gap-8 xl:grid-cols-2">
            <section>
              <h2 className="mb-2 text-lg font-bold tracking-tight">Топ треков</h2>
              <TopTracks items={data.topTracks.slice(0, 25)} context={context} />
            </section>
            <section>
              <h2 className="mb-2 text-lg font-bold tracking-tight">Топ исполнителей</h2>
              <TopArtists items={data.topArtists.slice(0, 15)} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
