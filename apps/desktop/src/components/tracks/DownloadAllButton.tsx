import type { UnifiedTrack } from '@mss/shared';
import { CircleArrowDown, Download, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { canDownload, downloadKey, useDownloadsStore } from '@/store/downloads-store';

export function DownloadAllButton({ tracks, size = 'lg' }: { tracks: UnifiedTrack[]; size?: 'sm' | 'md' | 'lg' }) {
  const items = useDownloadsStore((s) => s.items);
  const active = useDownloadsStore((s) => s.active);
  const downloadMany = useDownloadsStore((s) => s.downloadMany);

  const eligible = useMemo(() => tracks.filter(canDownload), [tracks]);
  if (!eligible.length) return null;

  const done = eligible.filter((t) => items[downloadKey(t)]).length;
  const running = eligible.filter((t) => active[downloadKey(t)]).length;

  if (running) {
    return (
      <Button size={size} variant="secondary" className="cursor-default tabular-nums">
        <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" /> Скачано {done} из {eligible.length}
      </Button>
    );
  }
  if (done === eligible.length) {
    return (
      <Button
        size={size}
        variant="secondary"
        title="Открыть папку со скачанными треками"
        onClick={() => void window.electronAPI.downloads.openDir()}
      >
        <CircleArrowDown size={size === 'sm' ? 14 : 16} className="text-primary" /> Скачано
      </Button>
    );
  }
  return (
    <Button size={size} variant="secondary" onClick={() => void downloadMany(eligible)}>
      <Download size={size === 'sm' ? 14 : 16} /> {done ? `Докачать ${eligible.length - done}` : 'Скачать'}
    </Button>
  );
}
