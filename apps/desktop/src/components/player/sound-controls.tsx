import { Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getAudioEngine } from '@/hooks/useAudioEngine';
import { cn } from '@/lib/utils';
import { formatSleepLeft, SLEEP_OPTIONS, useSleepStore } from '@/store/sleep-store';
import { useSettingsStore } from '@/store/settings-store';

interface OutputDevice {
  id: string;
  label: string;
}

export function useOutputDevices(): OutputDevice[] {
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const load = () =>
      void md
        .enumerateDevices()
        .then((list) => {
          const outputs = list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
          setDevices(outputs.map((d, i) => ({ id: d.deviceId, label: d.label || `Устройство ${i + 1}` })));
        })
        .catch(() => setDevices([]));
    load();
    md.addEventListener('devicechange', load);
    return () => md.removeEventListener('devicechange', load);
  }, []);
  return devices;
}

export function OutputDeviceSelect({ className }: { className?: string }) {
  const outputDeviceId = useSettingsStore((s) => s.outputDeviceId);
  const setOutputDeviceId = useSettingsStore((s) => s.setOutputDeviceId);
  const devices = useOutputDevices();
  if (!getAudioEngine().outputDeviceSupported) {
    return <p className="text-xs text-muted">Выбор устройства не поддерживается этой версией Electron.</p>;
  }
  const missing = outputDeviceId && !devices.some((d) => d.id === outputDeviceId);
  return (
    <select
      value={missing ? '' : outputDeviceId}
      onChange={(e) => setOutputDeviceId(e.target.value)}
      className={cn(
        'h-9 w-full rounded-lg border bg-foreground/[0.06] px-2 text-sm outline-none focus:ring-2 focus:ring-primary/50',
        className,
      )}
    >
      <option value="">Системное по умолчанию</option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function SleepTimerControl() {
  const { endsAt, afterTrack, start, stopAfterTrack, cancel } = useSleepStore();
  const now = useNow(!!endsAt);
  const chip = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1 text-xs transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-foreground/10 hover:bg-foreground/15',
    );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Moon size={14} /> Таймер сна
        </span>
        <span className="text-xs tabular-nums text-muted">
          {endsAt ? `через ${formatSleepLeft(endsAt, now)}` : afterTrack ? 'после трека' : 'выкл.'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SLEEP_OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            className={chip(false)}
            onClick={() => {
              start(m);
              toast(`Таймер сна: ${m} мин`);
            }}
          >
            {m} мин
          </button>
        ))}
        <button type="button" className={chip(afterTrack)} onClick={stopAfterTrack}>
          До конца трека
        </button>
        {(endsAt || afterTrack) && (
          <button type="button" className={cn(chip(false), 'text-muted')} onClick={cancel}>
            Выключить
          </button>
        )}
      </div>
    </div>
  );
}
