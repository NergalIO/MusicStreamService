import { EQ_FREQUENCIES, EQ_PRESETS } from '@mss/audio-engine';
import type { Quality } from '@mss/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { OutputDeviceSelect, SleepTimerControl } from '@/components/player/sound-controls';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Range, Segmented, Switch } from '@/components/ui/controls';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/store/player-store';
import { PLAYBACK_RATES, useSettingsStore } from '@/store/settings-store';

const PRESET_LABELS: Record<string, string> = {
  Flat: 'Ровно',
  'Bass boost': 'Бас',
  'Treble boost': 'Высокие',
  Vocal: 'Вокал',
};

const QUALITY: { value: Quality; label: string }[] = [
  { value: 'normal', label: 'Эконом' },
  { value: 'high', label: 'Высокое' },
  { value: 'lossless', label: 'Lossless' },
];

export function SoundSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    eqBands,
    eqEnabled,
    setEq,
    crossfade,
    setCrossfade,
    quality,
    setQuality,
    normalize,
    setNormalize,
    playbackRate,
    setPlaybackRate,
  } = useSettingsStore();
  const spotifyNow = usePlayerStore((s) => s.current?.source === 'spotify');
  const activePreset = Object.entries(EQ_PRESETS).find(([, bands]) => bands.every((b, i) => b === eqBands[i]))?.[0];
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="no-drag fixed inset-0 z-[90] flex justify-end bg-background/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Звук"
            tabIndex={-1}
            className="glass flex h-full w-full max-w-sm flex-col gap-6 overflow-y-auto border-l p-6"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Звук</h2>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={onClose}
                className="rounded-full p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Эквалайзер</span>
                <Switch checked={eqEnabled} onChange={(on) => setEq(eqBands, on)} label="Эквалайзер" />
              </div>
              {spotifyNow && (
                <p className="text-xs text-muted">Эквалайзер не действует на Spotify — звук идёт из веб-плеера.</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(EQ_PRESETS).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setEq([...EQ_PRESETS[name]], true)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs transition-colors',
                      activePreset === name ? 'bg-primary text-primary-foreground' : 'bg-foreground/10 hover:bg-foreground/15',
                    )}
                  >
                    {PRESET_LABELS[name] ?? name}
                  </button>
                ))}
              </div>
              <div className={cn('flex h-48 items-stretch justify-between gap-1 pt-2', !eqEnabled && 'opacity-40')}>
                {EQ_FREQUENCIES.map((freq, i) => (
                  <div key={freq} className="flex flex-1 flex-col items-center gap-2">
                    <span className="text-[10px] tabular-nums text-muted">
                      {eqBands[i] > 0 ? '+' : ''}
                      {eqBands[i]}
                    </span>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={eqBands[i]}
                      disabled={!eqEnabled}
                      onChange={(e) => {
                        const next = [...eqBands];
                        next[i] = Number(e.target.value);
                        setEq(next);
                      }}
                      className="flex-1 accent-[hsl(var(--primary))] [direction:rtl] [writing-mode:vertical-lr]"
                    />
                    <span className="text-[10px] text-muted">{freq >= 1000 ? `${freq / 1000}k` : freq}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Плавный переход</span>
                <span className="text-xs tabular-nums text-muted">{crossfade ? `${crossfade} с` : 'выкл.'}</span>
              </div>
              <Range min={0} max={12} step={1} value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} />
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Выравнивать громкость</span>
                <Switch checked={normalize} onChange={setNormalize} label="Выравнивать громкость" />
              </div>
              <p className="text-xs text-muted">Треки звучат одинаково громко (цель −14 LUFS).</p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Скорость</span>
                <span className="text-xs tabular-nums text-muted">{playbackRate}×</span>
              </div>
              <Segmented
                value={String(playbackRate)}
                options={PLAYBACK_RATES.map((r) => ({ value: String(r), label: `${r}×` }))}
                onChange={(v) => setPlaybackRate(Number(v))}
                className="w-full [&>button]:flex-1 [&>button]:px-1"
              />
            </section>

            <section className="space-y-3">
              <span className="text-sm font-medium">Устройство вывода</span>
              <OutputDeviceSelect />
            </section>

            <section>
              <SleepTimerControl />
            </section>

            <section className="space-y-3">
              <span className="text-sm font-medium">Качество Яндекс Музыки</span>
              <Segmented value={quality} options={QUALITY} onChange={setQuality} className="w-full [&>button]:flex-1" />
            </section>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
