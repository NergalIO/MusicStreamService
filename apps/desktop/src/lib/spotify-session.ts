import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

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
      queryClient.setQueryData(QUERY_KEY, loggedIn);
    });
  }, [queryClient]);
  return data ?? false;
}

export async function logoutSpotifySession(): Promise<void> {
  await window.electronAPI.spotifySession.logout();
}

export function isSpotifyPath(pathname: string): boolean {
  return pathname === '/spotify' || pathname.startsWith('/spotify/');
}
