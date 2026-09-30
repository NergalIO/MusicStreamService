import type { Quality } from '@mss/shared';
import type { ClientSecretKey, ClientSecretsView, SystemSettings } from '../../electron/preload/index';
import { useQueryClient } from '@tanstack/react-query';
import { Crown, FolderOpen, Loader2, LogOut } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
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
  useVkAccount,
  useYandexAccount,
  type ConnectorStatus,
} from '@/lib/connectors';
import { logoutSpotifySession, useSpotifySessionLoggedIn } from '@/lib/spotify-session';
import { SPOTIFY_HOME, SPOTIFY_WEB } from '@/lib/service-routes';
import { clearSession, loadSession } from '@/lib/api';
import { leaveCurrentLobby } from '@/lib/lobby-session';
import { getApiBaseUrl, setApiBaseUrl } from '@/lib/api-base';
import { Input } from '@/components/ui/input';
import { ACCENTS, COVER_ACCENT } from '@/lib/appearance';
import { formatBytes, formatTrackCount } from '@/lib/format';
import { isCompressible, useDownloadsStore } from '@/store/downloads-store';
import { compressionKbps, useSettingsStore, type DownloadCompression } from '@/store/settings-store';
import { SIDEBAR_CATEGORIES, useSidebarStore } from '@/store/sidebar-store';
import { useUpdateStore } from '@/store/update-store';
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

const CACHE_LIMIT_OPTIONS: { value: string; label: string }[] = [
  { value: '200', label: '200 МБ' },
  { value: '500', label: '500 МБ' },
  { value: '1000', label: '1 ГБ' },
  { value: '2000', label: '2 ГБ' },
];

