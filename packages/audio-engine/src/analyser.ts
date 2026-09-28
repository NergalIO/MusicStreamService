import type { AudioModule } from './types.js';

export interface AnalyserModule extends AudioModule {
  /** Fills `out` with `out.length` log-spaced band levels in 0..1; returns false before audio starts. */
  getBands(out: Float32Array): boolean;
}

/** Pass-through AnalyserNode for spectrum visualisers; does not change the sound. */
export function createAnalyserModule(): AnalyserModule {
  let node: AnalyserNode | null = null;
  let bins: Uint8Array<ArrayBuffer> | null = null;

  return {
    id: 'analyser',
    displayName: 'Анализатор',
    createNodes(ctx) {
      node = ctx.createAnalyser();
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0.78;
      node.minDecibels = -85;
      node.maxDecibels = -20;
      bins = new Uint8Array(node.frequencyBinCount);
      return { input: node, output: node };
    },
    getBands(out) {
      if (!node || !bins) return false;
      node.getByteFrequencyData(bins);
      const nyquist = node.context.sampleRate / 2;
      const minF = 40;
      const maxF = Math.min(16000, nyquist);
      for (let i = 0; i < out.length; i++) {
        const f0 = minF * Math.pow(maxF / minF, i / out.length);
        const f1 = minF * Math.pow(maxF / minF, (i + 1) / out.length);
        const b0 = Math.floor((f0 / nyquist) * bins.length);
        const b1 = Math.max(b0 + 1, Math.floor((f1 / nyquist) * bins.length));
        let peak = 0;
        for (let b = b0; b < b1 && b < bins.length; b++) peak = Math.max(peak, bins[b]);
        out[i] = peak / 255;
      }
      return true;
    },
    applySettings() {},
    getSettings() {
      return {};
    },
    dispose() {
      node?.disconnect();
      node = null;
      bins = null;
    },
  };
}
