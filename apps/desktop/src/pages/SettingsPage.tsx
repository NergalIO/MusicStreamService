import type { Quality } from '@mss/shared';
import type { SystemSettings } from '../../electron/preload/index';
import { useQueryClient } from '@tanstack/react-query';
import { Crown, FolderOpen, Loader2, LogOut } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLogo } from '@/components/layout/AppLogo';
import { OutputDeviceSelect } from '@/components/player/sound-controls';
import { AccentPicker, THEME_OPTIONS } from '@/components/settings/appearance-controls';
import { Button } from '@/components/ui/button';
import { GLOBAL_HOTKEYS, HOTKEYS } from '@/hooks/useHotkeys';
import { Range, Segmented, Switch } from '@/components/ui/controls';
import {
  connectSource,
  disconnectSource,
  useConnectStore,
  useConnectors,
  useYandexAccount,
  type ConnectorStatus,
} from '@/lib/connectors';
import { clearSession, loadSession } from '@/lib/api';
import { ACCENTS, COVER_ACCENT } from '@/lib/appearance';
import { formatBytes, formatTrackCount } from '@/lib/format';
import { isCompressible, useDownloadsStore } from '@/store/downloads-store';
import { compressionKbps, useSettingsStore, type DownloadCompression } from '@/store/settings-store';
import { toast } from 'sonner';

const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: 'normal', label: 'Экономия' },
  { value: 'high', label: 'Высокое' },
  { value: 'lossless', label: 'Lossless' },
];

const QUALITY_HINT: Record<Quality, string> = {
  normal: 'MP3 192 кбит/с — меньше трафика.',
  high: 'MP3 320 кбит/с.',
  lossless: 'FLAC, если он есть у трека; иначе лучшее доступное качество. Около 30–40 МБ на трек.',
};

const DOWNLOAD_HINT: Record<Quality, string> = {
  normal: 'MP3 192 кбит/с — около 5 МБ на трек.',
  high: 'MP3 320 кбит/с — около 8 МБ на трек.',
  lossless: 'FLAC без потерь, если он есть у трека, иначе MP3 320 кбит/с. Около 30–40 МБ на трек.',
};

const COMPRESSION_OPTIONS: { value: DownloadCompression; label: string }[] = [
  { value: 'off', label: 'Нет' },
  { value: '256', label: '256' },
  { value: '192', label: '192' },
  { value: '128', label: '128' },
];

const COMPRESSION_HINT: Record<DownloadCompression, string> = {
  off: 'Файлы сохраняются как есть.',
  '256': 'Треки перекодируются в AAC 256 кбит/с (.m4a) — на слух почти не отличить, около 8 МБ на трек.',
  '192': 'Треки перекодируются в AAC 192 кбит/с (.m4a) — около 6 МБ на трек.',
  '128': 'Треки перекодируются в AAC 128 кбит/с (.m4a) — около 4 МБ на трек, заметнее потеря качества.',
};

function CompressExistingRow() {
  const kbps = compressionKbps(useSettingsStore((s) => s.downloadCompression));
  const items = useDownloadsStore((s) => s.items);
  const compressing = useDownloadsStore((s) => s.compressing);
  const compressAll = useDownloadsStore((s) => s.compressAll);
  const candidates = Object.values(items).filter((r) => isCompressible(r, kbps));
  const size = candidates.reduce((sum, r) => sum + r.size, 0);
  return (
    <Row
      title="Сжать уже скачанные"
      subtitle={
        !kbps
          ? 'Включите сжатие, чтобы уменьшить старые загрузки'
          : candidates.length
            ? `${formatTrackCount(candidates.length)}, ${formatBytes(size)}`
            : 'Все загрузки уже компактные'
      }
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={!kbps || !candidates.length || compressing}
        onClick={() => void compressAll()}
      >
        {compressing && <Loader2 size={14} className="animate-spin" />}
        Сжать
      </Button>
    </Row>
  );
}

