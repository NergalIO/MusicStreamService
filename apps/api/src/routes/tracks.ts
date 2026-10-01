import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { deriveContentKey, encodeMssPackage } from '@mss/mss-format';
import { registerTrackSchema, updateTrackSchema } from '@mss/shared';
import type { TrackAvailability } from '@mss/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { trackHoldings, tracks } from '../db/schema.js';
import { deleteObject, getObjectFull, getObjectRange, headObject, presignGet, presignPut, putObject, CLOUD_GET_TTL_SEC } from '../lib/storage.js';
import { detectLyricsFormat, formatFromKey, lyricsObjectKey, LYRICS_MAX_BYTES, parseLyricsFile, type LyricsFormat } from '../lib/lyrics.js';
import { transcodeQueue, type TranscodeJob } from '../lib/queue.js';
import { getActiveSubscription } from '../services/subscription.js';
import { appendToPlaylist, findOwnPlaylist } from './playlists.js';
import { computeAvailability, hasStreamableBytes } from '../lib/track-availability.js';
import { ensureTrackStreamable } from '../lib/ensure-stream.js';

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.wma',
  '.aif',
  '.aiff',
  '.ape',
  '.wv',
  '.webm',
]);

const CATALOG_STATUSES = ['ready', 'registered', 'cached'] as const;

/** «Исполнитель - Название.mp3» → теги; без разделителя всё имя становится названием. */
export function tagsFromFilename(filename: string): { title: string; artist: string } {
  const base = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const match = /^(?:\d{1,3}[.\s-]+)?(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { title: base || 'Без названия', artist: 'Неизвестный исполнитель' };
}

export type TrackRow = typeof tracks.$inferSelect;

export async function toTrackDto(t: TrackRow, availability?: TrackAvailability, opts?: { userHolds?: boolean }) {
  const avail =
    availability ??
    (hasStreamableBytes(t) ? 'cached' : t.status === 'registered' || t.status === 'cached' ? 'unavailable' : 'unavailable');
  const canStream = avail === 'cached' || avail === 'online';
  const cloud = await cloudUrls(t, canStream);
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    durationMs: t.durationMs,
    loudnessLufs: t.loudnessLufs !== null && t.loudnessLufs > -70 ? t.loudnessLufs : null,
    status: t.status,
    codec: t.codec,
    contentHash: t.contentHash,
    availability: avail,
    ...(opts?.userHolds ? { userHolds: true as const } : {}),
    coverUrl: t.coverStorageKey
      ? `${config.publicUrl}/covers/${t.id}?v=${encodeURIComponent(t.coverStorageKey.split('/').pop()!.replace(/\.[^.]+$/, ''))}`
      : null,
    streamUrl: canStream ? `${config.publicUrl}/stream/${t.id}` : null,
    hasLyrics: !!t.storageKeyLyrics,
    ...cloud,
  };
}

