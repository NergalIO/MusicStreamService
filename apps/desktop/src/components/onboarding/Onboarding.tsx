import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, FolderOpen, Loader2, Music2, Palette, Plug } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppLogo } from '@/components/layout/AppLogo';
import { StandaloneTitleBar } from '@/components/layout/WindowControls';
import { Button } from '@/components/ui/button';
import { AccentPicker, THEME_OPTIONS } from '@/components/settings/appearance-controls';
import { Segmented } from '@/components/ui/controls';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { connectSource, useConnectStore, useConnectors } from '@/lib/connectors';
import { cn } from '@/lib/utils';
import { useDownloadsStore } from '@/store/downloads-store';
import { useSettingsStore } from '@/store/settings-store';

function Step({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">{icon}</div>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ServicesStep() {
  const queryClient = useQueryClient();
  const { data: connectors = [], isLoading } = useConnectors();
  const connecting = useConnectStore((s) => s.connecting);
  return (
    <Step
      icon={<Plug size={22} />}
      title="Подключите сервисы"
      description="Моя волна и плейлисты Яндекса, музыка из VK, Spotify как веб-плеер из сайдбара."
    >
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {isLoading && <div className="px-4 py-3 text-sm text-muted">Проверяем подключения…</div>}
        {connectors.map((c) => {
          const connected = c.status === 'connected';
          return (
            <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-muted">{connected ? 'Подключено' : c.status === 'expired' ? 'Нужен повторный вход' : 'Не подключено'}</div>
              </div>
              {connected ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-500">
                  <Check size={14} /> Готово
                </span>
              ) : (
                <Button size="sm" disabled={!!connecting} onClick={() => void connectSource(c.id, queryClient)}>
                  {connecting === c.id && <Loader2 size={14} className="animate-spin" />}
                  Подключить
                </Button>
              )}
            </div>
          );
        })}
        {!isLoading && !connectors.length && <div className="px-4 py-3 text-sm text-muted">Сервисы не настроены в этой сборке</div>}
      </div>
    </Step>
  );
}

function DownloadsStep() {
  const dir = useDownloadsStore((s) => s.dir);
  const chooseDir = useDownloadsStore((s) => s.chooseDir);
  return (
    <Step
      icon={<FolderOpen size={22} />}
      title="Папка для загрузок"
      description="Сюда сохраняются скачанные треки с тегами и обложками — они играют без интернета. Папку можно поменять позже в настройках."
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="min-w-0 break-all text-sm">{dir || 'Папка по умолчанию'}</span>
        <Button variant="secondary" size="sm" onClick={() => void chooseDir()}>
          Изменить
        </Button>
      </div>
    </Step>
  );
}

function AppearanceStep() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  return (
    <Step icon={<Palette size={22} />} title="Как будет выглядеть MSS" description="Выберите тему и акцентный цвет. Акцент может подстраиваться под обложку играющего трека.">
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">Тема</span>
          <Segmented value={theme} options={THEME_OPTIONS} onChange={setTheme} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">Акцент</span>
          <AccentPicker />
        </div>
      </div>
    </Step>
  );
}

export function Onboarding() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);
  const [step, setStep] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const steps = [
    <Step
      key="welcome"
      icon={<Music2 size={22} />}
      title="Добро пожаловать в MusicStream"
      description="Ваша библиотека MSS, Яндекс Музыка и встроенный веб-плеер Spotify. Настроим всё за минуту — любой шаг можно пропустить."
    />,
    <AppearanceStep key="appearance" />,
    <ServicesStep key="services" />,
    ...(window.electronAPI ? [<DownloadsStep key="downloads" />] : []),
  ];
  const last = step === steps.length - 1;
  useFocusTrap(panelRef, !onboarded);

  if (onboarded) return null;

  return createPortal(
    <motion.div
      className="no-drag fixed inset-0 z-[95] flex items-center justify-center bg-background/80 p-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <StandaloneTitleBar />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Первый запуск"
        tabIndex={-1}
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-elevated p-8 shadow-popover"
      >
        <div className="mb-6 flex items-center justify-between">
          <AppLogo className="h-9 w-9" />
          <button type="button" onClick={() => setOnboarded(true)} className="text-sm text-muted hover:text-foreground">
            Пропустить
          </button>
        </div>

        <div className="min-h-[300px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
            >
              {steps[step]}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Шаг ${step + 1} из ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i} className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-primary' : 'w-1.5 bg-foreground/20')} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                <ChevronLeft size={16} /> Назад
              </Button>
            )}
            <Button data-autofocus onClick={() => (last ? setOnboarded(true) : setStep(step + 1))}>
              {last ? 'Начать слушать' : step === 0 ? 'Начать' : 'Далее'}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
