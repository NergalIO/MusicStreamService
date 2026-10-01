import { Disc3, Upload } from 'lucide-react';
import { useRef } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { AUDIO_ACCEPT, useUploadsStore } from '@/store/uploads-store';

export function UploadButton({
  playlistId,
  albumId,
  label = 'Добавить треки',
  album,
  ...props
}: Omit<ButtonProps, 'onClick'> & { playlistId?: string; albumId?: string; label?: string; album?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadsStore((s) => s.upload);
  const uploadFromDialog = useUploadsStore((s) => s.uploadFromDialog);
  const uploadAlbumFromDialog = useUploadsStore((s) => s.uploadAlbumFromDialog);
  const hasDialog = !!window.electronAPI?.localTracks?.pickFiles;
  const hasFolder = !!window.electronAPI?.localTracks?.pickFolder;
  const target = { playlistId, albumId };

  if (album) {
    return (
      <Button {...props} onClick={() => (hasFolder ? uploadAlbumFromDialog() : input.current?.click())}>
        <Disc3 size={15} /> {label}
        <input
          ref={input}
          type="file"
          multiple
          accept={AUDIO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files, target);
            e.target.value = '';
          }}
        />
      </Button>
    );
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files, target);
          e.target.value = '';
        }}
      />
      <Button
        {...props}
        onClick={() => (hasDialog ? uploadFromDialog(target) : input.current?.click())}
      >
        <Upload size={15} /> {label}
      </Button>
    </>
  );
}
