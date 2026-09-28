import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { DeviceCodeDialog } from '@/components/connectors/DeviceCodeDialog';
import { VkLoginDialog } from '@/components/connectors/VkLoginDialog';
import { ScrollContainerContext } from '@/components/layout/scroll-context';
import { LobbyBar } from '@/components/lobby/LobbyBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { NowPlaying } from '@/components/player/NowPlaying';
import { TopPlayer } from '@/components/player/TopPlayer';
import { SpotifySessionPane } from '@/components/spotify/SpotifySessionPane';
import { EditTrackDialogHost } from '@/components/tracks/EditTrackDialog';
import { PlaylistPickerHost } from '@/components/tracks/PlaylistPicker';
import { TrackContextMenuHost } from '@/components/tracks/TrackContextMenu';
import { UploadDropZone } from '@/components/uploads/UploadDropZone';
import { ErrorBoundary } from '@/components/ui/states';
import { DownloadPanel } from '@/components/downloads/DownloadPanel';
import { RelayPanel } from '@/components/uploads/RelayPanel';
import { UploadPanel } from '@/components/uploads/UploadPanel';
import { initRelayClient } from '@/lib/relay-client';
import { applyDeepLink } from '@/lib/deep-links';
import { isSpotifyPath } from '@/lib/spotify-session';
import { useHotkeys } from '@/hooks/useHotkeys';
import { usePlayerController } from '@/hooks/usePlayerController';
import { useDownloadsStore } from '@/store/downloads-store';
import { usePlaybackStore } from '@/store/playback-store';
import { useSettingsStore } from '@/store/settings-store';

function scrollRouteKey(pathname: string, search: string): string {
  return pathname + search;
}

export function AppShell() {
  usePlayerController();
  useHotkeys();
  const scrollRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const prevScrollKey = useRef('');
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const setNowPlaying = usePlaybackStore((s) => s.setNowPlaying);
  const lastLink = useRef({ url: '', at: 0 });
  const onboarded = useSettingsStore((s) => s.onboarded);
  const spotifyPane = isSpotifyPath(location.pathname) && onboarded;

  useEffect(() => useDownloadsStore.getState().init(), []);
  useEffect(() => initRelayClient(), []);

  useEffect(() => {
    const apply = (url: string) => {
      const now = Date.now();
      if (url === lastLink.current.url && now - lastLink.current.at < 800) return;
      lastLink.current = { url, at: now };
      void applyDeepLink(url, navigate);
    };
    return window.electronAPI?.system.onDeepLink(apply);
  }, [navigate]);

  const scrollKey = scrollRouteKey(location.pathname, location.search);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevScrollKey.current && prevScrollKey.current !== scrollKey) {
      scrollPositions.current.set(prevScrollKey.current, el.scrollTop);
    }
    const top = scrollPositions.current.get(scrollKey) ?? 0;
    el.scrollTo({ top });
    prevScrollKey.current = scrollKey;
    setNowPlaying(false);
  }, [scrollKey, setNowPlaying]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const key = scrollKey;
    const save = () => scrollPositions.current.set(key, el.scrollTop);
    el.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      el.removeEventListener('scroll', save);
    };
  }, [scrollKey]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {spotifyPane ? (
          <SpotifySessionPane active />
        ) : (
          <>
            <TopPlayer />
            <LobbyBar />
            <ScrollContainerContext.Provider value={scrollRef}>
              <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={location.pathname}
                    className="mx-auto w-full max-w-7xl px-8 pb-16 pt-6"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } }}
                    exit={{ opacity: 0, y: -6, transition: { duration: 0.12, ease: 'easeIn' } }}
                  >
                    <ErrorBoundary resetKey={location.pathname}>{outlet}</ErrorBoundary>
                  </motion.div>
                </AnimatePresence>
              </main>
            </ScrollContainerContext.Provider>
            <NowPlaying />
          </>
        )}
        <div className="no-drag pointer-events-none absolute bottom-6 left-6 z-40 flex w-[360px] flex-col gap-3">
          <RelayPanel />
          <DownloadPanel />
          <UploadPanel />
        </div>
      </div>
      <TrackContextMenuHost />
      <PlaylistPickerHost />
      <EditTrackDialogHost />
      <UploadDropZone />
      <DeviceCodeDialog />
      <VkLoginDialog />
      <Onboarding />
    </div>
  );
}
