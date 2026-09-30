import { Music } from 'lucide-react';
import { useState } from 'react';
import { cachedImageUrl } from '@/lib/cached-image';
import { cn } from '@/lib/utils';

export function Artwork({
  src,
  alt = '',
  className,
  rounded = 'rounded-lg',
  iconSize = 20,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  rounded?: string;
  iconSize?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <div className={cn('relative shrink-0 overflow-hidden bg-foreground/[0.07]', rounded, className)}>
      {show ? (
        <img
          src={cachedImageUrl(src)}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <Music size={iconSize} />
        </div>
      )}
    </div>
  );
}
