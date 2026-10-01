import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import type { FastifyInstance } from 'fastify';
import type { ZodError } from 'zod';
import { config } from './config.js';
import { ensureBuckets } from './lib/storage.js';
import { authPlugin } from './plugins/auth.js';
import { artistRoutes } from './routes/artists.js';
import { authRoutes } from './routes/auth.js';
import { likeRoutes } from './routes/likes.js';
import { objectRoutes } from './routes/objects.js';
import { playlistRoutes } from './routes/playlists.js';
import { statsRoutes } from './routes/stats.js';
import { subscriptionRoutes } from './routes/subscription.js';
import { trackRoutes } from './routes/tracks.js';
import { lobbyRoutes } from './routes/lobbies.js';
import { relayRoutes } from './routes/relay.js';
import { siteRoutes } from './routes/site.js';
import { wsLobbyRoutes } from './ws/lobby.js';
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

const registerApi = async (scoped: FastifyInstance) => {
  scoped.get('/health', async () => ({
    ok: true,
    version: config.appVersion,
    basePath: config.basePath || '/',
  }));

  await scoped.register(authRoutes);
  await scoped.register(trackRoutes);
  await scoped.register(objectRoutes);
  await scoped.register(relayRoutes);
  await scoped.register(lobbyRoutes);
  await scoped.register(wsPresenceRoutes);
  await scoped.register(wsLobbyRoutes);
  await scoped.register(artistRoutes);
  await scoped.register(likeRoutes);
  await scoped.register(playlistRoutes);
  await scoped.register(subscriptionRoutes);
  await scoped.register(statsRoutes);
  await scoped.register(siteRoutes);
};

if (config.basePath) {
  await app.register(registerApi, { prefix: config.basePath });
} else {
  await registerApi(app);
}

try {
  await ensureBuckets();
} catch (err) {
  app.log.error(err);
  if (config.storageBackend !== 's3') process.exit(1);
  app.log.warn('S3 недоступен при старте — API слушаем, лайки/плейлисты/статистика из БД');
}

try {
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
