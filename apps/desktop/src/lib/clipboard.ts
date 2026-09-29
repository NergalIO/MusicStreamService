import { toast } from 'sonner';

export async function copyText(text: string): Promise<void> {
  const electronWrite = window.electronAPI?.clipboard?.writeText;
  if (electronWrite) {
    await electronWrite(text);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (!ok) throw new Error('Не удалось скопировать');
  }
}

export function copyTextWithToast(text: string, ok = 'Скопировано'): void {
  void copyText(text)
    .then(() => toast(ok))
    .catch(() => toast.error('Не удалось скопировать'));
}
