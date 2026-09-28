import { eq } from 'drizzle-orm';
import type { TrackAvailability } from '@mss/shared';
import { db } from '../db/client.js';
import { trackHoldings, tracks } from '../db/schema.js';
import { isUserOnline } from './presence.js';

export type TrackRow = typeof tracks.$inferSelect;

export function hasStreamableBytes(t: TrackRow, now = new Date()): boolean {
  if (t.status !== 'ready' || !t.storageKeyMaster) return false;
  if (!t.cacheExpiresAt) return true;
  return t.cacheExpiresAt > now;
}

export async function computeAvailability(t: TrackRow): Promise<TrackAvailability> {
  if (hasStreamableBytes(t)) return 'cached';
  const holders = await db.select({ userId: trackHoldings.userId }).from(trackHoldings).where(eq(trackHoldings.trackId, t.id));
  for (const h of holders) {
    if (await isUserOnline(h.userId)) return 'online';
  }
  return 'unavailable';
}

export async function findOnlineHolder(trackId: string): Promise<string | null> {
  const holders = await db.select({ userId: trackHoldings.userId }).from(trackHoldings).where(eq(trackHoldings.trackId, trackId));
  for (const h of holders) {
    if (await isUserOnline(h.userId)) return h.userId;
  }
  return null;
}
