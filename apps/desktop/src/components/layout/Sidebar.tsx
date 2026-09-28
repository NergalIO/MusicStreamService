import {
  BarChart3,
  ChevronRight,
  CircleArrowDown,
  Clock,
  Heart,
  Home,
  Library,
  ListMusic,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Search,
  Settings,
  Sparkles,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AppLogo } from '@/components/layout/AppLogo';
import { clearSession, loadSession } from '@/lib/api';
import { useYandexConnected } from '@/lib/connectors';
import { playlistPath } from '@/lib/links';
import { libraryPath, MSS_HOME, searchPath, SPOTIFY_HOME, YANDEX_HOME } from '@/lib/service-routes';
import { useMssPlaylists, useSpotifyPlaylists, useYandexPlaylists } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/store/player-store';
import { useSettingsStore } from '@/store/settings-store';
import { type SidebarSectionId, useSidebarStore } from '@/store/sidebar-store';

const NARROW_WIDTH = 960;

const CollapsedContext = createContext(false);

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_WIDTH);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

function Item({
  to,
  icon: Icon,
  label,
  end,
  image,
  indent,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  image?: string | null;
  indent?: boolean;
}) {
  const collapsed = useContext(CollapsedContext);
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'relative flex h-8 items-center gap-2.5 rounded-md border-l-2 text-[13px] transition-colors',
          collapsed ? 'justify-center border-transparent px-0' : cn('px-2.5', indent && 'pl-6'),
          isActive
            ? 'border-primary bg-foreground/10 font-medium text-foreground'
            : 'border-transparent text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {image ? (
            <img src={image} alt="" draggable={false} className={cn('shrink-0 rounded-[3px] object-cover', collapsed ? 'h-5 w-5' : 'h-4 w-4')} />
          ) : (
            <Icon size={collapsed ? 18 : 16} className={cn('shrink-0', isActive ? 'text-primary' : 'text-primary/80')} />
          )}
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

