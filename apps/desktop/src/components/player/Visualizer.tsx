import { useEffect, useRef } from 'react';
import { getAnalyser } from '@/hooks/useAudioEngine';
import { cn } from '@/lib/utils';

interface VisualizerProps {
  /** Внешний источник полос 0..1; без него читаем анализатор движка этого окна. */
  bands?: ArrayLike<number> | null;
  barCount?: number;
  color?: string;
  active?: boolean;
  className?: string;
}

function draw(canvas: HTMLCanvasElement, values: ArrayLike<number>, color: string): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (color.includes('var(')) {
    canvas.style.color = color;
    ctx.fillStyle = getComputedStyle(canvas).color;
  } else ctx.fillStyle = color;
  const n = values.length;
  if (!n) return;
  const gap = Math.max(1, Math.round(2 * dpr));
  const barW = Math.max(1, (w - gap * (n - 1)) / n);
  const radius = Math.min(barW / 2, 3 * dpr);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.03, Math.min(1, values[i]));
    const barH = Math.max(2 * dpr, v * h);
    const x = i * (barW + gap);
    ctx.beginPath();
    ctx.roundRect(x, h - barH, barW, barH, [radius, radius, 0, 0]);
    ctx.fill();
  }
}

export function Visualizer({ bands, barCount = 48, color = 'rgba(255,255,255,0.55)', active = true, className }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothed = useRef(new Float32Array(barCount));

  useEffect(() => {
    smoothed.current = new Float32Array(barCount);
  }, [barCount]);

  useEffect(() => {
    if (bands === undefined) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(canvas, bands ?? smoothed.current.fill(0), color);
  }, [bands, color]);

  useEffect(() => {
    if (bands !== undefined) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const raw = new Float32Array(barCount);
    let frame = 0;
    const tick = () => {
      const target = smoothed.current;
      const has = active && !!getAnalyser()?.getBands(raw);
      for (let i = 0; i < target.length; i++) {
        const next = has ? raw[i] : 0;
        // Быстрый подъём и плавный спад — столбики не дёргаются.
        target[i] = next > target[i] ? next : target[i] * 0.86 + next * 0.14;
      }
      draw(canvas, target, color);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [bands, barCount, color, active]);

  return <canvas ref={canvasRef} aria-hidden className={cn('block w-full', className)} />;
}
