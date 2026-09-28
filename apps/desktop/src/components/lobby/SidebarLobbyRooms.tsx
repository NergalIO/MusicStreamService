import type { LobbyDto, LobbySummaryDto } from '@mss/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LobbyRoomList } from '@/components/lobby/LobbyRoomList';
import { joinLobby } from '@/lib/lobby-api';
import { enterLobbySession } from '@/lib/lobby-session';
import { useLobbyStore } from '@/store/lobby-store';

export function SidebarLobbyRooms({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentId = useLobbyStore((s) => s.lobby?.id);

  const joinMut = useMutation({
    mutationFn: (room: LobbySummaryDto) => joinLobby(room.inviteCode),
    onSuccess: (dto: LobbyDto) => {
      enterLobbySession(dto);
      void queryClient.invalidateQueries({ queryKey: ['lobbies', 'active'] });
      navigate(`/lobby/${dto.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось войти'),
  });

  if (collapsed) return null;

  return (
    <LobbyRoomList
      compact
      joiningId={joinMut.isPending ? (joinMut.variables?.id ?? null) : null}
      onJoin={(room) => {
        if (currentId === room.id) {
          navigate(`/lobby/${room.id}`);
          return;
        }
        joinMut.mutate(room);
      }}
    />
  );
}