function CollapsibleSection({
  id,
  title,
  children,
}: {
  id: SidebarSectionId;
  title: string;
  children: React.ReactNode;
}) {
  const panelCollapsed = useContext(CollapsedContext);
  const open = useSidebarStore((s) => s.sectionsOpen[id]);
  const toggleSection = useSidebarStore((s) => s.toggleSection);

  if (panelCollapsed) {
    return (
      <div className="space-y-0.5" role="group" aria-label={title}>
        <div className="mx-3 mb-2 mt-4 border-t border-border" />
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-0.5" role="group" aria-label={title}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggleSection(id)}
        className="flex w-full items-center gap-1 px-2.5 pb-1 pt-4 text-left text-[11px] font-semibold uppercase tracking-wide text-muted transition-colors hover:text-foreground"
      >
        <ChevronRight size={14} className={cn('shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="truncate">{title}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

function PlaylistSubsection({
  id,
  scope,
}: {
  id: Extract<SidebarSectionId, 'mssPlaylists' | 'yandexPlaylists' | 'spotifyPlaylists'>;
  scope: 'mss' | 'yandex' | 'spotify';
}) {
  const panelCollapsed = useContext(CollapsedContext);
  const parentSection = scope === 'mss' ? 'mss' : scope === 'yandex' ? 'yandex' : 'spotify';
  const parentOpen = useSidebarStore((s) => s.sectionsOpen[parentSection]);
  const open = useSidebarStore((s) => s.sectionsOpen[id]);
  const toggleSection = useSidebarStore((s) => s.toggleSection);
  const pinned = useSidebarStore((s) => s.pinnedPlaylists);
  const { data: mssPlaylists = [] } = useMssPlaylists();
  const { data: yandexPlaylists = [] } = useYandexPlaylists();
  const { data: spotifyPlaylists = [] } = useSpotifyPlaylists();

  const pinSource = scope === 'mss' ? 'local' : scope;
  const pins = pinned.filter((p) => p.source === pinSource);

  const items = useMemo(() => {
    return pins
      .map((pin) => {
        if (pin.source === 'local') {
          const p = mssPlaylists.find((x) => x.id === pin.id);
          if (!p) return null;
          return { key: `l-${p.id}`, to: `/playlists/${p.id}`, label: p.name, image: p.coverUrl };
        }
        if (pin.source === 'yandex') {
          const p = yandexPlaylists.find((x) => x.id === pin.id);
          if (!p) return null;
          return { key: `y-${p.id}`, to: playlistPath(p), label: p.title, image: p.coverUrl };
        }
        const p = spotifyPlaylists.find((x) => x.id === pin.id);
        if (!p) return null;
        return { key: `s-${p.id}`, to: playlistPath(p), label: p.title, image: p.coverUrl };
      })
      .filter(Boolean) as { key: string; to: string; label: string; image?: string | null }[];
  }, [pins, mssPlaylists, yandexPlaylists, spotifyPlaylists]);

  if (!parentOpen && !panelCollapsed) return null;
  if (!pins.length && panelCollapsed) return null;

  if (panelCollapsed) {
    return (
      <>
        {items.map((item) => (
          <Item key={item.key} to={item.to} icon={ListMusic} label={item.label} image={item.image} />
        ))}
      </>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggleSection(id)}
        className="flex w-full items-center gap-1 py-1 pl-4 pr-2.5 text-left text-[11px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <span>Плейлисты{pins.length ? ` · ${pins.length}` : ''}</span>
      </button>
      {open &&
        (items.length ? (
          items.map((item) => (
            <Item key={item.key} to={item.to} icon={ListMusic} label={item.label} image={item.image} indent />
          ))
        ) : (
          <p className="px-6 py-1 text-[11px] leading-snug text-muted">Закрепите плейлисты через меню ⋯ на странице медиатеки</p>
        ))}
    </div>
  );
}

function SidebarSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [value, setValue] = useState('');
  const searchBase = searchPath('media');

  useEffect(() => {
    if (location.pathname === '/media/search') setValue(params.get('q') ?? '');
  }, [location.pathname, params]);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(value.trim() ? searchPath('media', value.trim()) : searchBase);
      }}
      className="relative"
    >
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => location.pathname !== '/media/search' && navigate(searchBase)}
        placeholder="Поиск"
        aria-label="Поиск"
        data-search-input
        className="h-8 w-full rounded-md border border-foreground/[0.06] bg-foreground/[0.07] pl-8 pr-2 text-[13px] outline-none placeholder:text-muted focus:border-primary/60"
      />
    </form>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const yandex = useYandexConnected();
  const radio = usePlayerStore((s) => s.radio);
  const email = loadSession()?.user.email;
  const preferCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const narrow = useNarrowWindow();
  const collapsed = preferCollapsed || narrow;

  return (
    <CollapsedContext.Provider value={collapsed}>
      <aside
        aria-label="Навигация"
        className={cn(
          'flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-out',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('drag-region space-y-3 pb-2 pt-4', collapsed ? 'px-2' : 'px-3')}>
          <div className={cn('flex items-center gap-2', collapsed ? 'justify-center' : 'px-1')}>
            <AppLogo />
            {!collapsed && <span className="text-[15px] font-semibold tracking-tight">MusicStream</span>}
          </div>
          {collapsed ? (
            <NavLink
              to={searchPath('media')}
              title="Поиск"
              aria-label="Поиск"
              className="flex h-8 items-center justify-center rounded-md text-muted hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <Search size={18} />
            </NavLink>
          ) : (
            <SidebarSearch />
          )}
        </div>

        <nav className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4', collapsed ? 'no-scrollbar px-2' : 'px-3')}>
          <CollapsibleSection id="media" title="Медиатека">
            <Item to={libraryPath('media', 'likes')} icon={Library} label="Мне нравится" />
            <Item to={libraryPath('media', 'history')} icon={Clock} label="Недавно играли" />
            <Item to={libraryPath('media', 'playlists')} icon={ListMusic} label="Все плейлисты" />
          </CollapsibleSection>

          <CollapsibleSection id="mss" title="MSS">
            <Item to={MSS_HOME} end icon={Home} label="Слушать сейчас" />
            <Item to={libraryPath('mss', 'likes')} icon={Heart} label="Мне нравится" />
            <Item to={libraryPath('mss', 'history')} icon={Clock} label="Недавно играли" />
            <Item to={libraryPath('mss', 'playlists')} icon={ListMusic} label="Все плейлисты" />
            <Item to={libraryPath('mss', 'uploads')} icon={Upload} label="Мои треки" />
            <Item to={libraryPath('mss', 'downloads')} icon={CircleArrowDown} label="Скачанные" />
            <PlaylistSubsection id="mssPlaylists" scope="mss" />
          </CollapsibleSection>

          <CollapsibleSection id="yandex" title="Яндекс Музыка">
            <Item to={YANDEX_HOME} end icon={Home} label="Слушать сейчас" />
            {yandex && <Item to="/wave" icon={Radio} label={radio ? 'Моя волна · играет' : 'Моя волна'} />}
            <Item to={libraryPath('yandex', 'likes')} icon={Heart} label="Мне нравится" />
            <Item to={libraryPath('yandex', 'playlists')} icon={ListMusic} label="Все плейлисты" />
            <PlaylistSubsection id="yandexPlaylists" scope="yandex" />
          </CollapsibleSection>

          <CollapsibleSection id="spotify" title="Spotify">
            <Item to={SPOTIFY_HOME} end icon={Home} label="Слушать сейчас" />
            <Item to={libraryPath('spotify', 'likes')} icon={Heart} label="Мне нравится" />
            <Item to={libraryPath('spotify', 'playlists')} icon={ListMusic} label="Все плейлисты" />
            <Item to={searchPath('spotify')} icon={Search} label="Поиск" />
            <PlaylistSubsection id="spotifyPlaylists" scope="spotify" />
          </CollapsibleSection>
        </nav>

        <div className={cn('space-y-0.5 border-t border-border py-3', collapsed ? 'px-2' : 'px-3')}>
          <Item to="/subscription" icon={Sparkles} label="Подписка" />
          <Item to="/stats" icon={BarChart3} label="Статистика" />
          <Item to="/settings" icon={Settings} label="Настройки" />
          <button
            type="button"
            title={email ? `Выйти (${email})` : 'Выйти'}
            aria-label={email ? `Выйти (${email})` : 'Выйти'}
            onClick={() => {
              clearSession();
              navigate('/login');
            }}
            className={cn(
              'flex h-8 w-full items-center gap-2.5 rounded-md text-[13px] text-foreground/60 transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
              collapsed ? 'justify-center' : 'px-2.5',
            )}
          >
            <LogOut size={collapsed ? 18 : 16} className="shrink-0" />
            {!collapsed && <span className="truncate">{email ?? 'Выйти'}</span>}
          </button>
          {!narrow && (
            <button
              type="button"
              aria-label={collapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
              title={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
              onClick={() => setCollapsed(!preferCollapsed)}
              className={cn(
                'flex h-8 w-full items-center gap-2.5 rounded-md text-[13px] text-foreground/60 transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
                collapsed ? 'justify-center' : 'px-2.5',
              )}
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={16} />}
              {!collapsed && <span>Свернуть панель</span>}
            </button>
          )}
        </div>
      </aside>
    </CollapsedContext.Provider>
  );
}
