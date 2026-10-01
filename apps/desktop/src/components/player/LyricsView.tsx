import type { SourceId, TrackLyrics, UnifiedTrack } from '@mss/shared';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { seekTo } from '@/lib/player-actions';
import { cn } from '@/lib/utils';
import { usePlaybackStore } from '@/store/playback-store';

const LEAD_MS = 250;

const LYRICS_SOURCES = new Set<SourceId>(['yandex', 'spotify', 'local']);

function scrollLineIntoView(container: HTMLElement, line: HTMLElement, smooth: boolean): void {
  const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
  container.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
}

export function LyricsView({ track }: { track: UnifiedTrack }) {
  const lyricsApi = window.electronAPI?.lyrics?.get;
  const supported = LYRICS_SOURCES.has(track.source);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['lyrics', track.source, track.id],
    queryFn: async () => {
      const local = await lyricsApi!(track.source, track.id);
      if (track.source !== 'local') return local;
      if (local?.lines.some((l) => l.text.trim())) return local;
      try {
        return await apiFetch<TrackLyrics>(`/tracks/${track.id}/lyrics`);
      } catch {
        return null;
      }
    },
    enabled: supported && !!lyricsApi,
    staleTime: Infinity,
    retry: false,
  });

  if (!lyricsApi) {
    return <Empty text="Обновите приложение: тексты для Spotify и MSS есть в сборке новее 0.5.6" />;
  }
  if (!supported) return <Empty text="Тексты песен недоступны для этого источника" />;
  if (isLoading)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (isError) {
    const text =
      track.source === 'spotify'
        ? 'Не удалось загрузить текст. Откройте Spotify → Веб-плеер в боковой панели и войдите в аккаунт.'
        : 'Не удалось загрузить текст';
    return <Empty text={text} />;
  }
  if (!data || !data.lines.some((l) => l.text.trim())) {
    const empty =
      track.source === 'local'
        ? 'Нет текста. Положите .lrc или .txt рядом с файлом при загрузке — он сохранится в облаке.'
        : track.source === 'spotify'
          ? 'У этого трека нет текста в Spotify (или они недоступны для вашего аккаунта).'
          : 'У этого трека нет текста';
    return <Empty text={empty} />;
  }

  return data.synced ? <SyncedLyrics data={data} /> : <PlainLyrics data={data} />;
}

function SyncedLyrics({ data }: { data: TrackLyrics }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrollUntil = useRef(0);
  const lastActive = useRef(-1);

  useEffect(() => {
    const apply = (currentTime: number) => {
      const t = currentTime * 1000 + LEAD_MS;
      let idx = -1;
      for (let i = 0; i < data.lines.length; i++) {
        if (data.lines[i].timeMs <= t) idx = i;
        else break;
      }
      if (idx === lastActive.current) return;
      const prev = containerRef.current?.querySelector<HTMLElement>(`[data-line="${lastActive.current}"]`);
      const next = containerRef.current?.querySelector<HTMLElement>(`[data-line="${idx}"]`);
      prev?.classList.remove('scale-100', 'text-white');
      prev?.classList.add('scale-[0.97]', 'text-white/35');
      next?.classList.remove('scale-[0.97]', 'text-white/35');
      next?.classList.add('scale-100', 'text-white');
      lastActive.current = idx;
      if (idx < 0 || Date.now() < userScrollUntil.current) return;
      const container = containerRef.current;
      if (!container || !next) return;
      scrollLineIntoView(container, next, true);
    };
    apply(usePlaybackStore.getState().currentTime);
    return usePlaybackStore.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime) apply(s.currentTime);
    });
  }, [data.lines]);

  return (
    <div
      ref={containerRef}
      onWheel={() => (userScrollUntil.current = Date.now() + 4000)}
      className="no-scrollbar h-full overflow-y-auto overscroll-y-contain px-2 py-[35vh] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
    >
      {data.lines.map((line, i) => (
        <button
          key={i}
          type="button"
          data-line={i}
          onClick={() => seekTo(line.timeMs / 1000)}
          className={cn(
            'block w-full origin-left py-2 text-left text-[28px] font-bold leading-tight tracking-tight transition-all duration-500 scale-[0.97] text-white/35 hover:text-white/60',
            !line.text.trim() && 'py-4',
          )}
        >
          {line.text.trim() || '♪'}
        </button>
      ))}
      {data.writers?.length ? (
        <p className="mt-10 text-sm text-white/40">Авторы: {data.writers.join(', ')}</p>
      ) : null}
    </div>
  );
}

function PlainLyrics({ data }: { data: TrackLyrics }) {
  return (
    <div className="no-scrollbar h-full overflow-y-auto overscroll-y-contain px-2 py-[35vh] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]">
      {data.lines.map((line, i) => (
        <p key={i} className="min-h-[1.5em] text-xl font-semibold leading-relaxed text-white/80">
          {line.text}
        </p>
      ))}
      {data.writers?.length ? (
        <p className="mt-10 text-sm text-white/40">Авторы: {data.writers.join(', ')}</p>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-white/50">{text}</div>;
}
