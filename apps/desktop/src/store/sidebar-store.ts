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

export type SidebarPlaylistPin = { source: 'local' | 'yandex' | 'spotify' | 'vk'; id: string };

export function sidebarPinKey(pin: SidebarPlaylistPin): string {
  return `${pin.source}:${pin.id}`;
}

interface SidebarState {
  sectionsOpen: Record<SidebarSectionId, boolean>;
  pinnedPlaylists: SidebarPlaylistPin[];
  toggleSection: (id: SidebarSectionId) => void;
  setSectionOpen: (id: SidebarSectionId, open: boolean) => void;
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
      pinnedPlaylists: [],
      toggleSection: (id) =>
        set((s) => ({
          sectionsOpen: { ...s.sectionsOpen, [id]: !s.sectionsOpen[id] },
        })),
      setSectionOpen: (id, open) =>
        set((s) => ({
          sectionsOpen: { ...s.sectionsOpen, [id]: open },
        })),
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
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { sectionsOpen?: Partial<Record<SidebarSectionId, boolean>>; pinnedPlaylists?: SidebarPlaylistPin[] } | undefined;
        return {
          sectionsOpen: { ...defaultOpen, ...state?.sectionsOpen },
          pinnedPlaylists: state?.pinnedPlaylists ?? [],
        };
      },
    },
  ),
);
