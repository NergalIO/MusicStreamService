import '@fontsource-variable/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { MiniPlayer } from '../components/player/MiniPlayer';
import { ErrorBoundary } from '../components/ui/states';
import '../styles/globals.css';
import { loadSession } from '../lib/api';
import { applyInitialTheme } from '../lib/appearance';
import { installGlobalErrorLogging } from '../lib/logger';
import { queryClient } from '../lib/query-client';

installGlobalErrorLogging();
loadSession();
applyInitialTheme();

const isMini = new URLSearchParams(window.location.search).get('mini') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fullscreen>
      {isMini ? (
        <MiniPlayer />
      ) : (
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
