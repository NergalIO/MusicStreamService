import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  broadcastLobbyAudio,
  broadcastLobbyJson,
  isLobbyAudioMessage,
  registerLobbySocket,
  sendLobbyError,
  stripAudioPrefix,
  unregisterLobbySocket,
} from '../lib/lobby-hub.js';
import { endLobby, isLobbyMember, loadLobbyDto } from '../lib/lobby-load.js';
import { db } from '../db/client.js';
import { listeningLobbies, listeningLobbyMembers } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export async function wsLobbyRoutes(app: FastifyInstance) {
  await app.register(websocket);

  app.get('/ws/lobby/:lobbyId', { websocket: true }, (socket: WebSocket, req) => {
    void (async () => {
      const { lobbyId } = req.params as { lobbyId: string };
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

      if (!(await isLobbyMember(lobbyId, userId))) {
        sendLobbyError(socket, 'Вы не участник лобби');
        socket.close(4403, 'Forbidden');
        return;
      }

      const [member] = await db
        .select({ role: listeningLobbyMembers.role })
        .from(listeningLobbyMembers)
        .where(and(eq(listeningLobbyMembers.lobbyId, lobbyId), eq(listeningLobbyMembers.userId, userId)))
        .limit(1);
      const role = (member?.role === 'host' ? 'host' : 'guest') as 'host' | 'guest';

      registerLobbySocket(lobbyId, userId, role, socket);
      const lobby = await loadLobbyDto(lobbyId);
      if (lobby) socket.send(JSON.stringify({ type: 'lobby_state', lobby }));

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (isLobbyAudioMessage(buf)) {
          if (role !== 'host') return;
          broadcastLobbyAudio(lobbyId, userId, stripAudioPrefix(buf));
          return;
        }
        try {
          const msg = JSON.parse(buf.toString()) as { type?: string };
          if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
        } catch {
          /* ignore */
        }
      });

      socket.on('close', async () => {
        unregisterLobbySocket(lobbyId, userId);
        const [lobby] = await db.select().from(listeningLobbies).where(eq(listeningLobbies.id, lobbyId)).limit(1);
        if (!lobby || lobby.endedAt) return;
        if (lobby.hostUserId === userId) {
          await endLobby(lobbyId);
          broadcastLobbyJson(lobbyId, { type: 'lobby_closed' });
          return;
        }
        await db
          .delete(listeningLobbyMembers)
          .where(and(eq(listeningLobbyMembers.lobbyId, lobbyId), eq(listeningLobbyMembers.userId, userId)));
        broadcastLobbyJson(lobbyId, { type: 'member_leave', userId });
      });
    })();
  });
}
