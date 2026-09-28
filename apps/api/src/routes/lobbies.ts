import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LobbyListDto, LobbyPlaybackState, UnifiedTrack } from '@mss/shared';
import {
  createLobbySchema,
  joinLobbySchema,
  lobbyPlaybackSchema,
  lobbySuggestSchema,
} from '@mss/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';
import {
  listeningLobbies,
  listeningLobbyMembers,
  listeningLobbyQueue,
  users,
  type LobbyTrackSnapshot,
} from '../db/schema.js';
import { broadcastLobbyJson, setLobbyPlayback } from '../lib/lobby-hub.js';
import {
  countLobbyMembers,
  endLobby,
  findActiveLobbyByCode,
  isLobbyMember,
  listActiveLobbySummaries,
  loadLobbyDto,
} from '../lib/lobby-load.js';

function inviteCode(): string {
  return randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}

function snapshotFromTrack(track: UnifiedTrack): LobbyTrackSnapshot {
  return {
    source: track.source,
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumId: track.albumId,
    durationMs: track.durationMs,
    coverUrl: track.coverUrl,
    playable: track.playable,
  };
}

async function requireHost(lobbyId: string, userId: string): Promise<void> {
  const [lobby] = await db.select().from(listeningLobbies).where(eq(listeningLobbies.id, lobbyId)).limit(1);
  if (!lobby || lobby.endedAt) throw new Error('NOT_FOUND');
  if (lobby.hostUserId !== userId) throw new Error('FORBIDDEN');
}

