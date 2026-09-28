import iconUrl from '../../../resources/icon.svg?url';
import { cn } from '@/lib/utils';

export function AppLogo({ className }: { className?: string }) {
  return <img src={iconUrl} alt="" draggable={false} className={cn('h-7 w-7 shrink-0 select-none', className)} />;
}
