import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

export interface MenuItem {
  icon: LucideIcon;
  label: string;
  action: (navigate: NavigateFunction) => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSpec {
  title?: string;
  groups: MenuItem[][];
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  spec: MenuSpec | null;
  /** Элемент, с которого открыли меню: туда возвращается фокус после закрытия. */
  returnFocus: HTMLElement | null;
  close: () => void;
}

const useMenuStore = create<MenuState>()((set) => ({
  open: false,
  x: 0,
  y: 0,
  spec: null,
  returnFocus: null,
  close: () => set({ open: false }),
}));

/** Открывает меню у курсора (правый клик) или под кнопкой (клик / клавиатура). */
export function openContextMenu(e: React.MouseEvent | React.KeyboardEvent, spec: MenuSpec): void {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const atCursor = e.type === 'contextmenu' && 'clientX' in e && (e.clientX || e.clientY);
  useMenuStore.setState({
    open: true,
    x: atCursor ? (e as React.MouseEvent).clientX : rect.right,
    y: atCursor ? (e as React.MouseEvent).clientY : rect.bottom + 4,
    spec: { ...spec, groups: spec.groups.filter((g) => g.length > 0) },
    returnFocus: target,
  });
}

export function closeContextMenu(): void {
  useMenuStore.getState().close();
}

export function ContextMenuHost() {
  const { open, x, y, spec, close, returnFocus } = useMenuStore();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, y + height > window.innerHeight - 8 ? y - height : y),
    });
    ref.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [open, x, y, spec]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        returnFocus?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? (idx + 1) % items.length
              : (idx - 1 + items.length) % items.length;
      items[next].focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open, close, returnFocus]);

  if (!open || !spec) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={spec.title}
      style={{ left: pos.left, top: pos.top }}
      className="no-drag glass fixed z-[200] min-w-[240px] max-w-[320px] animate-scale-in rounded-xl border p-1.5 shadow-popover"
    >
      {spec.title && <div className="truncate px-2.5 pb-1.5 pt-1 text-xs text-muted">{spec.title}</div>}
      {spec.groups.map((items, gi) => (
        <div key={gi} role="group" className={cn(gi > 0 && 'mt-1 border-t border-foreground/[0.06] pt-1')}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close();
                item.action(navigate);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground disabled:pointer-events-none disabled:opacity-40',
                item.danger && 'text-danger',
              )}
            >
              <item.icon size={15} className="shrink-0 opacity-80" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
