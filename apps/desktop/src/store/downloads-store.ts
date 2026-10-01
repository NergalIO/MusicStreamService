import type { DownloadRecord, UnifiedTrack } from '@mss/shared';
import { toast } from 'sonner';
import { create } from 'zustand';
import { apiFetch } from '@/lib/api';
import { freshCloudDownloadUrl } from '@/lib/cloud-urls';
import { formatBytes, formatTrackCount } from '@/lib/format';
import { undoableToast } from '@/lib/undo';
import { compressionKbps, useSettingsStore } from '@/store/settings-store';

type TrackRef = Pick<UnifiedTrack, 'source' | 'id'>;

interface ActiveDownload {
  received: number;
  total: number;
}

export type DownloadPanelStatus = 'downloading' | 'ready' | 'failed' | 'cancelled';

export interface DownloadPanelItem {
  key: string;
  title: string;
  artist: string;
  status: DownloadPanelStatus;
  received: number;
  total: number;
  error?: string;
}

interface DownloadsState {
  items: Record<string, DownloadRecord>;
  active: Record<string, ActiveDownload>;
  panelItems: DownloadPanelItem[];
  panelCollapsed: boolean;
  dir: string;
  init: () => () => void;
  refresh: () => Promise<void>;
  download: (track: UnifiedTrack, opts?: { silent?: boolean }) => Promise<boolean>;
  downloadMany: (tracks: UnifiedTrack[]) => Promise<void>;
  cancel: (key: string) => void;
  cancelAll: () => void;
  clearPanelFinished: () => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  remove: (track: TrackRef) => Promise<void>;
  removeMany: (tracks: TrackRef[]) => Promise<void>;
  reveal: (track: TrackRef) => void;
  chooseDir: () => Promise<void>;
  compressing: boolean;
  compressAll: () => Promise<void>;
}

/** То же правило, что в main: сжимаем lossless и файлы заметно «толще» целевого битрейта. */
export function isCompressible(record: DownloadRecord, kbps: number): boolean {
  if (!kbps) return false;
  if (record.codec.includes('flac')) return true;
  return !!record.bitrate && record.bitrate > kbps + 32;
}

export function downloadKey(track: TrackRef): string {
  return `${track.source}:${String(track.id).split(':')[0]}`;
}

export function canDownload(track: UnifiedTrack): boolean {
  if (!track.playable || !window.electronAPI) return false;
  if (track.source === 'yandex' || track.source === 'vk' || track.source === 'spotify') return true;
  if (track.source === 'local') {
    return !!(
      freshCloudDownloadUrl(track) ||
      track.availability === 'cached' ||
      track.availability === 'online'
    );
  }
  return false;
}

async function resolveDownloadTrack(track: UnifiedTrack): Promise<UnifiedTrack> {
  if (track.source !== 'local') return track;
  const cached = freshCloudDownloadUrl(track);
  if (cached) return { ...track, cloudDownloadUrl: cached };
  const { url } = await apiFetch<{ url: string }>(`/tracks/${track.id}/download`, {
    headers: { Accept: 'application/json' },
  });
  return { ...track, cloudDownloadUrl: url };
}

/** Файлы, удаление которых ещё можно отменить: из списка они уже скрыты, с диска — ещё нет. */
const pendingRemoval = new Set<string>();

window.addEventListener('beforeunload', () => {
  pendingRemoval.forEach((key) => void window.electronAPI?.downloads.remove(key));
});

function cleanError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function isCancelledError(e: unknown): boolean {
  return cleanError(e).includes('DOWNLOAD_CANCELLED');
}

function patchPanel(key: string, patch: Partial<DownloadPanelItem>): void {
  useDownloadsStore.setState((s) => ({
    panelItems: s.panelItems.map((i) => (i.key === key ? { ...i, ...patch } : i)),
  }));
}

