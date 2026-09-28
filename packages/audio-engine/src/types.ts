export interface AudioModule {
  id: string;
  displayName: string;
  createNodes(ctx: AudioContext): { input: AudioNode; output: AudioNode };
  applySettings(settings: unknown): void;
  getSettings(): unknown;
  dispose(): void;
}

export type AudioModuleFactory = () => AudioModule;
