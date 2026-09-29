import { DoorOpen, Radio } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { lobbyPath } from '@/lib/lobby-route';
import { leaveCurrentLobby } from '@/lib/lobby-session';
import { useLobbyStore } from '@/store/lobby-store';

export function LobbyBar() {
  const lobby = useLobbyStore((s) => s.lobby);
  const role = useLobbyStore((s) => s.role);
  const live = useLobbyStore((s) => s.live);
  const wsStatus = useLobbyStore((s) => s.wsStatus);
  const audioTransport = useLobbyStore((s) => s.audioTransport);
  const navigate = useNavigate();
  const location = useLocation();
  if (!lobby || !role) return null;

  const onRoom = location.pathname === `/lobby/${lobby.id}`;
  const status =
    wsStatus !== 'open'
      ? 'Подключение…'
      : role === 'host'
        ? live
          ? 'Гости слышат ваш плеер'
          : 'Включите трек'
        : live
          ? lobby.playback.paused
            ? 'Эфир на паузе'
            : 'Эфир идёт'
          : 'Ждём звук DJ';

  return (
    <div className="no-drag flex items-center gap-3 border-b border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm">
      <Radio size={16} className="shrink-0 text-violet-300" />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-medium">{lobby.title}</span>
          <span className="text-muted">
            {' '}
            · {role === 'host' ? 'вы DJ' : 'вы слушаете'} · {lobby.members.length}/{lobby.maxMembers} · {status}
            {role === 'guest' && wsStatus === 'open'
              ? audioTransport === 'webrtc'
                ? ' · напрямую'
                : ' · через сервер'
              : ''}
          </span>
        </p>
        {lobby.playback.track && (
          <p className="truncate text-xs text-muted">
            Сейчас: {lobby.playback.track.title} — {lobby.playback.track.artist}
          </p>
        )}
      </div>
      {!onRoom && (
        <Button size="sm" variant="secondary" onClick={() => navigate(lobbyPath(lobby.id))}>
          Комната
        </Button>
      )}
      <Button
        size="sm"
        variant={role === 'host' ? 'danger' : 'ghost'}
        onClick={() => {
          void leaveCurrentLobby().finally(() => {
            if (location.pathname.startsWith('/lobby')) navigate(lobbyPath());
          });
        }}
      >
        <DoorOpen size={14} /> {role === 'host' ? 'Закрыть' : 'Выйти'}
      </Button>
    </div>
  );
}
