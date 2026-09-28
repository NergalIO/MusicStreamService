import type { UnifiedTrack } from '@mss/shared';
import { ImagePlus, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { Artwork } from '@/components/media/Artwork';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { prepareCover, setTrackCover, updateTrack } from '@/lib/mss-library';
import { usePlayerStore } from '@/store/player-store';

const useEditTrack = create<{ track: UnifiedTrack | null }>()(() => ({ track: null }));

export function openEditTrack(track: UnifiedTrack): void {
  useEditTrack.setState({ track });
}

export function EditTrackDialogHost() {
  const track = useEditTrack((s) => s.track);
  const close = () => useEditTrack.setState({ track: null });
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!track) return;
    setTitle(track.title);
    setArtist(track.artist);
    setAlbum(track.album ?? '');
    setCoverFile(null);
  }, [track]);

  useEffect(() => {
    if (!coverFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const save = async () => {
    if (!track || !title.trim() || !artist.trim()) return;
    setSaving(true);
    try {
      const patch = {
        title: title.trim() !== track.title ? title.trim() : undefined,
        artist: artist.trim() !== track.artist ? artist.trim() : undefined,
        album: album.trim() !== (track.album ?? '') ? album.trim() || null : undefined,
      };
      if (Object.values(patch).some((v) => v !== undefined)) await updateTrack(track.id, patch);
      if (coverFile) await setTrackCover(track.id, await prepareCover(coverFile));
      // Очередь хранит копии треков: обновляем их, чтобы плеер сразу показал новые данные.
      usePlayerStore.setState((s) => {
        const apply = <T extends UnifiedTrack>(t: T): T =>
          t.source === 'local' && t.id === track.id
            ? { ...t, title: title.trim(), artist: artist.trim(), album: album.trim() || undefined }
            : t;
        return { queue: s.queue.map(apply), current: s.current ? apply(s.current) : s.current };
      });
      toast('Изменения сохранены');
      close();
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!track} onClose={saving ? () => undefined : close} title="Изменить трек" className="max-w-xl">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex gap-5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="group relative h-36 w-36 shrink-0 overflow-hidden rounded-xl shadow-artwork"
            aria-label="Выбрать обложку"
          >
            <Artwork src={preview ?? track?.coverUrl} className="h-full w-full" rounded="rounded-xl" iconSize={36} />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              <ImagePlus size={22} />
              Обложка
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) setCoverFile(file);
            }}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Название</span>
              <Input autoFocus maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Исполнитель</span>
              <Input maxLength={500} value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Альбом</span>
              <Input maxLength={500} value={album} onChange={(e) => setAlbum(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={saving} onClick={close}>
            Отмена
          </Button>
          <Button type="submit" disabled={!title.trim() || !artist.trim() || saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Сохранить
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
