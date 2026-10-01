import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, X } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUploadsStore, type UploadItem } from '@/store/uploads-store';

function statusText(item: UploadItem): string {
  switch (item.status) {
    case 'queued':
      return `В очереди · ${formatBytes(item.size)}`;
    case 'hashing':
      return `Хеширование ${Math.round(item.progress * 100)}%`;
    case 'registering':
      return 'Регистрация в каталоге…';
    case 'uploading':
      return `Загрузка в облако ${Math.round(item.progress * 100)}%`;
    case 'processing':
      return 'На сервере: конвертация…';
    case 'ready':
      return item.title ?? 'Готово';
    case 'failed':
      return item.error ?? 'Ошибка';
  }
}

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  if (status === 'ready') return <CheckCircle2 size={16} className="text-emerald-400" />;
  if (status === 'failed') return <AlertCircle size={16} className="text-danger" />;
  return <Loader2 size={16} className={cn('text-primary', status !== 'queued' && 'animate-spin')} />;
}

export function UploadPanel() {
  const { items, collapsed, setCollapsed, clearFinished } = useUploadsStore();
  const converting = items.filter((i) => i.status === 'processing').length;
  const pending = items.filter((i) => i.status !== 'ready' && i.status !== 'failed').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const title = pending
    ? converting && pending === converting
      ? `На сервере: конвертация (${converting})`
      : `Загрузка: осталось ${pending}`
    : failed
      ? `Загружено с ошибками: ${failed}`
      : 'Загрузка завершена';

  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="no-drag pointer-events-auto glass w-full overflow-hidden rounded-xl border shadow-popover"
        >
          <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-3 py-2.5">
            <span className="flex-1 truncate text-sm font-medium">{title}</span>
            <button
              type="button"
              aria-label={collapsed ? 'Развернуть' : 'Свернуть'}
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronDown size={16} className={cn('transition-transform', collapsed && 'rotate-180')} />
            </button>
            {!pending && (
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
          {!collapsed && (
            <ul className="max-h-72 overflow-y-auto p-1.5">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <StatusIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{item.name}</div>
                    <div className={cn('truncate text-xs', item.status === 'failed' ? 'text-danger' : 'text-muted')}>
                      {statusText(item)}
                    </div>
                    {(item.status === 'hashing' || item.status === 'registering' || item.status === 'uploading') && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-200"
                          style={{ width: `${item.progress * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
