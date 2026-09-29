import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { copyText } from '@/lib/clipboard';
import { cancelConnect, useConnectStore } from '@/lib/connectors';

function useCountdown(seconds: number | undefined, key: string | undefined): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!seconds) return;
    const until = Date.now() + seconds * 1000;
    setLeft(seconds);
    const t = setInterval(() => setLeft(Math.max(0, Math.round((until - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [seconds, key]);
  return left;
}

export function DeviceCodeDialog() {
  const connecting = useConnectStore((s) => s.connecting);
  const prompt = useConnectStore((s) => s.prompt);
  const setPrompt = useConnectStore((s) => s.setPrompt);
  const [copied, setCopied] = useState(false);
  const left = useCountdown(prompt?.expiresIn, prompt?.userCode);

  useEffect(() => window.electronAPI?.connectors.onDeviceCode(setPrompt), [setPrompt]);

  const open = connecting === 'yandex';

  const copy = async () => {
    if (!prompt) return;
    await copyText(prompt.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onClose={() => void cancelConnect()} title="Вход в Яндекс Музыку">
      {!prompt ? (
        <div className="flex items-center gap-3 py-6 text-sm text-muted">
          <Loader2 className="animate-spin" size={18} /> Запрашиваем код у Яндекса…
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-muted">
            Браузер уже открыт на странице{' '}
            <span className="text-foreground">{prompt.verificationUrl.replace(/^https?:\/\//, '')}</span>. Войдите в
            аккаунт с Плюсом и введите код:
          </p>
          <button
            type="button"
            onClick={copy}
            className="group flex w-full items-center justify-center gap-3 rounded-xl bg-foreground/[0.06] py-5 font-mono text-3xl font-semibold tracking-[0.3em] transition-colors hover:bg-foreground/10"
          >
            {prompt.userCode}
            {copied ? (
              <Check size={18} className="text-primary" />
            ) : (
              <Copy size={18} className="text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </button>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="animate-spin" size={14} />
              Ждём подтверждения · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => void cancelConnect()}>
                Отмена
              </Button>
              <Button size="sm" onClick={() => window.open(prompt.verificationUrl, '_blank')}>
                <ExternalLink size={14} /> Открыть
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
