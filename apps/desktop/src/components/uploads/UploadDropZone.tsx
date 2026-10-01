import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useMssPlaylists } from '@/lib/queries';
import { useUploadsStore } from '@/store/uploads-store';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Файлы, брошенные в окно, загружаются в MSS; на странице плейлиста MSS — сразу в этот плейлист. */
export function UploadDropZone() {
  const location = useLocation();
  const { data: playlists } = useMssPlaylists();
  const upload = useUploadsStore((s) => s.upload);
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const playlistId = matchPath('/playlists/:id', location.pathname)?.params.id;
  const playlistName = playlists?.find((p) => p.id === playlistId)?.name;
  const albumMatch = matchPath('/album/:source/:id', location.pathname);
  const albumId =
    albumMatch?.params.source === 'local' && albumMatch.params.id
      ? decodeURIComponent(albumMatch.params.id)
      : undefined;

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      if (e.dataTransfer?.files.length) upload(e.dataTransfer.files, { playlistId, albumId });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [upload, playlistId, albumId]);

  if (!active) return null;
  return (
    <div className="no-drag pointer-events-none fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-10 backdrop-blur-sm">
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-primary/70 bg-primary/10">
        <Upload size={48} className="text-primary" />
        <div className="text-2xl font-semibold">Отпустите, чтобы загрузить</div>
        <div className="text-sm text-muted">
          {playlistName
            ? `Треки добавятся в плейлист «${playlistName}»`
            : albumId
              ? 'Треки добавятся в этот альбом'
              : 'Файлы появятся в «Мои треки», папка — как альбом'}
        </div>
      </div>
    </div>
  );
}
