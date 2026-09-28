import { useEffect, useRef } from 'react';
import { getAnalyser } from '@/hooks/useAudioEngine';

/** Корень с CSS-переменными --wave-bass, --wave-mid, --wave-treble, --wave-pulse, --wave-energy (0..1). */
export function useWaveAudioReactive(enabled: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sim = useRef({ bassEma: 0, pulse: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!enabled) {
      el?.style.setProperty('--wave-bass', '0');
      el?.style.setProperty('--wave-mid', '0');
      el?.style.setProperty('--wave-treble', '0');
      el?.style.setProperty('--wave-pulse', '0');
      el?.style.setProperty('--wave-energy', '0');
      return;
    }

    const bands = new Float32Array(24);
    let frame = 0;

    const tick = () => {
      const node = rootRef.current;
      let bass = 0;
      let mid = 0;
      let treble = 0;
      const analyser = getAnalyser();
      if (analyser?.getBands(bands)) {
        for (let i = 0; i < 6; i++) bass += bands[i];
        bass /= 6;
        for (let i = 6; i < 15; i++) mid += bands[i];
        mid /= 9;
        for (let i = 15; i < bands.length; i++) treble += bands[i];
        treble /= bands.length - 15;
      }

      const s = sim.current;
      const flux = Math.max(0, bass - s.bassEma);
      s.bassEma = s.bassEma * 0.9 + bass * 0.1;
      if (flux > 0.08 && bass > 0.18) s.pulse = Math.min(1, s.pulse * 0.45 + flux * 3.2 + bass * 0.35);
      else s.pulse *= 0.82;

      const energy = Math.min(1, bass * 0.55 + mid * 0.3 + treble * 0.15);

      if (node) {
        node.style.setProperty('--wave-bass', bass.toFixed(3));
        node.style.setProperty('--wave-mid', mid.toFixed(3));
        node.style.setProperty('--wave-treble', treble.toFixed(3));
        node.style.setProperty('--wave-pulse', s.pulse.toFixed(3));
        node.style.setProperty('--wave-energy', energy.toFixed(3));
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return rootRef;
}
