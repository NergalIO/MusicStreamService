import type { LobbySummaryDto } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { Activity, Radio, RefreshCw, Users, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { fetchActiveLobbies, lobbyPingToHostMs } from '@/lib/lobby-api';
import { cn } from '@/lib/utils';

const REFRESH_MS = 5_000;

function pingTone(ms: number): string {
  if (ms < 120) return 'text-emerald-400';
  if (ms < 300) return 'text-amber-400';
  return 'text-danger';
}

function lossTone(pct: number): string {
  if (pct < 1) return 'text-emerald-400';
  if (pct < 5) return 'text-amber-400';
  return 'text-danger';
}

function Metric({
  icon,
  label,
  value,
  tone,
  title,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: string;
  title: string;
}) {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className="text-muted">{icon}</span>
      <span className="text-muted">{label}</span>
      <span className={cn('font-medium tabular-nums', tone)}>{value}</span>
    </span>
  );
}

export function RoomCard({
  lobby,
  clientRttMs,
  onJoin,
  joining,
  compact = false,
}: {
  lobby: LobbySummaryDto;
  clientRttMs: number;
  onJoin: (lobby: LobbySummaryDto) => void;
  joining: boolean;
  compact?: boolean;
}) {
  const ping = lobbyPingToHostMs(lobby, clientRttMs);
  const loss = lobby.hostLossPct;
  const full = lobby.listeners >= lobby.maxMembers;

  if (compact) {
    return (
      <li>
        <button
          type="button"
          disabled={joining || (full && !lobby.isMember)}
          onClick={() => onJoin(lobby)}
          className={cn(
            'w-full rounded-lg border border-border bg-foreground/[0.03] px-2.5 py-2 text-left transition-colors',
            'hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:opacity-40',
            lobby.isMember && 'border-primary/40',
          )}
        >
          <p className="truncate text-[13px] font-medium leading-tight">{lobby.title}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] leading-tight">
            <span className={cn('tabular-nums', full ? 'text-amber-400' : 'text-muted')} title="Слушатели и всего мест">
              {lobby.listeners}/{lobby.maxMembers}
            </span>
            <span className={cn('tabular-nums', ping === null ? 'text-muted' : pingTone(ping))} title="Пинг до DJ через сервер">
              {ping === null ? 'пинг —' : `${ping} мс`}
            </span>
            <span className={cn('tabular-nums', loss === null ? 'text-muted' : lossTone(loss))} title="Потери до DJ">
              {loss === null ? 'pl —' : `pl ${loss}%`}
            </span>
          </p>
        </button>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-border bg-foreground/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate font-medium">
            {lobby.title}
            {lobby.hostOnline && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                <Radio size={10} /> в эфире
              </span>
            )}
            {lobby.isMember && (
              <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-[11px]">вы здесь</span>
            )}
          </p>
          <p className="mt-1 truncate text-sm text-muted">
            DJ: {lobby.hostDisplayName ?? lobby.hostUserId.slice(0, 8)}
            {!lobby.isPublic && ' · по коду'}
          </p>
        </div>
        <Button
          size="sm"
          variant={lobby.isMember ? 'default' : 'secondary'}
          disabled={joining || (full && !lobby.isMember)}
          onClick={() => onJoin(lobby)}
        >
          {lobby.isMember ? 'Открыть' : full ? 'Заполнено' : 'Войти'}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Metric
          icon={<Users size={14} />}
          label="слушателей"
          value={`${lobby.listeners}/${lobby.maxMembers}`}
          tone={full ? 'text-amber-400' : 'text-foreground'}
          title="Участники комнаты, включая DJ, и всего мест"
        />
        <Metric
          icon={<Wifi size={14} />}
          label="пинг"
          value={ping === null ? '—' : `${ping} мс`}
          tone={ping === null ? 'text-muted' : pingTone(ping)}
          title={
            ping === null
              ? 'DJ не в сети или ещё не ответил на проверку связи'
              : `Путь до DJ через сервер: ваш RTT ${clientRttMs} мс + RTT DJ ${lobby.hostRttMs} мс`
          }
        />
        <Metric
          icon={<Activity size={14} />}
          label="pl до DJ"
          value={loss === null ? '—' : `${loss}%`}
          tone={loss === null ? 'text-muted' : lossTone(loss)}
          title={
            loss === null
              ? 'Потери появятся, когда DJ начнёт эфир'
              : 'Потери кадров эфира на участке DJ → сервер'
          }
        />
      </div>
    </li>
  );
}

export function LobbyRoomList({
  onJoin,
  joiningId,
  compact = false,
}: {
  onJoin: (lobby: LobbySummaryDto) => void;
  joiningId: string | null;
  compact?: boolean;
}) {
  const rooms = useQuery({
    queryKey: ['lobbies', 'active'],
    queryFn: fetchActiveLobbies,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const list = rooms.data?.items ?? [];

  if (compact) {
    return (
      <div className="space-y-1 pt-1" aria-label="Активные комнаты">
        {rooms.isLoading && !list.length ? (
          <p className="px-2.5 py-1 text-[11px] text-muted">Ищем комнаты…</p>
        ) : !list.length ? (
          <p className="px-2.5 py-1 text-[11px] leading-snug text-muted">Нет активных комнат</p>
        ) : (
          <ul className="space-y-1">
            {list.map((lobby) => (
              <RoomCard
                key={lobby.id}
                lobby={lobby}
                clientRttMs={rooms.data?.clientRttMs ?? 0}
                onJoin={onJoin}
                joining={joiningId === lobby.id}
                compact
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Активные комнаты</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Обновить список комнат"
          onClick={() => void rooms.refetch()}
        >
          <RefreshCw size={14} className={cn(rooms.isFetching && 'animate-spin')} />
        </Button>
      </div>

      {rooms.isError ? (
        <ErrorState className="py-6" error={rooms.error} onRetry={() => void rooms.refetch()} />
      ) : rooms.isLoading ? (
        <p className="text-sm text-muted">Ищем комнаты…</p>
      ) : !list.length ? (
        <p className="text-sm text-muted">
          Открытых комнат нет. Создайте свою или войдите по коду приглашения.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((lobby) => (
            <RoomCard
              key={lobby.id}
              lobby={lobby}
              clientRttMs={rooms.data?.clientRttMs ?? 0}
              onJoin={onJoin}
              joining={joiningId === lobby.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
