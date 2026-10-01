import type { AlbumDetailDto, AlbumWithTracks, PlaylistEntryDto, UnifiedAlbum, UnifiedPlaylist, UnifiedTrack } from '@mss/shared';
import { Copy, CloudUpload, Download, FileDown, Heart, Link2, ListEnd, ListPlus, ListStart, MicVocal, Pin, PinOff, Play, Radio, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import { openPlaylistPicker } from '@/components/tracks/PlaylistPicker';
import type { MenuItem, MenuSpec } from '@/components/ui/context-menu';
import { apiFetch } from '@/lib/api';
import { artistPath, type ArtistGroup } from '@/lib/artists';
import { copyTextWithToast } from '@/lib/clipboard';
import { formatTrackCount } from '@/lib/format';
import { albumLink, mssAlbumUrl, mssPlaylistUrl, playlistPath } from '@/lib/links';
import { playCollection, startWave } from '@/lib/player-actions';
import { exportM3u8, importToMss } from '@/lib/playlist-io';
import { publishAlbumToMssCollection } from '@/lib/publish-to-mss';
import { queryClient } from '@/lib/query-client';
import { mapLocalAlbumDetail } from '@/lib/queries';
import { mapPlaylistEntry } from '@/lib/sources';
import { canDownload, downloadKey, useDownloadsStore } from '@/store/downloads-store';
import { useAlbumLikesStore } from '@/store/album-likes-store';
import { usePlayerStore, type PlayContext } from '@/store/player-store';
import { useSidebarStore } from '@/store/sidebar-store';

export function loadAlbum(source: 'yandex' | 'spotify' | 'local', id: string): Promise<AlbumWithTracks> {
  if (source === 'local') {
    return apiFetch<AlbumDetailDto>(`/albums/${id}`).then(mapLocalAlbumDetail);
  }
  return source === 'spotify' ? window.electronAPI.connectors.album('spotify', id) : window.electronAPI.yandex.album(id);
}

/** Те же ключи, что у страниц альбома и плейлиста: повторный переход откроется из кэша. */
export function loadAlbumTracks(id: string, source: 'yandex' | 'spotify' | 'local' = 'yandex'): Promise<UnifiedTrack[]> {
  return queryClient
    .fetchQuery({ queryKey: ['album', source, id], queryFn: () => loadAlbum(source, id), staleTime: 30 * 60_000 })
    .then((a) => a.tracks);
}

export function loadPlaylistTracks(p: Pick<UnifiedPlaylist, 'source' | 'id'>): Promise<UnifiedTrack[]> {
  if (p.source === 'local') {
    return queryClient.fetchQuery({
      queryKey: ['playlist', p.id],
      queryFn: async () => (await apiFetch<{ items: PlaylistEntryDto[] }>(`/playlists/${p.id}/tracks`)).items.map(mapPlaylistEntry),
    });
  }
  if (p.source === 'yandex' || p.source === 'vk' || p.source === 'spotify') {
    const source = p.source;
    return queryClient
      .fetchQuery({
        queryKey: [source, 'playlist', p.id],
        queryFn: () =>
          source === 'yandex'
            ? window.electronAPI.yandex.playlist(p.id)
            : window.electronAPI.connectors.getPlaylist(source, p.id),
        staleTime: 5 * 60_000,
      })
      .then((pl) => pl.tracks);
  }
  throw new Error('Этот источник не поддерживает плейлисты');
}

function withTracks(load: () => Promise<UnifiedTrack[]>, run: (tracks: UnifiedTrack[]) => void): () => void {
  return () =>
    void load().then(
      (tracks) => (tracks.length ? run(tracks) : toast.error('Здесь нет треков')),
      (e) => toast.error(e instanceof Error ? e.message : 'Не удалось загрузить треки'),
    );
}

function collectionItems(load: () => Promise<UnifiedTrack[]>, context: PlayContext): MenuItem[][] {
  return [
    [
      { icon: Play, label: 'Слушать', action: withTracks(load, (t) => playCollection(t, context)) },
      { icon: Shuffle, label: 'Перемешать', action: withTracks(load, (t) => playCollection(t, context, true)) },
    ],
    [
      {
        icon: ListStart,
        label: 'Играть следующим',
        action: withTracks(load, (t) => {
          usePlayerStore.getState().playNext(t.filter((x) => x.playable));
          toast(`Сыграют следующими: ${formatTrackCount(t.length)}`);
        }),
      },
      {
        icon: ListEnd,
        label: 'Добавить в очередь',
        action: withTracks(load, (t) => {
          usePlayerStore.getState().addToQueue(t.filter((x) => x.playable));
          toast(`В очередь: ${formatTrackCount(t.length)}`);
        }),
      },
      { icon: ListPlus, label: 'Добавить в плейлист', action: withTracks(load, (t) => openPlaylistPicker(t)) },
    ],
  ];
}

function downloadAllItem(load: () => Promise<UnifiedTrack[]>): MenuItem {
  return {
    icon: Download,
    label: 'Скачать всё',
    action: withTracks(load, (tracks) => {
      const downloads = useDownloadsStore.getState();
      const todo = tracks.filter((t) => canDownload(t) && !downloads.items[downloadKey(t)]);
      if (!todo.length) return void toast('Всё уже скачано');
      for (const t of todo) void downloads.download(t);
      toast(`Скачиваем ${formatTrackCount(todo.length)}`);
    }),
  };
}

export function albumMenu(album: UnifiedAlbum): MenuSpec {
  const source = album.source === 'local' || album.source === 'spotify' ? album.source : 'yandex';
  const load = () => loadAlbumTracks(album.id, source);
  const context: PlayContext = { type: 'album', title: album.title, path: albumLink(album) };
  const artist = album.artists?.[0];
  const liked = useAlbumLikesStore.getState().isLiked(album);
  const externalUrl =
    album.source === 'spotify'
      ? `https://open.spotify.com/album/${album.id}`
      : album.source === 'yandex'
        ? `https://music.yandex.ru/album/${album.id}`
        : null;
  return {
    title: `${album.title} · ${album.artist}`,
    groups: [
      ...collectionItems(load, context),
      [
        {
          icon: Heart,
          label: liked ? 'Убрать из «Мне нравится»' : 'Мне нравится',
          action: () => void useAlbumLikesStore.getState().toggle(album),
        },
        ...(album.source === 'yandex'
          ? [
              {
                icon: Radio,
                label: 'Волна по альбому',
                action: () => void startWave({ seed: `album:${album.id}`, seedTitle: album.title }),
              } as MenuItem,
            ]
          : []),
        ...(artist
          ? [
              {
                icon: MicVocal,
                label: `Исполнитель: ${artist.name}`,
                action: (nav) => nav(artistPath(artist.name, { [album.source]: { source: album.source, id: artist.id, name: artist.name } })),
              } as MenuItem,
            ]
          : []),
        downloadAllItem(load),
        {
          icon: CloudUpload,
          label: 'Отправить на сервер MSS',
          action: withTracks(load, (tracks) => {
            void toast.promise(publishAlbumToMssCollection(album, tracks), {
              loading: 'Отправляем альбом на сервер MSS…',
              success: (r) =>
                r.uploaded > 0 || r.createdAlbum ? 'Отправлено на сервер MSS' : 'Альбом уже на сервере MSS',
              error: (e) => (e instanceof Error ? e.message : 'Не удалось отправить на сервер MSS'),
            });
          }),
        },
        ...(externalUrl
          ? [
              {
                icon: Copy,
                label: 'Скопировать ссылку',
                action: () => copyTextWithToast(externalUrl, 'Ссылка скопирована'),
              } as MenuItem,
            ]
          : []),
        {
          icon: Link2,
          label: 'Скопировать ссылку MSS',
          action: () => copyTextWithToast(mssAlbumUrl(album), 'Ссылка скопирована'),
        },
      ],
    ],
  };
}

export function playlistMenu(playlist: UnifiedPlaylist): MenuSpec {
  const load = () => loadPlaylistTracks(playlist);
  const context: PlayContext = { type: 'playlist', title: playlist.title, path: playlistPath(playlist) };
  const external = playlist.source !== 'local';
  const pinSource =
    playlist.source === 'local' || playlist.source === 'yandex' || playlist.source === 'vk' || playlist.source === 'spotify'
      ? playlist.source
      : null;
  const pinned = pinSource ? useSidebarStore.getState().isPinned(pinSource, playlist.id) : false;
  return {
    title: playlist.title,
    groups: [
      ...collectionItems(load, context),
      [
        ...(pinSource
          ? [
              {
                icon: pinned ? PinOff : Pin,
                label: pinned ? 'Открепить от боковой панели' : 'Закрепить в боковой панели',
                action: () => {
                  useSidebarStore.getState().togglePin(pinSource, playlist.id);
                  toast(pinned ? 'Плейлист убран из боковой панели' : 'Плейлист закреплён в боковой панели');
                },
              } as MenuItem,
            ]
          : []),
        ...(external
          ? [
              {
                icon: ListPlus,
                label: 'Скопировать в плейлисты MSS',
                action: (nav) =>
                  void load().then(async (tracks) => {
                    const id = await importToMss(playlist, tracks);
                    if (id) nav(`/playlists/${id}`);
                  }),
              } as MenuItem,
              downloadAllItem(load),
            ]
          : []),
        { icon: FileDown, label: 'Экспорт в M3U8', action: withTracks(load, (t) => void exportM3u8(playlist.title, t)) },
        {
          icon: Link2,
          label: 'Скопировать ссылку MSS',
          action: () => copyTextWithToast(mssPlaylistUrl(playlist), 'Ссылка скопирована'),
        },
      ],
    ],
  };
}

export function artistMenu(group: ArtistGroup): MenuSpec {
  const yandex = group.refs.yandex;
  const vk = group.refs.vk;
  const spotify = group.refs.spotify;
  const source = yandex ? 'yandex' : vk ? 'vk' : spotify ? 'spotify' : null;
  const artist = yandex ?? vk ?? spotify;
  const loadPopular = () => window.electronAPI.connectors.artistTracks(source!, artist!.id, 50, artist!.name);
  const context: PlayContext = { type: 'artist', title: group.name, path: artistPath(group.name, group.refs) };
  return {
    title: group.name,
    groups: [
      artist
        ? [
            { icon: Play, label: 'Слушать популярное', action: withTracks(loadPopular, (t) => playCollection(t, context)) },
            { icon: Shuffle, label: 'Перемешать', action: withTracks(loadPopular, (t) => playCollection(t, context, true)) },
            ...(yandex
              ? [
                  {
                    icon: Radio,
                    label: 'Волна по исполнителю',
                    action: () => void startWave({ seed: `artist:${yandex.id}`, seedTitle: group.name }),
                  } as MenuItem,
                ]
              : []),
          ]
        : [],
      [
        { icon: MicVocal, label: 'Открыть страницу', action: (nav) => nav(artistPath(group.name, group.refs)) },
        { icon: Copy, label: 'Скопировать имя', action: () => copyTextWithToast(group.name, 'Имя скопировано') },
      ],
    ],
  };
}
