import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Открытые окна могут лежать друг на друге (диалог входа поверх приветствия): Tab ловит только верхнее. */
const stack: object[] = [];

/**
 * Tab и Shift+Tab не выходят за пределы открытого окна; после закрытия фокус возвращается туда, откуда окно открыли.
 * Первым получает фокус элемент с `data-autofocus`, иначе первый интерактивный.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const token = {};
    stack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root || root.contains(document.activeElement)) return;
      const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
      const target = preferred ?? focusables(root).find((el) => el.getAttribute('aria-label') !== 'Закрыть') ?? root;
      target.focus({ preventScroll: true });
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || stack[stack.length - 1] !== token) return;
      const root = ref.current;
      if (!root) return;
      const items = focusables(root);
      if (!items.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      stack.splice(stack.indexOf(token), 1);
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}
