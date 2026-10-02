import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    authenticateOptional: (req: FastifyRequest) => Promise<void>;
    requireAdmin: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: string;
    userRole?: string;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      const payload = await req.jwtVerify<{ sub: string; role: string }>();
      req.userId = payload.sub;
      req.userRole = payload.role;
    } catch {
      throw app.httpErrors.unauthorized();
    }
  });

  app.decorate('authenticateOptional', async (req: FastifyRequest) => {
    try {
      const payload = await req.jwtVerify<{ sub: string; role: string }>();
      req.userId = payload.sub;
      req.userRole = payload.role;
    } catch {
      req.userId = undefined;
      req.userRole = undefined;
    }
  });

  app.decorate('requireAdmin', async (req: FastifyRequest) => {
    await app.authenticate(req);
    if (req.userRole === 'admin') return;
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, req.userId!))
      .limit(1);
    if (row?.role === 'admin') {
      req.userRole = 'admin';
      return;
    }
    throw app.httpErrors.forbidden('Нужны права администратора');
  });
});