function DownloadsSection() {
  const dir = useDownloadsStore((s) => s.dir);
  const chooseDir = useDownloadsStore((s) => s.chooseDir);
  const quality = useSettingsStore((s) => s.downloadQuality);
  const setQuality = useSettingsStore((s) => s.setDownloadQuality);
  const compression = useSettingsStore((s) => s.downloadCompression);
  const setCompression = useSettingsStore((s) => s.setDownloadCompression);
  const [ffmpeg, setFfmpeg] = useState<boolean | null>(null);
  useEffect(() => {
    void window.electronAPI?.downloads.ffmpegAvailable().then(setFfmpeg);
  }, []);
  if (!window.electronAPI) return null;
  const hint = compression === 'off' ? DOWNLOAD_HINT[quality] : COMPRESSION_HINT[compression];
  return (
    <Section
      title="Скачивание"
      footer={`${hint} Файлы сохраняются с тегами и обложкой, скачанные треки играют без интернета. Скачивать можно треки Яндекс Музыки при активном Плюсе.`}
    >
      <Row title="Папка" subtitle={<span className="break-all">{dir || '…'}</span>}>
        <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.downloads.openDir()}>
          <FolderOpen size={14} /> Открыть
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void chooseDir()}>
          Изменить
        </Button>
      </Row>
      <Row title="Качество скачивания">
        <Segmented value={quality} options={QUALITY_OPTIONS} onChange={setQuality} />
      </Row>
      <Row
        title="Сжатие, кбит/с"
        subtitle={
          ffmpeg === false ? (
            <span className="text-danger">Не найден ffmpeg — файлы сохраняются без сжатия</span>
          ) : (
            'Экономит место на диске'
          )
        }
      >
        <Segmented value={compression} options={COMPRESSION_OPTIONS} onChange={setCompression} />
      </Row>
      <CompressExistingRow />
    </Section>
  );
}

export function useSystemSettings() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  useEffect(() => {
    void window.electronAPI?.system.getSettings().then(setSettings);
  }, []);
  const update = (patch: Partial<SystemSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    void window.electronAPI.system.setSettings(patch).then(setSettings);
  };
  return [settings, update] as const;
}

function SystemSection() {
  const [system, update] = useSystemSettings();
  if (!window.electronAPI || !system) return null;
  return (
    <Section title="Система">
      <Row title="Сворачивать в трей при закрытии" subtitle="Крестик прячет окно, музыка продолжает играть">
        <Switch checked={system.closeToTray} onChange={(v) => update({ closeToTray: v })} label="Сворачивать в трей" />
      </Row>
      <Row title="Запускать вместе с Windows">
        <Switch checked={system.openAtLogin} onChange={(v) => update({ openAtLogin: v })} label="Автозапуск" />
      </Row>
      <Row title="Запускать свёрнутым" subtitle="При автозапуске сразу уходить в трей">
        <Switch
          checked={system.startMinimized}
          onChange={(v) => update({ startMinimized: v })}
          label="Запускать свёрнутым"
        />
      </Row>
      <Row
        title="Глобальные клавиши"
        subtitle={GLOBAL_HOTKEYS.map((h) => `${h.keys} — ${h.action.toLowerCase()}`).join(' · ')}
      >
        <Switch
          checked={system.globalShortcuts}
          onChange={(v) => update({ globalShortcuts: v })}
          label="Глобальные клавиши"
        />
      </Row>
      <Row
        title="Discord Rich Presence"
        subtitle="Статус «Слушает MusicStream» с обложкой и прогрессом. Нужен DISCORD_CLIENT_ID в .env"
      >
        <Switch checked={system.discordPresence} onChange={(v) => update({ discordPresence: v })} label="Discord Rich Presence" />
      </Row>
      <Row title="Обложка трека" subtitle="Большая картинка в статусе; для локальных треков — логотип MSS">
        <Switch
          checked={system.discordShowCover}
          disabled={!system.discordPresence}
          onChange={(v) => update({ discordShowCover: v })}
          label="Обложка трека"
        />
      </Row>
      <Row title="Кнопка «Открыть трек»" subtitle="Ссылка на Яндекс Музыку или Spotify (видна другим пользователям)">
        <Switch
          checked={system.discordShowButton}
          disabled={!system.discordPresence}
          onChange={(v) => update({ discordShowButton: v })}
          label="Кнопка «Открыть трек»"
        />
      </Row>
      <Row title="Показывать на паузе" subtitle="Если выключено, статус скрывается при паузе">
        <Switch
          checked={system.discordShowOnPause}
          disabled={!system.discordPresence}
          onChange={(v) => update({ discordShowOnPause: v })}
          label="Показывать на паузе"
        />
      </Row>
    </Section>
  );
}

