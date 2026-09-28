import type { AudioModule } from './types.js';

export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000];

export interface EqSettings {
  bands: number[];
  enabled: boolean;
}

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 4, 2, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 2, 4, 6, 6],
  Vocal: [-2, -1, 0, 2, 4, 2, 0, -1],
};

export function createEqualizerModule(initial?: Partial<EqSettings>): AudioModule {
  let filters: BiquadFilterNode[] = [];
  let settings: EqSettings = {
    bands: [...EQ_PRESETS.Flat],
    enabled: true,
    ...initial,
  };

  return {
    id: 'equalizer',
    displayName: 'Эквалайзер',
    createNodes(ctx) {
      filters = EQ_FREQUENCIES.map((freq, i) => {
        const f = ctx.createBiquadFilter();
        f.type = 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1;
        f.gain.value = settings.bands[i] ?? 0;
        return f;
      });
      for (let i = 0; i < filters.length - 1; i++) {
        filters[i].connect(filters[i + 1]);
      }
      return { input: filters[0], output: filters[filters.length - 1] };
    },
    applySettings(s: unknown) {
      const next = s as EqSettings;
      settings = { ...settings, ...next };
      filters.forEach((f, i) => {
        f.gain.value = settings.enabled ? (settings.bands[i] ?? 0) : 0;
      });
    },
    getSettings() {
      return settings;
    },
    dispose() {
      filters.forEach((f) => f.disconnect());
      filters = [];
    },
  };
}
