import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { SPOTIFY_WEB } from '@/lib/service-routes';

const QUERY_KEY = ['spotify-session', 'loggedIn'] as const;

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
      void queryClient.invalidateQueries({ queryKey: ['connectors'] });
      if (loggedIn) void queryClient.invalidateQueries({ queryKey: ['spotify'] });
      else queryClient.removeQueries({ queryKey: ['spotify'] });
    });
  }, [queryClient]);
  return data ?? false;
}

export async function logoutSpotifySession(): Promise<void> {
  await window.electronAPI.spotifySession.logout();
}

/** Только встроенный веб-плеер; остальной раздел Spotify — обычные страницы MSS. */
export function isSpotifyPath(pathname: string): boolean {
  return pathname === SPOTIFY_WEB || pathname.startsWith(`${SPOTIFY_WEB}/`);
}
