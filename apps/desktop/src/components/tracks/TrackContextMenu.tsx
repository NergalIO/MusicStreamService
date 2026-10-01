import type { UnifiedTrack } from '@mss/shared';
import {
  Copy,
  CloudUpload,
  Disc3,
  Download,
  FolderOpen,
  Heart,
  Link2,
  ListEnd,
  ListPlus,
  ListStart,
  MicVocal,
  Pencil,
  Radio,
  Send,
  Sparkles,
  ThumbsDown,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { openEditTrack } from '@/components/tracks/EditTrackDialog';
import { openPlaylistPicker } from '@/components/tracks/PlaylistPicker';
import { ContextMenuHost, openContextMenu, type MenuItem } from '@/components/ui/context-menu';
import { copyTextWithToast } from '@/lib/clipboard';
import { formatTrackCount } from '@/lib/format';
import { suggestTrack } from '@/lib/lobby-api';
import { mssTrackUrl, similarPath, trackAlbumPath, trackArtistLinks } from '@/lib/links';
import { publishTracksToMss } from '@/lib/mss-library';
import { downloadOffline } from '@/lib/offline';
import { startSpotifyRadio, startWave, toggleLike } from '@/lib/player-actions';
import { queryClient } from '@/lib/query-client';
import { canDownload, downloadKey, useDownloadsStore } from '@/store/downloads-store';
import { useLikesStore } from '@/store/likes-store';
import { isLobbyGuest, useLobbyStore } from '@/store/lobby-store';
import { usePlayerStore } from '@/store/player-store';

type MenuTrack = UnifiedTrack & { streamUrl?: string; uid?: string };

export interface MenuExtras {
  onRemove?: () => void;
  removeLabel?: string;
}

export interface BulkMenuExtras {
  onRemove?: () => void;
  removeLabel?: string;
}

/** Треки, которые можно менять: загруженные этим пользователем (если список ещё не загружен — показываем пункт). */
function isOwnUpload(track: UnifiedTrack): boolean {
  if (track.source !== 'local') return false;
  const uploads = queryClient.getQueryData<UnifiedTrack[]>(['my-uploads']);
  return !uploads || uploads.some((t) => t.id === track.id);
}

function suggestToParty(track: UnifiedTrack): void {
  const lobby = useLobbyStore.getState().lobby;
  if (!lobby || !isLobbyGuest()) {
    toast.error('Предложить трек может слушатель эфира');
    return;
  }
  void suggestTrack(lobby.id, track)
    .then(() => toast.success('Трек предложен DJ'))
    .catch((e) => toast.error(e instanceof Error ? e.message : 'Не удалось предложить'));
}

function partySuggestItem(track: UnifiedTrack): MenuItem[] {
  if (!isLobbyGuest()) return [];
  return [{ icon: Send, label: 'Предложить', action: () => suggestToParty(track) }];
}

function publishToMss(tracks: UnifiedTrack[]): void {
  void toast.promise(publishTracksToMss(tracks), {
    loading: 'Отправляем на сервер MSS…',
    success: (r) => (r.uploaded > 0 ? 'Отправлено на сервер MSS' : 'Уже на сервере MSS'),
    error: (e) => (e instanceof Error ? e.message : 'Не удалось отправить на сервер MSS'),
  });
}

export function trackMenuGroups(track: MenuTrack, extras: MenuExtras = {}): MenuItem[][] {
  const player = usePlayerStore.getState();
  const downloads = useDownloadsStore.getState();
  const liked = useLikesStore.getState().isLiked(track);
  const artists = trackArtistLinks(track);
  const album = trackAlbumPath(track);

  return [
    [
      ...partySuggestItem(track),
      { icon: ListStart, label: 'Играть следующим', action: () => (player.playNext(track), toast('Сыграет следующим')) },
      { icon: ListEnd, label: 'Добавить в очередь', action: () => (player.addToQueue(track), toast('Добавлено в очередь')) },
      { icon: ListPlus, label: 'Добавить в плейлист', action: () => openPlaylistPicker(track) },
    ],
    [
      {
        icon: Heart,
        label: liked ? 'Удалить из «Мне нравится»' : 'Мне нравится',
        action: () => void toggleLike(track),
      },
      ...(track.source === 'yandex'
        ? [
            {
              icon: ThumbsDown,
              label: 'Не рекомендовать',
              action: () =>
                void window.electronAPI.yandex
                  .dislike(track)
                  .then(() => toast('Трек не будет попадать в рекомендации'))
                  .catch(() => toast.error('Не удалось отправить')),
            },
          ]
        : []),
    ],
    [
      ...artists.slice(0, 3).map((a) => ({ icon: MicVocal, label: `Исполнитель: ${a.name}`, action: (nav) => nav(a.to) }) as MenuItem),
      ...(album ? [{ icon: Disc3, label: 'Перейти к альбому', action: (nav) => nav(album) } as MenuItem] : []),
      ...(track.source === 'yandex'
        ? [
            {
              icon: Radio,
              label: 'Волна по треку',
              action: () => void startWave({ seed: `track:${track.id}`, seedTitle: track.title }),
            } as MenuItem,
            { icon: Sparkles, label: 'Похожие треки', action: (nav) => nav(similarPath(track)) } as MenuItem,
          ]
        : []),
      ...(track.source === 'spotify'
        ? [{ icon: Radio, label: 'Радио по треку', action: () => void startSpotifyRadio(track) } as MenuItem]
        : []),
    ],
    [
      ...(track.source === 'local'
        ? [
            { icon: CloudUpload, label: 'Отправить на сервер MSS', action: () => publishToMss([track]) },
            { icon: Download, label: 'Скачать офлайн', action: () => void downloadOffline(track.id) },
          ]
        : []),
      ...(downloads.items[downloadKey(track)]
        ? [
            { icon: FolderOpen, label: 'Показать в папке', action: () => downloads.reveal(track) },
            { icon: Trash2, label: 'Удалить загрузку', action: () => void downloads.remove(track) },
          ]
        : canDownload(track)
          ? [
              {
                icon: Download,
                label: downloads.active[downloadKey(track)] ? 'Скачивается…' : 'Скачать',
                action: () => void downloads.download(track),
              },
            ]
          : []),
      ...(isOwnUpload(track) ? [{ icon: Pencil, label: 'Изменить данные', action: () => openEditTrack(track) }] : []),
      {
        icon: Copy,
        label: 'Скопировать название',
        action: () => copyTextWithToast(`${track.artist} — ${track.title}`, 'Название скопировано'),
      },
      {
        icon: Link2,
        label: 'Скопировать ссылку MSS',
        action: () => copyTextWithToast(mssTrackUrl(track), 'Ссылка скопирована'),
      },
      ...(extras.onRemove
        ? [{ icon: Trash2, label: extras.removeLabel ?? 'Удалить', action: extras.onRemove, danger: true }]
        : []),
    ],
  ];
}

export function bulkTrackActions(tracks: MenuTrack[], extras: BulkMenuExtras = {}): MenuItem[][] {
  const player = usePlayerStore.getState();
  const downloads = useDownloadsStore.getState();
  const likes = useLikesStore.getState();
  const playable = tracks.filter((t) => t.playable);
  const notLiked = tracks.filter((t) => !likes.isLiked(t));
  const downloadable = tracks.filter((t) => canDownload(t) && !downloads.items[downloadKey(t)] && !downloads.active[downloadKey(t)]);
  const publishable = tracks.filter((t) => t.source === 'local');
  const n = formatTrackCount(tracks.length);

  return [
    [
      {
        icon: ListStart,
        label: 'Играть следующими',
        disabled: !playable.length,
        action: () => (player.playNext(playable), toast(`Сыграют следующими: ${formatTrackCount(playable.length)}`)),
      },
      {
        icon: ListEnd,
        label: 'Добавить в очередь',
        disabled: !playable.length,
        action: () => (player.addToQueue(playable), toast(`В очередь: ${formatTrackCount(playable.length)}`)),
      },
      { icon: ListPlus, label: 'Добавить в плейлист', action: () => openPlaylistPicker(tracks) },
    ],
    [
      {
        icon: Heart,
        label: notLiked.length ? 'Мне нравится' : 'Уже в «Мне нравится»',
        disabled: !notLiked.length,
        action: () => {
          for (const t of notLiked) void toggleLike(t);
          toast(`В «Мне нравится»: ${formatTrackCount(notLiked.length)}`);
        },
      },
      {
        icon: Download,
        label: downloadable.length ? `Скачать (${downloadable.length})` : 'Скачать',
        disabled: !downloadable.length,
        action: () => {
          for (const t of downloadable) void downloads.download(t);
          toast(`Скачиваем ${formatTrackCount(downloadable.length)}`);
        },
      },
      {
        icon: CloudUpload,
        label: publishable.length > 1 ? `Отправить на сервер MSS (${publishable.length})` : 'Отправить на сервер MSS',
        disabled: !publishable.length,
        action: () => publishToMss(publishable),
      },
      {
        icon: Copy,
        label: 'Скопировать названия',
        action: () => copyTextWithToast(tracks.map((t) => `${t.artist} — ${t.title}`).join('\n'), 'Названия скопированы'),
      },
    ],
    extras.onRemove ? [{ icon: Trash2, label: extras.removeLabel ?? `Удалить (${n})`, action: extras.onRemove, danger: true }] : [],
  ];
}

export function openTrackMenu(e: React.MouseEvent | React.KeyboardEvent, track: MenuTrack, extras?: MenuExtras): void {
  openContextMenu(e, { title: `${track.title} · ${track.artist}`, groups: trackMenuGroups(track, extras) });
}

export function openTracksMenu(e: React.MouseEvent | React.KeyboardEvent, tracks: MenuTrack[], extras?: BulkMenuExtras): void {
  openContextMenu(e, { title: `Выбрано: ${formatTrackCount(tracks.length)}`, groups: bulkTrackActions(tracks, extras) });
}

/** Оставлено для совместимости: хост общего контекстного меню. */
export const TrackContextMenuHost = ContextMenuHost;
