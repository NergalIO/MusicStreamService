import type { UnifiedTrack } from '@mss/shared';
import { ListMusic, Plus } from 'lucide-react';
import { useState } from 'react';
import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cachedImageUrl } from '@/lib/cached-image';
import { formatTrackCount } from '@/lib/format';
import { addTracksToPlaylist, createPlaylist } from '@/lib/mss-library';
import { useMssPlaylists } from '@/lib/queries';

interface PickerState {
  tracks: UnifiedTrack[];
  close: () => void;
}

const usePicker = create<PickerState>()((set) => ({
  tracks: [],
  close: () => set({ tracks: [] }),
}));

export function openPlaylistPicker(tracks: UnifiedTrack | UnifiedTrack[]): void {
  usePicker.setState({ tracks: Array.isArray(tracks) ? tracks : [tracks] });
}

export function PlaylistPickerHost() {
  const { tracks, close } = usePicker();
  const { data: playlists = [], isLoading } = useMssPlaylists();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const open = tracks.length > 0;

  const pick = async (playlist: { id: string; name: string }) => {
    if (!open) return;
    const picked = tracks;
    close();
    await addTracksToPlaylist(playlist, picked);
  };

  const createAndAdd = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const playlist = await createPlaylist(name.trim());
      setName('');
      await pick(playlist);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Добавить в плейлист">
      {open && (
        <p className="-mt-2 mb-4 truncate text-sm text-muted">
          {tracks.length === 1 ? `${tracks[0].artist} — ${tracks[0].title}` : `Выбрано: ${formatTrackCount(tracks.length)}`}
        </p>
      )}
      <div className="-mx-2 max-h-72 space-y-0.5 overflow-y-auto">
        {isLoading && <p className="px-2 py-3 text-sm text-muted">Загружаем плейлисты…</p>}
        {!isLoading && !playlists.length && (
          <p className="px-2 py-3 text-sm text-muted">Плейлистов пока нет — создайте первый ниже</p>
        )}
        {playlists.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => void pick(p)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.06]"
          >
            {p.coverUrl ? (
              <img src={cachedImageUrl(p.coverUrl)} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/60 to-fuchsia-600/40">
                <ListMusic size={18} className="text-white/80" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted">{formatTrackCount(p.trackCount)}</span>
            </span>
          </button>
        ))}
      </div>
      <form
        className="mt-4 flex gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void createAndAdd();
        }}
      >
        <Input placeholder="Новый плейлист" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || busy}>
          <Plus size={15} /> Создать
        </Button>
      </form>
    </Dialog>
  );
}
