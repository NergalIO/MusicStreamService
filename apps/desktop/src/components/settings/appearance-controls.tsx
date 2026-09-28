import { Check, Image as ImageIcon } from 'lucide-react';
import { ACCENTS, COVER_ACCENT } from '@/lib/appearance';
import { cn } from '@/lib/utils';
import { useSettingsStore, type ThemeMode } from '@/store/settings-store';

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Как в Windows' },
];

export function AccentPicker() {
  const accent = useSettingsStore((s) => s.accent);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const swatch = 'relative h-7 w-7 rounded-full transition-transform hover:scale-110 focus-visible:ring-offset-2 focus-visible:ring-offset-card';
  return (
    <div role="radiogroup" aria-label="Акцентный цвет" className="flex flex-wrap items-center gap-2">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          role="radio"
          aria-checked={accent === a.id}
          aria-label={a.label}
          title={a.label}
          onClick={() => setAccent(a.id)}
          className={swatch}
          style={{ backgroundColor: `hsl(${a.hsl[0]} ${a.hsl[1]}% ${a.hsl[2]}%)` }}
        >
          {accent === a.id && <Check size={14} className="absolute inset-0 m-auto text-white" strokeWidth={3} />}
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={accent === COVER_ACCENT}
        aria-label="Из обложки текущего трека"
        title="Из обложки текущего трека"
        onClick={() => setAccent(COVER_ACCENT)}
        className={cn(swatch, 'bg-[conic-gradient(from_90deg,#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e)]')}
      >
        {accent === COVER_ACCENT ? (
          <Check size={14} className="absolute inset-0 m-auto text-white" strokeWidth={3} />
        ) : (
          <ImageIcon size={13} className="absolute inset-0 m-auto text-white" />
        )}
      </button>
    </div>
  );
}
