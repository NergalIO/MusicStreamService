import { Play, Radio, Shuffle, Sparkles } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PageTitle, TrackListSkeleton } from '@/components/media/CollectionHeader';
import { TrackList } from '@/components/tracks/TrackList';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useYandexConnected } from '@/lib/connectors';
import { formatTrackCount } from '@/lib/format';
import { playCollection, startWave } from '@/lib/player-actions';
import { useSimilarTracks } from '@/lib/queries';
import type { PlayContext } from '@/store/player-store';

export function SimilarPage() {
  const { source, id } = useParams();
  const [params] = useSearchParams();
  const title = params.get('title') ?? 'трек';
  const connected = useYandexConnected();
  const similar = useSimilarTracks(source, id);
  const tracks = similar.data ?? [];
  const context: PlayContext = { type: 'other', title: `Похожие на «${title}»`, path: `/similar/${source}/${id}?${params}` };

  if (source !== 'yandex' || !connected) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Похожие треки недоступны"
        description={source !== 'yandex' ? 'Подборка похожих есть только для треков Яндекс Музыки.' : 'Подключите Яндекс Музыку в настройках.'}
      />
    );
  }

  return (
    <div>
      <PageTitle
        title="Похожие треки"
        subtitle={`На основе «${title}»${tracks.length ? ` · ${formatTrackCount(tracks.length)}` : ''}`}
        actions={
          <>
            <Button disabled={!tracks.length} onClick={() => playCollection(tracks, context)}>
              <Play size={15} fill="currentColor" /> Слушать
            </Button>
            <Button variant="secondary" disabled={!tracks.length} onClick={() => playCollection(tracks, context, true)}>
              <Shuffle size={15} /> Перемешать
            </Button>
            <Button variant="secondary" onClick={() => void startWave({ seed: `track:${id}`, seedTitle: title })}>
              <Radio size={15} /> Волна по треку
            </Button>
          </>
        }
      />
      {similar.isLoading ? (
        <TrackListSkeleton />
      ) : similar.isError ? (
        <ErrorState title="Не удалось загрузить похожие треки" error={similar.error} onRetry={() => void similar.refetch()} />
      ) : (
        <TrackList tracks={tracks} context={context} emptyText="Яндекс не нашёл похожих треков" />
      )}
    </div>
  );
}
