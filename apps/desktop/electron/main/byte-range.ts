export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Разбор заголовка Range по RFC 7233: `bytes=0-99`, `bytes=100-` и суффикс `bytes=-500`
 * (последние 500 байт). Наивный разбор принимал суффикс за `0-500` и отдавал не те данные.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    end = Math.min(end, size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
