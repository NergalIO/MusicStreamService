import { toast } from 'sonner';
import { create } from 'zustand';
import { apiFetch, currentAccessToken } from '@/lib/api';
import { audioContentType, rememberCloudUrls } from '@/lib/cloud-urls';
import { createAlbum, setAlbumCover, setTrackCover } from '@/lib/mss-library';
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
  albumId?: string;
  albumJobId?: string;
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
  upload: (files: File[] | FileList, opts?: { playlistId?: string; albumId?: string }) => void;
  uploadFromDialog: (opts?: { playlistId?: string; albumId?: string }) => void;
  uploadAlbumFromDialog: () => void;
  clearFinished: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

const paths = new Map<string, string>();
let active = 0;

type AlbumJob = {
  title: string;
  artist: string;
  year: number | null;
  coverJpeg?: Uint8Array;
  items: string[];
};

const albumJobs = new Map<string, AlbumJob>();
const albumFinalizing = new Set<string>();

export function isAudioFile(file: File): boolean {
  return AUDIO_EXT.test(file.name) || file.type.startsWith('audio/');
}

function patch(id: string, changes: Partial<UploadItem>): void {
  useUploadsStore.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...changes } : i)) }));
}

function refreshLists(playlistId?: string, albumId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ['tracks'] });
  void queryClient.invalidateQueries({ queryKey: ['my-uploads'] });
  void queryClient.invalidateQueries({ queryKey: ['my-albums'] });
  void queryClient.invalidateQueries({ queryKey: ['playlists'] });
  if (playlistId) void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
  if (albumId) void queryClient.invalidateQueries({ queryKey: ['album', 'local', albumId] });
}

function watchUntilReady(itemId: string, trackId: string, playlistId?: string): void {
  const deadline = Date.now() + 30 * 60_000;
  const poll = async () => {
    const current = useUploadsStore.getState().items.find((i) => i.id === itemId);
    if (!current || current.status !== 'processing') return;
    try {
      const t = await apiFetch<LocalTrackDto>(`/tracks/${trackId}`);
      if (t.status === 'ready') {
        patch(itemId, { status: 'ready', title: `${t.artist} — ${t.title}` });
        refreshLists(playlistId);
        notifyIfDone();
        return;
      }
      if (t.status === 'failed') {
        patch(itemId, { status: 'failed', error: 'Не удалось обработать файл на сервере' });
        refreshLists(playlistId);
        notifyIfDone();
        return;
      }
    } catch {
      /* сеть — пробуем ещё */
    }
    if (Date.now() > deadline) {
      patch(itemId, {
        status: 'failed',
        error: 'Конвертация на сервере слишком долгая. Проверьте логи воркера или вкладку «Мои треки».',
      });
      notifyIfDone();
      return;
    }
    window.setTimeout(() => void poll(), 3000);
  };
  window.setTimeout(() => void poll(), 3000);
}

