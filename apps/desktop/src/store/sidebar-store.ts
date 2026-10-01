import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarSectionId =
  | 'mss'
  | 'yandex'
  | 'spotify'
  | 'vk'
  | 'party'
  | 'mssPlaylists'
  | 'yandexPlaylists'
  | 'spotifyPlaylists'
  | 'vkPlaylists';

/** Верхнеуровневые блоки боковой панели (можно полностью скрыть). */
export type SidebarCategoryId = 'mss' | 'yandex' | 'spotify' | 'vk' | 'party';

export const SIDEBAR_CATEGORIES: readonly { id: SidebarCategoryId; label: string }[] = [
  { id: 'mss', label: 'MSS' },
  { id: 'yandex', label: 'Яндекс Музыка' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'vk', label: 'VK Музыка' },
  { id: 'party', label: 'Listening party' },
] as const;

const defaultHidden: Record<SidebarCategoryId, boolean> = {
  mss: false,
  yandex: false,
  spotify: false,
  vk: false,
  party: false,
};

export function isSidebarCategory(id: SidebarSectionId): id is SidebarCategoryId {
  return id in defaultHidden;
}

export type SidebarPlaylistPin = { source: 'local' | 'yandex' | 'spotify' | 'vk'; id: string };

export function sidebarPinKey(pin: SidebarPlaylistPin): string {
  return `${pin.source}:${pin.id}`;
}

interface SidebarState {
  sectionsOpen: Record<SidebarSectionId, boolean>;
  sectionsHidden: Record<SidebarCategoryId, boolean>;
  pinnedPlaylists: SidebarPlaylistPin[];
  toggleSection: (id: SidebarSectionId) => void;
  setSectionOpen: (id: SidebarSectionId, open: boolean) => void;
  setSectionHidden: (id: SidebarCategoryId, hidden: boolean) => void;
  showAllCategories: () => void;
  isPinned: (source: SidebarPlaylistPin['source'], id: string) => boolean;
  togglePin: (source: SidebarPlaylistPin['source'], id: string) => void;
}

const defaultOpen: Record<SidebarSectionId, boolean> = {
  mss: true,
  yandex: true,
  spotify: true,
  vk: true,
  party: true,
  mssPlaylists: true,
  yandexPlaylists: true,
  spotifyPlaylists: true,
  vkPlaylists: true,
};

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      sectionsOpen: { ...defaultOpen },
      sectionsHidden: { ...defaultHidden },
      pinnedPlaylists: [],
      toggleSection: (id) =>
        set((s) => ({
          sectionsOpen: { ...s.sectionsOpen, [id]: !s.sectionsOpen[id] },
        })),
      setSectionOpen: (id, open) =>
        set((s) => ({
          sectionsOpen: { ...s.sectionsOpen, [id]: open },
        })),
      setSectionHidden: (id, hidden) =>
        set((s) => ({
          sectionsHidden: { ...s.sectionsHidden, [id]: hidden },
        })),
      showAllCategories: () => set({ sectionsHidden: { ...defaultHidden } }),
      isPinned: (source, id) => get().pinnedPlaylists.some((p) => p.source === source && p.id === id),
      togglePin: (source, id) =>
        set((s) => {
          const key = sidebarPinKey({ source, id });
          const exists = s.pinnedPlaylists.some((p) => sidebarPinKey(p) === key);
          return {
            pinnedPlaylists: exists
              ? s.pinnedPlaylists.filter((p) => sidebarPinKey(p) !== key)
              : [...s.pinnedPlaylists, { source, id }],
          };
        }),
    }),
    {
      name: 'mss-sidebar',
      version: 4,
      migrate: (persisted) => {
        const state = persisted as {
          sectionsOpen?: Partial<Record<string, boolean>>;
          sectionsHidden?: Partial<Record<string, boolean>>;
          pinnedPlaylists?: SidebarPlaylistPin[];
        } | undefined;
        const sectionsHidden: Record<SidebarCategoryId, boolean> = { ...defaultHidden };
        for (const id of Object.keys(defaultHidden) as SidebarCategoryId[]) {
          if (state?.sectionsHidden?.[id]) sectionsHidden[id] = true;
        }
        const sectionsOpen: Record<SidebarSectionId, boolean> = { ...defaultOpen };
        for (const id of Object.keys(defaultOpen) as SidebarSectionId[]) {
          if (typeof state?.sectionsOpen?.[id] === 'boolean') sectionsOpen[id] = state.sectionsOpen[id]!;
        }
        return {
          sectionsOpen,
          sectionsHidden,
          pinnedPlaylists: state?.pinnedPlaylists ?? [],
        };
      },
    },
  ),
);
