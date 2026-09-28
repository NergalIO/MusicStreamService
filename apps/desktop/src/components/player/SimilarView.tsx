import type { UnifiedTrack } from '@mss/shared';
import { Loader2, Play, Radio } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Artwork } from '@/components/media/Artwork';
import { Button } from '@/components/ui/button';
import { openTrackMenu } from '@/components/tracks/TrackContextMenu';
import { formatDuration } from '@/lib/format';
import { similarPath } from '@/lib/links';
import { playCollection, startWave } from '@/lib/player-actions';
import { useSimilarTracks } from '@/lib/queries';
import { usePlaybackStore } from '@/store/playback-store';

export function SimilarView({ track }: { track: UnifiedTrack }) {
  const navigate = useNavigate();
  const similar = useSimilarTracks(track.source, track.id);
  const tracks = similar.data ?? [];
  const context = { type: 'other' as const, title: `Похожие на «${track.title}»`, path: similarPath(track) };

  if (track.source !== 'yandex') {
    return <div className="flex h-full items-center justify-center px-6 text-center text-muted">Похожие треки есть только для Яндекс Музыки</div>;
  }
  if (similar.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }
  if (similar.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        Не удалось загрузить похожие треки
        <button type="button" onClick={() => void similar.refetch()} className="text-sm text-foreground underline-offset-2 hover:underline">
          Повторить
        </button>
      </div>
    );
  }
  if (!tracks.length) {
    return <div className="flex h-full items-center justify-center text-muted">Яндекс не нашёл похожих треков</div>;
  }

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-10 pr-1">
      <div className="mb-3 flex flex-wrap items-center gap-2 px-2">
        <Button size="sm" className="rounded-full" onClick={() => playCollection(tracks, context)}>
          <Play size={13} fill="currentColor" /> Слушать все
        </Button>
        <Button variant="secondary" size="sm" className="rounded-full bg-foreground/15 hover:bg-foreground/25" onClick={() => void startWave({ seed: `track:${track.id}`, seedTitle: track.title })}>
          <Radio size={13} /> Волна по треку
        </Button>
        <button
          type="button"
          onClick={() => {
            usePlaybackStore.getState().setNowPlaying(false);
            navigate(similarPath(track));
          }}
          className="ml-auto text-xs text-muted hover:text-foreground"
        >
          Открыть страницей
        </button>
      </div>
      {tracks.map((t, i) => (
        <div
          key={`${t.source}:${t.id}`}
          onDoubleClick={() => playCollection(tracks.slice(i), context)}
          onContextMenu={(e) => openTrackMenu(e, t)}
          className="group flex h-14 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-foreground/10"
        >
          <button type="button" aria-label={`Слушать ${t.title}`} onClick={() => playCollection(tracks.slice(i), context)} className="relative shrink-0">
            <Artwork src={t.coverUrl} className="h-10 w-10" rounded="rounded-md" iconSize={14} />
            <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Play size={14} fill="currentColor" className="text-foreground" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.title}</div>
            <div className="truncate text-xs text-muted">{t.artist}</div>
          </div>
          <span className="text-xs tabular-nums text-muted">{formatDuration(t.durationMs)}</span>
        </div>
      ))}
    </div>
  );
}
