import { Heart } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DonationQr({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  const openDonate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.electronAPI.system.openDonate();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/u, '') || 'Не удалось открыть ЮMoney');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('rounded-2xl border border-border bg-card p-6', className)}>
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Heart size={20} className="text-primary" aria-hidden />
        Будем рады поддержке
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Если MSS помогает вам слушать музыку, можно поддержать разработку добровольным донатом через ЮMoney.
      </p>
      <div className="mt-6">
        <Button
          type="button"
          variant="default"
          size="lg"
          disabled={busy}
          onClick={() => void openDonate()}
          className={cn(
            'h-12 min-w-[220px] max-w-full rounded-xl border border-primary/30 px-8 font-semibold',
            'shadow-[0_10px_32px_-10px_hsl(var(--primary)/0.55)]',
            'transition-[transform,box-shadow,filter] duration-200',
            'hover:brightness-[1.06] hover:shadow-[0_12px_36px_-8px_hsl(var(--primary)/0.65)]',
          )}
        >
          <Heart size={18} className="fill-primary-foreground/25" aria-hidden />
          Подарить
        </Button>
      </div>
    </div>
  );
}