function upsertPanel(item: DownloadPanelItem): void {
  useDownloadsStore.setState((s) => {
    const idx = s.panelItems.findIndex((i) => i.key === item.key);
    if (idx === -1) return { panelItems: [...s.panelItems, item], panelCollapsed: false };
    const next = [...s.panelItems];
    next[idx] = { ...next[idx], ...item };
    return { panelItems: next, panelCollapsed: false };
  });
}

export const useDownloadsStore = create<DownloadsState>()((set, get) => ({
  items: {},
  active: {},
  panelItems: [],
  panelCollapsed: false,
  dir: '',

  init: () => {
    const api = window.electronAPI?.downloads;
    if (!api) return () => undefined;
    void get().refresh();
    void api.getDir().then((dir) => set({ dir }));
    const offProgress = api.onProgress(({ key, received, total }) =>
      set((s) => {
        const active = s.active[key] ? { ...s.active, [key]: { received, total } } : s.active;
        const panelItems = s.panelItems.map((i) =>
          i.key === key && i.status === 'downloading' ? { ...i, received, total } : i,
        );
        return { active, panelItems };
      }),
    );
    const offChanged = api.onChanged(() => void get().refresh());
    return () => {
      offProgress();
      offChanged();
    };
  },

  refresh: async () => {
    const list = await window.electronAPI.downloads.list();
    set({ items: Object.fromEntries(list.filter((r) => !pendingRemoval.has(r.key)).map((r) => [r.key, r])) });
  },

  download: async (track, opts) => {
    const key = downloadKey(track);
    if (get().items[key] || get().active[key]) return true;
    upsertPanel({
      key,
      title: track.title,
      artist: track.artist,
      status: 'downloading',
      received: 0,
      total: 0,
    });
    set((s) => ({ active: { ...s.active, [key]: { received: 0, total: 0 } } }));
    try {
      const { downloadQuality, downloadCompression } = useSettingsStore.getState();
      const toDownload = await resolveDownloadTrack(track);
      const record = await window.electronAPI.downloads.start(
        toDownload,
        downloadQuality,
        compressionKbps(downloadCompression),
      );
      set((s) => ({ items: { ...s.items, [key]: record } }));
      patchPanel(key, { status: 'ready', received: record.size, total: record.size });
      if (!opts?.silent) toast.success(`Скачано: ${track.artist} — ${track.title}`);
      return true;
    } catch (e) {
      if (isCancelledError(e)) {
        patchPanel(key, { status: 'cancelled' });
        return false;
      }
      patchPanel(key, { status: 'failed', error: cleanError(e) });
      if (!opts?.silent) toast.error(`Не удалось скачать «${track.title}»: ${cleanError(e)}`);
      return false;
    } finally {
      set((s) => {
        const { [key]: _, ...active } = s.active;
        return { active };
      });
    }
  },

  downloadMany: async (tracks) => {
    const { items, active } = get();
    const queue = tracks.filter((t) => canDownload(t) && !items[downloadKey(t)] && !active[downloadKey(t)]);
    if (!queue.length) {
      toast('Всё уже скачано');
      return;
    }
    set({ panelCollapsed: false });
    const results = await Promise.all(queue.map((t) => get().download(t, { silent: true })));
    const ok = results.filter(Boolean).length;
    const statuses = queue.map((t) => get().panelItems.find((p) => p.key === downloadKey(t))?.status);
    const cancelled = statuses.filter((s) => s === 'cancelled').length;
    if (cancelled === queue.length) toast('Скачивание отменено');
    else if (ok === queue.length) toast.success(`Скачано ${formatTrackCount(ok)}`);
    else if (ok > 0) toast.error(`Скачано ${ok} из ${queue.length}`);
    else if (cancelled < queue.length) toast.error('Не удалось скачать треки');
  },

  cancel: (key) => {
    void window.electronAPI?.downloads.cancel(key);
    patchPanel(key, { status: 'cancelled' });
    set((s) => {
      const { [key]: _, ...active } = s.active;
      return { active };
    });
  },

  cancelAll: () => {
    void window.electronAPI?.downloads.cancelAll();
    set((s) => ({
      active: {},
      panelItems: s.panelItems.map((i) => (i.status === 'downloading' ? { ...i, status: 'cancelled' as const } : i)),
    }));
  },

  clearPanelFinished: () =>
    set((s) => ({
      panelItems: s.panelItems.filter((i) => i.status === 'downloading'),
    })),

  setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),

  remove: async (track) => {
    const key = downloadKey(track);
    const record = get().items[key];
    if (!record) return;
    pendingRemoval.add(key);
    set((s) => {
      const { [key]: _, ...items } = s.items;
      return { items };
    });
    const restore = () => {
      pendingRemoval.delete(key);
      set((s) => ({ items: { ...s.items, [key]: record } }));
    };
    undoableToast(`«${record.track.title}» удалён из скачанных`, {
      undo: restore,
      commit: () => {
        pendingRemoval.delete(key);
        void window.electronAPI.downloads.remove(key).catch((e) => {
          restore();
          toast.error(`Не удалось удалить файл: ${cleanError(e)}`);
        });
      },
    });
  },

  removeMany: async (tracks) => {
    const records = tracks.map((t) => get().items[downloadKey(t)]).filter((r): r is DownloadRecord => !!r);
    if (!records.length) return;
    if (records.length === 1) {
      await get().remove(records[0].track);
      return;
    }
    for (const r of records) pendingRemoval.add(r.key);
    set((s) => {
      const items = { ...s.items };
      for (const r of records) delete items[r.key];
      return { items };
    });
    const restore = () => {
      for (const r of records) pendingRemoval.delete(r.key);
      set((s) => ({ items: { ...s.items, ...Object.fromEntries(records.map((r) => [r.key, r])) } }));
    };
    undoableToast(`Удалено из скачанных: ${formatTrackCount(records.length)}`, {
      undo: restore,
      commit: () => {
        for (const r of records) pendingRemoval.delete(r.key);
        void Promise.all(records.map((r) => window.electronAPI.downloads.remove(r.key))).catch((e) => {
          restore();
          toast.error(`Не удалось удалить файлы: ${cleanError(e)}`);
        });
      },
    });
  },

  reveal: (track) => void window.electronAPI.downloads.reveal(downloadKey(track)),

  chooseDir: async () => {
    const dir = await window.electronAPI.downloads.chooseDir();
    if (dir) set({ dir });
  },

  compressing: false,
  compressAll: async () => {
    const kbps = compressionKbps(useSettingsStore.getState().downloadCompression);
    if (!kbps || get().compressing) return;
    set({ compressing: true });
    const id = toast.loading('Сжимаем скачанные треки…');
    try {
      const { compressed, failed, savedBytes } = await window.electronAPI.downloads.compressAll(kbps);
      const summary = `Сжато ${formatTrackCount(compressed)}, освобождено ${formatBytes(savedBytes)}`;
      if (failed) toast.error(`${summary}. Не удалось: ${failed}`, { id });
      else toast.success(compressed ? summary : 'Нечего сжимать', { id });
    } catch (e) {
      toast.error(`Не удалось сжать: ${cleanError(e)}`, { id });
    } finally {
      set({ compressing: false });
      void get().refresh();
    }
  },
}));

export function useDownloadState(track: TrackRef): { record?: DownloadRecord; active?: ActiveDownload } {
  const key = downloadKey(track);
  const record = useDownloadsStore((s) => s.items[key]);
  const active = useDownloadsStore((s) => s.active[key]);
  return { record, active };
}

export function downloadedFileUrl(track: TrackRef): string | null {
  const record = useDownloadsStore.getState().items[downloadKey(track)];
  return record ? `mss-stream://file/?p=${encodeURIComponent(record.path)}` : null;
}
