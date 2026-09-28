import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, FolderOpen, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useRelayStore, type RelayItem } from '@/store/relay-store';

function statusText(item: RelayItem): string {
  switch (item.status) {
    case 'uploading':
      return 'Отдаём файл на сервер для другого пользователя…';
    case 'done':
      return 'Доступен для прослушивания на сервере';
    case 'need_file':
      return item.error ?? 'Укажите файл на этом компьютере';
    case 'failed':
      return item.error ?? 'Не удалось отдать трек';
  }
}

function StatusIcon({ status }: { status: RelayItem['status'] }) {
  if (status === 'done') return <CheckCircle2 size={16} className="text-emerald-400" />;
  if (status === 'failed' || status === 'need_file') return <AlertCircle size={16} className="text-amber-400" />;
  return <Loader2 size={16} className="animate-spin text-primary" />;
}

export function RelayPanel() {
  const { items, clearFinished, patch } = useRelayStore();
  const active = items.filter((i) => i.status === 'uploading' || i.status === 'need_file');
  const visible = items.length > 0;
  const title =
    active.length > 0
      ? `Запросы на треки: ${active.length}`
      : items.some((i) => i.status === 'failed')
        ? 'Не все запросы выполнены'
        : 'Запросы выполнены';

  async function provideFile(sessionId: string): Promise<void> {
    if (!window.electronAPI?.relay?.provideFile) {
      toast.error('Доступно только в приложении MSS');
      return;
    }
    patch(sessionId, { status: 'uploading', error: undefined });
    try {
      await window.electronAPI.relay.provideFile(sessionId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      patch(sessionId, {
        status: message.includes('файл') ? 'need_file' : 'failed',
        error: message,
      });
      toast.error(message);
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="no-drag pointer-events-auto glass w-full overflow-hidden rounded-xl border border-primary/20 shadow-popover"
        >
          <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-3 py-2.5">
            <span className="flex-1 truncate text-sm font-medium">{title}</span>
            {!active.length && (
              <button
                type="button"
                aria-label="Закрыть"
                onClick={clearFinished}
                className="rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <ul className="max-h-56 overflow-y-auto p-1.5">
            {items.map((item) => (
              <li key={item.sessionId} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <StatusIcon status={item.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{item.title}</div>
                  <div
                    className={cn(
                      'truncate text-xs',
                      item.status === 'failed' ? 'text-danger' : item.status === 'need_file' ? 'text-amber-400' : 'text-muted',
                    )}
                  >
                    {statusText(item)}
                  </div>
                </div>
                {item.status === 'need_file' && (
                  <button
                    type="button"
                    onClick={() => void provideFile(item.sessionId)}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/25"
                  >
                    <FolderOpen size={14} />
                    Указать файл
                  </button>
                )}
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
