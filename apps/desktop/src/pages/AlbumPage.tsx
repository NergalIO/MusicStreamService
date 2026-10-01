import type { UnifiedTrack } from '@mss/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, Download, Heart, Loader2, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CollectionHeader, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { TrackFilterInput, TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { openContextMenu } from '@/components/ui/context-menu';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SOURCE_LABEL } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useTrackSort } from '@/hooks/useTrackSort';
import { formatTotalDuration, formatTrackCount } from '@/lib/format';
import { loadAlbum } from '@/lib/card-menus';
import { albumMatchKey, findAlbumAlternatives } from '@/lib/album-match';
import { albumPath, trackArtistLinks } from '@/lib/links';
import { deleteAlbum, removeAlbumTracks, updateAlbum } from '@/lib/mss-library';
import { playCollection } from '@/lib/player-actions';
import { publishAlbumToMssCollection } from '@/lib/publish-to-mss';
import { MSS_UPLOADS } from '@/lib/service-routes';
import { useIsAlbumLiked, useAlbumLikesStore } from '@/store/album-likes-store';
import { canDownload, downloadKey, useDownloadsStore } from '@/store/downloads-store';
import { useUploadsStore } from '@/store/uploads-store';

const NO_TRACKS: UnifiedTrack[] = [];

const TYPE_LABEL: Record<string, string> = {
  single: 'Сингл',
  ep: 'EP',
  compilation: 'Сборник',
  podcast: 'Подкаст',
};

