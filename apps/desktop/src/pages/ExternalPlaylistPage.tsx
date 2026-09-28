import type { SourceId, UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { FileDown, ListPlus, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { CollectionHeader, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { DownloadAllButton } from '@/components/tracks/DownloadAllButton';
import { TrackFilterInput, TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useTrackSort } from '@/hooks/useTrackSort';
import { formatTotalDuration, formatTrackCount } from '@/lib/format';
import { playCollection } from '@/lib/player-actions';
import { exportM3u8, importToMss } from '@/lib/playlist-io';
import { SOURCE_LABEL } from '@/lib/sources';

const NO_TRACKS: UnifiedTrack[] = [];

export function ExternalPlaylistPage() {
  const { source = '', id = '' } = useParams();
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const supported = source === 'yandex' || source === 'vk';
  const { data: playlist, isLoading, error, refetch } = useQuery({
    queryKey: [source, 'playlist', id],
    queryFn: () => {
      if (source === 'yandex') return window.electronAPI.yandex.playlist(id);
      if (source === 'vk') return window.electronAPI.connectors.getPlaylist('vk', id);
      throw new Error('Unsupported source');
    },
    enabled: supported && !!id,
    staleTime: 5 * 60_000,
  });
  const { view, sort, cycle, filter, setFilter } = useTrackSort(playlist?.tracks ?? NO_TRACKS);

  if (source === 'spotify') return <Navigate to="/spotify" replace />;
  if (!supported) {
    return <EmptyState title="Этот источник пока не поддерживает плейлисты" />;
  }
  if (error) return <ErrorState title="Не удалось загрузить плейлист" error={error} onRetry={() => void refetch()} />;
  if (isLoading || !playlist) return <TrackListSkeleton rows={12} />;

  const kicker = `Плейлист · ${SOURCE_LABEL[source as SourceId] ?? source}`;
  const context = { type: 'playlist' as const, title: playlist.title, path: `/playlist/${source}/${encodeURIComponent(id)}` };
  const total = playlist.tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  const runImport = async () => {
    setImporting(true);
    const newId = await importToMss(playlist, playlist.tracks);
    setImporting(false);
    if (newId) navigate(`/playlists/${newId}`);
  };

  return (
    <div>
      <CollectionHeader
        kicker={kicker}
        title={playlist.title}
        subtitle={playlist.owner}
        meta={[formatTrackCount(playlist.tracks.length), total ? formatTotalDuration(total) : null].filter(Boolean).join(' · ')}
        description={playlist.description}
        coverUrl={playlist.coverUrl}
        onPlay={() => playCollection(view, context)}
        onShuffle={() => playCollection(view, context, true)}
        actions={
          <>
            <DownloadAllButton tracks={playlist.tracks} />
            <Button size="lg" variant="secondary" disabled={importing || !playlist.tracks.length} onClick={() => void runImport()}>
              {importing ? <Loader2 size={16} className="animate-spin" /> : <ListPlus size={16} />}
              В плейлисты MSS
            </Button>
            <Button size="lg" variant="secondary" onClick={() => exportM3u8(playlist.title, playlist.tracks)}>
              <FileDown size={16} /> M3U
            </Button>
          </>
        }
      />
      <div className="mb-4 flex justify-end">
        <TrackFilterInput value={filter} onChange={setFilter} />
      </div>
      <TrackList tracks={view} context={context} header sort={sort} onSort={cycle} showSource={false} />
    </div>
  );
}