async function cloudUrls(t: TrackRow, canStream: boolean) {
  const expiresAt = new Date(Date.now() + CLOUD_GET_TTL_SEC * 1000).toISOString();
  let cloudPlayUrl: string | null = null;
  let cloudDownloadUrl: string | null = null;
  if (canStream && t.storageKeyMaster) {
    cloudPlayUrl = await presignGet(config.minio.bucketTracks, t.storageKeyMaster, {
      contentType: t.mimeType ?? 'audio/ogg',
    }).catch(() => null);
  }
  const downloadKey = t.storageKeyOriginal ?? t.storageKeyMaster;
  if (downloadKey) {
    const name = t.originalFilename?.replace(/[\r\n"]/g, '') || `${t.id}.ogg`;
    cloudDownloadUrl = await presignGet(config.minio.bucketTracks, downloadKey, {
      contentDisposition: `attachment; filename="${name}"`,
    }).catch(() => null);
  }
  if (!cloudPlayUrl && !cloudDownloadUrl) {
    return { cloudPlayUrl: null, cloudDownloadUrl: null, cloudUrlExpiresAt: null as string | null };
  }
  return { cloudPlayUrl, cloudDownloadUrl, cloudUrlExpiresAt: expiresAt };
}

export async function toTrackDtoWithAvailability(t: TrackRow) {
  return toTrackDto(t, await computeAvailability(t));
}

async function userOwnsTrack(userId: string, trackId: string): Promise<boolean> {
  const [h] = await db
    .select()
    .from(trackHoldings)
    .where(and(eq(trackHoldings.userId, userId), eq(trackHoldings.trackId, trackId)))
    .limit(1);
  if (h) return true;
  const [t] = await db.select({ uploadedBy: tracks.uploadedBy }).from(tracks).where(eq(tracks.id, trackId)).limit(1);
  return t?.uploadedBy === userId;
}

export async function heldTrackIdsForUser(userId: string, trackIds: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  if (!trackIds.length) return held;
  const fromHoldings = await db
    .select({ trackId: trackHoldings.trackId })
    .from(trackHoldings)
    .where(and(eq(trackHoldings.userId, userId), inArray(trackHoldings.trackId, trackIds)));
  for (const row of fromHoldings) held.add(row.trackId);
  const fromUploads = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.uploadedBy, userId), inArray(tracks.id, trackIds)));
  for (const row of fromUploads) held.add(row.id);
  return held;
}

function catalogWhere(q: string) {
  const statusFilter = inArray(tracks.status, [...CATALOG_STATUSES]);
  const trimmed = q.trim();
  if (!trimmed) return statusFilter;
  return and(
    statusFilter,
    or(
      ilike(tracks.title, `%${trimmed}%`),
      ilike(tracks.artist, `%${trimmed}%`),
      ilike(tracks.album, `%${trimmed}%`),
    ),
  );
}

