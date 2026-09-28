import type { UnifiedTrack } from '@mss/shared';
import { CircleArrowDown } from 'lucide-react';
import { useDownloadState } from '@/store/downloads-store';

export function DownloadBadge({ track }: { track: Pick<UnifiedTrack, 'source' | 'id'> }) {
  const { record, active } = useDownloadState(track);
  if (active) {
    const ratio = active.total ? active.received / active.total : 0;
    const r = 5.5;
    const c = 2 * Math.PI * r;
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" className="shrink-0 -rotate-90 text-primary" aria-label="Скачивается">
        <circle cx={7} cy={7} r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
        <circle
          cx={7}
          cy={7}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(ratio, 0.08))}
          className={ratio ? 'transition-[stroke-dashoffset] duration-300' : 'origin-center animate-spin'}
        />
      </svg>
    );
  }
  if (!record) return null;
  return (
    <span title={`Скачано · ${record.codec.toUpperCase()}`} className="shrink-0 text-primary">
      <CircleArrowDown size={14} />
    </span>
  );
}