async function registerPath(item: UploadItem, filePath: string): Promise<void> {
  const api = window.electronAPI?.localTracks;
  if (!api) throw new Error('Регистрация локальных треков доступна только в приложении');

  patch(item.id, { status: 'hashing', progress: 0.1 });
  const prepared = await api.prepare(filePath);
  if (prepared.sizeBytes > MAX_BYTES) throw new Error('Файл больше 500 МБ');

  patch(item.id, { status: 'registering', progress: 0.6 });
  const params = new URLSearchParams();
  if (item.playlistId) params.set('playlistId', item.playlistId);
  if (item.albumId) params.set('albumId', item.albumId);
  const query = params.size ? `?${params}` : '';
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
  patch(item.id, { trackId: track.id });
  if (item.albumJobId && prepared.coverJpeg) {
    const job = albumJobs.get(item.albumJobId);
    if (job && !job.coverJpeg) job.coverJpeg = prepared.coverJpeg;
  }

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
    patch(item.id, { status: 'processing', progress: 0.95, trackId: track.id });
    refreshLists(item.playlistId);
    done = await apiFetch<LocalTrackDto>(`/tracks/${track.id}/cloud-complete`, { method: 'POST' });
  }
  rememberCloudUrls(done.id, done);

  if (prepared.lyrics?.text.trim()) {
    try {
      await apiFetch(`/tracks/${done.id}/lyrics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared.lyrics),
      });
    } catch {
      /* текст необязателен */
    }
  }

  const cover = prepared.coverJpeg;
  if (cover?.byteLength && !done.coverUrl) {
    try {
      await setTrackCover(done.id, jpegBlob(cover));
    } catch {
      /* обложка необязательна */
    }
  }

  patch(item.id, {
    status: done.status === 'ready' ? 'ready' : done.status === 'failed' ? 'failed' : 'processing',
    progress: 1,
    trackId: done.id,
    title: `${done.artist} — ${done.title}`,
    error: done.status === 'failed' ? 'Не удалось обработать файл на сервере' : undefined,
  });
  if (done.status !== 'ready' && done.status !== 'failed') {
    watchUntilReady(item.id, done.id, item.playlistId);
  }
}

async function run(item: UploadItem): Promise<void> {
  const filePath = paths.get(item.id);
  if (!filePath) {
    patch(item.id, { status: 'failed', error: 'Не удалось получить путь к файлу' });
    return;
  }
  try {
    await registerPath(item, filePath);
    refreshLists(item.playlistId, item.albumId);
  } catch (e) {
    patch(item.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
  } finally {
    paths.delete(item.id);
    refreshLists(item.playlistId, item.albumId);
    void finalizeReadyAlbums();
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
        i.status === 'uploading' ||
        i.status === 'processing',
    )
  )
    return;
  const ok = items.filter((i) => i.status === 'ready').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  if (failed) toast.error(`Добавлено ${ok} из ${ok + failed}`);
  else if (ok) toast.success(`Добавлено ${formatTrackCount(ok)}`);
}

async function finalizeReadyAlbums(): Promise<void> {
  const items = useUploadsStore.getState().items;
  for (const [jobId, job] of [...albumJobs.entries()]) {
    const batch = items.filter((i) => i.albumJobId === jobId);
    if (!batch.length || batch.some((i) => !i.trackId && i.status !== 'failed')) continue;
    if (albumFinalizing.has(jobId)) continue;
    albumFinalizing.add(jobId);
    albumJobs.delete(jobId);
    const trackIds = job.items
      .map((id) => batch.find((i) => i.id === id)?.trackId)
      .filter((id): id is string => !!id);
    if (!trackIds.length) {
      albumFinalizing.delete(jobId);
      continue;
    }
    try {
      const album = await createAlbum({
        title: job.title,
        artist: job.artist,
        year: job.year,
        trackIds,
      });
      if (job.coverJpeg?.byteLength) {
        await setAlbumCover(album.id, jpegBlob(job.coverJpeg)).catch(() => undefined);
      }
      refreshLists(undefined, album.id);
      toast.success(`Альбом «${album.title}» сохранён`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать альбом');
    } finally {
      albumFinalizing.delete(jobId);
    }
  }
}

function jpegBlob(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: 'image/jpeg' });
}

function mostCommon(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = raw?.trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [value, count] of counts) {
    if (count > n) {
      best = value;
      n = count;
    }
  }
  return best;
}

function sortAlbumFiles(
  files: string[],
  tags: { path: string; discNo: number | null; trackNo: number | null }[],
): string[] {
  const byPath = new Map(tags.map((t) => [t.path, t]));
  return [...files].sort((a, b) => {
    const ta = byPath.get(a);
    const tb = byPath.get(b);
    const d = (ta?.discNo ?? 1) - (tb?.discNo ?? 1);
    if (d) return d;
    const n = (ta?.trackNo ?? 9999) - (tb?.trackNo ?? 9999);
    if (n) return n;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

async function enqueueAlbum(source: { title: string; files: string[]; coverPath: string | null }): Promise<void> {
  const api = window.electronAPI?.localTracks;
  if (!api?.readTags) {
    enqueuePaths(source.files);
    return;
  }
  const tags = await Promise.all(
    source.files.map(async (filePath) => {
      const t = await api.readTags!(filePath);
      return { path: filePath, ...t };
    }),
  );
  const ordered = sortAlbumFiles(source.files, tags);
  const title = mostCommon(tags.map((t) => t.album)) || source.title || 'Альбом';
  const artist =
    mostCommon(tags.map((t) => t.albumArtist)) || mostCommon(tags.map((t) => t.artist)) || 'Неизвестный исполнитель';
  const yearRaw = mostCommon(tags.map((t) => (t.year ? String(t.year) : null)));
  const year = yearRaw ? Number(yearRaw) : null;
  let coverJpeg: Uint8Array | undefined;
  if (source.coverPath && api.readCoverJpeg) {
    coverJpeg = (await api.readCoverJpeg(source.coverPath)) ?? undefined;
  }
  const jobId = crypto.randomUUID();
  albumJobs.set(jobId, { title, artist, year: year && year >= 1000 ? year : null, coverJpeg, items: [] });
  enqueuePaths(ordered, { albumJobId: jobId });
}

function enqueuePaths(filePaths: string[], opts?: { playlistId?: string; albumId?: string; albumJobId?: string }): void {
  if (!filePaths.length) return;
  if (!currentAccessToken()) {
    toast.error('Войдите в аккаунт MSS');
    return;
  }
  const added: UploadItem[] = filePaths.map((filePath) => {
    const id = crypto.randomUUID();
    paths.set(id, filePath);
    const name = filePath.replace(/^.*[/\\]/, '');
    return {
      id,
      name,
      size: 0,
      playlistId: opts?.playlistId,
      albumId: opts?.albumId,
      albumJobId: opts?.albumJobId,
      status: 'queued',
      progress: 0,
    };
  });
  if (opts?.albumJobId) {
    const job = albumJobs.get(opts.albumJobId);
    if (job) job.items.push(...added.map((i) => i.id));
  }
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
    const filePaths = list.map((f) => api.getPathForFile!(f)).filter(Boolean);
    if (!filePaths.length) {
      toast.error('Не удалось получить путь к файлу');
      return;
    }
    if (api.expandSources) {
      void api.expandSources(filePaths).then((expanded) => {
        if (opts?.albumId || opts?.playlistId) {
          enqueuePaths([...expanded.files, ...expanded.albums.flatMap((a) => a.files)], opts);
          return;
        }
        for (const album of expanded.albums) void enqueueAlbum(album);
        const audio = expanded.files.filter((p) => AUDIO_EXT.test(p));
        const skipped = filePaths.length - expanded.albums.length - expanded.files.length;
        if (skipped > 0) toast.warning(`Пропущено файлов, которые не похожи на аудио: ${skipped}`);
        enqueuePaths(audio, opts);
      });
      return;
    }
    const audio = filePaths.filter((p) => AUDIO_EXT.test(p));
    const skipped = filePaths.length - audio.length;
    if (skipped) toast.warning(`Пропущено файлов, которые не похожи на аудио: ${skipped}`);
    enqueuePaths(audio, opts);
  },

  uploadFromDialog: (opts) => {
    const api = window.electronAPI?.localTracks;
    if (!api) {
      toast.error('Доступно только в приложении MSS');
      return;
    }
    void api.pickFiles().then((filePaths) => enqueuePaths(filePaths, opts));
  },

  uploadAlbumFromDialog: () => {
    const api = window.electronAPI?.localTracks;
    if (!api?.pickFolder) {
      toast.error('Доступно только в приложении MSS');
      return;
    }
    if (!currentAccessToken()) {
      toast.error('Войдите в аккаунт MSS');
      return;
    }
    void api.pickFolder().then(async (dir) => {
      if (!dir || !api.expandSources) return;
      const expanded = await api.expandSources([dir]);
      const album = expanded.albums[0];
      if (!album?.files.length) {
        toast.error('В папке нет аудиофайлов');
        return;
      }
      await enqueueAlbum(album);
    });
  },

  clearFinished: () =>
    set((s) => ({
      items: s.items.filter((i) => i.status !== 'ready' && i.status !== 'failed' && i.status !== 'processing'),
    })),

  setCollapsed: (collapsed) => set({ collapsed }),
}));
