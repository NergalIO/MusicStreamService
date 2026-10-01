import { toast } from 'sonner';
import { create } from 'zustand';
import { apiFetch, currentAccessToken } from '@/lib/api';
import { audioContentType, rememberCloudUrls } from '@/lib/cloud-urls';
import { setTrackCover } from '@/lib/mss-library';
import { formatTrackCount } from '@/lib/format';
import { queryClient } from '@/lib/query-client';
import type { LocalTrackDto } from '@/lib/sources';

export const AUDIO_ACCEPT = '.mp3,.flac,.m4a,.aac,.ogg,.oga,.opus,.wav,.wma,.aif,.aiff,.ape,.wv,.webm,audio/*';
const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|wma|aiff?|ape|wv|webm)$/i;
const MAX_BYTES = 500 * 1024 * 1024;
const PARALLEL = 2;

export type UploadStatus =
  | 'queued'
  | 'hashing'
  | 'registering'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

type CloudUploadRes = {
  skipUpload: boolean;
  alreadyReady: boolean;
  uploadUrl?: string;
  headers?: Record<string, string>;
} & Partial<LocalTrackDto>;

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  playlistId?: string;
  status: UploadStatus;
  /** 0..1 — прогресс подготовки (хеширование). */
  progress: number;
  trackId?: string;
  title?: string;
  error?: string;
}

interface UploadsState {
  items: UploadItem[];
  collapsed: boolean;
  upload: (files: File[] | FileList, opts?: { playlistId?: string }) => void;
  uploadFromDialog: (opts?: { playlistId?: string }) => void;
  clearFinished: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

const paths = new Map<string, string>();
let active = 0;

export function isAudioFile(file: File): boolean {
  return AUDIO_EXT.test(file.name) || file.type.startsWith('audio/');
}

function patch(id: string, changes: Partial<UploadItem>): void {
  useUploadsStore.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...changes } : i)) }));
}

function refreshLists(playlistId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ['tracks'] });
  void queryClient.invalidateQueries({ queryKey: ['my-uploads'] });
  void queryClient.invalidateQueries({ queryKey: ['playlists'] });
  if (playlistId) void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
}

async function registerPath(item: UploadItem, filePath: string): Promise<void> {
  const api = window.electronAPI?.localTracks;
  if (!api) throw new Error('Регистрация локальных треков доступна только в приложении');

  patch(item.id, { status: 'hashing', progress: 0.1 });
  const prepared = await api.prepare(filePath);
  if (prepared.sizeBytes > MAX_BYTES) throw new Error('Файл больше 500 МБ');

  patch(item.id, { status: 'registering', progress: 0.6 });
  const query = item.playlistId ? `?playlistId=${encodeURIComponent(item.playlistId)}` : '';
  const body = JSON.stringify({
    contentHash: prepared.contentHash,
    title: prepared.title,
    artist: prepared.artist,
    album: prepared.album ?? undefined,
    durationMs: prepared.durationMs ?? undefined,
    sizeBytes: prepared.sizeBytes,
    originalFilename: prepared.originalFilename,
  });
  const track = await apiFetch<LocalTrackDto>(`/tracks/register${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  await api.bind(track.id, prepared.path, prepared.contentHash);

  const contentType = audioContentType(prepared.originalFilename);
  patch(item.id, { status: 'uploading', progress: 0.65 });
  const cloud = await apiFetch<CloudUploadRes>(`/tracks/${track.id}/cloud-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType }),
  });

  if (!cloud.skipUpload) {
    if (!cloud.uploadUrl) throw new Error('Сервер не выдал ссылку загрузки');
    if (!api.putToUrl) throw new Error('Загрузка в облако доступна только в приложении');
    const offProgress = api.onPutProgress?.(({ id, loaded, total }) => {
      if (id !== item.id || !total) return;
      patch(item.id, { progress: 0.65 + 0.25 * (loaded / total) });
    });
    try {
      await api.putToUrl(prepared.path, cloud.uploadUrl, cloud.headers ?? { 'Content-Type': contentType }, item.id);
    } finally {
      offProgress?.();
    }
  }

  let done: LocalTrackDto = track;
  if (cloud.alreadyReady) {
    done = { ...track, ...cloud, id: track.id };
  } else {
    patch(item.id, { status: 'processing', progress: 0.95 });
    done = await apiFetch<LocalTrackDto>(`/tracks/${track.id}/cloud-complete`, { method: 'POST' });
  }
  rememberCloudUrls(done.id, done);

  const cover = prepared.coverJpeg;
  if (cover?.byteLength && !done.coverUrl) {
    try {
      await setTrackCover(done.id, new Blob([cover], { type: 'image/jpeg' }));
    } catch {
      /* обложка необязательна */
    }
  }

  patch(item.id, {
    status: done.status === 'ready' ? 'ready' : 'processing',
    progress: 1,
    trackId: done.id,
    title: `${done.artist} — ${done.title}`,
  });
}

