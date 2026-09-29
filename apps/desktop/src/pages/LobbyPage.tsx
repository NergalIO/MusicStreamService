import type { LobbyDto, LobbySummaryDto } from '@mss/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, DoorOpen, Radio, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LobbyRoomList } from '@/components/lobby/LobbyRoomList';
import { TrackList } from '@/components/tracks/TrackList';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Input } from '@/components/ui/input';
import {
  acceptSuggestion,
  closeLobby,
  createLobby,
  fetchLobby,
  joinLobby,
  rejectSuggestion,
} from '@/lib/lobby-api';
import { copyTextWithToast } from '@/lib/clipboard';
import { isLobbyListenPaused, resumeLobbyListen } from '@/lib/lobby-listen';
import { disconnectLobbySession, enterLobbySession, leaveCurrentLobby } from '@/lib/lobby-session';
import { useLobbyStore } from '@/store/lobby-store';

function copyCode(code: string): void {
  copyTextWithToast(code, 'Код скопирован');
}

export function LobbyPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const lobby = useLobbyStore((s) => s.lobby);
  const role = useLobbyStore((s) => s.role);
  const live = useLobbyStore((s) => s.live);
  const wsStatus = useLobbyStore((s) => s.wsStatus);
  const [joinCode, setJoinCode] = useState(search.get('code') ?? '');
  const [publicRoom, setPublicRoom] = useState(true);
  const queryClient = useQueryClient();

  const enterLobby = (dto: LobbyDto) => {
    enterLobbySession(dto);
    void queryClient.invalidateQueries({ queryKey: ['lobbies', 'active'] });
    navigate(`/lobby/${dto.id}`, { replace: true });
  };

  const createMut = useMutation({
    mutationFn: () => createLobby({ title: 'Listening party', isPublic: publicRoom }),
    onSuccess: (dto) => {
      enterLobbySession(dto);
      void queryClient.invalidateQueries({ queryKey: ['lobbies', 'active'] });
      navigate(`/lobby/${dto.id}`, { replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Ошибка'),
  });

  const joinMut = useMutation({
    mutationFn: (code: string) => joinLobby(code),
    onSuccess: enterLobby,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось войти'),
  });

  // Вход из списка: сервер по коду вернёт комнату и участнику, повторно его не добавляя.
  const joinRoomMut = useMutation({
    mutationFn: (room: LobbySummaryDto) => joinLobby(room.inviteCode),
    onSuccess: enterLobby,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось войти'),
  });

  useEffect(() => {
    const code = search.get('code')?.trim().toUpperCase();
    if (!code || id || lobby) return;
    setJoinCode(code);
    joinMut.mutate(code);
  }, [search, id, lobby]);

  useEffect(() => {
    if (!id || lobby?.id === id) return;
    void fetchLobby(id)
      .then((dto) => enterLobbySession(dto))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Лобби недоступно'));
  }, [id, lobby?.id]);

  const queue = lobby?.queue.filter((q) => q.status !== 'rejected') ?? [];
  const suggestions = queue.filter((q) => q.status === 'suggested');
  const queueTracks = useMemo(
    () =>
      queue
        .filter((q) => q.status === 'queued' || q.status === 'playing')
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          ...item.track,
          playable: role === 'host' ? (item.track.playable ?? true) : false,
          unplayableReason: role === 'host' ? item.track.unplayableReason : 'Включает только DJ',
        })),
    [queue, role],
  );
  const queueContext = useMemo(
    () =>
      lobby
        ? { type: 'playlist' as const, title: 'Очередь лобби', path: `/lobby/${lobby.id}` }
        : undefined,
    [lobby],
  );
  const [guestNeedsUnmute, setGuestNeedsUnmute] = useState(false);
  useEffect(() => {
    if (role !== 'guest' || !live) {
      setGuestNeedsUnmute(false);
      return;
    }
    const id = window.setInterval(() => setGuestNeedsUnmute(isLobbyListenPaused()), 1500);
    return () => window.clearInterval(id);
  }, [role, live]);

  if (!id) {
    return (
      <div className="mx-auto max-w-lg space-y-6 pt-8">
        <h1 className="text-2xl font-semibold">Listening party</h1>
        <p className="text-sm text-muted">
          Создайте комнату или введите код. DJ включает треки в обычном плеере — гости слышат этот звук. Комната не
          закрывается, если уйти в медиатеку. Ретрансляция Spotify и Яндекса — на вашу ответственность.
        </p>
        <Button className="w-full" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
          <Radio size={16} className="mr-2" /> Создать лобби
        </Button>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="text-sm">
            Показывать в списке комнат
            <span className="block text-xs text-muted">Иначе войти можно будет только по коду</span>
          </span>
          <Switch checked={publicRoom} onChange={setPublicRoom} label="Публичная комната" />
        </div>
        <div className="flex gap-2">
          <Input placeholder="Код приглашения" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
          <Button variant="secondary" onClick={() => joinMut.mutate(joinCode)} disabled={!joinCode.trim() || joinMut.isPending}>
            Войти
          </Button>
        </div>

        <LobbyRoomList
          onJoin={(room) => {
            if (lobby?.id === room.id) {
              navigate(`/lobby/${room.id}`);
              return;
            }
            joinRoomMut.mutate(room);
          }}
          joiningId={joinRoomMut.isPending ? (joinRoomMut.variables?.id ?? null) : null}
        />
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
            {lobby.members.length}/{lobby.maxMembers} · {role === 'host' ? 'Вы DJ' : 'Вы слушаете'}
          </p>
          <p className="mt-2 text-sm text-foreground/80">
            {wsStatus !== 'open'
              ? 'Подключение к комнате…'
              : role === 'host'
                ? live
                  ? 'Эфир идёт. Включите или смените трек в любом разделе — гости слышат ваш плеер. Уход со страницы комнату не закрывает.'
                  : 'Включите трек в плеере. Пока звука нет, гости ждут.'
                : live
                  ? 'Вы слышите эфир DJ. Свой плеер на это не влияет. Можно уйти в другой раздел — комната останется.'
                  : 'Ждём звук от DJ. Если тишина долгая, пусть DJ перезапустит трек.'}
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

      {role === 'guest' && guestNeedsUnmute && live && (
        <Button variant="secondary" onClick={() => resumeLobbyListen()}>
          Включить звук эфира
        </Button>
      )}

      {role === 'guest' && (
        <p className="text-sm text-muted">
          Найдите трек в поиске или медиатеке и в меню трека нажмите «Предложить». Это заявка DJ, ваш плеер в эфире не
          запускается.
        </p>
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
        {role === 'host' ? (
          <TrackList
            tracks={queueTracks}
            context={queueContext}
            showSource
            header
            selectable={false}
            emptyText="Очередь пуста. DJ включает треки из медиатеки или нажимает здесь."
          />
        ) : queueTracks.length === 0 ? (
          <p className="text-sm text-muted">Очередь пуста.</p>
        ) : (
          <TrackList tracks={queueTracks} context={queueContext} showSource header selectable={false} />
        )}
      </section>

      <div className="flex gap-2 pt-4">
        <Button
          variant="secondary"
          onClick={() => {
            void leaveCurrentLobby().finally(() => navigate('/lobby'));
          }}
        >
          <DoorOpen size={16} className="mr-2" /> {role === 'host' ? 'Выйти и закрыть комнату' : 'Выйти'}
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