function CacheSection() {
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<{ bytes: number; limitMb: number } | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    void window.electronAPI?.cache?.stats().then(setStats);
  }, []);
  if (!window.electronAPI?.cache) return null;
  const clear = async () => {
    setClearing(true);
    try {
      setStats(await window.electronAPI.cache.clear());
      queryClient.removeQueries({ queryKey: ['album'] });
      queryClient.removeQueries({ queryKey: ['lyrics'] });
      toast.success('Кеш очищен');
    } finally {
      setClearing(false);
    }
  };
  return (
    <Section
      title="Кеш"
      footer="Обложки, фото исполнителей, списки треков в альбомах и тексты песен сохраняются на диске: повторно открываются мгновенно и без интернета. При превышении лимита удаляется то, что давно не открывали."
    >
      <Row title="Занято" subtitle={stats ? `${formatBytes(stats.bytes)} из ${formatBytes(stats.limitMb * 1024 * 1024)}` : '…'}>
        <Button variant="secondary" size="sm" disabled={clearing || !stats?.bytes} onClick={() => void clear()}>
          {clearing && <Loader2 size={14} className="animate-spin" />}
          Очистить кеш
        </Button>
      </Row>
      <Row title="Лимит размера">
        <Segmented
          value={String(stats?.limitMb ?? 500)}
          options={CACHE_LIMIT_OPTIONS}
          onChange={(v) => void window.electronAPI.cache.setLimit(Number(v)).then(setStats)}
        />
      </Row>
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

const CLIENT_SECRET_META: Record<
  Exclude<ClientSecretKey, 'SPOTIFY_CLIENT_ID'>,
  { label: string; placeholder: string; hint: string }
> = {
  DISCORD_CLIENT_ID: {
    label: 'Discord Application ID',
    placeholder: 'Числовой ID приложения в Discord Developer Portal',
    hint: 'Rich Presence и кнопка «Открыть трек». Можно оставить пустым, если ID уже в сборке или .env.',
  },
  YANDEX_CLIENT_ID: {
    label: 'Яндекс OAuth Client ID',
    placeholder: 'Только при своём OAuth-приложении',
    hint: 'По умолчанию используется встроенный клиент Music Android (рекомендуется для Плюса).',
  },
  YANDEX_CLIENT_SECRET: {
    label: 'Яндекс OAuth Client Secret',
    placeholder: 'Пароль приложения oauth.yandex.ru',
    hint: 'Используется вместе с Client ID, если включён «Свой OAuth Яндекс».',
  },
};

const SECRET_SOURCE_LABEL: Record<ClientSecretsView['fields'][ClientSecretKey]['source'], string> = {
  user: 'Задано вручную',
  env: 'Из .env',
  baked: 'Из сборки',
  none: 'Не задано',
};

function ClientSecretsSection() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ClientSecretsView | null>(null);
  const [draft, setDraft] = useState<Partial<Record<ClientSecretKey, string>>>({});
  const [yandexCustom, setYandexCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.electronAPI?.system.getClientSecrets().then((v) => {
      setView(v);
      setYandexCustom(v.yandexCustomOAuth);
      const d: Partial<Record<ClientSecretKey, string>> = {};
      for (const key of Object.keys(v.fields) as ClientSecretKey[]) {
        d[key] = v.fields[key].userValue;
      }
      setDraft(d);
    });
  }, []);

  if (!window.electronAPI || !view) return null;

  const save = async () => {
    setSaving(true);
    try {
      const secrets: Partial<Record<ClientSecretKey, string | null>> = {};
      for (const key of Object.keys(CLIENT_SECRET_META) as Exclude<ClientSecretKey, 'SPOTIFY_CLIENT_ID'>[]) {
        const value = draft[key]?.trim() ?? '';
        const hadUser = Boolean(view.fields[key].userValue);
        if (value) secrets[key] = value;
        else if (hadUser) secrets[key] = null;
      }
      const next = await window.electronAPI.system.setClientSecrets({
        secrets,
        yandexCustomOAuth: yandexCustom,
      });
      setView(next);
      await queryClient.invalidateQueries({ queryKey: ['connectors'] });
      toast.success('Ключи сохранены. При смене Яндекс OAuth переподключите сервис выше.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить ключи');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Ключи API"
      footer="Значения хранятся только на этом компьютере (app-settings.json). Ручной ввод имеет приоритет над .env и ключами из установщика. Секреты не отправляются на сервер MSS."
    >
      {(Object.keys(CLIENT_SECRET_META) as Exclude<ClientSecretKey, 'SPOTIFY_CLIENT_ID'>[]).map((key) => {
        const meta = CLIENT_SECRET_META[key];
        const field = view.fields[key];
        if (key.startsWith('YANDEX_') && !yandexCustom) return null;
        return (
          <Fragment key={key}>
          <Row
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                {meta.label}
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-muted">
                  {SECRET_SOURCE_LABEL[field.source]}
                  {field.effectiveSet && field.source !== 'user' ? ' · активен' : ''}
                </span>
              </span>
            }
            subtitle={meta.hint}
          >
            <Input
              className="max-w-md font-mono text-xs"
              type="password"
              autoComplete="off"
              placeholder={field.effectiveSet && !draft[key] ? 'Задано (введите новое, чтобы заменить)' : meta.placeholder}
              value={draft[key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          </Row>
          </Fragment>
        );
      })}
      <Row
        title="Свой OAuth Яндекс"
        subtitle="Включайте только если создали приложение на oauth.yandex.ru. Иначе Плюс и полные треки могут не работать."
      >
        <Switch checked={yandexCustom} onChange={setYandexCustom} label="Свой OAuth Яндекс" />
      </Row>
      <Row title="Сохранить ключи">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          Сохранить
        </Button>
      </Row>
    </Section>
  );
}

function SystemSection() {
  const [system, update] = useSystemSettings();
  if (!window.electronAPI || !system) return null;
  const serverUrl = system.apiPublicUrl ?? getApiBaseUrl();
  return (
    <Section title="Система">
      {!import.meta.env.DEV && (
        <Row title="Сервер" subtitle="Публичный URL API, как на странице загрузки (с /MusicStreamService)">
          <Input
            className="max-w-md"
            placeholder="https://your-domain/MusicStreamService"
            value={serverUrl}
            onChange={(e) => {
              const v = e.target.value;
              update({ apiPublicUrl: v || undefined });
              if (v.trim()) setApiBaseUrl(v);
            }}
          />
        </Row>
      )}
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
    </Section>
  );
}

function DiscordSection() {
  const [system, update] = useSystemSettings();
  if (!window.electronAPI || !system) return null;
  return (
    <Section
      title="Discord"
      footer="Application ID задаётся в разделе «Ключи API». В Discord Developer Portal включите Rich Presence и загрузите ассеты play/pause при необходимости."
    >
      <Row title="Rich Presence" subtitle="Статус «Слушает MusicStream» с обложкой и прогрессом">
        <Switch checked={system.discordPresence} onChange={(v) => update({ discordPresence: v })} label="Rich Presence" />
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

function SidebarCategoriesSection() {
  const hidden = useSidebarStore((s) => s.sectionsHidden);
  const setSectionHidden = useSidebarStore((s) => s.setSectionHidden);
  const showAll = useSidebarStore((s) => s.showAllCategories);
  const anyHidden = SIDEBAR_CATEGORIES.some((c) => hidden[c.id]);
  return (
    <Section
      title="Категории в боковой панели"
    >
      {SIDEBAR_CATEGORIES.map((c) => (
        <Row key={c.id} title={c.label}>
          <Switch
            checked={!hidden[c.id]}
            onChange={(visible) => setSectionHidden(c.id, !visible)}
            label={`Показывать «${c.label}»`}
          />
        </Row>
      ))}
      {anyHidden && (
        <div className="pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={() => showAll()}>
            Показать все категории
          </Button>
        </div>
      )}
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
  const email = loadSession()?.user.email;
  const status = useUpdateStore((s) => s.status);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);
  const version = status.currentVersion ?? currentVersion;
  const checking = status.state === 'checking';
  const installing = status.state === 'downloading' || status.state === 'installing';

  const exportReport = async () => {
    const saved = await window.electronAPI.system.exportReport();
    if (saved) toast.success('Отчёт сохранён');
  };

  const updateSubtitle = (() => {
    if (!window.electronAPI) return undefined;
    if (status.state === 'dev') return 'Проверка доступна в установленной версии';
    if (status.state === 'checking') return 'Проверяем…';
    if (status.state === 'downloading') return `Скачивание ${status.progress ?? 0}%`;
    if (status.state === 'installing') return 'Закрываем приложение и запускаем установщик';
    if (status.state === 'error') return status.message ?? 'Не удалось проверить обновления';
    if (status.state === 'available') return `Доступна ${status.version}`;
    if (status.state === 'not-available') return 'Установлена актуальная версия';
    return version ? `Версия ${version}` : 'Проверьте наличие обновлений';
  })();

  const onCheck = async () => {
    const next = await check();
    if (!next) return;
    if (next.state === 'dev') toast.message('Проверка обновлений доступна в установленной версии');
    else if (next.state === 'not-available') toast.success('Установлена актуальная версия');
    else if (next.state === 'error') toast.error(next.message ?? 'Не удалось проверить обновления');
  };

  return (
    <Section title="О программе">
      <Row title="MusicStream" subtitle={version ? `Версия ${version}` : 'Веб-версия'}>
        <AppLogo className="h-8 w-8" />
      </Row>
      {window.electronAPI && (
        <>
          <Row title="Обновления" subtitle={updateSubtitle}>
            {status.state === 'available' || installing || (status.state === 'error' && status.version) ? (
              <Button size="sm" disabled={installing} onClick={() => void install()}>
                {installing && <Loader2 size={14} className="animate-spin" />}
                {status.state === 'error' ? 'Повторить установку' : 'Перезапустить и установить'}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled={checking} onClick={() => void onCheck()}>
                {checking && <Loader2 size={14} className="animate-spin" />}
                Проверить обновления
              </Button>
            )}
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
            void leaveCurrentLobby().finally(() => {
              clearSession();
              navigate('/login');
            });
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
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px]">
          Без Плюса — только превью (удалите YANDEX_* из .env, отключите и войдите снова через ya.ru/device)
        </span>
      )}
    </span>
  );
}

function SpotifySessionRow() {
  const loggedIn = useSpotifySessionLoggedIn();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!window.electronAPI) return null;
  return (
    <Row
      title="Spotify"
      subtitle={
        loggedIn
          ? 'Вход выполнен в веб-плеере (Premium или бесплатно с рекламой Spotify)'
          : 'Обычный аккаунт встроенного веб-плеера. Developer Dashboard не нужен.'
      }
    >
      <Button size="sm" onClick={() => navigate(loggedIn ? SPOTIFY_HOME : SPOTIFY_WEB)}>
        {loggedIn ? 'Открыть' : 'Войти'}
      </Button>
      {loggedIn && (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void logoutSpotifySession()
              .then(() => queryClient.invalidateQueries({ queryKey: ['spotify-session'] }))
              .finally(() => setBusy(false));
          }}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Выйти
        </Button>
      )}
    </Row>
  );
}

