import type { UnifiedTrack } from '@mss/shared';
import { useMutation } from '@tanstack/react-query';
import { Copy, DoorOpen, Radio, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  acceptSuggestion,
  closeLobby,
  createLobby,
  fetchLobby,
  joinLobby,
  leaveLobby,
  rejectSuggestion,
  suggestTrack,
} from '@/lib/lobby-api';
import { connectLobbySession, disconnectLobbySession } from '@/lib/lobby-session';
import { loadSession } from '@/lib/api';
import { useLobbyStore } from '@/store/lobby-store';
import { usePlayerStore } from '@/store/player-store';

function copyCode(code: string): void {
  void navigator.clipboard.writeText(code);
  toast.success('Код скопирован');
}

export function LobbyPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const lobby = useLobbyStore((s) => s.lobby);
  const role = useLobbyStore((s) => s.role);
  const [joinCode, setJoinCode] = useState(search.get('code') ?? '');
  const current = usePlayerStore((s) => s.current);

  const createMut = useMutation({
    mutationFn: () => createLobby({ title: 'Listening party' }),
    onSuccess: (dto) => {
      connectLobbySession(dto, 'host');
      navigate(`/lobby/${dto.id}`, { replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Ошибка'),
  });

  const joinMut = useMutation({
    mutationFn: (code: string) => joinLobby(code),
    onSuccess: (dto) => {
      const session = loadSession();
      const r = session?.user.id === dto.hostUserId ? 'host' : 'guest';
      connectLobbySession(dto, r);
      navigate(`/lobby/${dto.id}`, { replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось войти'),
  });

  const suggestMut = useMutation({
    mutationFn: (track: UnifiedTrack) => {
      if (!lobby) throw new Error('Нет лобби');
      return suggestTrack(lobby.id, track);
    },
    onSuccess: () => toast.success('Трек предложен DJ'),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Ошибка'),
  });

  useEffect(() => {
    const code = search.get('code')?.trim().toUpperCase();
    if (!code || id || lobby) return;
    setJoinCode(code);
    joinMut.mutate(code);
  }, [search, id, lobby]);

  useEffect(() => {
    return () => {
      if (useLobbyStore.getState().lobby) disconnectLobbySession();
    };
  }, []);

  useEffect(() => {
    if (!id || lobby?.id === id) return;
    void fetchLobby(id)
      .then((dto) => {
        const session = loadSession();
        const r = session?.user.id === dto.hostUserId ? 'host' : 'guest';
        connectLobbySession(dto, r);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Лобби недоступно'));
  }, [id, lobby?.id]);

  const queue = lobby?.queue.filter((q) => q.status !== 'rejected') ?? [];
  const suggestions = queue.filter((q) => q.status === 'suggested');

  if (!lobby && !id) {
    return (
      <div className="mx-auto max-w-lg space-y-6 pt-8">
        <h1 className="text-2xl font-semibold">Listening party</h1>
        <p className="text-sm text-muted">
          DJ с Premium или Яндекс Плюс ведёт эфир; гости слышат поток и могут предлагать треки. Ретрансляция Spotify/Яндекс —
          на вашу ответственность по правилам сервисов.
        </p>
        <Button className="w-full" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
          <Radio size={16} className="mr-2" /> Создать лобби
        </Button>
        <div className="flex gap-2">
          <Input placeholder="Код приглашения" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
          <Button variant="secondary" onClick={() => joinMut.mutate(joinCode)} disabled={!joinCode.trim() || joinMut.isPending}>
            Войти
          </Button>
        </div>
      </div>
    );
  }

  if (!lobby) {
    return (
      <div className="pt-8 text-center text-muted">
        Подключение к лобби…
        <Button className="mt-4" variant="ghost" onClick={() => navigate('/lobby')}>
          Назад
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{lobby.title}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <Users size={14} />
            {lobby.members.length}/{lobby.maxMembers} · {role === 'host' ? 'Вы DJ' : 'Гость'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-foreground/10 px-3 py-1.5 text-sm font-mono">{lobby.inviteCode}</code>
          <Button size="icon" variant="ghost" aria-label="Копировать код" onClick={() => copyCode(lobby.inviteCode)}>
            <Copy size={16} />
          </Button>
        </div>
      </div>

      {lobby.playback.track && (
        <div className="rounded-xl border border-border bg-foreground/[0.04] p-4">
          <p className="text-xs uppercase text-muted">Сейчас в эфире</p>
          <p className="font-medium">{lobby.playback.track.title}</p>
          <p className="text-sm text-muted">{lobby.playback.track.artist}</p>
          {lobby.playback.paused && <p className="mt-1 text-xs text-amber-400">Пауза</p>}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Участники</h2>
        <ul className="space-y-1 text-sm">
          {lobby.members.map((m) => (
            <li key={m.userId} className="flex justify-between rounded-md px-2 py-1 hover:bg-foreground/5">
              <span>{m.displayName ?? m.userId.slice(0, 8)}</span>
              <span className="text-muted">{m.role === 'host' ? 'DJ' : 'гость'}</span>
            </li>
          ))}
        </ul>
      </section>

      {role === 'guest' && current && (
        <Button variant="secondary" onClick={() => suggestMut.mutate(current)} disabled={suggestMut.isPending}>
          Предложить текущий трек
        </Button>
      )}

      {role === 'host' && suggestions.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Предложения</h2>
          <ul className="space-y-2">
            {suggestions.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="truncate">
                  {item.track.title} · {item.track.artist}
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" onClick={() => void acceptSuggestion(lobby.id, item.id)}>
                    В очередь
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void rejectSuggestion(lobby.id, item.id)}>
                    ✕
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Очередь</h2>
        {queue.filter((q) => q.status === 'queued' || q.status === 'playing').length === 0 ? (
          <p className="text-sm text-muted">Очередь пуста — DJ выбирает треки в плеере.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {queue
              .filter((q) => q.status === 'queued' || q.status === 'playing')
              .map((item) => (
                <li key={item.id} className="truncate rounded-md px-2 py-1">
                  {item.status === 'playing' ? '▶ ' : ''}
                  {item.track.title} · {item.track.artist}
                </li>
              ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2 pt-4">
        <Button
          variant="secondary"
          onClick={() => {
            void leaveLobby(lobby.id).finally(() => {
              disconnectLobbySession();
              navigate('/lobby');
            });
          }}
        >
          <DoorOpen size={16} className="mr-2" /> Выйти
        </Button>
        {role === 'host' && (
          <Button
            variant="danger"
            onClick={() => {
              void closeLobby(lobby.id).finally(() => {
                disconnectLobbySession();
                navigate('/lobby');
              });
            }}
          >
            Закрыть лобби
          </Button>
        )}
      </div>
    </div>
  );
}
