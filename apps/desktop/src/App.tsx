import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { libraryPath } from '@/lib/service-routes';
import { toast, Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { loadSession } from '@/lib/api';
import { useApplyAppearance } from '@/lib/appearance';
import { usePlayerStore } from '@/store/player-store';
import { AlbumPage } from '@/pages/AlbumPage';
import { ArtistPage } from '@/pages/ArtistPage';
import { ExternalPlaylistPage } from '@/pages/ExternalPlaylistPage';
import { MssHomePage, SpotifyHomePage, YandexHomePage } from '@/pages/HomePage';
import { LibraryPage } from '@/pages/LibraryPage';
import { LoginPage } from '@/pages/LoginPage';
import { PlaylistDetailPage } from '@/pages/PlaylistDetailPage';
import { SearchPage } from '@/pages/SearchPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SimilarPage } from '@/pages/SimilarPage';
import { StatsPage } from '@/pages/StatsPage';
import { SubscriptionPage } from '@/pages/SubscriptionPage';
import { WavePage } from '@/pages/WavePage';
import { WrappedPage } from '@/pages/WrappedPage';

function LegacyLibraryRedirect() {
  const { tab } = useParams();
  return <Navigate to={libraryPath('mss', tab ?? 'likes')} replace />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = loadSession();
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function Appearance() {
  const coverUrl = usePlayerStore((s) => s.current?.coverUrl);
  const dark = useApplyAppearance(coverUrl);
  useEffect(() => {
    return window.electronAPI?.system.onUpdate((s) => {
      if (s.state === 'available') {
        toast(`Доступна версия ${s.version ?? ''}`.trim(), {
          id: 'mss-update',
          duration: Infinity,
          action: {
            label: 'Обновить',
            onClick: () => void window.electronAPI.system.installUpdate(),
          },
        });
        return;
      }
      if (s.state !== 'downloaded') return;
      toast('Обновление готово — откройте установщик или перезапустите', {
        id: 'mss-update',
        duration: Infinity,
        action: {
          label: 'Установить',
          onClick: () => void window.electronAPI.system.installUpdate(),
        },
      });
    });
  }, []);
  return <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors closeButton />;
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AppRoutes />
    </MotionConfig>
  );
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Appearance />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/mss" replace />} />
          <Route path="/mss" element={<MssHomePage />} />
          <Route path="/yandex" element={<YandexHomePage />} />
          <Route path="/spotify" element={<SpotifyHomePage />} />
          <Route path="/media/search" element={<SearchPage scope="media" />} />
          <Route path="/mss/search" element={<Navigate to="/media/search" replace />} />
          <Route path="/yandex/search" element={<Navigate to="/media/search" replace />} />
          <Route path="/spotify/search" element={<SearchPage scope="spotify" />} />
          <Route path="/search" element={<Navigate to="/media/search" replace />} />
          <Route path="/media/library" element={<Navigate to="/media/library/likes" replace />} />
          <Route path="/media/library/:tab" element={<LibraryPage scope="media" />} />
          <Route path="/wave" element={<WavePage />} />
          <Route path="/artist/:name" element={<ArtistPage />} />
          <Route path="/album/:source/:id" element={<AlbumPage />} />
          <Route path="/playlist/:source/:id" element={<ExternalPlaylistPage />} />
          <Route path="/mss/library" element={<Navigate to="/mss/library/likes" replace />} />
          <Route path="/mss/library/:tab" element={<LibraryPage scope="mss" />} />
          <Route path="/yandex/library" element={<Navigate to="/yandex/library/likes" replace />} />
          <Route path="/yandex/library/:tab" element={<LibraryPage scope="yandex" />} />
          <Route path="/spotify/library" element={<Navigate to="/spotify/library/likes" replace />} />
          <Route path="/spotify/library/:tab" element={<LibraryPage scope="spotify" />} />
          <Route path="/library" element={<Navigate to="/mss/library/likes" replace />} />
          <Route path="/library/:tab" element={<LegacyLibraryRedirect />} />
          <Route path="/playlists" element={<Navigate to="/mss/library/playlists" replace />} />
          <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/stats/wrapped" element={<WrappedPage />} />
          <Route path="/similar/:source/:id" element={<SimilarPage />} />
          <Route path="/subscription" element={<SubscriptionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/mss" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
