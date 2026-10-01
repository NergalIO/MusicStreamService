import type { DeviceCodePrompt, LoginPrompt, UnifiedTrack } from '@mss/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { sessionEvent } from '@/lib/logger';

export interface ConnectorStatus {
  id: string;
  status: string;
  name: string;
}

export function useConnectors() {
  return useQuery({
    queryKey: ['connectors'],
    queryFn: async (): Promise<ConnectorStatus[]> =>
      window.electronAPI ? window.electronAPI.connectors.status() : [],
    staleTime: 30_000,
  });
}

/** Главный процесс сообщает, что сессия сервиса изменилась (например, протухла посреди запроса). */
export function useConnectorStatusSync(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      window.electronAPI?.connectors.onStatusChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['connectors'] });
      }),
    [queryClient],
  );
}

export function useYandexConnected(): boolean {
  const { data } = useConnectors();
  return data?.some((c) => c.id === 'yandex' && c.status === 'connected') ?? false;
}

export function useVkConnected(): boolean {
  const { data } = useConnectors();
  return data?.some((c) => c.id === 'vk' && c.status === 'connected') ?? false;
}

/** Spotify «подключён», когда выполнен вход во встроенный веб-плеер. */
export { useSpotifySessionLoggedIn as useSpotifyConnected } from '@/lib/spotify-session';

export function useYandexAccount() {
  const connected = useYandexConnected();
  return useQuery({
    queryKey: ['yandex-account'],
    queryFn: () => window.electronAPI.yandex.account(true),
    enabled: connected,
    staleTime: 5 * 60_000,
  });
}

export function useVkAccount() {
  const connected = useVkConnected();
  return useQuery({
    queryKey: ['vk-account'],
    queryFn: () => window.electronAPI.connectors.account('vk'),
    enabled: connected,
    staleTime: 5 * 60_000,
  });
}

interface ConnectState {
  connecting: string | null;
  prompt: DeviceCodePrompt | null;
  loginPrompt: LoginPrompt | null;
  setPrompt: (prompt: DeviceCodePrompt) => void;
  setLoginPrompt: (prompt: LoginPrompt | null) => void;
}

export const useConnectStore = create<ConnectState>()((set) => ({
  connecting: null,
  prompt: null,
  loginPrompt: null,
  setPrompt: (prompt) => set({ prompt }),
  setLoginPrompt: (loginPrompt) => set({ loginPrompt }),
}));

function connectedToast(id: string): string {
  if (id === 'yandex') return 'Яндекс Музыка подключена';
  if (id === 'vk') return 'VK Музыка подключена';
  if (id === 'spotify') return 'Spotify подключён';
  return 'Сервис подключён';
}

export async function connectSource(id: string, queryClient: QueryClient): Promise<void> {
  useConnectStore.setState({ connecting: id, prompt: null, loginPrompt: null });
  sessionEvent('info', 'auth', `connect ${id}`);
  try {
    await window.electronAPI.connectors.connect(id);
    sessionEvent('info', 'auth', `${id} connected`);
    toast.success(connectedToast(id));
  } catch (e) {
    const message = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
    if (!/abort|отмен/i.test(message)) {
      sessionEvent('error', 'connector', message || `connect ${id} failed`);
      toast.error(message || 'Не удалось подключиться');
    }
  } finally {
    useConnectStore.setState({ connecting: null, prompt: null, loginPrompt: null });
    await queryClient.invalidateQueries({ queryKey: ['connectors'] });
    await queryClient.invalidateQueries({ queryKey: ['yandex-account'] });
    await queryClient.invalidateQueries({ queryKey: ['vk-account'] });
  }
}

export async function cancelConnect(): Promise<void> {
  const id = useConnectStore.getState().connecting;
  if (id) await window.electronAPI.connectors.cancelConnect(id);
}

export async function replyVkLogin(reply: Parameters<typeof window.electronAPI.connectors.loginReply>[0]): Promise<void> {
  await window.electronAPI.connectors.loginReply(reply);
}

/** Единая точка отключения: сервис, его кеш запросов и состояние «подключено» расходиться не должны. */
export async function disconnectSource(id: string, queryClient: QueryClient): Promise<void> {
  sessionEvent('info', 'auth', `disconnect ${id}`);
  if (id === 'spotify') {
    await window.electronAPI.spotifySession.logout();
  } else {
    await window.electronAPI.connectors.disconnect(id);
  }
  queryClient.removeQueries({ queryKey: [id] });
  await queryClient.invalidateQueries({ queryKey: ['connectors'] });
  if (id === 'spotify') await queryClient.invalidateQueries({ queryKey: ['spotify-session'] });
  if (id === 'yandex') queryClient.setQueryData(['yandex-account'], null);
  if (id === 'vk') queryClient.setQueryData(['vk-account'], null);
}

export async function setVkSaved(track: UnifiedTrack, saved: boolean): Promise<void> {
  await window.electronAPI.connectors.setSaved('vk', track, saved);
}