function AppearanceSection() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const accent = useSettingsStore((s) => s.accent);
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  return (
    <Section title="Внешний вид">
      <Row title="Тема">
        <Segmented value={theme} options={THEME_OPTIONS} onChange={setTheme} />
      </Row>
      <Row
        title="Акцентный цвет"
        subtitle={accent === COVER_ACCENT ? 'Подстраивается под обложку играющего трека' : ACCENTS.find((a) => a.id === accent)?.label}
      >
        <AccentPicker />
      </Row>
      <Row title="Компактная боковая панель" subtitle="Только иконки. На узком окне панель сворачивается сама">
        <Switch checked={collapsed} onChange={setCollapsed} label="Компактная боковая панель" />
      </Row>
    </Section>
  );
}

function AboutSection() {
  const navigate = useNavigate();
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const email = loadSession()?.user.email;
  useEffect(() => {
    void window.electronAPI?.system.version().then(setVersion);
  }, []);

  const checkUpdate = async () => {
    if (!window.electronAPI) return;
    setChecking(true);
    try {
      const status = await window.electronAPI.system.checkForUpdate();
      if (status.state === 'dev') toast.message('Проверка обновлений доступна в установленной версии');
      else if (status.state === 'error') toast.error(status.message ?? 'Не удалось проверить обновления');
      else if (status.state === 'not-available') toast.success('Установлена актуальная версия');
      else if (status.state === 'available')
        toast(`Доступна ${status.version} — нажмите «Обновить» в уведомлении или проверьте снова`, {
          action: { label: 'Обновить', onClick: () => void window.electronAPI.system.installUpdate() },
        });
      else if (status.state === 'downloaded') toast('Откройте установщик из уведомления');
      else toast.message(status.version ? `Найдена версия ${status.version}` : 'Ищем обновление…');
    } finally {
      setChecking(false);
    }
  };

  const exportReport = async () => {
    const saved = await window.electronAPI.system.exportReport();
    if (saved) toast.success('Отчёт сохранён');
  };

  return (
    <Section title="О программе">
      <Row title="MusicStream" subtitle={version ? `Версия ${version}` : 'Веб-версия'}>
        <AppLogo className="h-8 w-8" />
      </Row>
      {window.electronAPI && (
        <>
          <Row title="Обновления" subtitle="GitHub Releases: cloud .exe или локальная пересборка bootstrap">
            <Button variant="secondary" size="sm" disabled={checking} onClick={() => void checkUpdate()}>
              {checking && <Loader2 size={14} className="animate-spin" />}
              Проверить
            </Button>
          </Row>
          <Row title="Логи приложения" subtitle="Пригодятся, если что-то сломалось. Токены в логи не пишутся">
            <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.system.openLogs()}>
              <FolderOpen size={14} /> Открыть папку
            </Button>
          </Row>
          <Row title="Отчёт о сбое" subtitle="Дампы и хвост лога без токенов. Можно приложить к обращению">
            <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.system.openCrashes()}>
              Дампы
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void exportReport()}>
              Сохранить отчёт
            </Button>
          </Row>
        </>
      )}
      <Row title="Аккаунт MSS" subtitle={email ?? 'Не выполнен вход'}>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            clearSession();
            navigate('/login');
          }}
        >
          <LogOut size={14} /> Выйти
        </Button>
      </Row>
    </Section>
  );
}

function Section({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{children}</div>
      {footer && <p className="px-1 text-xs leading-relaxed text-muted">{footer}</p>}
    </section>
  );
}