export async function lobbyRoutes(app: FastifyInstance) {
  app.get('/lobbies', async (req) => {
    await app.authenticate(req);
    const startedAt = process.hrtime.bigint();
    const items = await listActiveLobbySummaries(req.userId!);
    const tookMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return { items, tookMs: Math.round(tookMs * 10) / 10 } satisfies LobbyListDto;
  });

  app.post('/lobbies', async (req, reply) => {
    await app.authenticate(req);
    const body = createLobbySchema.parse(req.body ?? {});
    const maxMembers = Math.min(body.maxMembers ?? config.lobbyMaxMembers, config.lobbyMaxMembers);

    let code = inviteCode();
    for (let i = 0; i < 5; i++) {
      try {
        const [lobby] = await db
          .insert(listeningLobbies)
          .values({
            inviteCode: code,
            hostUserId: req.userId!,
            title: body.title?.trim() || 'Listening party',
            maxMembers,
            isPublic: body.isPublic ?? false,
          })
          .returning();
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.userId!)).limit(1);
        await db.insert(listeningLobbyMembers).values({
          lobbyId: lobby.id,
          userId: req.userId!,
          role: 'host',
          displayName: user?.email?.split('@')[0] ?? 'Host',
        });
        await setLobbyPlayback(lobby.id, {
          track: null,
          paused: true,
          positionMs: 0,
          updatedAt: new Date().toISOString(),
        });
        const dto = await loadLobbyDto(lobby.id);
        return reply.code(201).send(dto);
      } catch {
        code = inviteCode();
      }
    }
    return reply.internalServerError('Не удалось создать лобби');
  });

  app.post('/lobbies/join', async (req, reply) => {
    await app.authenticate(req);
    const { inviteCode: code } = joinLobbySchema.parse(req.body);
    const lobby = await findActiveLobbyByCode(code);
    if (!lobby) return reply.notFound('Лобби не найдено или уже закрыто');

    if (await isLobbyMember(lobby.id, req.userId!)) {
      return loadLobbyDto(lobby.id);
    }

    const count = await countLobbyMembers(lobby.id);
    if (count >= lobby.maxMembers) return reply.code(403).send({ message: 'Лобби заполнено' });

    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.userId!)).limit(1);
    await db.insert(listeningLobbyMembers).values({
      lobbyId: lobby.id,
      userId: req.userId!,
      role: 'guest',
      displayName: user?.email?.split('@')[0] ?? 'Guest',
    });

    const dto = await loadLobbyDto(lobby.id);
    broadcastLobbyJson(lobby.id, {
      type: 'member_join',
      member: dto!.members.find((m) => m.userId === req.userId!)!,
    });
    return dto;
  });

  app.get('/lobbies/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!(await isLobbyMember(id, req.userId!))) return reply.forbidden();
    const dto = await loadLobbyDto(id);
    if (!dto) return reply.notFound();
    return dto;
  });

  app.post('/lobbies/:id/leave', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    const [lobby] = await db.select().from(listeningLobbies).where(eq(listeningLobbies.id, id)).limit(1);
    if (!lobby) return reply.notFound();

    await db
      .delete(listeningLobbyMembers)
      .where(and(eq(listeningLobbyMembers.lobbyId, id), eq(listeningLobbyMembers.userId, req.userId!)));

    if (lobby.hostUserId === req.userId) {
      await endLobby(id);
      broadcastLobbyJson(id, { type: 'lobby_closed' });
    } else {
      broadcastLobbyJson(id, { type: 'member_leave', userId: req.userId! });
    }
    return { ok: true };
  });

  app.delete('/lobbies/:id', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    try {
      await requireHost(id, req.userId!);
    } catch (e) {
      if (String(e).includes('NOT_FOUND')) return reply.notFound();
      return reply.forbidden();
    }
    await endLobby(id);
    broadcastLobbyJson(id, { type: 'lobby_closed' });
    return { ok: true };
  });

  app.post('/lobbies/:id/suggestions', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    if (!(await isLobbyMember(id, req.userId!))) return reply.forbidden();
    const { track } = lobbySuggestSchema.parse(req.body);
    const unified = { ...track, playable: track.playable ?? true } as UnifiedTrack;

    const [item] = await db
      .insert(listeningLobbyQueue)
      .values({
        lobbyId: id,
        position: 9999,
        track: snapshotFromTrack(unified),
        suggestedBy: req.userId!,
        status: 'suggested',
      })
      .returning();

    const dto = await loadLobbyDto(id);
    const queueItem = dto!.queue.find((q) => q.id === item.id)!;
    broadcastLobbyJson(id, { type: 'suggestion_new', item: queueItem });
    return queueItem;
  });

  app.post('/lobbies/:id/queue/:itemId/accept', async (req, reply) => {
    await app.authenticate(req);
    const { id, itemId } = req.params as { id: string; itemId: string };
    try {
      await requireHost(id, req.userId!);
    } catch {
      return reply.forbidden();
    }

    const queued = await db
      .select({ position: listeningLobbyQueue.position })
      .from(listeningLobbyQueue)
      .where(and(eq(listeningLobbyQueue.lobbyId, id), eq(listeningLobbyQueue.status, 'queued')));
    const maxPos = queued.reduce((m, r) => Math.max(m, r.position), 0);

    await db
      .update(listeningLobbyQueue)
      .set({ status: 'queued', position: maxPos + 1 })
      .where(and(eq(listeningLobbyQueue.id, itemId), eq(listeningLobbyQueue.lobbyId, id)));

    const dto = await loadLobbyDto(id);
    broadcastLobbyJson(id, { type: 'queue_updated', queue: dto!.queue });
    return dto!.queue;
  });

  app.post('/lobbies/:id/queue/:itemId/reject', async (req, reply) => {
    await app.authenticate(req);
    const { id, itemId } = req.params as { id: string; itemId: string };
    try {
      await requireHost(id, req.userId!);
    } catch {
      return reply.forbidden();
    }
    await db
      .update(listeningLobbyQueue)
      .set({ status: 'rejected' })
      .where(and(eq(listeningLobbyQueue.id, itemId), eq(listeningLobbyQueue.lobbyId, id)));
    const dto = await loadLobbyDto(id);
    broadcastLobbyJson(id, { type: 'queue_updated', queue: dto!.queue });
    return dto!.queue;
  });

  app.post('/lobbies/:id/playback', async (req, reply) => {
    await app.authenticate(req);
    const { id } = req.params as { id: string };
    try {
      await requireHost(id, req.userId!);
    } catch {
      return reply.forbidden();
    }
    const body = lobbyPlaybackSchema.parse(req.body);
    const prev = (await loadLobbyDto(id))!.playback;
    let playback: LobbyPlaybackState = { ...prev, updatedAt: new Date().toISOString() };

    switch (body.action) {
      case 'play':
        playback = {
          track: body.track
            ? ({ ...body.track, playable: body.track.playable ?? true } satisfies UnifiedTrack)
            : prev.track,
          paused: false,
          positionMs: body.positionMs ?? 0,
          updatedAt: new Date().toISOString(),
        };
        if (body.track) {
          await db
            .update(listeningLobbyQueue)
            .set({ status: 'played' })
            .where(and(eq(listeningLobbyQueue.lobbyId, id), eq(listeningLobbyQueue.status, 'playing')));
          const playing = await db
            .select()
            .from(listeningLobbyQueue)
            .where(and(eq(listeningLobbyQueue.lobbyId, id), eq(listeningLobbyQueue.status, 'queued')))
            .orderBy(asc(listeningLobbyQueue.position))
            .limit(1);
          if (playing[0]) {
            await db
              .update(listeningLobbyQueue)
              .set({ status: 'playing' })
              .where(eq(listeningLobbyQueue.id, playing[0].id));
          }
        }
        break;
      case 'pause':
        playback = { ...prev, paused: true, positionMs: body.positionMs ?? prev.positionMs, updatedAt: new Date().toISOString() };
        break;
      case 'seek':
        playback = { ...prev, positionMs: body.positionMs ?? prev.positionMs, updatedAt: new Date().toISOString() };
        break;
      case 'skip':
        playback = {
          ...prev,
          track: body.track ? ({ ...body.track, playable: body.track.playable ?? true } satisfies UnifiedTrack) : null,
          paused: false,
          positionMs: body.positionMs ?? 0,
          updatedAt: new Date().toISOString(),
        };
        break;
    }

    await setLobbyPlayback(id, playback);
    broadcastLobbyJson(id, { type: 'playback', playback });
    return playback;
  });

  app.get('/join/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const lobby = await findActiveLobbyByCode(code);
    const deepLink = `mss://lobby/${encodeURIComponent((lobby?.inviteCode ?? code).toUpperCase())}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Join MSS Lobby</title>
<script>location.href=${JSON.stringify(deepLink)}</script></head>
<body><p><a href="${deepLink}">Открыть MusicStreamService</a></p></body></html>`;
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
