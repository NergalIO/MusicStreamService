import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { tracks } from '../db/schema.js';
import { toTrackDtoWithAvailability } from './tracks.js';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function artistRoutes(app: FastifyInstance) {
  app.get('/artists', async (req) => {
    const query = req.query as { query?: string; limit?: string };
    const q = (query.query ?? '').trim();
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const trackCount = sql<number>`count(*)::int`;

    const rows = await db
      .select({ name: tracks.artist, trackCount })
      .from(tracks)
      .where(
        q
          ? and(eq(tracks.status, 'ready'), ilike(tracks.artist, `%${escapeLike(q)}%`))
          : eq(tracks.status, 'ready'),
      )
      .groupBy(tracks.artist)
      .orderBy(desc(trackCount), asc(tracks.artist))
      .limit(limit);

    return { items: rows };
  });

  app.get('/artists/:name/tracks', async (req) => {
    const { name } = req.params as { name: string };
    const query = req.query as { limit?: string };
    const limit = Math.min(Number(query.limit ?? 500), 1000);

    const rows = await db
      .select()
      .from(tracks)
      .where(and(eq(tracks.status, 'ready'), ilike(tracks.artist, `%${escapeLike(name.trim())}%`)))
      .orderBy(asc(tracks.album), asc(tracks.title))
      .limit(limit);

    const items = await Promise.all(rows.map((r) => toTrackDtoWithAvailability(r)));
    return { items };
  });
}
