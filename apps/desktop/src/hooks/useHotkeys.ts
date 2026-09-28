import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchPath } from '@/lib/service-routes';
import { changeVolumeBy, seekBy, skipNext, skipPrev, toggleLike, togglePlay } from '@/lib/player-actions';
import { usePlaybackStore } from '@/store/playback-store';
import { usePlayerStore } from '@/store/player-store';

/** Список для раздела настроек; держать в согласии с обработчиком ниже. */
export const HOTKEYS: { keys: string; action: string }[] = [
  { keys: 'Пробел', action: 'Играть / пауза' },
  { keys: '← / →', action: 'Перемотка на 5 секунд' },
  { keys: 'Ctrl + ← / →', action: 'Предыдущий / следующий трек' },
  { keys: '↑ / ↓', action: 'Громкость ±5%' },
  { keys: 'M', action: 'Выключить / включить звук' },
  { keys: 'L', action: 'Мне нравится' },
  { keys: 'Ctrl + F', action: 'Поиск' },
  { keys: 'Ctrl + P', action: 'Экран «Сейчас играет»' },
  { keys: 'Esc', action: 'Закрыть «Сейчас играет» или меню' },
];

export const GLOBAL_HOTKEYS: { keys: string; action: string }[] = [
  { keys: 'Ctrl + Alt + Пробел', action: 'Играть / пауза' },
  { keys: 'Ctrl + Alt + ← / →', action: 'Предыдущий / следующий трек' },
  { keys: 'Ctrl + Alt + ↑ / ↓', action: 'Громкость' },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}

function focusSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  input?.focus();
  input?.select();
}

export function useHotkeys(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyF') {
        e.preventDefault();
        if (document.querySelector('[data-search-input]')) focusSearch();
        else {
          navigate(searchPath('media'));
          setTimeout(focusSearch, 50);
        }
        return;
      }
      if (ctrl && e.code === 'KeyP') {
        e.preventDefault();
        const { nowPlayingOpen, setNowPlaying } = usePlaybackStore.getState();
        if (usePlayerStore.getState().current || nowPlayingOpen) setNowPlaying(!nowPlayingOpen);
        return;
      }
      if (isTyping(e.target) || e.altKey) return;
      // Внутри открытых меню и списков стрелки заняты навигацией.
      if ((e.target as HTMLElement | null)?.closest('[role="menu"], [role="listbox"], [role="slider"]')) return;

      switch (e.code) {
        case 'Space':
          if (e.repeat) return;
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (ctrl) skipNext();
          else seekBy(5);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (ctrl) skipPrev();
          else seekBy(-5);
          break;
        case 'ArrowUp':
          if (ctrl) return;
          e.preventDefault();
          changeVolumeBy(0.05);
          break;
        case 'ArrowDown':
          if (ctrl) return;
          e.preventDefault();
          changeVolumeBy(-0.05);
          break;
        case 'KeyM':
          if (ctrl || e.repeat) return;
          usePlayerStore.getState().setMuted(!usePlayerStore.getState().muted);
          break;
        case 'KeyL':
          if (ctrl || e.repeat) return;
          void toggleLike(usePlayerStore.getState().current);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
