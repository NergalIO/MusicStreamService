import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-border bg-foreground/5 px-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary/60 focus:bg-foreground/[0.07]',
        className,
      )}
      {...props}
    />
  );
});
