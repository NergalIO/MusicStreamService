import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const YOOMONEY_DONATE_URL =
  'https://yoomoney.ru/quickpay/fundraise/widget?billNumber=1KJ0576C9CG.260928';

export function DonationQr({ className }: { className?: string }) {
  const openDonate = () => {
    void window.electronAPI?.system.openExternal(YOOMONEY_DONATE_URL);
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
          onClick={openDonate}
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