async function run(item: UploadItem): Promise<void> {
  const filePath = paths.get(item.id);
  if (!filePath) {
    patch(item.id, { status: 'failed', error: 'Не удалось получить путь к файлу' });
    return;
  }
  try {
    await registerPath(item, filePath);
    refreshLists(item.playlistId);
  } catch (e) {
    patch(item.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
  } finally {
    paths.delete(item.id);
    refreshLists(item.playlistId);
  }
}

function pump(): void {
  while (active < PARALLEL) {
    const next = useUploadsStore.getState().items.find((i) => i.status === 'queued');
    if (!next) break;
    active++;
    void run(next).finally(() => {
      active--;
      pump();
      notifyIfDone();
    });
  }
}

function notifyIfDone(): void {
  const { items } = useUploadsStore.getState();
  if (
    items.some(
      (i) =>
        i.status === 'queued' ||
        i.status === 'hashing' ||
        i.status === 'registering' ||
        i.status === 'uploading',
    )
  )
    return;
  const ok = items.filter((i) => i.status === 'ready' || i.status === 'processing').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  if (failed) toast.error(`Добавлено ${ok} из ${ok + failed}`);
  else if (ok) toast.success(`Добавлено ${formatTrackCount(ok)}`);
}

function enqueuePaths(filePaths: string[], opts?: { playlistId?: string }): void {
  if (!filePaths.length) return;
  if (!currentAccessToken()) {
    toast.error('Войдите в аккаунт MSS');
    return;
  }
  const added: UploadItem[] = filePaths.map((filePath) => {
    const id = crypto.randomUUID();
    paths.set(id, filePath);
    const name = filePath.replace(/^.*[/\\]/, '');
    return { id, name, size: 0, playlistId: opts?.playlistId, status: 'queued', progress: 0 };
  });
  useUploadsStore.setState((s) => ({
    items: [...s.items.filter((i) => i.status !== 'ready'), ...added],
    collapsed: false,
  }));
  pump();
}

export const useUploadsStore = create<UploadsState>()((set) => ({
  items: [],
  collapsed: false,

  upload: (input, opts) => {
    const api = window.electronAPI?.localTracks;
    if (!api?.getPathForFile) {
      toast.error('Выберите файлы через «Добавить» — нужен десктоп-клиент');
      return;
    }
    const list = Array.from(input);
    const audio = list.filter(isAudioFile);
    const skipped = list.length - audio.length;
    if (skipped) toast.warning(`Пропущено файлов, которые не похожи на аудио: ${skipped}`);
    const filePaths = audio.map((f) => api.getPathForFile!(f)).filter(Boolean);
    if (!filePaths.length) {
      toast.error('Не удалось получить путь к файлу');
      return;
    }
    enqueuePaths(filePaths, opts);
  },

  uploadFromDialog: (opts) => {
    const api = window.electronAPI?.localTracks;
    if (!api) {
      toast.error('Доступно только в приложении MSS');
      return;
    }
    void api.pickFiles().then((filePaths) => enqueuePaths(filePaths, opts));
  },

  clearFinished: () =>
    set((s) => ({
      items: s.items.filter((i) => i.status !== 'ready' && i.status !== 'failed' && i.status !== 'processing'),
    })),

  setCollapsed: (collapsed) => set({ collapsed }),
}));