export async function trackRoutes(app: FastifyInstance) {
  app.get('/tracks', async (req) => {
    await app.authenticateOptional(req);
    const query = req.query as { query?: string; limit?: string; offset?: string };
    const limit = Math.min(Number(query.limit ?? 50), 100);
    const offset = Number(query.offset ?? 0);
    const rows = await db
      .select()
      .from(tracks)
      .where(catalogWhere(query.query ?? ''))
      .orderBy(desc(tracks.createdAt))
      .limit(limit)
      .offset(offset);
    const heldIds = req.userId ? await heldTrackIdsForUser(req.userId, rows.map((r) => r.id)) : new Set<string>();
    const items = await Promise.all(
      rows.map(async (r) => {
        const avail = await computeAvailability(r);
        return await toTrackDto(r, avail, { userHolds: heldIds.has(r.id) });
      }),
    );
    return { items };
  });

  app.get('/tracks/:id/offline-package', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const deviceId = (req.headers['x-device-id'] as string) ?? '';
    if (!deviceId) return reply.badRequest('X-Device-Id required');

    const sub = await getActiveSubscription(req.userId!);
    if (!sub?.features.offline_enabled) {
      return reply.forbidden('Offline requires Premium');
    }

    const t = await ensureTrackStreamable(id);
    if (!t?.storageKeyMaster) return reply.code(503).send({ message: 'Трек недоступен — нет активных источников' });

    const payload = await getObjectFull(config.minio.bucketTracks, t.storageKeyMaster);
    const contentKey = deriveContentKey(req.userId!, deviceId, id, config.offlineHkdfSecret);
    const mss = encodeMssPackage(id, deviceId, payload, contentKey, config.offlineHkdfSecret);

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${id}.mss"`);
    return reply.send(mss);
  });

  app.get('/tracks/:id', async (req, reply) => {
    await app.authenticateOptional(req);
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    const avail = await computeAvailability(t);
    const userHolds = req.userId ? (await heldTrackIdsForUser(req.userId, [id])).has(id) : false;
    return await toTrackDto(t, avail, { userHolds });
  });

  app.post('/tracks/register', async (req, reply) => {
    await app.authenticate(req);
    const { playlistId } = req.query as { playlistId?: string };
    if (playlistId && !(await findOwnPlaylist(playlistId, req.userId!))) return reply.notFound('Плейлист не найден');

    const body = registerTrackSchema.parse(req.body);
    const hash = body.contentHash.toLowerCase();

    const [existing] = await db.select().from(tracks).where(eq(tracks.contentHash, hash)).limit(1);
    const deduped = !!existing;
    let trackId: string;
    let row: TrackRow;

    if (existing) {
      trackId = existing.id;
      row = existing;
      await db
        .insert(trackHoldings)
        .values({ userId: req.userId!, trackId })
        .onConflictDoNothing();
    } else {
      trackId = uuidv4();
      [row] = await db
        .insert(tracks)
        .values({
          id: trackId,
          title: body.title,
          artist: body.artist,
          album: body.album ?? null,
          durationMs: body.durationMs ?? null,
          sizeBytes: body.sizeBytes,
          contentHash: hash,
          status: 'registered',
          uploadedBy: req.userId,
          originalFilename: body.originalFilename,
          loudnessLufs: body.loudnessLufs ?? null,
        })
        .returning();
      await db.insert(trackHoldings).values({ userId: req.userId!, trackId });
    }

    if (playlistId) await appendToPlaylist(playlistId, trackId);
    const dto = await toTrackDtoWithAvailability(row);
    return reply.code(deduped ? 200 : 201).send(dto);
  });

  app.post('/tracks/:id/cloud-upload', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    if (!(await userOwnsTrack(req.userId!, id))) return reply.forbidden();

    if (hasStreamableBytes(t) && t.storageKeyMaster) {
      return { skipUpload: true, alreadyReady: true, ...(await toTrackDtoWithAvailability(t)) };
    }
    const originalKey = t.storageKeyOriginal ?? `tracks/${id}/original`;
    const existingOriginal = await headObject(config.minio.bucketTracks, originalKey).catch(() => null);
    if (existingOriginal && existingOriginal.size > 0) {
      return { skipUpload: true, alreadyReady: false, ...(await toTrackDtoWithAvailability(t)) };
    }

    const body = (req.body ?? {}) as { contentType?: string };
    const contentType = body.contentType?.trim() || 'application/octet-stream';
    const uploadUrl = await presignPut(config.minio.bucketTracks, originalKey, contentType);
    await db.update(tracks).set({ status: 'uploading', storageKeyOriginal: originalKey }).where(eq(tracks.id, id));
    return {
      skipUpload: false,
      alreadyReady: false,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': contentType },
      key: originalKey,
    };
  });

  app.post('/tracks/:id/cloud-complete', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    if (!(await userOwnsTrack(req.userId!, id))) return reply.forbidden();
    const originalKey = t.storageKeyOriginal ?? `tracks/${id}/original`;
    const head = await headObject(config.minio.bucketTracks, originalKey).catch(() => null);
    if (!head || head.size <= 0) return reply.badRequest('Файл в облаке не найден — повторите загрузку');

    await db
      .update(tracks)
      .set({
        status: 'processing',
        storageKeyOriginal: originalKey,
        sizeBytes: head.size,
        cacheExpiresAt: null,
      })
      .where(eq(tracks.id, id));

    const fallback = tagsFromFilename(t.originalFilename || `${t.artist} - ${t.title}`);
    await transcodeQueue.add('transcode', {
      trackId: id,
      originalKey,
      fallback: { title: t.title || fallback.title, artist: t.artist || fallback.artist },
    } satisfies TranscodeJob);
    const [updated] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    return reply.code(202).send(await toTrackDtoWithAvailability(updated ?? t));
  });

  app.get('/tracks/:id/download', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    const key = t.storageKeyOriginal ?? t.storageKeyMaster;
    if (!key) return reply.code(503).send({ message: 'Файл ещё не в облаке' });
    const name = t.originalFilename?.replace(/[\r\n"]/g, '') || `${id}.ogg`;
    const url = await presignGet(config.minio.bucketTracks, key, {
      contentDisposition: `attachment; filename="${name}"`,
    });
    const accept = String(req.headers.accept ?? '');
    if (accept.includes('application/json')) return { url };
    return reply.redirect(url);
  });

  app.post('/tracks', async (req, reply) => {
    if (!config.allowServerUpload) {
      return reply.code(410).send({ message: 'Загрузка файлов на сервер отключена — используйте POST /tracks/register' });
    }
    await app.authenticate(req);
    const { playlistId } = req.query as { playlistId?: string };
    if (playlistId && !(await findOwnPlaylist(playlistId, req.userId!))) return reply.notFound('Плейлист не найден');

    const data = await req.file();
    if (!data) return reply.badRequest('Нет файла');
    const originalFilename = path.basename(data.filename);
    const ext = path.extname(originalFilename).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext) && !data.mimetype.startsWith('audio/')) {
      data.file.resume();
      return reply.badRequest(`«${originalFilename}» — не аудиофайл`);
    }

    const trackId = uuidv4();
    await fs.mkdir(config.uploadTmpDir, { recursive: true });
    const tmpPath = path.join(config.uploadTmpDir, `${trackId}${ext || '.bin'}`);
    await pipeline(data.file, createWriteStream(tmpPath));
    if (data.file.truncated) {
      await fs.rm(tmpPath, { force: true });
      return reply.code(413).send('Файл больше 500 МБ');
    }

    const fallback = tagsFromFilename(originalFilename);
    const [row] = await db
      .insert(tracks)
      .values({
        id: trackId,
        title: fallback.title,
        artist: fallback.artist,
        status: 'processing',
        uploadedBy: req.userId,
        originalFilename,
      })
      .returning();
    await db.insert(trackHoldings).values({ userId: req.userId!, trackId });

    if (playlistId) await appendToPlaylist(playlistId, trackId);
    await transcodeQueue.add('transcode', { trackId, inputPath: tmpPath, fallback } satisfies TranscodeJob);
    return reply.code(202).send(await toTrackDtoWithAvailability(row));
  });

  app.get('/me/uploads', async (req) => {
    await app.authenticate(req);
    const held = await db
      .select({ track: tracks })
      .from(trackHoldings)
      .innerJoin(tracks, eq(trackHoldings.trackId, tracks.id))
      .where(eq(trackHoldings.userId, req.userId!))
      .orderBy(desc(tracks.createdAt));
    const items = await Promise.all(held.map((r) => toTrackDtoWithAvailability(r.track)));
    return { items };
  });

  app.patch('/tracks/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const body = updateTrackSchema.parse(req.body);
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    if (!(await userOwnsTrack(req.userId!, id))) return reply.forbidden('Изменять можно только свои треки');
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length) return toTrackDtoWithAvailability(t);
    const [updated] = await db.update(tracks).set(patch).where(eq(tracks.id, id)).returning();
    return toTrackDtoWithAvailability(updated);
  });

  app.put('/tracks/:id/cover', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    if (!(await userOwnsTrack(req.userId!, id))) return reply.forbidden('Изменять можно только свои треки');
    const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!data) return reply.badRequest('Нет файла');
    if (data.mimetype !== 'image/jpeg') {
      data.file.resume();
      return reply.badRequest('Обложка должна быть в JPEG');
    }
    const body = await data.toBuffer().catch(() => null);
    if (!body || data.file.truncated) return reply.code(413).send({ message: 'Обложка больше 10 МБ' });
    const key = `tracks/${id}/${uuidv4()}.jpg`;
    await putObject(config.minio.bucketCovers, key, body, 'image/jpeg');
    const [updated] = await db.update(tracks).set({ coverStorageKey: key }).where(eq(tracks.id, id)).returning();
    if (t.coverStorageKey) await deleteObject(config.minio.bucketCovers, t.coverStorageKey).catch(() => undefined);
    return toTrackDtoWithAvailability(updated);
  });

  app.put('/tracks/:id/lyrics', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    if (!(await userOwnsTrack(req.userId!, id))) return reply.forbidden('Текст можно загрузить только к своим трекам');
    const body = (req.body ?? {}) as { format?: string; text?: string };
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return reply.badRequest('Пустой текст');
    if (Buffer.byteLength(text, 'utf8') > LYRICS_MAX_BYTES) {
      return reply.code(413).send({ message: 'Текст больше 512 КБ' });
    }
    const format: LyricsFormat =
      body.format === 'lrc' || body.format === 'txt' ? body.format : detectLyricsFormat(text);
    const parsed = parseLyricsFile(format, text);
    if (!parsed) return reply.badRequest('Не удалось разобрать текст');
    const key = lyricsObjectKey(id, format);
    await putObject(config.minio.bucketTracks, key, Buffer.from(text, 'utf8'), 'text/plain; charset=utf-8');
    if (t.storageKeyLyrics && t.storageKeyLyrics !== key) {
      await deleteObject(config.minio.bucketTracks, t.storageKeyLyrics).catch(() => undefined);
    }
    const [updated] = await db.update(tracks).set({ storageKeyLyrics: key }).where(eq(tracks.id, id)).returning();
    return toTrackDtoWithAvailability(updated ?? t);
  });

  app.get('/tracks/:id/lyrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t?.storageKeyLyrics) return reply.notFound();
    const raw = await getObjectFull(config.minio.bucketTracks, t.storageKeyLyrics).catch(() => null);
    if (!raw?.length) return reply.notFound();
    const parsed = parseLyricsFile(formatFromKey(t.storageKeyLyrics), raw.toString('utf8'));
    if (!parsed) return reply.notFound();
    return parsed;
  });

  app.delete('/tracks/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t) return reply.notFound();
    if (!(await userOwnsTrack(req.userId!, id))) return reply.forbidden('Удалять можно только свои треки');

    await db.delete(trackHoldings).where(and(eq(trackHoldings.userId, req.userId!), eq(trackHoldings.trackId, id)));

    const remaining = await db.select().from(trackHoldings).where(eq(trackHoldings.trackId, id)).limit(1);
    const isEphemeral = t.cacheExpiresAt !== null;
    if (!remaining.length && (t.status === 'registered' || t.status === 'uploading' || isEphemeral)) {
      await db.delete(tracks).where(eq(tracks.id, id));
      await Promise.all([
        t.storageKeyMaster && deleteObject(config.minio.bucketTracks, t.storageKeyMaster),
        t.storageKeyOriginal && deleteObject(config.minio.bucketTracks, t.storageKeyOriginal),
        t.storageKeyLyrics && deleteObject(config.minio.bucketTracks, t.storageKeyLyrics),
        t.coverStorageKey && deleteObject(config.minio.bucketCovers, t.coverStorageKey),
      ]).catch((e) => req.log.warn({ err: e, trackId: id }, 'failed to delete track objects'));
    }
    return reply.code(204).send();
  });

  app.get('/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await ensureTrackStreamable(id);
    if (!t?.storageKeyMaster) {
      return reply.code(503).send({ message: 'Трек недоступен — нет активных источников' });
    }

    const head = await headObject(config.minio.bucketTracks, t.storageKeyMaster).catch(() => null);
    if (!head) return reply.code(503).send({ message: 'Файл потока не найден' });
    const total = head.size;
    const mime = t.mimeType ?? head.contentType ?? 'audio/ogg';
    const range = req.headers.range;
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', mime);

    const sendRange = async (start: number, end: number, status: 200 | 206) => {
      const { body, contentLength, totalSize } = await getObjectRange(
        config.minio.bucketTracks,
        t.storageKeyMaster!,
        start,
        end,
      );
      if (status === 206) {
        reply.code(206).header('Content-Range', `bytes ${start}-${end}/${totalSize || total}`);
      }
      reply.header('Content-Length', contentLength);
      return reply.send(Readable.from(body));
    };

    if (!range) {
      return sendRange(0, Math.max(0, total - 1), 200);
    }
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) return reply.code(416).send();
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : total - 1;
    if (start >= total || end < start) return reply.code(416).send();
    return sendRange(start, Math.min(end, total - 1), 206);
  });

  app.get('/covers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [t] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!t?.coverStorageKey) return reply.notFound();
    const buf = await getObjectFull(config.minio.bucketCovers, t.coverStorageKey);
    return reply.type('image/jpeg').send(buf);
  });
}
