import { create } from 'zustand';

export type RelayStatus = 'uploading' | 'done' | 'failed' | 'need_file';

export interface RelayItem {
  sessionId: string;
  trackId: string;
  title: string;
  status: RelayStatus;
  error?: string;
}

interface RelayState {
  items: RelayItem[];
  upsert: (item: RelayItem) => void;
  patch: (sessionId: string, patch: Partial<RelayItem>) => void;
  clearFinished: () => void;
}

export const useRelayStore = create<RelayState>()((set) => ({
  items: [],
  upsert: (item) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.sessionId === item.sessionId);
      if (idx < 0) return { items: [item, ...s.items].slice(0, 8) };
      const next = [...s.items];
      next[idx] = { ...next[idx], ...item };
      return { items: next };
    }),
  patch: (sessionId, patch) =>
    set((s) => ({
      items: s.items.map((i) => (i.sessionId === sessionId ? { ...i, ...patch } : i)),
    })),
  clearFinished: () => set((s) => ({ items: s.items.filter((i) => i.status === 'uploading' || i.status === 'need_file') })),
}));
