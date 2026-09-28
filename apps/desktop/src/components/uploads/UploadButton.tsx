import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { AUDIO_ACCEPT, useUploadsStore } from '@/store/uploads-store';

export function UploadButton({
  playlistId,
  label = 'Добавить треки',
  ...props
}: Omit<ButtonProps, 'onClick'> & { playlistId?: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadsStore((s) => s.upload);
  const uploadFromDialog = useUploadsStore((s) => s.uploadFromDialog);
  const hasDialog = !!window.electronAPI?.localTracks?.pickFiles;

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files, { playlistId });
          e.target.value = '';
        }}
      />
      <Button
        {...props}
        onClick={() => (hasDialog ? uploadFromDialog({ playlistId }) : input.current?.click())}
      >
        <Upload size={15} /> {label}
      </Button>
    </>
  );
}
