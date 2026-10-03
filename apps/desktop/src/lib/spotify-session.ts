import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionEvent } from '@/lib/logger';
import { SPOTIFY_WEB } from '@/lib/service-routes';

const QUERY_KEY = ['spotify-session', 'loggedIn'] as const;
const AUTH_QUERY_KEY = ['spotify-session', 'auth'] as const;

export function useSpotifySessionLoggedIn(): boolean {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => (window.electronAPI ? window.electronAPI.spotifySession.loggedIn() : false),
    staleTime: 15_000,
  });
  const queryClient = useQueryClient();
  useEffect(() => {
    return window.electronAPI?.spotifySession.onLoggedIn((loggedIn) => {
      const was = queryClient.getQueryData<boolean>(QUERY_KEY);
      queryClient.setQueryData(QUERY_KEY, loggedIn);
      if (was === loggedIn) return;
      sessionEvent('info', 'auth', loggedIn ? 'spotify connected' : 'spotify disconnected');
      void queryClient.invalidateQueries({ queryKey: ['connectors'] });
      void queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      if (loggedIn) void queryClient.invalidateQueries({ queryKey: ['spotify'] });
      else queryClient.removeQueries({ queryKey: ['spotify'] });
    });
  }, [queryClient]);
  return data ?? false;
}

export function useSpotifyAuth() {
  const loggedIn = useSpotifySessionLoggedIn();
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => window.electronAPI!.spotifySession.auth(),
    enabled: loggedIn && Boolean(window.electronAPI),
    staleTime: 60_000,
  });
}

export async function logoutSpotifySession(): Promise<void> {
  await window.electronAPI.spotifySession.logout();
}

/** Только встроенный веб-плеер; остальной раздел Spotify — обычные страницы MSS. */
export function isSpotifyPath(pathname: string): boolean {
  return pathname === SPOTIFY_WEB || pathname.startsWith(`${SPOTIFY_WEB}/`);
}
