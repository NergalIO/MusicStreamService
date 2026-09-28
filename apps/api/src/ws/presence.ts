import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { registerSocket, touchOnline } from '../lib/presence.js';

export async function wsPresenceRoutes(app: FastifyInstance) {
  await app.register(websocket);

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://local');
      const token = url.searchParams.get('token') ?? (req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '');
      if (!token) {
        socket.close(4401, 'Unauthorized');
        return;
      }
      let userId: string;
      try {
        const payload = await app.jwt.verify<{ sub: string }>(token);
        userId = payload.sub;
      } catch {
        socket.close(4401, 'Unauthorized');
        return;
      }

      registerSocket(userId, socket);
      socket.send(JSON.stringify({ type: 'connected', userId }));

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg = JSON.parse(String(raw)) as { type?: string };
          if (msg.type === 'ping') {
            void touchOnline(userId);
            socket.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          /* ignore */
        }
      });
    })();
  });
}
