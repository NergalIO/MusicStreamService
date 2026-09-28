import { useEffect, useState } from 'react';
import { proxyUrl } from '@/lib/playback';

const cache = new Map<string, string>();
const paletteCache = new Map<string, CoverPalette>();

export interface CoverPalette {
  /** Основной оттенок обложки. */
  a: string;
  /** Второй акцент (другая зона кадра). */
  b: string;
  /** Третий акцент. */
  c: string;
}

export const WAVE_IDLE_PALETTE: CoverPalette = {
  a: '92 68 235',
  b: '210 72 255',
  c: '58 168 255',
};

function imageSource(src: string): string {
  const url = new URL(src, window.location.href);
  return url.origin === window.location.origin ? url.href : proxyUrl(url.href);
}

/** Saturation-weighted average colour of an image, as "r g b" for use in rgb(). */
function extract(img: HTMLImageElement): string {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const weight = 0.15 + (max - min) / 255 + (max > 40 && max < 235 ? 0.3 : 0);
    r += pr * weight;
    g += pg * weight;
    b += pb * weight;
    total += weight;
  }
  return `${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)}`;
}

function extractRegion(data: Uint8ClampedArray, width: number, x0: number, y0: number, x1: number, y1: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      const weight = 0.15 + (max - min) / 255 + (max > 40 && max < 235 ? 0.35 : 0);
      r += pr * weight;
      g += pg * weight;
      b += pb * weight;
      total += weight;
    }
  }
  if (!total) return '60 50 110';
  return `${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)}`;
}

function extractPalette(img: HTMLImageElement): CoverPalette {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  const { data, width } = ctx.getImageData(0, 0, size, size);
  const mid = size / 2;
  return {
    a: extractRegion(data, width, 0, 0, mid, mid),
    b: extractRegion(data, width, mid, 0, size, mid),
    c: extractRegion(data, width, 0, mid, size, size),
  };
}

export function useCoverPalette(src?: string | null, fallback: CoverPalette = WAVE_IDLE_PALETTE): CoverPalette {
  const [palette, setPalette] = useState<CoverPalette>(() => (src && paletteCache.get(src)) || fallback);

  useEffect(() => {
    if (!src) {
      setPalette(fallback);
      return;
    }
    const hit = paletteCache.get(src);
    if (hit) {
      setPalette(hit);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const p = extractPalette(img);
        paletteCache.set(src, p);
        if (!cancelled) setPalette(p);
      } catch {
        if (!cancelled) setPalette(fallback);
      }
    };
    img.onerror = () => !cancelled && setPalette(fallback);
    img.src = imageSource(src);
    return () => {
      cancelled = true;
    };
  }, [src, fallback]);

  return palette;
}

export function useDominantColor(src?: string | null, fallback = '60 50 110'): string {
  const [color, setColor] = useState(() => (src && cache.get(src)) || fallback);

  useEffect(() => {
    if (!src) {
      setColor(fallback);
      return;
    }
    const hit = cache.get(src);
    if (hit) {
      setColor(hit);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = extract(img);
        cache.set(src, c);
        if (!cancelled) setColor(c);
      } catch {
        if (!cancelled) setColor(fallback);
      }
    };
    img.onerror = () => !cancelled && setColor(fallback);
    img.src = imageSource(src);
    return () => {
      cancelled = true;
    };
  }, [src, fallback]);

  return color;
}
