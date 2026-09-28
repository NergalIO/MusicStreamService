import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, X, XCircle } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDownloadsStore, type DownloadPanelItem } from '@/store/downloads-store';

function statusText(item: DownloadPanelItem): string {
  switch (item.status) {
    case 'downloading':
      if (item.total > 0) {
        return `${formatBytes(item.received)} из ${formatBytes(item.total)} · ${Math.round((item.received / item.total) * 100)}%`;
      }
      return item.received > 0 ? formatBytes(item.received) : 'Подготовка…';
    case 'ready':
      return 'Скачано';
    case 'failed':
      return item.error ?? 'Ошибка';
    case 'cancelled':
      return 'Отменено';
  }
}

function StatusIcon({ status }: { status: DownloadPanelItem['status'] }) {
  if (status === 'ready') return <CheckCircle2 size={16} className="text-emerald-400" />;
  if (status === 'failed') return <AlertCircle size={16} className="text-danger" />;
  if (status === 'cancelled') return <XCircle size={16} className="text-muted" />;
  return <Loader2 size={16} className="animate-spin text-primary" />;
}

function progress(item: DownloadPanelItem): number {
  if (item.status !== 'downloading' || !item.total) return item.status === 'ready' ? 1 : 0;
  return Math.min(1, item.received / item.total);
}

export function DownloadPanel() {
  const { panelItems, panelCollapsed, setPanelCollapsed, clearPanelFinished, cancel, cancelAll } = useDownloadsStore();
  const pending = panelItems.filter((i) => i.status === 'downloading').length;
  const failed = panelItems.filter((i) => i.status === 'failed').length;
  const title = pending
    ? `Скачивание: осталось ${pending}`
    : failed
      ? `Скачано с ошибками: ${failed}`
      : 'Скачивание завершено';

  return (
    <AnimatePresence>
      {panelItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="no-drag pointer-events-auto glass w-full overflow-hidden rounded-xl border shadow-popover"
        >
          <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-3 py-2.5">
            <span className="flex-1 truncate text-sm font-medium">{title}</span>
            {pending > 0 && (
              <button
                type="button"
                onClick={() => cancelAll()}
                className="shrink-0 rounded-md px-2 py-0.5 text-xs text-muted hover:bg-foreground/10 hover:text-foreground"
              >
                Отменить всё
              </button>
            )}
            <button
              type="button"
              aria-label={panelCollapsed ? 'Развернуть' : 'Свернуть'}
              onClick={() => setPanelCollapsed(!panelCollapsed)}
              className="rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronDown size={16} className={cn('transition-transform', panelCollapsed && 'rotate-180')} />
            </button>
            {!pending && (
              <button
                type="button"
                aria-label="Закрыть"
                onClick={clearPanelFinished}
                className="rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {!panelCollapsed && (
            <ul className="max-h-72 overflow-y-auto p-1.5">
              {panelItems.map((item) => (
                <li key={item.key} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <StatusIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{item.title}</div>
                    <div className="truncate text-xs text-muted">{item.artist}</div>
                    <div
                      className={cn(
                        'truncate text-xs',
                        item.status === 'failed' ? 'text-danger' : 'text-muted',
                      )}
                    >
                      {statusText(item)}
                    </div>
                    {item.status === 'downloading' && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-200"
                          style={{ width: `${progress(item) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {item.status === 'downloading' && (
                    <button
                      type="button"
                      aria-label={`Отменить «${item.title}»`}
                      onClick={() => cancel(item.key)}
                      className="shrink-0 rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
