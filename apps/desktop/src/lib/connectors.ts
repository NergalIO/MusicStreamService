import type { DeviceCodePrompt, LoginPrompt, UnifiedTrack } from '@mss/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { create } from 'zustand';

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

export function useYandexConnected(): boolean {
  const { data } = useConnectors();
  return data?.some((c) => c.id === 'yandex' && c.status === 'connected') ?? false;
}

export function useVkConnected(): boolean {
  const { data } = useConnectors();
  return data?.some((c) => c.id === 'vk' && c.status === 'connected') ?? false;
}

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
  try {
    await window.electronAPI.connectors.connect(id);
    toast.success(connectedToast(id));
  } catch (e) {
    const message = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
    if (!/abort|отмен/i.test(message)) toast.error(message || 'Не удалось подключиться');
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

export async function disconnectSource(id: string, queryClient: QueryClient): Promise<void> {
  await window.electronAPI.connectors.disconnect(id);
  if (id === 'yandex') queryClient.removeQueries({ queryKey: ['yandex'] });
  if (id === 'vk') queryClient.removeQueries({ queryKey: ['vk'] });
  await queryClient.invalidateQueries({ queryKey: ['connectors'] });
  if (id === 'yandex') queryClient.setQueryData(['yandex-account'], null);
  if (id === 'vk') queryClient.setQueryData(['vk-account'], null);
}

export async function setVkSaved(track: UnifiedTrack, saved: boolean): Promise<void> {
  await window.electronAPI.connectors.setSaved('vk', track, saved);
}
