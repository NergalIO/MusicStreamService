import { Sparkles } from 'lucide-react';
import { DonationQr } from '@/components/support/DonationQr';
import { PageTitle } from '@/components/media/CollectionHeader';

export function SubscriptionPage() {
  return (
    <div className="mx-auto max-w-2xl pb-10">
      <PageTitle title="Подписка" subtitle="MSS сейчас бесплатен для всех пользователей" />

      <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card to-card p-6">
        <div className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <Sparkles size={22} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="space-y-3 text-sm leading-relaxed">
            <p className="text-base font-medium text-foreground">
              В данный момент подписка не предусмотрена, и доступен полный функционал программы.
            </p>
            <p className="text-muted">
              Все возможности MSS — внутренняя библиотека, подключение сервисов, офлайн, плейлисты и плеер — доступны без
              ограничений и без оплаты.
            </p>
          </div>
        </div>
      </div>

      <DonationQr className="mt-8" />
    </div>
  );
}
