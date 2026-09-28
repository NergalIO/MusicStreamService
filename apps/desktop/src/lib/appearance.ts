import { useEffect, useState } from 'react';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useSettingsStore, type ThemeMode } from '@/store/settings-store';

export interface AccentPreset {
  id: string;
  label: string;
  /** `h s% l%` для `--primary` в тёмной теме; в светлой цвет затемняется ради контраста. */
  hsl: [number, number, number];
}

export const ACCENTS: AccentPreset[] = [
  { id: 'violet', label: 'Фиолетовый', hsl: [262, 83, 66] },
  { id: 'blue', label: 'Синий', hsl: [217, 91, 60] },
  { id: 'teal', label: 'Бирюзовый', hsl: [178, 70, 42] },
  { id: 'green', label: 'Зелёный', hsl: [145, 63, 45] },
  { id: 'amber', label: 'Янтарный', hsl: [36, 95, 52] },
  { id: 'orange', label: 'Оранжевый', hsl: [20, 92, 56] },
  { id: 'rose', label: 'Розовый', hsl: [340, 82, 60] },
  { id: 'red', label: 'Красный', hsl: [0, 80, 58] },
];

export const COVER_ACCENT = 'cover';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

/** Цвет обложки часто тусклый: поднимаем насыщенность и держим яркость в читаемом диапазоне. */
function coverAccent(rgb: string): [number, number, number] | null {
  const [r, g, b] = rgb.split(' ').map(Number);
  if ([r, g, b].some((v) => !Number.isFinite(v))) return null;
  const [h, s] = rgbToHsl(r, g, b);
  if (s < 12) return null;
  return [h, Math.max(55, Math.min(90, s * 1.3)), 62];
}

function resolveDark(theme: ThemeMode, systemDark: boolean): boolean {
  return theme === 'system' ? systemDark : theme === 'dark';
}

function setThemeClass(dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
}

/** До первого рендера, чтобы светлая тема не мигала тёмной при запуске. */
export function applyInitialTheme(): void {
  setThemeClass(resolveDark(useSettingsStore.getState().theme, window.matchMedia('(prefers-color-scheme: dark)').matches));
}

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export function useIsDark(): boolean {
  const theme = useSettingsStore((s) => s.theme);
  const systemDark = useSystemDark();
  return resolveDark(theme, systemDark);
}

/**
 * Применяет тему и акцент к `<html>`. Мини-плеер — отдельное окно с тем же localStorage,
 * поэтому изменения настроек из главного окна подхватываются через событие `storage`.
 */
export function useApplyAppearance(coverUrl?: string | null): boolean {
  const accent = useSettingsStore((s) => s.accent);
  const dark = useIsDark();
  const coverColor = useDominantColor(accent === COVER_ACCENT ? coverUrl : null, '');

  useEffect(() => setThemeClass(dark), [dark]);

  useEffect(() => {
    const preset = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0];
    const fromCover = accent === COVER_ACCENT && coverColor ? coverAccent(coverColor) : null;
    const [h, s, l] = fromCover ?? preset.hsl;
    const lightness = dark ? l : Math.max(38, l - 12);
    document.documentElement.style.setProperty('--primary', `${Math.round(h)} ${Math.round(s)}% ${Math.round(lightness)}%`);
  }, [accent, coverColor, dark]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'mss-settings') void useSettingsStore.persist.rehydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return dark;
}
