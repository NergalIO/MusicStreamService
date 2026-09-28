import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { tracks } from '../db/schema.js';
import { markRelayUploadDone, verifyRelayToken } from '../lib/relay-sessions.js';
import { transcodeQueue, type TranscodeJob } from '../lib/queue.js';
import { tagsFromFilename } from './tracks.js';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.wma', '.aif', '.aiff', '.ape', '.wv', '.webm']);

export async function relayRoutes(app: FastifyInstance) {
  app.post('/relay/:sessionId', async (req, reply) => {
    await app.authenticate(req);
    const { sessionId } = req.params as { sessionId: string };
    const relayToken = (req.headers['x-relay-token'] as string) ?? '';
    const session = verifyRelayToken(sessionId, relayToken);
    if (!session) return reply.unauthorized('Invalid relay session');
    if (session.holderUserId !== req.userId) return reply.forbidden('Not the designated holder');

    const [t] = await db.select().from(tracks).where(eq(tracks.id, session.trackId)).limit(1);
    if (!t) return reply.notFound();

    const data = await req.file({ limits: { fileSize: 500 * 1024 * 1024 } });
    if (!data) return reply.badRequest('Нет файла');
    const originalFilename = path.basename(data.filename);
    const ext = path.extname(originalFilename).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext) && !data.mimetype.startsWith('audio/')) {
      data.file.resume();
      return reply.badRequest('Не аудиофайл');
    }

    await fs.mkdir(config.uploadTmpDir, { recursive: true });
    const tmpPath = path.join(config.uploadTmpDir, `relay-${sessionId}${ext || '.bin'}`);
    await pipeline(data.file, createWriteStream(tmpPath));
    if (data.file.truncated) {
      await fs.rm(tmpPath, { force: true });
      return reply.code(413).send('Файл больше 500 МБ');
    }

    const cacheExpiresAt = new Date(Date.now() + config.relayCacheTtlHours * 3600_000);
    await db
      .update(tracks)
      .set({ status: 'processing', cacheExpiresAt })
      .where(eq(tracks.id, session.trackId));

    const fallback = tagsFromFilename(originalFilename);
    await transcodeQueue.add('transcode', {
      trackId: session.trackId,
      inputPath: tmpPath,
      fallback: { title: t.title || fallback.title, artist: t.artist || fallback.artist },
    } satisfies TranscodeJob);

    markRelayUploadDone(sessionId);
    return reply.code(202).send({ ok: true, trackId: session.trackId });
  });
}
