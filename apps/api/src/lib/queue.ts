import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from '../config.js';

/** BullMQ требует maxRetriesPerRequest: null, иначе воркер не забирает джобы. */
export const bullmqConnection: ConnectionOptions = {
  url: config.redisUrl,
  maxRetriesPerRequest: null,
};

export const transcodeQueue = new Queue('track.transcode', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 8_000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export interface TranscodeJob {
  trackId: string;
  inputPath?: string;
  originalKey?: string;
  /** Теги из имени файла — на случай, если в самом файле их нет. */
  fallback: { title: string; artist: string };
}

export function transcodeJobId(trackId: string): string {
  return `transcode-${trackId}`;
}

export async function enqueueTranscode(data: TranscodeJob): Promise<void> {
  const jobId = transcodeJobId(data.trackId);
  const existing = await transcodeQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') return;
    await existing.remove().catch(() => undefined);
  }
  await transcodeQueue.add('transcode', data, { jobId });
}
