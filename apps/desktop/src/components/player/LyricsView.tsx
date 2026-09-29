import type { SourceId, UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { seekTo } from '@/lib/player-actions';
import { cn } from '@/lib/utils';
import { usePlaybackStore } from '@/store/playback-store';

const LEAD_MS = 250;

const LYRICS_SOURCES = new Set<SourceId>(['yandex', 'spotify', 'local']);

export function LyricsView({ track }: { track: UnifiedTrack }) {
  const supported = LYRICS_SOURCES.has(track.source);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['lyrics', track.source, track.id],
    queryFn: () => window.electronAPI.lyrics.get(track.source, track.id),
    enabled: supported,
    staleTime: Infinity,
    retry: false,
  });
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrollUntil = useRef(0);

  const active = useMemo(() => {
    if (!data?.synced) return -1;
    const t = currentTime * 1000 + LEAD_MS;
    let idx = -1;
    for (let i = 0; i < data.lines.length; i++) {
      if (data.lines[i].timeMs <= t) idx = i;
      else break;
    }
    return idx;
  }, [data, currentTime]);

  useEffect(() => {
    if (active < 0 || Date.now() < userScrollUntil.current) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  if (!supported) return <Empty text="Тексты песен недоступны для этого источника" />;
  if (isLoading)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (isError) return <Empty text="Не удалось загрузить текст" />;
  if (!data || !data.lines.some((l) => l.text.trim())) {
    const empty =
      track.source === 'local'
        ? 'Нет текста. Положите .lrc или .txt рядом с файлом трека (или скачанной копией).'
        : 'У этого трека нет текста';
    return <Empty text={empty} />;
  }

  return (
    <div
      ref={containerRef}
      onWheel={() => (userScrollUntil.current = Date.now() + 4000)}
      className="no-scrollbar h-full overflow-y-auto px-2 py-[35vh] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
    >
      {data.lines.map((line, i) =>
        data.synced ? (
          <button
            key={i}
            type="button"
            data-line={i}
            onClick={() => seekTo(line.timeMs / 1000)}
            className={cn(
              'block w-full origin-left py-2 text-left text-[28px] font-bold leading-tight tracking-tight transition-all duration-500',
              i === active ? 'scale-100 text-white' : 'scale-[0.97] text-white/35 hover:text-white/60',
              !line.text.trim() && 'py-4',
            )}
          >
            {line.text.trim() || '♪'}
          </button>
        ) : (
          <p key={i} className="min-h-[1.5em] text-xl font-semibold leading-relaxed text-white/80">
            {line.text}
          </p>
        ),
      )}
      {data.writers?.length ? (
        <p className="mt-10 text-sm text-white/40">Авторы: {data.writers.join(', ')}</p>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-white/50">{text}</div>;
}
