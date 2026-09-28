import { useCallback, useEffect, useRef } from 'react';
import { WindowControls } from '@/components/layout/WindowControls';
import { getAudioEngine } from '@/hooks/useAudioEngine';

function reportBounds(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  void window.electronAPI?.spotifySession.setBounds({
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height)),
  });
}

export function SpotifySessionPane({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  const sync = useCallback(() => {
    const el = hostRef.current;
    if (!el || !window.electronAPI) return;
    reportBounds(el);
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    if (!active) {
      void window.electronAPI.spotifySession.hide();
      return;
    }
    getAudioEngine().pause();
    const el = hostRef.current;
    const start = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (el) {
        const r = el.getBoundingClientRect();
        await window.electronAPI.spotifySession.setBounds({
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.max(0, Math.round(r.width)),
          height: Math.max(0, Math.round(r.height)),
        });
      }
      await window.electronAPI.spotifySession.show();
      sync();
    };
    void start();
    if (!el) {
      return () => {
        void window.electronAPI.spotifySession.hide();
      };
    }
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
      void window.electronAPI.spotifySession.hide();
    };
  }, [active, sync]);

  if (!active) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border bg-background pl-4 pr-1">
        <span className="text-sm font-medium">Spotify</span>
        <WindowControls />
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 bg-background" />
    </div>
  );
}
