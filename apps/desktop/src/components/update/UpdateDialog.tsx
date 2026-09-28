import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useUpdateStore } from '@/store/update-store';

function busy(state: string): boolean {
  return state === 'downloading' || state === 'installing';
}

export function UpdateDialog() {
  const status = useUpdateStore((s) => s.status);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion);
  const installError = useUpdateStore((s) => s.installError);
  const install = useUpdateStore((s) => s.install);
  const check = useUpdateStore((s) => s.check);
  const dismiss = useUpdateStore((s) => s.dismiss);

  const locked = busy(status.state);
  const available = status.state === 'available' && status.version !== dismissedVersion;
  const open = locked || available || (installError && status.state === 'error');
  const current = status.currentVersion ?? currentVersion;

  const title =
    status.state === 'error'
      ? 'Не удалось обновить'
      : status.state === 'installing'
        ? 'Установка обновления'
        : status.state === 'downloading'
          ? 'Скачивание обновления'
          : 'Доступно обновление';

  return (
    <Dialog open={open} onClose={locked ? () => undefined : dismiss} title={title} closable={!locked}>
      {status.state === 'downloading' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Скачивание{status.version ? ` ${status.version}` : ''}… приложение закроется и установит обновление само.
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${status.progress ?? 0}%` }}
            />
          </div>
          <p className="text-xs text-muted">{status.progress ?? 0}%</p>
        </div>
      ) : status.state === 'installing' ? (
        <div className="flex items-center gap-3 text-sm text-muted">
          <Loader2 size={18} className="animate-spin text-primary" />
          Закрываем приложение и запускаем установщик. MusicStream откроется снова.
        </div>
      ) : status.state === 'error' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">{status.message ?? 'Не удалось скачать или установить обновление.'}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={dismiss}>
              Закрыть
            </Button>
            <Button size="sm" onClick={() => void (status.version ? install() : check())}>
              Повторить
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            Установлена версия {current ?? '—'}. Доступна {status.version ?? 'новая версия'}. Приложение закроется, установит
            обновление и откроется снова.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={dismiss}>
              Позже
            </Button>
            <Button size="sm" onClick={() => void install()}>
              Перезапустить и установить
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
