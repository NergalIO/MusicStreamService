import type { LobbyDto, LobbyMemberRole } from '@mss/shared';

export function notifyLobbyPresence(lobby: LobbyDto | null, role: LobbyMemberRole | null): void {
  void window.electronAPI?.lobby?.setPresence?.({
    active: !!lobby && !!role,
    lobbyId: lobby?.id ?? null,
    inviteCode: lobby?.inviteCode ?? null,
    title: lobby?.title ?? null,
    memberCount: lobby?.members.length ?? 0,
    maxMembers: lobby?.maxMembers ?? 0,
    role: lobby && role ? role : null,
  });
}
