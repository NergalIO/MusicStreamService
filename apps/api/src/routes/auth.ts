import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema, resendVerificationSchema, verifyEmailSchema } from '@mss/shared';
import { config, emailVerificationRequired, smtpConfigured } from '../config.js';
import { db } from '../db/client.js';
import { refreshTokens, users } from '../db/schema.js';
import { issueAndSendVerificationCode, verifyEmailCode } from '../services/email-verification.js';
import { assignPlan } from '../services/subscription.js';

function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(app: FastifyInstance, user: { id: string; email: string; role: string }) {
  const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '15m' });
  const refresh = randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefresh(refresh),
    expiresAt: expires,
  });
  return {
    accessToken,
    refreshToken: refresh,
    user: { id: user.id, email: user.email },
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const existing = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (existing.length) return reply.conflict('Email taken');
    if (emailVerificationRequired() && config.nodeEnv === 'production' && !smtpConfigured()) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'SMTP не настроен на сервере — регистрация временно недоступна',
      });
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    const verifiedNow = !emailVerificationRequired();
    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        passwordHash,
        emailVerifiedAt: verifiedNow ? new Date() : null,
      })
      .returning();
    await assignPlan(user.id, 'free', 3650, 'register');
    if (verifiedNow) {
      return createSession(app, user);
    }
    try {
      await issueAndSendVerificationCode(user.id, user.email);
    } catch (e) {
      if (e instanceof Error && e.message === 'RESEND_TOO_SOON') {
        return reply.code(429).send({ error: 'Too Many Requests', message: 'Подождите минуту перед повторной отправкой' });
      }
      throw e;
    }
    return { needsVerification: true as const, email: user.email };
  });

  app.post('/auth/verify-email', async (req, reply) => {
    const body = verifyEmailSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user) return reply.notFound('User not found');
    if (user.emailVerifiedAt) {
      return createSession(app, user);
    }
    const result = await verifyEmailCode(user.id, body.code);
    if (result === 'invalid') {
      return reply.badRequest('Неверный код');
    }
    if (result === 'expired') {
      return reply.badRequest('Код истёк — запросите новый');
    }
    if (result === 'too_many_attempts') {
      return reply.code(429).send({ error: 'Too Many Requests', message: 'Слишком много попыток — запросите новый код' });
    }
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    return createSession(app, user);
  });

  app.post('/auth/resend-verification', async (req, reply) => {
    const body = resendVerificationSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.unauthorized('Invalid credentials');
    }
    if (user.emailVerifiedAt) {
      return reply.badRequest('Email already verified');
    }
    if (!emailVerificationRequired()) {
      return reply.badRequest('Подтверждение email отключено на сервере');
    }
    if (config.nodeEnv === 'production' && !smtpConfigured()) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'SMTP не настроен на сервере',
      });
    }
    try {
      await issueAndSendVerificationCode(user.id, user.email);
    } catch (e) {
      if (e instanceof Error && e.message === 'RESEND_TOO_SOON') {
        return reply.code(429).send({ error: 'Too Many Requests', message: 'Подождите минуту перед повторной отправкой' });
      }
      throw e;
    }
    return { ok: true };
  });

  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.unauthorized('Invalid credentials');
    }
    if (emailVerificationRequired() && !user.emailVerifiedAt) {
      return reply.code(403).send({
        error: 'Forbidden',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Подтвердите email — проверьте почту или запросите код снова',
        email: user.email,
      });
    }
    return createSession(app, user);
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
    if (emailVerificationRequired() && !user.emailVerifiedAt) return reply.unauthorized();
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
