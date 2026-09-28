import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { tracks } from '../db/schema.js';
import { createRelaySession, getRelaySession, waitRelayUpload } from './relay-sessions.js';
import { findOnlineHolder, hasStreamableBytes } from './track-availability.js';
import { sendToUser } from './presence.js';

const POLL_MS = 1500;
const pendingRelayByTrack = new Map<string, string>();

export async function ensureTrackStreamable(trackId: string): Promise<typeof tracks.$inferSelect | null> {
  const pollUntil = Date.now() + config.relayWaitMs;

  while (Date.now() < pollUntil) {
    const [t] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
    if (!t) return null;
    if (hasStreamableBytes(t)) return t;

    if (t.status === 'processing') {
      await sleep(POLL_MS);
      continue;
    }

    let sessionId = pendingRelayByTrack.get(trackId);
    let session = sessionId ? getRelaySession(sessionId) : undefined;

    if (!session) {
      const holder = await findOnlineHolder(trackId);
      if (!holder) return null;

      const created = createRelaySession(trackId, holder);
      sessionId = created.sessionId;
      session = getRelaySession(sessionId);
      pendingRelayByTrack.set(trackId, sessionId);
      const uploadUrl = `${config.publicUrl}/relay/${sessionId}`;
      const sent = sendToUser(holder, {
        type: 'relay_upload',
        sessionId,
        trackId,
        title: `${t.artist} — ${t.title}`,
        uploadUrl,
        token: created.token,
      });
      if (!sent) {
        pendingRelayByTrack.delete(trackId);
        await sleep(POLL_MS);
        continue;
      }
    }

    const remaining = pollUntil - Date.now();
    try {
      await waitRelayUpload(sessionId!, Math.max(remaining, 5000));
      pendingRelayByTrack.delete(trackId);
    } catch {
      await sleep(POLL_MS);
      continue;
    }
    await sleep(POLL_MS);
  }
  pendingRelayByTrack.delete(trackId);

  const [final] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
  return final && hasStreamableBytes(final) ? final : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
