import type { UpdateStatus } from '../../electron/preload/index';
import { create } from 'zustand';

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string | null;
  dismissedVersion: string | null;
  /** Ошибка установки — показать диалог, даже если версию отложили. */
  installError: boolean;
  apply: (status: UpdateStatus) => void;
  check: () => Promise<UpdateStatus | undefined>;
  install: () => Promise<void>;
  dismiss: () => void;
}

const idle: UpdateStatus = { state: 'idle' };

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: idle,
  currentVersion: null,
  dismissedVersion: null,
  installError: false,
  apply: (status) =>
    set((s) => ({
      status,
      currentVersion: status.currentVersion ?? s.currentVersion,
      installError:
        status.state === 'error'
          ? s.status.state === 'downloading' || s.status.state === 'installing' || s.installError
          : false,
    })),
  check: async () => {
    const api = window.electronAPI;
    if (!api) return undefined;
    const status = await api.system.checkForUpdate();
    set({
      status,
      currentVersion: status.currentVersion ?? get().currentVersion,
      dismissedVersion: status.state === 'available' ? null : get().dismissedVersion,
      installError: false,
    });
    return status;
  },
  install: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const status = await api.system.installUpdate();
    set({
      status,
      currentVersion: status.currentVersion ?? get().currentVersion,
      installError: status.state === 'error',
    });
  },
  dismiss: () =>
    set((s) => ({
      dismissedVersion: s.status.version ?? s.dismissedVersion,
      installError: false,
    })),
}));

export function hasUpdateBadge(status: UpdateStatus): boolean {
  return status.state === 'available' || status.state === 'downloading' || status.state === 'installing' || status.state === 'error';
}

export function initUpdateStore(): () => void {
  const api = window.electronAPI;
  if (!api) return () => undefined;
  void api.system.version().then((version) => useUpdateStore.setState({ currentVersion: version }));
  const unsub = api.system.onUpdate((status) => useUpdateStore.getState().apply(status));
  void api.system.updateStatus().then((status) => {
    if (useUpdateStore.getState().status.state !== 'idle') return;
    useUpdateStore.getState().apply(status);
  });
  return unsub;
}
