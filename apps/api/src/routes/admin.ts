import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, emailVerificationRequired, smtpConfigured } from '../config.js';
import { db } from '../db/client.js';
import {
  albums,
  playlists,
  refreshTokens,
  tracks,
  users,
} from '../db/schema.js';
import { listLogs, pushLog } from '../lib/log-ring.js';
import { sendTestMail } from '../lib/mail.js';
import { transcodeQueue } from '../lib/queue.js';
import { assignPlan, getActiveSubscription } from '../services/subscription.js';

const execFileAsync = promisify(execFile);
const startedAt = Date.now();

const patchUserSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  emailVerified: z.boolean().optional(),
  password: z.string().min(8).optional(),
  plan: z.enum(['free', 'premium']).optional(),
  planDays: z.number().int().min(1).max(3650).optional(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['user', 'admin']).default('user'),
});

function pageParams(query: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(query.limit) || 40, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  return { limit, offset, q };
}

async function adminCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
  return Number(row?.n ?? 0);
}

async function dirBytes(dir: string): Promise<number | null> {
  try {
    await fs.access(dir);
  } catch {
    return null;
  }
  try {
    const { stdout } = await execFileAsync('du', ['-sb', dir], { timeout: 8_000 });
    const n = Number(String(stdout).split(/\s+/)[0]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    await app.requireAdmin(req);
  });

  app.addHook('onResponse', (req, reply, done) => {
    if (req.method !== 'GET') {
      pushLog(
        reply.statusCode >= 400 ? 'warn' : 'info',
        `admin ${req.method} ${req.url} ${reply.statusCode} by ${req.userId ?? '?'}`,
      );
    }
    done();
  });

  app.get('/admin/me', async (req) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!user) throw app.httpErrors.unauthorized();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };
  });

  app.get('/admin/overview', async () => {
    const [userRow] = await db.select({ n: count() }).from(users);
    const [verifiedRow] = await db
      .select({ n: count() })
      .from(users)
      .where(sql`${users.emailVerifiedAt} is not null`);
    const [trackRow] = await db.select({ n: count() }).from(tracks);
    const [albumRow] = await db.select({ n: count() }).from(albums);
    const [playlistRow] = await db.select({ n: count() }).from(playlists);
    let queue: Record<string, number> | null = null;
    let redisOk = false;
    try {
      queue = await transcodeQueue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed');
      redisOk = true;
    } catch {
      redisOk = false;
    }
    let dbOk = true;
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbOk = false;
    }
    return {
      version: config.appVersion,
      nodeEnv: config.nodeEnv,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      users: Number(userRow?.n ?? 0),
      verifiedUsers: Number(verifiedRow?.n ?? 0),
      tracks: Number(trackRow?.n ?? 0),
      albums: Number(albumRow?.n ?? 0),
      playlists: Number(playlistRow?.n ?? 0),
      dbOk,
      redisOk,
      queue,
      smtp: smtpConfigured(),
      emailVerificationRequired: emailVerificationRequired(),
      storageBackend: config.storageBackend,
      storageBytes: await dirBytes(config.localStoragePath),
    };
  });

  app.get('/admin/config', async () => ({
    version: config.appVersion,
    nodeEnv: config.nodeEnv,
    publicUrl: config.publicUrl,
    basePath: config.basePath || '/',
    storageBackend: config.storageBackend,
    smtp: {
      configured: smtpConfigured(),
      host: config.smtp.host || null,
      port: config.smtp.port,
      secure: config.smtp.secure,
      user: config.smtp.user || null,
      from: config.smtp.from,
    },
    emailVerificationRequired: emailVerificationRequired(),
    emailVerificationTtlMin: config.emailVerificationTtlMin,
    relayCacheTtlHours: config.relayCacheTtlHours,
    presenceTtlSec: config.presenceTtlSec,
  }));

  app.post('/admin/mail-test', async (req, reply) => {
    const body = z.object({ to: z.string().email().optional() }).parse(req.body ?? {});
    const [me] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    const to = body.to || me?.email;
    if (!to) return reply.badRequest('Укажите адрес');
    try {
      await sendTestMail(to);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'SMTP error';
      return reply.code(503).send({ error: 'Service Unavailable', message });
    }
    return { ok: true, to };
  });

  app.get('/admin/logs', async (req) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit) || 200, 1), 400);
    return { items: listLogs(limit) };
  });

  app.get('/admin/users', async (req) => {
    const { limit, offset, q } = pageParams(req.query as Record<string, unknown>);
    const where = q ? ilike(users.email, `%${q}%`) : sql`true`;
    const [totalRow] = await db.select({ n: count() }).from(users).where(where);
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
    const items = await Promise.all(
      rows.map(async (u) => ({
        ...u,
        emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        subscription: await getActiveSubscription(u.id),
      })),
    );
    return { total: Number(totalRow?.n ?? 0), items };
  });

  app.post('/admin/users', async (req, reply) => {
    const body = createUserSchema.parse(req.body);
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (exists) return reply.conflict('Этот email уже зарегистрирован');
    const passwordHash = await bcrypt.hash(body.password, 10);
    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        passwordHash,
        role: body.role,
        emailVerifiedAt: new Date(),
      })
      .returning();
    await assignPlan(user.id, body.role === 'admin' ? 'premium' : 'free', 3650, 'admin');
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  });

  app.patch('/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = patchUserSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return reply.notFound('User not found');
    if (user.role === 'admin' && body.role === 'user') {
      if ((await adminCount()) <= 1) {
        return reply.badRequest('Нельзя снять роль с последнего администратора');
      }
    }
    const patch: {
      role?: string;
      emailVerifiedAt?: Date | null;
      passwordHash?: string;
    } = {};
    if (body.role) patch.role = body.role;
    if (body.emailVerified === true) patch.emailVerifiedAt = new Date();
    if (body.emailVerified === false) patch.emailVerifiedAt = null;
    if (body.password) {
      patch.passwordHash = await bcrypt.hash(body.password, 10);
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));
    }
    if (Object.keys(patch).length) {
      await db.update(users).set(patch).where(eq(users.id, id));
    }
    if (body.plan) {
      await assignPlan(id, body.plan, body.planDays ?? 365, 'admin');
    }
    const [updated] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      emailVerifiedAt: updated.emailVerifiedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      subscription: await getActiveSubscription(updated.id),
    };
  });

  app.delete('/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.userId) return reply.badRequest('Нельзя удалить свой аккаунт');
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return reply.notFound('User not found');
    if (user.role === 'admin' && (await adminCount()) <= 1) {
      return reply.badRequest('Нельзя удалить последнего администратора');
    }
    await db.delete(users).where(eq(users.id, id));
    return { ok: true };
  });

  app.get('/admin/tracks', async (req) => {
    const { limit, offset, q } = pageParams(req.query as Record<string, unknown>);
    const where = q
      ? or(ilike(tracks.title, `%${q}%`), ilike(tracks.artist, `%${q}%`))
      : sql`true`;
    const [totalRow] = await db.select({ n: count() }).from(tracks).where(where);
    const items = await db
      .select({
        id: tracks.id,
        title: tracks.title,
        artist: tracks.artist,
        album: tracks.album,
        status: tracks.status,
        durationMs: tracks.durationMs,
        createdAt: tracks.createdAt,
        uploadedBy: tracks.uploadedBy,
      })
      .from(tracks)
      .where(where)
      .orderBy(desc(tracks.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      total: Number(totalRow?.n ?? 0),
      items: items.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    };
  });

  app.delete('/admin/tracks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!row) return reply.notFound('Track not found');
    await db.delete(tracks).where(eq(tracks.id, id));
    return { ok: true };
  });

  app.get('/admin/albums', async (req) => {
    const { limit, offset, q } = pageParams(req.query as Record<string, unknown>);
    const where = q ? or(ilike(albums.title, `%${q}%`), ilike(albums.artist, `%${q}%`)) : sql`true`;
    const [totalRow] = await db.select({ n: count() }).from(albums).where(where);
    const items = await db
      .select({
        id: albums.id,
        title: albums.title,
        artist: albums.artist,
        year: albums.year,
        userId: albums.userId,
        createdAt: albums.createdAt,
      })
      .from(albums)
      .where(where)
      .orderBy(desc(albums.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      total: Number(totalRow?.n ?? 0),
      items: items.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
  });

  app.delete('/admin/albums/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select({ id: albums.id }).from(albums).where(eq(albums.id, id)).limit(1);
    if (!row) return reply.notFound('Album not found');
    await db.delete(albums).where(eq(albums.id, id));
    return { ok: true };
  });

  app.get('/admin/queue', async () => {
    try {
      const counts = await transcodeQueue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed');
      return { ok: true, counts };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Redis недоступен', counts: null };
    }
  });
}