import type { PlaylistEntryDto, SourceId, TrackAvailability, UnifiedTrack } from '@mss/shared';
import { apiMediaUrl } from '@/lib/api-base';
import { cachedCloudUrls, rememberCloudUrls } from '@/lib/cloud-urls';

export type SourceFilterId = SourceId | 'all';

export const SOURCE_FILTERS: { id: SourceFilterId; label: string }[] = [
  { id: 'all', label: 'Везде' },
  { id: 'local', label: 'Наша библиотека' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'yandex', label: 'Yandex' },
  { id: 'vk', label: 'VK' },
];

export const SOURCE_LABEL: Record<SourceId, string> = {
  local: 'MSS',
  spotify: 'Spotify',
  yandex: 'Yandex',
  vk: 'VK',
};

export const EXTERNAL_SOURCES = ['spotify', 'yandex', 'vk'] as const;

export function matchesFilter(filter: SourceFilterId, source: SourceId): boolean {
  return filter === 'all' || filter === source;
}

export interface LocalTrackDto {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  durationMs?: number | null;
  loudnessLufs?: number | null;
  status: string;
  coverUrl?: string | null;
  availability?: TrackAvailability;
  streamUrl?: string | null;
  userHolds?: boolean;
  cloudPlayUrl?: string | null;
  cloudDownloadUrl?: string | null;
  cloudUrlExpiresAt?: string | null;
}

const LOCAL_STATUS_REASON: Record<string, string> = {
  processing: 'Трек ещё обрабатывается',
  uploading: 'Файл загружается в облако',
  failed: 'Не удалось обработать файл',
  registered: 'Нет активных источников',
};

export const AVAILABILITY_LABEL: Record<TrackAvailability, string> = {
  cached: 'Кэш',
  online: 'Онлайн',
  unavailable: 'Недоступно',
};

export function mapLocalTrack(
  t: LocalTrackDto,
  opts?: { ownsLocal?: boolean },
): UnifiedTrack & { streamUrl?: string; status: string } {
  const ownsLocal = !!opts?.ownsLocal || !!t.userHolds;
  let availability = t.availability ?? (t.status === 'ready' ? 'cached' : 'unavailable');
  if (ownsLocal && availability === 'unavailable' && (t.status === 'registered' || t.status === 'cached')) {
    availability = 'cached';
  }
  const playable =
    ownsLocal ||
    availability === 'cached' ||
    availability === 'online' ||
    t.status === 'ready';
  const unplayableReason =
    playable ? undefined : LOCAL_STATUS_REASON[t.status] ?? 'Нет активных источников';
  rememberCloudUrls(t.id, t);
  const cached = cachedCloudUrls(t.id);
  return {
    source: 'local',
    status: t.status,
    availability,
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album ?? undefined,
    durationMs: t.durationMs ?? undefined,
    loudnessLufs: t.loudnessLufs ?? undefined,
    coverUrl: t.coverUrl
      ? apiMediaUrl(`/covers/${t.id}${coverVersion(t.coverUrl)}`)
      : undefined,
    playable,
    unplayableReason,
    streamUrl: t.streamUrl ?? apiMediaUrl(`/stream/${t.id}`),
    cloudPlayUrl: t.cloudPlayUrl ?? cached?.cloudPlayUrl,
    cloudDownloadUrl: t.cloudDownloadUrl ?? cached?.cloudDownloadUrl,
    cloudUrlExpiresAt: t.cloudUrlExpiresAt ?? cached?.cloudUrlExpiresAt,
  };
}

function coverVersion(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(q) : '';
}

export type PlaylistEntryTrack = UnifiedTrack & { entryId: string; streamUrl?: string; status?: string };

export function mapPlaylistEntry(entry: PlaylistEntryDto): PlaylistEntryTrack {
  if ('external' in entry) {
    const { source, id, snapshot } = entry.external;
    return {
      source,
      id,
      entryId: entry.entryId,
      title: snapshot.title,
      artist: snapshot.artist,
      artists: snapshot.artists,
      album: snapshot.album,
      albumId: snapshot.albumId,
      durationMs: snapshot.durationMs,
      coverUrl: snapshot.coverUrl,
      explicit: snapshot.explicit,
      playable: true,
    };
  }
  return { ...mapLocalTrack(entry), entryId: entry.entryId };
}
