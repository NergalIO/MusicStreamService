import { AlertTriangle, RotateCw, type LucideIcon } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import { cn } from '@/lib/utils';

function errorText(error: unknown): string {
  if (!error) return '';
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function ErrorState({
  title = 'Не удалось загрузить',
  error,
  onRetry,
  action,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}) {
  const details = errorText(error);
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle size={22} />
      </div>
      <div className="space-y-1">
        <div className="text-base font-semibold">{title}</div>
        {details && <p className="max-w-md break-words text-sm text-muted">{details}</p>}
      </div>
      {(action || onRetry) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RotateCw size={14} /> Повторить
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center', className)}>
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.06] text-muted">
          <Icon size={22} />
        </div>
      )}
      <div className="space-y-1">
        <div className="text-base font-semibold">{title}</div>
        {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Сбрасывает ошибку при смене значения, например при переходе на другую страницу. */
  resetKey?: unknown;
  fullscreen?: boolean;
}

export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log('error', 'React render error', error, info.componentStack ?? '');
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={cn('flex flex-col items-center justify-center gap-4 px-6 py-20 text-center', this.props.fullscreen && 'h-screen')}>
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle size={26} />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Что-то пошло не так</h2>
          <p className="max-w-md break-words text-sm text-muted">{error.message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Попробовать снова
          </Button>
          <Button onClick={() => window.location.reload()}>
            <RotateCw size={14} /> Перезагрузить страницу
          </Button>
        </div>
        {window.electronAPI?.system && (
          <button type="button" className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => void window.electronAPI.system.openLogs()}>
            Открыть папку логов
          </button>
        )}
      </div>
    );
  }
}
