import type { PlaylistEntryDto } from '@mss/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileDown, ImagePlus, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Artwork } from '@/components/media/Artwork';
import { CollectionHeader, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { defaultPlaylistAuthor, EditPlaylistDialog, PlaylistCover } from '@/components/playlists/EditPlaylistDialog';
import { TrackFilterInput, TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/states';
import { UploadButton } from '@/components/uploads/UploadButton';
import { useTrackSort } from '@/hooks/useTrackSort';
import { apiFetch } from '@/lib/api';
import { formatDuration, formatTotalDuration, formatTrackCount } from '@/lib/format';
import { addToPlaylist, deletePlaylist, removePlaylistEntries, reorderPlaylist } from '@/lib/mss-library';
import { playCollection } from '@/lib/player-actions';
import { exportM3u8 } from '@/lib/playlist-io';
import { useMssPlaylists, type MssPlaylist } from '@/lib/queries';
import { mapLocalTrack, mapPlaylistEntry, type LocalTrackDto, type PlaylistEntryTrack } from '@/lib/sources';
import { undoableToast } from '@/lib/undo';

function usePlaylistTracks(id?: string) {
  return useQuery({
    queryKey: ['playlist', id],
    queryFn: async () => (await apiFetch<{ items: PlaylistEntryDto[] }>(`/playlists/${id}/tracks`)).items.map(mapPlaylistEntry),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.some((t) => t.status === 'processing') ? 3000 : false),
  });
}

function AddFromLibraryDialog({
  open,
  onClose,
  playlist,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  playlist: { id: string; name: string };
  existing: Set<string>;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['tracks', 'picker', query],
    queryFn: async () =>
      (await apiFetch<{ items: LocalTrackDto[] }>(`/tracks?limit=50${query ? `&query=${encodeURIComponent(query)}` : ''}`)).items.map((t) =>
        mapLocalTrack(t),
      ),
    enabled: open,
  });

  return (
    <Dialog open={open} onClose={onClose} title={`Добавить в «${playlist.name}»`} className="max-w-lg">
      <div className="relative mb-3">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input autoFocus className="pl-9" placeholder="Поиск по библиотеке MSS" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="-mx-2 h-80 overflow-y-auto">
        {isLoading && <p className="px-2 py-3 text-sm text-muted">Ищем…</p>}
        {!isLoading && !results.length && (
          <p className="px-2 py-3 text-sm text-muted">
            {query ? 'Ничего не нашлось' : 'В библиотеке MSS пока нет треков — загрузите свои файлы'}
          </p>
        )}
        {results.map((t) => {
          const added = existing.has(t.id);
          return (
            <div key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.06]">
              <Artwork src={t.coverUrl} className="h-10 w-10" rounded="rounded-md" iconSize={14} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="truncate text-xs text-muted">{t.artist}</div>
              </div>
              <span className="text-xs tabular-nums text-muted">{formatDuration(t.durationMs)}</span>
              <Button
                size="icon-sm"
                variant={added ? 'ghost' : 'secondary'}
                disabled={added}
                aria-label={added ? 'Уже в плейлисте' : 'Добавить'}
                onClick={() => void addToPlaylist(playlist, t)}
              >
                {added ? <Check size={14} /> : <Plus size={14} />}
              </Button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

export function PlaylistDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: playlists } = useMssPlaylists();
  const { data: tracks = [], isLoading, error, refetch } = usePlaylistTracks(id);
  const [dialog, setDialog] = useState<'add' | 'edit' | 'cover' | 'delete' | null>(null);
  const { view, sort, cycle, filter, setFilter, isNatural } = useTrackSort(tracks);
  const queryClient = useQueryClient();

  const playlist: MssPlaylist = playlists?.find((p) => p.id === id) ?? {
    id,
    name: 'Плейлист',
    description: null,
    author: null,
    coverUrl: null,
    trackCount: tracks.length,
  };
  const author = playlist.author ?? defaultPlaylistAuthor();
  const context = { type: 'playlist' as const, title: playlist.name, path: `/playlists/${id}` };
  const total = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const playable = tracks.filter((t) => t.playable);
  const close = () => setDialog(null);

  const removeMany = (items: PlaylistEntryTrack[]) => {
    const ids = new Set(items.map((t) => t.entryId));
    const key = ['playlist', id];
    const before = queryClient.getQueryData<PlaylistEntryTrack[]>(key);
    queryClient.setQueryData<PlaylistEntryTrack[]>(key, (list) => list?.filter((t) => !ids.has(t.entryId)));
    undoableToast(items.length === 1 ? `«${items[0].title}» убран из плейлиста` : `Убрано: ${formatTrackCount(items.length)}`, {
      undo: () => queryClient.setQueryData(key, before),
      commit: () =>
        removePlaylistEntries(id, [...ids]).catch(() => {
          queryClient.setQueryData(key, before);
          toast.error('Не удалось убрать треки');
        }),
    });
  };
  const remove = (track: PlaylistEntryTrack) => removeMany([track]);

  const reorder = (from: number, to: number) => {
    const key = ['playlist', id];
    const list = [...tracks];
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    queryClient.setQueryData(key, list);
    void reorderPlaylist(
      id,
      list.map((t) => t.entryId),
    ).catch(() => {
      toast.error('Не удалось сохранить порядок');
      void refetch();
    });
  };

  return (
    <div>
      <CollectionHeader
        kicker="Плейлист · MSS"
        title={playlist.name}
        meta={[author, formatTrackCount(tracks.length), total ? formatTotalDuration(total) : null]
          .filter(Boolean)
          .join(' · ')}
        description={playlist.description ? <span className="whitespace-pre-line">{playlist.description}</span> : undefined}
        coverUrl={playlist.coverUrl ?? undefined}
        cover={
          <button
            type="button"
            onClick={() => setDialog(playlist.coverUrl ? 'edit' : 'cover')}
            className="group relative h-56 w-56 shrink-0 overflow-hidden rounded-xl shadow-artwork"
            aria-label="Изменить обложку"
          >
            <PlaylistCover playlist={playlist} className="h-full w-full" />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              <ImagePlus size={28} />
              {playlist.coverUrl ? 'Изменить' : 'Выбрать фото'}
            </span>
          </button>
        }
        onPlay={playable.length ? () => playCollection(tracks, context) : undefined}
        onShuffle={playable.length > 1 ? () => playCollection(tracks, context, true) : undefined}
        actions={
          <>
            <UploadButton size="lg" variant="secondary" playlistId={id} label="Загрузить файлы" />
            <Button size="lg" variant="secondary" onClick={() => setDialog('add')}>
              <Plus size={16} /> Из библиотеки
            </Button>
            <Button size="icon" variant="ghost" aria-label="Изменить" title="Изменить" onClick={() => setDialog('edit')}>
              <Pencil size={16} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Экспорт в M3U8"
              title="Экспорт в M3U8"
              disabled={!tracks.length}
              onClick={() => void exportM3u8(playlist.name, tracks)}
            >
              <FileDown size={16} />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Удалить плейлист" title="Удалить плейлист" onClick={() => setDialog('delete')}>
              <Trash2 size={16} />
            </Button>
          </>
        }
      />
      {isLoading ? (
        <TrackListSkeleton />
      ) : error ? (
        <ErrorState title="Не удалось загрузить треки" error={error} onRetry={() => void refetch()} />
      ) : tracks.length ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {isNatural ? 'Перетаскивайте треки, чтобы изменить порядок' : 'Порядок изменится только в исходной сортировке'}
            </p>
            <TrackFilterInput value={filter} onChange={setFilter} />
          </div>
          <TrackList
            tracks={view}
            context={context}
            header
            showSource={tracks.some((t) => t.source !== 'local')}
            onRemove={remove}
            onRemoveMany={removeMany}
            removeLabel="Убрать из плейлиста"
            sort={sort}
            onSort={cycle}
            onReorder={isNatural ? reorder : undefined}
            emptyText="Ничего не найдено"
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
          <Upload size={32} className="text-muted" />
          <div className="text-lg font-semibold">В плейлисте пока нет треков</div>
          <p className="max-w-md text-sm text-muted">
            Перетащите аудиофайлы в окно или загрузите их кнопкой — MP3, FLAC, M4A, OGG, WAV и другие. Теги и обложка
            подтянутся из файлов.
          </p>
          <div className="mt-2 flex gap-2">
            <UploadButton playlistId={id} label="Выбрать файлы" />
            <Button variant="secondary" onClick={() => setDialog('add')}>
              <Plus size={15} /> Из библиотеки
            </Button>
          </div>
        </div>
      )}

      <AddFromLibraryDialog
        open={dialog === 'add'}
        onClose={close}
        playlist={playlist}
        existing={new Set(tracks.filter((t) => t.source === 'local').map((t) => t.id))}
      />
      <EditPlaylistDialog
        open={dialog === 'edit' || dialog === 'cover'}
        onClose={close}
        playlist={playlist}
        pickCoverOnOpen={dialog === 'cover'}
      />
      <Dialog open={dialog === 'delete'} onClose={close} title="Удалить плейлист?">
        <p className="mb-5 text-sm text-muted">
          Плейлист «{playlist.name}» будет удалён. Сами треки останутся в библиотеке и в разделе «Мои треки».
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const key = ['playlists'] as const;
              const before = queryClient.getQueryData<MssPlaylist[]>(key) ?? [];
              queryClient.setQueryData(
                key,
                before.filter((p) => p.id !== id),
              );
              close();
              undoableToast(`Плейлист «${playlist.name}» удалён`, {
                undo: () => queryClient.setQueryData(key, before),
                commit: () =>
                  void deletePlaylist(id!).then(
                    () => navigate('/mss/library/playlists'),
                    () => {
                      queryClient.setQueryData(key, before);
                      toast.error('Не удалось удалить плейлист');
                    },
                  ),
              });
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