export function AlbumPage() {
  const { source = '', id = '' } = useParams();
  const supported = source === 'yandex' || source === 'spotify' || source === 'local';
  const { data: album, isLoading, error, refetch } = useQuery({
    queryKey: ['album', source, id],
    queryFn: () => loadAlbum(source as 'yandex' | 'spotify' | 'local', id),
    enabled: supported && !!id,
    staleTime: source === 'local' ? 30_000 : 30 * 60_000,
  });
  const { view, sort, cycle, filter, setFilter, isNatural } = useTrackSort(album?.tracks ?? NO_TRACKS);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const liked = useIsAlbumLiked(album);
  const toggleAlbumLike = useAlbumLikesStore((s) => s.toggle);
  const alternatives = useQuery({
    queryKey: ['album-alternatives', album ? albumMatchKey(album) : ''],
    queryFn: () => findAlbumAlternatives(album!),
    enabled: !!album,
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  if (!supported) return <EmptyState title="Страницы альбомов доступны для MSS, Яндекс Музыки и Spotify" />;
  if (error) return <ErrorState title="Не удалось загрузить альбом" error={error} onRetry={() => void refetch()} />;
  if (isLoading || !album) {
    return (
      <>
        <div className="mb-8 flex items-end gap-8">
          <div className="h-56 w-56 animate-pulse rounded-xl bg-foreground/[0.07]" />
          <div className="flex-1 space-y-3">
            <div className="h-8 w-1/2 animate-pulse rounded bg-foreground/[0.07]" />
            <div className="h-5 w-1/4 animate-pulse rounded bg-foreground/[0.05]" />
          </div>
        </div>
        <TrackListSkeleton />
      </>
    );
  }

  const context = { type: 'album' as const, title: album.title, path: `/album/${source}/${id}` };
  const artists = trackArtistLinks({ source: album.source, artist: album.artist, artists: album.artists });
  const tags = [
    album.year ? String(album.year) : null,
    ...(album.genre ?? '')
      .split(/[,/]/)
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((g) => g[0].toUpperCase() + g.slice(1)),
    album.tracks.some((t) => t.explicit) ? '18+' : null,
    formatTrackCount(album.trackCount ?? album.tracks.length),
    album.durationMs ? formatTotalDuration(album.durationMs) : null,
    album.label ? `℗ ${album.label}` : null,
  ].filter((t): t is string => !!t);
  const platforms = (alternatives.data ?? []).some((a) => a.source === album.source && a.id === album.id)
    ? alternatives.data!
    : [];
  const meta = (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 md:justify-start">
      <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">{SOURCE_LABEL[album.source]}</span>
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-xs font-medium text-foreground/80">
          {tag}
        </span>
      ))}
    </div>
  );

  return (
    <div>
      <CollectionHeader
        kicker={TYPE_LABEL[album.type ?? ''] ?? 'Альбом'}
        title={album.title}
        subtitle={artists.map((a, i) => (
          <Fragment key={a.to}>
            {i > 0 && ', '}
            <Link to={a.to} className="hover:underline">
              {a.name}
            </Link>
          </Fragment>
        ))}
        meta={meta}
        coverUrl={album.coverUrl}
        onPlay={() => playCollection(album.tracks, context)}
        onShuffle={album.tracks.length > 1 ? () => playCollection(album.tracks, context, true) : undefined}
        actions={
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
              aria-pressed={liked}
              title={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
              onClick={() => void toggleAlbumLike(album)}
            >
              <Heart size={18} className={cn(liked && 'fill-primary text-primary')} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Ещё"
              title="Ещё"
              onClick={(e) => {
                const downloads = useDownloadsStore.getState();
                const todo = album.tracks.filter((t) => canDownload(t) && !downloads.items[downloadKey(t)]);
                openContextMenu(e, {
                  title: album.title,
                  groups: [
                    [
                      {
                        icon: Download,
                        label: todo.length ? 'Скачать альбом' : 'Уже скачано',
                        disabled: !album.tracks.some(canDownload),
                        action: () => {
                          if (!todo.length) return void toast('Всё уже скачано');
                          for (const t of todo) void downloads.download(t);
                          toast(`Скачиваем ${formatTrackCount(todo.length)}`);
                        },
                      },
                      {
                        icon: CloudUpload,
                        label: 'Отправить на сервер MSS',
                        action: () => {
                          void toast.promise(
                            publishAlbumToMssCollection(album, album.tracks).then((r) => {
                              if ('albumId' in r && r.albumId && r.albumId !== album.id) {
                                navigate(albumPath('local', r.albumId), { replace: true });
                              } else {
                                void queryClient.invalidateQueries({ queryKey: ['album', 'local', album.id] });
                                void queryClient.invalidateQueries({ queryKey: ['my-albums'] });
                              }
                              return r;
                            }),
                            {
                              loading: 'Отправляем на сервер MSS…',
                              success: (r) =>
                                r.uploaded > 0 || r.createdAlbum
                                  ? 'Отправлено на сервер MSS'
                                  : 'Альбом уже на сервере MSS',
                              error: (e) => (e instanceof Error ? e.message : 'Не удалось отправить на сервер MSS'),
                            },
                          );
                        },
                      },
                    ],
                    album.source === 'local'
                      ? [
                          {
                            icon: Upload,
                            label: 'Добавить треки',
                            action: () => void useUploadsStore.getState().uploadFromDialog({ albumId: album.id }),
                          },
                          { icon: Pencil, label: 'Изменить', action: () => setDialog('edit') },
                          { icon: Trash2, label: 'Удалить альбом', danger: true, action: () => setDialog('delete') },
                        ]
                      : [],
                  ],
                });
              }}
            >
              <MoreHorizontal size={18} />
            </Button>
          </>
        }
      />
      {(platforms.length > 1 || alternatives.isFetching) && (
        <section className="-mt-4 mb-6 flex flex-wrap items-center gap-2" aria-label="Альбом на других площадках">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Слушать на</span>
          {platforms.map((p) => {
            const active = p.source === album.source;
            return (
              <button
                key={p.source}
                type="button"
                aria-pressed={active}
                disabled={active}
                onClick={() => navigate(albumPath(p.source, p.id), { replace: true })}
                className={cn(
                  'rounded-full px-3 py-1 text-sm transition-colors',
                  active ? 'bg-foreground/15 font-medium text-foreground' : 'bg-foreground/5 text-muted hover:bg-foreground/10 hover:text-foreground',
                )}
              >
                {SOURCE_LABEL[p.source]}
                {p.trackCount ? <span className="ml-1.5 text-xs text-muted">{p.trackCount} тр.</span> : null}
              </button>
            );
          })}
          {alternatives.isFetching && <Loader2 size={14} className="animate-spin text-muted" aria-label="Ищем на других площадках" />}
        </section>
      )}
      {album.description && (
        <section className="mb-8 max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold">Описание</h2>
          <p className={cn('whitespace-pre-line text-sm text-muted', !aboutOpen && 'line-clamp-4')}>{album.description}</p>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAboutOpen((v) => !v)}>
            {aboutOpen ? 'Свернуть' : 'Подробнее'}
          </Button>
        </section>
      )}
      {album.tracks.length > 12 && (
        <div className="mb-3 flex justify-end">
          <TrackFilterInput value={filter} onChange={setFilter} />
        </div>
      )}
      <TrackList
        tracks={view}
        context={context}
        variant="album"
        header
        sort={sort}
        onSort={cycle}
        numbered={isNatural}
        emptyText="Ничего не найдено"
        showSource={false}
        onRemove={
          album.source === 'local'
            ? (track) => {
                void removeAlbumTracks(album.id, [track.id]).catch(() => toast.error('Не удалось убрать трек из альбома'));
              }
            : undefined
        }
        removeLabel="Убрать из альбома"
      />
      {album.label && (
        <p className="mt-8 text-xs text-muted">
          {album.year ? `℗ ${album.year} ` : ''}
          {album.label}
        </p>
      )}
      {album.source === 'local' && dialog === 'edit' && (
        <EditAlbumDialog
          title={album.title}
          artist={album.artist}
          year={album.year}
          onClose={() => setDialog(null)}
          onSave={async (patch) => {
            await updateAlbum(album.id, patch);
            setDialog(null);
            void queryClient.invalidateQueries({ queryKey: ['album', 'local', album.id] });
          }}
        />
      )}
      <Dialog open={album.source === 'local' && dialog === 'delete'} onClose={() => setDialog(null)} title="Удалить альбом?">
        <p className="mb-5 text-sm text-muted">
          «{album.title}» будет удалён из библиотеки. Треки останутся в «Мои треки».
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              void deleteAlbum(album.id)
                .then(() => navigate(MSS_UPLOADS, { replace: true }))
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Не удалось удалить альбом'));
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function EditAlbumDialog({
  title,
  artist,
  year,
  onClose,
  onSave,
}: {
  title: string;
  artist: string;
  year?: number;
  onClose: () => void;
  onSave: (patch: { title?: string; artist?: string; year?: number | null }) => Promise<void>;
}) {
  const [name, setName] = useState(title);
  const [artistName, setArtistName] = useState(artist);
  const [yearText, setYearText] = useState(year ? String(year) : '');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onClose={onClose} title="Альбом">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = yearText.trim() ? Number(yearText.trim()) : null;
          if (parsed != null && (!Number.isInteger(parsed) || parsed < 1000 || parsed > 2100)) {
            toast.error('Год — число от 1000 до 2100');
            return;
          }
          setSaving(true);
          void onSave({
            title: name.trim() || title,
            artist: artistName.trim() || artist,
            year: parsed,
          }).finally(() => setSaving(false));
        }}
      >
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" />
        <Input value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="Исполнитель" />
        <Input value={yearText} onChange={(e) => setYearText(e.target.value)} placeholder="Год" inputMode="numeric" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} type="button">
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            Сохранить
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
