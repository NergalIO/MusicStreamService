import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarSectionId =
  | 'media'
  | 'mss'
  | 'yandex'
  | 'spotify'
  | 'mssPlaylists'
  | 'yandexPlaylists'
  | 'spotifyPlaylists'
  | 'vk'
  | 'vkPlaylists';

/** Верхнеуровневые блоки боковой панели (можно полностью скрыть). */
export type SidebarCategoryId = 'media' | 'mss' | 'yandex' | 'spotify' | 'vk';

export const SIDEBAR_CATEGORIES: readonly { id: SidebarCategoryId; label: string }[] = [
  { id: 'media', label: 'Медиатека' },
  { id: 'mss', label: 'MSS' },
  { id: 'yandex', label: 'Яндекс Музыка' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'vk', label: 'VK Музыка' },
] as const;

const defaultHidden: Record<SidebarCategoryId, boolean> = {
  media: false,
  mss: false,
  yandex: false,
  spotify: false,
  vk: false,
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
  media: true,
  mss: true,
  yandex: true,
  spotify: true,
  mssPlaylists: true,
  yandexPlaylists: true,
  spotifyPlaylists: true,
  vk: true,
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
      version: 3,
      migrate: (persisted) => {
        const state = persisted as {
          sectionsOpen?: Partial<Record<SidebarSectionId, boolean>>;
          sectionsHidden?: Partial<Record<SidebarCategoryId, boolean>>;
          pinnedPlaylists?: SidebarPlaylistPin[];
        } | undefined;
        return {
          sectionsOpen: { ...defaultOpen, ...state?.sectionsOpen },
          sectionsHidden: { ...defaultHidden, ...state?.sectionsHidden },
          pinnedPlaylists: state?.pinnedPlaylists ?? [],
        };
      },
    },
  ),
);
