import { NavLink } from 'react-router-dom';
import { libraryPath, SERVICE_HOMES, type CatalogScope } from '@/lib/service-routes';
import { cn } from '@/lib/utils';

export function serviceTabs(scope: CatalogScope): { to: string; label: string; end?: boolean }[] {
  const items = [
    { to: SERVICE_HOMES[scope], label: 'Слушать сейчас', end: true as const },
    { to: libraryPath(scope, 'likes'), label: 'Мне нравится' },
  ];
  if (scope === 'mss') items.push({ to: libraryPath('mss', 'uploads'), label: 'Мои треки' });
  else items.push({ to: libraryPath(scope, 'playlists'), label: 'Плейлисты' });
  return items;
}

export function ServiceNav({ scope }: { scope: CatalogScope }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-border">
      {serviceTabs(scope).map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors',
              isActive ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
