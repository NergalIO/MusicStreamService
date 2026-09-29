import { Speaker } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { ipcMessage, startSpotifyTrack } from '@/lib/spotify-player';
import { usePlaybackStore } from '@/store/playback-store';
import { usePlayerStore } from '@/store/player-store';

interface SpotifyDevice {
  name: string;
  active: boolean;
  local: boolean;
}

export function SpotifyDeviceButton() {
  const source = usePlayerStore((s) => s.current?.source);
  const [remote, setRemote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (source !== 'spotify') {
      setRemote(null);
      setOpen(false);
      return;
    }
    let cancel = false;
    const apply = (name: string | null) => {
      if (!cancel) setRemote(name);
    };
    const pull = () => {
      void window.electronAPI.spotifyConnect
        .deviceStatus()
        .then((s) => apply(s.remoteName))
        .catch(() => undefined);
    };
    const off = window.electronAPI.spotifyConnect.onDevice((s) => apply(s.remoteName));
    pull();
    const id = setInterval(pull, 8000);
    return () => {
      cancel = true;
      off();
      clearInterval(id);
    };
  }, [source]);

  if (source !== 'spotify' || !remote) return null;

  return (
    <>
      <div className="no-drag px-4 pb-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
        >
          <Speaker size={14} />
          Воспроизведение на «{remote}» — выбрать устройство
        </button>
      </div>
      <SpotifyDeviceDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SpotifyDeviceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setError(null);
    setPending(null);
    void window.electronAPI.spotifyConnect
      .deviceStatus()
      .then((s) => {
        if (cancel) return;
        setDevices(s.devices);
        if (!s.devices.length) setError('Spotify не показал устройства. Откройте список ещё раз через пару секунд.');
      })
      .catch((e) => {
        if (!cancel) setError(ipcMessage(e));
      });
    return () => {
      cancel = true;
    };
  }, [open]);

  const choose = (device: SpotifyDevice) => {
    setPending(device.name);
    setError(null);
    void window.electronAPI.spotifyConnect
      .selectDevice(device.name)
      .then(async (status) => {
        if (status.selectedLocal || device.local) {
          const current = usePlayerStore.getState().current;
          if (current?.source === 'spotify') {
            await startSpotifyTrack(current, usePlaybackStore.getState().currentTime);
          }
        }
        onClose();
      })
      .catch((e) => setError(ipcMessage(e)))
      .finally(() => setPending(null));
  };

  return (
    <Dialog open={open} onClose={onClose} title="Устройство воспроизведения">
      <p className="mb-3 text-sm text-muted">
        Spotify играет только на одном устройстве. Выберите, где должен звучать трек.
      </p>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <div className="flex flex-col gap-1">
        {devices.map((device) => (
          <button
            key={device.name}
            type="button"
            disabled={!!pending}
            onClick={() => choose(device)}
            className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-foreground/10 disabled:opacity-50"
          >
            <span className="min-w-0 truncate">
              {device.name}
              {device.local && <span className="ml-2 text-xs text-muted">это приложение</span>}
            </span>
            {device.active && <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-300">сейчас</span>}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
