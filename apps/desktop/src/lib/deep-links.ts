import type { NavigateFunction } from 'react-router-dom';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { mapLocalTrack, type LocalTrackDto } from '@/lib/sources';
import { usePlayerStore } from '@/store/player-store';

export function parseMssLink(url: string): { path: string; play?: { source: string; id: string } } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'mss:') return null;
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname
    .replace(/^\//, '')
    .split('/')
    .map((p) => decodeURIComponent(p))
    .filter(Boolean);

  switch (host) {
    case 'track':
      return parts.length >= 2 ? { path: '/mss', play: { source: parts[0], id: parts[1] } } : null;
    case 'album':
      return parts.length >= 2 ? { path: `/album/${parts[0]}/${encodeURIComponent(parts[1])}` } : null;
    case 'playlist':
      if (parts[0] === 'local' && parts[1]) return { path: `/playlists/${parts[1]}` };
      return parts.length >= 2 ? { path: `/playlist/${parts[0]}/${encodeURIComponent(parts[1])}` } : null;
    case 'artist':
      return { path: `/artist/${encodeURIComponent(parts[0] ?? '')}${parsed.search}` };
    case 'wave':
      return { path: '/wave' };
    case 'search':
      return { path: `/media/search${parsed.search}` };
    case 'library':
      return { path: `/mss/library/${parts[0] || 'likes'}` };
    case 'stats':
      return { path: parts[0] === 'wrapped' ? '/stats/wrapped' : '/stats' };
    case 'settings':
      return { path: '/settings' };
    case 'lobby': {
      const code = parts[0] ?? parsed.pathname.replace(/^\//, '');
      return code ? { path: `/lobby?code=${encodeURIComponent(code)}` } : { path: '/lobby' };
    }
    case 'similar':
      return parts.length >= 2 ? { path: `/similar/${parts[0]}/${encodeURIComponent(parts[1])}${parsed.search}` } : null;
    default:
      return null;
  }
}

async function playFromLink(source: string, id: string): Promise<void> {
  if (source === 'local') {
    const track = await apiFetch<LocalTrackDto>(`/tracks/${id}`);
    usePlayerStore.getState().playTrack(mapLocalTrack(track));
    return;
  }
  if (source === 'yandex') {
    const tracks = await window.electronAPI.yandex.tracks([id]);
    if (!tracks[0]) throw new Error('Трек не найден');
    usePlayerStore.getState().playTrack(tracks[0]);
    return;
  }
  throw new Error('Этот источник пока нельзя открыть по ссылке');
}

export async function applyDeepLink(url: string, navigate: NavigateFunction): Promise<void> {
  const parsed = parseMssLink(url);
  if (!parsed) {
    toast.error('Неизвестная ссылка MSS');
    return;
  }
  navigate(parsed.path);
  if (!parsed.play) return;
  try {
    await playFromLink(parsed.play.source, parsed.play.id);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Не удалось открыть трек');
  }
}
