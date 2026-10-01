import { toast } from 'sonner';
import { noteHistoryCleared, restoreHistoryCleared } from '@/lib/listening';
import { usePlayerStore } from '@/store/player-store';

const UNDO_MS = 5000;

/**
 * Тост с кнопкой «Отменить». `commit` вызывается, когда тост закрылся без отмены,
 * поэтому необратимое действие (удаление файла) можно отложить до этого момента.
 */
export function undoableToast(message: string, { undo, commit }: { undo: () => void; commit?: () => void }): void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    commit?.();
  };
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: 'Отменить',
      onClick: () => {
        if (settled) return;
        settled = true;
        undo();
      },
    },
    onAutoClose: finish,
    onDismiss: finish,
  });
}

export function clearQueueWithUndo(): void {
  const { upNext, order } = usePlayerStore.getState();
  usePlayerStore.getState().clearUpcoming();
  undoableToast('Очередь очищена', { undo: () => usePlayerStore.setState({ upNext, order }) });
}

export function clearHistoryWithUndo(): void {
  const { history } = usePlayerStore.getState();
  if (!history.length) return;
  const prevCleared = noteHistoryCleared();
  usePlayerStore.getState().clearHistory();
  undoableToast('История очищена', {
    undo: () => {
      restoreHistoryCleared(prevCleared);
      usePlayerStore.setState({ history });
    },
  });
}
