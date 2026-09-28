import { SOURCE_FILTERS, type SourceFilterId } from '@/lib/sources';
import { cn } from '@/lib/utils';

export function SourceFilter({
  value,
  onChange,
  counts,
}: {
  value: SourceFilterId;
  onChange: (value: SourceFilterId) => void;
  counts?: Partial<Record<SourceFilterId, number | null>>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {SOURCE_FILTERS.map((f) => {
        const count = counts?.[f.id];
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            className={cn(
              'rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-foreground/5',
              value === f.id && 'border-primary bg-primary/30',
            )}
          >
            {f.label}
            {counts && (
              <span className="ml-1.5 text-muted">{count === null ? '…' : (count ?? 0)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
