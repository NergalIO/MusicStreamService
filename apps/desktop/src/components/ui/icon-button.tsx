import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  /** Не дублировать подсказку title — достаточно aria-label. */
  showTitle?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, showTitle = false, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      title={showTitle ? label : undefined}
      className={cn(
        'relative flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-30',
        active ? 'text-primary' : 'text-foreground/70 hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
});
