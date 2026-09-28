import type { UnifiedTrack } from '@mss/shared';
import { useDeferredValue, useMemo, useState } from 'react';

export type SortKey = 'default' | 'title' | 'artist' | 'album' | 'duration';

export interface TrackSort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const DEFAULT_SORT: TrackSort = { key: 'default', dir: 'asc' };
const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim();
}

function compare(a: UnifiedTrack, b: UnifiedTrack, key: SortKey): number {
  switch (key) {
    case 'title':
      return collator.compare(a.title, b.title);
    case 'artist':
      return collator.compare(a.artist, b.artist) || collator.compare(a.album ?? '', b.album ?? '');
    case 'album':
      return collator.compare(a.album ?? '', b.album ?? '') || collator.compare(a.title, b.title);
    case 'duration':
      return (a.durationMs ?? 0) - (b.durationMs ?? 0);
    default:
      return 0;
  }
}

export function matchesTrack(track: UnifiedTrack, query: string): boolean {
  if (!query) return true;
  const hay = normalizeSearch(`${track.title} ${track.artist} ${track.album ?? ''}`);
  return query.split(/\s+/).every((word) => hay.includes(word));
}

export function useTrackSort<T extends UnifiedTrack>(tracks: T[]) {
  const [sort, setSort] = useState<TrackSort>(DEFAULT_SORT);
  const [filter, setFilter] = useState('');
  const deferred = normalizeSearch(useDeferredValue(filter));

  const view = useMemo(() => {
    const filtered = deferred ? tracks.filter((t) => matchesTrack(t, deferred)) : tracks;
    if (sort.key === 'default') return sort.dir === 'desc' ? [...filtered].reverse() : filtered;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => sign * compare(a, b, sort.key));
  }, [tracks, deferred, sort]);

  /** Клик по заголовку: по возрастанию → по убыванию → исходный порядок. */
  const cycle = (key: SortKey) =>
    setSort((s) => (s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : DEFAULT_SORT));

  return {
    view,
    sort,
    setSort,
    cycle,
    filter,
    setFilter,
    /** Порядок совпадает с исходным — можно перетаскивать строки. */
    isNatural: sort.key === 'default' && sort.dir === 'asc' && !deferred,
  };
}