function Row({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

function HotkeyRow({ keys, action }: { keys: string; action: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-sm">{action}</span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {keys.split(' + ').map((k) => (
          <kbd key={k} className="rounded-md border border-border bg-foreground/[0.06] px-1.5 py-0.5 font-sans text-xs text-muted">
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

function YandexStatus({ status }: { status: string }) {
  const { data: account, isLoading } = useYandexAccount();
  if (status === 'expired') return <span className="text-danger">Нужен повторный вход — старый токен даёт только превью</span>;
  if (status !== 'connected') return <>Не подключено</>;
  if (isLoading) return <>Проверяем подписку…</>;
  if (!account) return <>Подключено</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{account.displayName ?? account.login ?? `uid ${account.uid}`}</span>
      {account.hasPlus ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
          <Crown size={11} /> Плюс активен
        </span>
      ) : (
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px]">Без Плюса — только превью</span>
      )}
    </span>
  );
}

function ConnectorRow({ connector }: { connector: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const connecting = useConnectStore((s) => s.connecting);
  const busy = connecting === connector.id;
  const isYandex = connector.id === 'yandex';
  const connected = connector.status === 'connected';

  return (
    <Row
      title={connector.name}
      subtitle={isYandex ? <YandexStatus status={connector.status} /> : connected ? 'Подключено' : 'Не подключено'}
    >
      {connected ? (
        <Button variant="secondary" size="sm" onClick={() => void disconnectSource(connector.id, queryClient)}>
          Отключить
        </Button>
      ) : (
        <Button size="sm" disabled={!!connecting} onClick={() => void connectSource(connector.id, queryClient)}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {connector.status === 'expired' ? 'Войти заново' : isYandex ? 'Войти через Яндекс' : 'Подключить'}
        </Button>
      )}
    </Row>
  );
}

export function SettingsPage() {
  const { data: connectors = [] } = useConnectors();
  const settings = useSettingsStore();

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-10">
      <h1 className="text-3xl font-bold tracking-tight">Настройки</h1>

      <Section
        title="Сервисы"
        footer="Токены хранятся только на этом устройстве в зашифрованном виде и не отправляются на сервер MSS. Вход в Яндекс выполняется по коду на ya.ru/device — так Яндекс выдаёт полные треки для аккаунтов с Плюсом."
      >
        {connectors.map((c) => (
          <ConnectorRow key={c.id} connector={c} />
        ))}
        {!connectors.length && <Row title="Нет доступных сервисов" subtitle="Проверьте .env и перезапустите приложение" />}
      </Section>

      <AppearanceSection />

      <Section title="Воспроизведение" footer={QUALITY_HINT[settings.quality]}>
        <Row title="Качество потока" subtitle="Для Яндекс Музыки">
          <Segmented value={settings.quality} options={QUALITY_OPTIONS} onChange={settings.setQuality} />
        </Row>
        <Row
          title="Плавный переход"
          subtitle={settings.crossfade ? `${settings.crossfade} с между треками` : 'Выключен'}
        >
          <Range
            className="w-40"
            min={0}
            max={12}
            step={1}
            value={settings.crossfade}
            onChange={(e) => settings.setCrossfade(Number(e.target.value))}
          />
        </Row>
        <Row title="Выравнивать громкость" subtitle="Треки звучат одинаково громко (−14 LUFS)">
          <Switch checked={settings.normalize} onChange={settings.setNormalize} label="Выравнивать громкость" />
        </Row>
        <Row title="Устройство вывода">
          <OutputDeviceSelect className="w-56" />
        </Row>
        <Row title="Визуализатор" subtitle="Спектр на экране «Сейчас играет»">
          <Switch checked={settings.visualizer} onChange={settings.setVisualizer} label="Визуализатор" />
        </Row>
        <Row title="Визуализатор в мини-плеере" subtitle="Тонкая полоса внизу окна">
          <Switch checked={settings.miniVisualizer} onChange={settings.setMiniVisualizer} label="Визуализатор в мини-плеере" />
        </Row>
        <Row title="Уведомления о смене трека" subtitle="Когда окно MSS свёрнуто или не в фокусе">
          <Switch checked={settings.notifications} onChange={settings.setNotifications} label="Уведомления" />
        </Row>
      </Section>

      <DownloadsSection />

      <SystemSection />

      <Section
        title="Горячие клавиши"
        footer="Клавиши работают, когда фокус не в поле ввода. Медиаклавиши клавиатуры и системная плашка Windows работают всегда."
      >
        {HOTKEYS.map((h) => (
          <HotkeyRow key={h.keys} keys={h.keys} action={h.action} />
        ))}
      </Section>

      <AboutSection />
    </div>
  );
}
