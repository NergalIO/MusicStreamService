import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react';
import { Range } from '@/components/ui/controls';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/store/player-store';

export function VolumeControl({ className }: { className?: string }) {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const effective = muted ? 0 : volume;
  const Icon = effective === 0 ? VolumeX : effective < 0.33 ? Volume : effective < 0.66 ? Volume1 : Volume2;

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      onWheel={(e) => setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
    >
      <button
        type="button"
        aria-label={muted ? 'Включить звук' : 'Выключить звук'}
        onClick={() => setMuted(!muted)}
        className="text-muted transition-colors hover:text-foreground"
      >
        <Icon size={17} />
      </button>
      <Range
        aria-label="Громкость"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="w-24"
      />
    </div>
  );
}
