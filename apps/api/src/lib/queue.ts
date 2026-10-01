import { Queue } from 'bullmq';
import { config } from '../config.js';

export const transcodeQueue = new Queue('track.transcode', {
  connection: { url: config.redisUrl },
});

export interface TranscodeJob {
  trackId: string;
  inputPath?: string;
  originalKey?: string;
  /** Теги из имени файла — на случай, если в самом файле их нет. */
  fallback: { title: string; artist: string };
}
