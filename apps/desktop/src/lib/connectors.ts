import type { DeviceCodePrompt } from '@mss/shared';
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

export function useSpotifyConnected(): boolean {
  const { data } = useConnectors();
  return data?.some((c) => c.id === 'spotify' && c.status !== 'disconnected') ?? false;
}

export function useSpotifyAvailable(): boolean {
  const { data } = useConnectors();
  return data?.some((c) => c.id === 'spotify') ?? false;
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

interface ConnectState {
  connecting: string | null;
  prompt: DeviceCodePrompt | null;
  setPrompt: (prompt: DeviceCodePrompt) => void;
}

export const useConnectStore = create<ConnectState>()((set) => ({
  connecting: null,
  prompt: null,
  setPrompt: (prompt) => set({ prompt }),
}));

export async function connectSource(id: string, queryClient: QueryClient): Promise<void> {
  useConnectStore.setState({ connecting: id, prompt: null });
  try {
    await window.electronAPI.connectors.connect(id);
    toast.success(
      id === 'yandex' ? 'Яндекс Музыка подключена' : id === 'spotify' ? 'Spotify подключён' : 'Сервис подключён',
    );
  } catch (e) {
    const message = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
    if (!/abort|отмен/i.test(message)) toast.error(message || 'Не удалось подключиться');
  } finally {
    useConnectStore.setState({ connecting: null, prompt: null });
    await queryClient.invalidateQueries({ queryKey: ['connectors'] });
    await queryClient.invalidateQueries({ queryKey: ['yandex-account'] });
    await queryClient.invalidateQueries({ queryKey: ['spotify'] });
  }
}

export async function cancelConnect(): Promise<void> {
  const id = useConnectStore.getState().connecting;
  if (id) await window.electronAPI.connectors.cancelConnect(id);
}

export async function disconnectSource(id: string, queryClient: QueryClient): Promise<void> {
  await window.electronAPI.connectors.disconnect(id);
  if (id === 'yandex') queryClient.removeQueries({ queryKey: ['yandex'] });
  if (id === 'spotify') queryClient.removeQueries({ queryKey: ['spotify'] });
  await queryClient.invalidateQueries({ queryKey: ['connectors'] });
  if (id === 'yandex') queryClient.setQueryData(['yandex-account'], null);
}

/** Отключить и снова пройти OAuth (нужно после смены scopes Spotify). */
export async function reconnectSource(id: string, queryClient: QueryClient): Promise<void> {
  await disconnectSource(id, queryClient);
  await connectSource(id, queryClient);
}

export function isSpotifyScopeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (/allowlist|User Management|403 Forbidden для/i.test(msg)) return false;
  return /недостаточно прав spotify|подтвердив доступ/i.test(msg);
}
