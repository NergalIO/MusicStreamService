const STORAGE_KEY = 'mss_active_lobby_id';

export function rememberActiveLobby(lobbyId: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, lobbyId);
  } catch {
    /* private mode */
  }
}

export function forgetActiveLobby(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function readActiveLobbyId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function lobbyPath(lobbyId?: string | null): string {
  return lobbyId ? `/lobby/${lobbyId}` : '/lobby';
}
