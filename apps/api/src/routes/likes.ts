import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { trackLikes, tracks } from '../db/schema.js';
import { toTrackDtoWithAvailability } from './tracks.js';

const CATALOG_STATUSES = ['ready', 'registered', 'cached', 'processing'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function likeRoutes(app: FastifyInstance) {
  app.get('/me/likes', async (req) => {
    await app.authenticate(req);
    const rows = await db
      .select({ track: tracks, likedAt: trackLikes.createdAt })
      .from(trackLikes)
      .innerJoin(tracks, eq(tracks.id, trackLikes.trackId))
      .where(and(eq(trackLikes.userId, req.userId!), inArray(tracks.status, [...CATALOG_STATUSES])))
      .orderBy(desc(trackLikes.createdAt));
    const items = await Promise.all(
      rows.map(async (r) => ({ ...(await toTrackDtoWithAvailability(r.track)), likedAt: r.likedAt })),
    );
    return { items };
  });

  app.post('/tracks/:id/like', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.badRequest('Invalid track id');
    const [track] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!track) return reply.notFound('Track not found');
    await db.insert(trackLikes).values({ userId: req.userId!, trackId: id }).onConflictDoNothing();
    return reply.code(204).send();
  });

  app.delete('/tracks/:id/like', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.badRequest('Invalid track id');
    await db.delete(trackLikes).where(and(eq(trackLikes.userId, req.userId!), eq(trackLikes.trackId, id)));
    return reply.code(204).send();
  });
}
