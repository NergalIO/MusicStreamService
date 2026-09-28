import {
  AudioEngine,
  createAnalyserModule,
  createEqualizerModule,
  type AnalyserModule,
  type EqSettings,
} from '@mss/audio-engine';
import { useSettingsStore } from '@/store/settings-store';

/**
 * Движок живёт на window, а не в переменной модуля: при горячей перезагрузке модуль
 * выполняется заново, и новый движок начинал играть поверх старого, до которого уже не дотянуться.
 */
const holder = window as typeof window & { __mssAudioEngine?: AudioEngine };

export function getAudioEngine(): AudioEngine {
  if (!holder.__mssAudioEngine) {
    const { eqBands, eqEnabled, playbackRate, outputDeviceId } = useSettingsStore.getState();
    const engine = new AudioEngine();
    engine.registerModule(() => createEqualizerModule({ bands: eqBands, enabled: eqEnabled }));
    engine.registerModule(createAnalyserModule);
    engine.setModuleOrder(['equalizer', 'analyser']);
    engine.enableModule('equalizer', true);
    engine.enableModule('analyser', true);
    engine.setPlaybackRate(playbackRate);
    if (outputDeviceId) void engine.setOutputDevice(outputDeviceId);
    holder.__mssAudioEngine = engine;
  }
  return holder.__mssAudioEngine;
}

export function getAnalyser(): AnalyserModule | undefined {
  return getAudioEngine().getModule<AnalyserModule>('analyser');
}

export function applyEqualizer(settings: EqSettings): void {
  getAudioEngine().getModule('equalizer')?.applySettings(settings);
}

export function useAudioEngine(): AudioEngine {
  return getAudioEngine();
}