function VkStatus({ status }: { status: string }) {
  const { data: account, isLoading } = useVkAccount();
  if (status !== 'connected') return <>Не подключено</>;
  if (isLoading) return <>Проверяем аккаунт…</>;
  if (!account) return <>Подключено · токен только на этом устройстве</>;
  return <>{account.displayName ?? account.login ?? `id ${account.uid}`} · пароль не хранится</>;
}

function ConnectorRow({ connector }: { connector: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const connecting = useConnectStore((s) => s.connecting);
  const busy = connecting === connector.id;
  const isYandex = connector.id === 'yandex';
  const isVk = connector.id === 'vk';
  const connected = connector.status === 'connected';
  const subtitle = isYandex ? (
    <YandexStatus status={connector.status} />
  ) : isVk ? (
    <VkStatus status={connector.status} />
  ) : connected ? (
    'Подключено'
  ) : (
    'Не подключено'
  );

  return (
    <Row title={connector.name} subtitle={subtitle}>
      {connected ? (
        <Button variant="secondary" size="sm" onClick={() => void disconnectSource(connector.id, queryClient)}>
          Отключить
        </Button>
      ) : (
        <Button size="sm" disabled={!!connecting} onClick={() => void connectSource(connector.id, queryClient)}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {connector.status === 'expired' ? 'Войти заново' : isYandex ? 'Войти через Яндекс' : isVk ? 'Войти во VK' : 'Подключить'}
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
        footer="Яндекс: вход по коду на ya.ru/device. VK: логин и пароль в окне приложения, пароль не сохраняется. Токены только на этом устройстве. Spotify: встроенный веб-плеер."
      >
        <SpotifySessionRow />
        {connectors
          .filter((c) => c.id !== 'spotify')
          .map((c) => (
            <ConnectorRow key={c.id} connector={c} />
          ))}
        {!connectors.length && (
          <Row title="Нет доступных сервисов" subtitle="Укажите ключи в разделе «Ключи API» ниже или в .env" />
        )}
      </Section>

      <ClientSecretsSection />

      <SidebarCategoriesSection />

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

      <CacheSection />

      <Section title="Тестовые функции" footer="Могут работать нестабильно — при сбое отключите.">
        <Row title="Быстрый старт Spotify" subtitle="Трек запускается одной командой Spotify, без переходов в веб-плеере">
          <Switch
            checked={settings.spotifyFastStart}
            onChange={settings.setSpotifyFastStart}
            label="Быстрый старт Spotify"
          />
        </Row>
      </Section>

      <SystemSection />

      <DiscordSection />

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
