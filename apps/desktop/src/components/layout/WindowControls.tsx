import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      {children}
    </svg>
  );
}

export function WindowControls({ className }: { className?: string }) {
  const api = window.electronAPI;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api) return;
    void api.window.isMaximized().then(setMaximized);
    return api.window.onMaximizedChange(setMaximized);
  }, [api]);

  if (!api || api.platform === 'darwin') return null;

  const btn =
    'no-drag flex h-8 w-[46px] items-center justify-center text-foreground/75 transition-colors hover:bg-foreground/10 hover:text-foreground';

  return (
    <div className={cn('no-drag flex shrink-0 self-start', className)}>
      <button type="button" aria-label="Свернуть" title="Свернуть" className={btn} onClick={() => api.window.minimize()}>
        <Glyph>
          <path d="M0 5.5h10" />
        </Glyph>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Восстановить' : 'Развернуть'}
        title={maximized ? 'Восстановить' : 'Развернуть'}
        className={btn}
        onClick={() => api.window.toggleMaximize()}
      >
        <Glyph>
          {maximized ? (
            <>
              <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
              <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          )}
        </Glyph>
      </button>
      <button
        type="button"
        aria-label="Закрыть"
        title="Закрыть"
        className={cn(btn, 'hover:bg-[#c42b1c] hover:text-white')}
        onClick={() => api.window.close()}
      >
        <Glyph>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </Glyph>
      </button>
    </div>
  );
}

/** Thin draggable strip with caption buttons for screens without the app shell (login). */
export function StandaloneTitleBar() {
  return (
    <div className="drag-region fixed inset-x-0 top-0 z-50 flex h-8 items-start justify-end">
      <WindowControls />
    </div>
  );
}
