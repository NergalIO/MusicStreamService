import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema } from '@mss/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { refreshTokens, users } from '../db/schema.js';
import { assignPlan } from '../services/subscription.js';

function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const existing = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (existing.length) return reply.conflict('Email taken');
    const passwordHash = await bcrypt.hash(body.password, 10);
    const [user] = await db
      .insert(users)
      .values({ email: body.email, passwordHash })
      .returning();
    await assignPlan(user.id, 'free', 3650, 'register');
    const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '15m' });
    const refresh = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashRefresh(refresh),
      expiresAt: expires,
    });
    return { accessToken, refreshToken: refresh, user: { id: user.id, email: user.email } };
  });

  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.unauthorized('Invalid credentials');
    }
    const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '15m' });
    const refresh = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashRefresh(refresh),
      expiresAt: expires,
    });
    return { accessToken, refreshToken: refresh, user: { id: user.id, email: user.email } };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return reply.badRequest();
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefresh(refreshToken)))
      .limit(1);
    if (!row || row.expiresAt < new Date()) return reply.unauthorized();
    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user) return reply.unauthorized();
    const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '15m' });
    return { accessToken };
  });

  app.post('/auth/logout', async (req, reply) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefresh(refreshToken)));
    }
    return { ok: true };
  });

  if (config.nodeEnv === 'development') {
    app.post('/subscription/dev-activate', async (req, reply) => {
      await app.authenticate(req);
      const { days = 30 } = (req.body as { days?: number }) ?? {};
      await assignPlan(req.userId!, 'premium', days, 'dev');
      return { ok: true };
    });
  }
}
