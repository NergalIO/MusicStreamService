import { renderSVG } from 'uqr';
import { cn } from '@/lib/utils';

export function QrCode({ value, className }: { value: string; className?: string }) {
  const svg = renderSVG(value, {
    border: 2,
    pixelSize: 6,
    whiteColor: '#ffffff',
    blackColor: '#111111',
  });
  return (
    <div
      className={cn('overflow-hidden rounded-xl bg-white p-1 shadow-sm [&>svg]:h-auto [&>svg]:w-full', className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
