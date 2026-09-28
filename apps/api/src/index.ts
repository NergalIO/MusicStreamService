import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import type { ZodError } from 'zod';
import { config } from './config.js';
import { ensureBuckets } from './lib/storage.js';
import { authPlugin } from './plugins/auth.js';
import { artistRoutes } from './routes/artists.js';
import { authRoutes } from './routes/auth.js';
import { likeRoutes } from './routes/likes.js';
import { playlistRoutes } from './routes/playlists.js';
import { statsRoutes } from './routes/stats.js';
import { subscriptionRoutes } from './routes/subscription.js';
import { trackRoutes } from './routes/tracks.js';
import { relayRoutes } from './routes/relay.js';
import { siteRoutes } from './routes/site.js';
import { wsPresenceRoutes } from './ws/presence.js';

const app = Fastify({
  logger: true,
  ...(config.tls ? { https: config.tls } : {}),
});

await app.register(cors, { origin: true });
await app.register(jwt, { secret: config.jwtSecret });
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
await app.register(sensible);
await app.register(authPlugin);

app.setErrorHandler((err: Error, _req, reply) => {
  if (err.name === 'ZodError' && Array.isArray((err as ZodError).issues)) {
    const issue = (err as ZodError).issues[0];
    return reply.code(400).send({
      error: 'Bad Request',
      message: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Некорректный запрос',
    });
  }
  return reply.send(err);
});

const registerApi = async () => {
  app.get('/health', async () => ({ ok: true, basePath: config.basePath || '/' }));

  await app.register(authRoutes);
  await app.register(trackRoutes);
  await app.register(relayRoutes);
  await app.register(wsPresenceRoutes);
  await app.register(artistRoutes);
  await app.register(likeRoutes);
  await app.register(playlistRoutes);
  await app.register(subscriptionRoutes);
  await app.register(statsRoutes);
  await app.register(siteRoutes);
};

if (config.basePath) {
  await app.register(registerApi, { prefix: config.basePath });
} else {
  await registerApi();
}

try {
  await ensureBuckets();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  const scheme = config.httpsEnabled ? 'https' : 'http';
  app.log.info(
    { scheme, port: config.port, publicUrl: config.publicUrl, basePath: config.basePath || '(root)' },
    'MSS API listening',
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
