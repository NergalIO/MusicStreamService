export function leftPrevNearEnd(positionMs: number, durationMs: number): boolean {
  return durationMs > 0 && durationMs - positionMs < 5000 && positionMs * 2 > durationMs;
}

export interface TrackEndWatch {
  armed: boolean;
  endedFor: string | null;
  lastTitle: string;
  lastAd: boolean;
  lastNearEnd: boolean;
  lastOurs: boolean;
}

export interface TrackEndSample {
  playing: boolean;
  ad: boolean;
  title: string;
  trackId: string | null;
  positionMs: number;
  durationMs: number;
}

export function emptyTrackEndWatch(): TrackEndWatch {
  return {
    armed: false,
    endedFor: null,
    lastTitle: '',
    lastAd: false,
    lastNearEnd: false,
    lastOurs: false,
  };
}

export function advanceTrackEnd(
  watch: TrackEndWatch,
  sample: TrackEndSample,
  expectedTrackId: string | null,
  endLeadMs: number,
  seeking = false,
): { watch: TrackEndWatch; emitTrackId: string | null } {
  const ours = !!(
    expectedTrackId &&
    (sample.trackId === expectedTrackId ||
      (!sample.trackId && !!sample.title && sample.title === watch.lastTitle && watch.lastOurs))
  );
  if (seeking) {
    return {
      watch: {
        ...watch,
        armed: false,
        lastTitle: sample.title,
        lastAd: sample.ad,
        lastNearEnd: false,
        lastOurs: ours,
      },
      emitTrackId: null,
    };
  }
  const left = sample.durationMs - sample.positionMs;
  let armed = watch.armed;
  if (ours && sample.durationMs > 0 && left > endLeadMs && sample.playing && !sample.ad) armed = true;

  let emitTrackId: string | null = null;
  let endedFor = watch.endedFor;
  if (armed && !sample.ad && expectedTrackId && endedFor !== expectedTrackId) {
    const near = sample.durationMs > 0 && left <= endLeadMs;
    if (ours && sample.playing && near) emitTrackId = expectedTrackId;
    else if (!ours && watch.lastAd && sample.title && sample.title !== watch.lastTitle) {
      emitTrackId = expectedTrackId;
    } else if (!ours && watch.lastOurs && watch.lastNearEnd) emitTrackId = expectedTrackId;
  }
  if (emitTrackId) endedFor = emitTrackId;

  return {
    watch: {
      armed,
      endedFor,
      lastTitle: sample.title,
      lastAd: sample.ad,
      lastNearEnd: leftPrevNearEnd(sample.positionMs, sample.durationMs),
      lastOurs: ours,
    },
    emitTrackId,
  };
}
