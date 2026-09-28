import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** `overlay` — светлые кнопки поверх размытой обложки, одинаковые в светлой и тёмной теме. */
type Variant = 'default' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'overlay';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-foreground/10 text-foreground hover:bg-foreground/15',
  ghost: 'text-foreground/80 hover:bg-foreground/10 hover:text-foreground',
  outline: 'border border-border text-foreground hover:bg-foreground/5',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
  overlay: 'text-foreground/80 hover:bg-foreground/10 hover:text-foreground',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-md px-3 text-xs',
  md: 'h-9 gap-2 rounded-lg px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-6 text-sm',
  icon: 'h-9 w-9 rounded-full',
  'icon-sm': 'h-7 w-7 rounded-full',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-medium transition-colors active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});
