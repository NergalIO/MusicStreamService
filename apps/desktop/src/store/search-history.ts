import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX = 12;

interface SearchHistoryState {
  items: string[];
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

export const useSearchHistory = create<SearchHistoryState>()(
  persist(
    (set) => ({
      items: [],
      add: (query) =>
        set((s) => {
          const q = query.trim();
          if (!q) return s;
          return { items: [q, ...s.items.filter((i) => i.toLowerCase() !== q.toLowerCase())].slice(0, MAX) };
        }),
      remove: (query) => set((s) => ({ items: s.items.filter((i) => i !== query) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'mss-search-history' },
  ),
);
