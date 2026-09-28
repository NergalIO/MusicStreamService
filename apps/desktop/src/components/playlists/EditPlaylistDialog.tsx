import { ImagePlus, ListMusic, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { loadSession } from '@/lib/api';
import { prepareCover, removePlaylistCover, setPlaylistCover, updatePlaylist } from '@/lib/mss-library';
import type { MssPlaylist } from '@/lib/queries';

const DESCRIPTION_MAX = 2000;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp';

export function defaultPlaylistAuthor(): string {
  return loadSession()?.user.email.split('@')[0] ?? '';
}

/** Пустая строка — «убрать», чтобы PATCH отличал очистку поля от «не трогать». */
function changed(next: string, prev: string | null): string | null | undefined {
  const value = next.trim();
  return value === (prev ?? '') ? undefined : value || null;
}

export function PlaylistCover({ playlist, className }: { playlist?: Pick<MssPlaylist, 'coverUrl'>; className?: string }) {
  return playlist?.coverUrl ? (
    <img src={playlist.coverUrl} alt="" draggable={false} className={`object-cover ${className ?? ''}`} />
  ) : (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-primary/60 to-fuchsia-600/40 ${className ?? ''}`}
    >
      <ListMusic className="h-1/3 w-1/3 text-white/80" />
    </div>
  );
}

export function EditPlaylistDialog({
  open,
  onClose,
  playlist,
  pickCoverOnOpen,
}: {
  open: boolean;
  onClose: () => void;
  playlist: MssPlaylist;
  /** Сразу открыть выбор файла — для клика по обложке в шапке. */
  pickCoverOnOpen?: boolean;
}) {
  const [name, setName] = useState(playlist.name);
  const [author, setAuthor] = useState(playlist.author ?? '');
  const [description, setDescription] = useState(playlist.description ?? '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(playlist.name);
    setAuthor(playlist.author ?? '');
    setDescription(playlist.description ?? '');
    setCoverFile(null);
    setCoverRemoved(false);
    if (pickCoverOnOpen) setTimeout(() => fileInput.current?.click(), 0);
    // Сбрасываем форму только при открытии, а не при каждом обновлении плейлиста в фоне.
  }, [open]);

  useEffect(() => {
    if (!coverFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const shownCover = preview ?? (coverRemoved ? null : playlist.coverUrl);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const patch = {
        name: name.trim() !== playlist.name ? name.trim() : undefined,
        author: changed(author, playlist.author),
        description: changed(description, playlist.description),
      };
      if (Object.values(patch).some((v) => v !== undefined)) await updatePlaylist(playlist.id, patch);
      if (coverFile) await setPlaylistCover(playlist.id, await prepareCover(coverFile));
      else if (coverRemoved && playlist.coverUrl) await removePlaylistCover(playlist.id);
      onClose();
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? () => undefined : onClose} title="Изменить плейлист" className="max-w-xl">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex gap-5">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group relative h-40 w-40 overflow-hidden rounded-xl shadow-artwork"
              aria-label="Выбрать фото"
            >
              <PlaylistCover playlist={{ coverUrl: shownCover ?? null }} className="h-full w-full" />
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                <ImagePlus size={22} />
                Выбрать фото
              </span>
            </button>
            {shownCover && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCoverFile(null);
                  setCoverRemoved(true);
                }}
              >
                <Trash2 size={14} /> Убрать фото
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (!file.type.startsWith('image/')) {
                  toast.error('Выберите изображение');
                  return;
                }
                setCoverFile(file);
                setCoverRemoved(false);
              }}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Название</span>
              <Input autoFocus={!pickCoverOnOpen} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Автор</span>
              <Input
                maxLength={200}
                placeholder={defaultPlaylistAuthor()}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="flex justify-between text-xs font-medium text-muted">
                Описание
                {description.length > DESCRIPTION_MAX * 0.8 && (
                  <span className="tabular-nums">
                    {description.length}/{DESCRIPTION_MAX}
                  </span>
                )}
              </span>
              <textarea
                rows={4}
                maxLength={DESCRIPTION_MAX}
                placeholder="О чём этот плейлист"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full resize-none rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary/60 focus:bg-foreground/[0.07]"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={!name.trim() || saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Сохранить
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
