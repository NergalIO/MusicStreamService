import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    authenticateOptional: (req: FastifyRequest) => Promise<void>;
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
});
