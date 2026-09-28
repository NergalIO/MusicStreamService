import { and, asc, eq, isNull } from 'drizzle-orm';
import type { LobbyDto, LobbyMemberDto, LobbyQueueItemDto, UnifiedTrack } from '@mss/shared';
import { db } from '../db/client.js';
import {
  listeningLobbies,
  listeningLobbyMembers,
  listeningLobbyQueue,
  type LobbyTrackSnapshot,
} from '../db/schema.js';
import { getLobbyPlayback } from './lobby-hub.js';

function toUnifiedTrack(t: LobbyTrackSnapshot): UnifiedTrack {
  return {
    source: t.source,
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumId: t.albumId,
    durationMs: t.durationMs,
    coverUrl: t.coverUrl,
    playable: t.playable ?? true,
  };
}

export async function loadLobbyDto(lobbyId: string): Promise<LobbyDto | null> {
  const [lobby] = await db.select().from(listeningLobbies).where(eq(listeningLobbies.id, lobbyId)).limit(1);
  if (!lobby) return null;

  const members = await db
    .select()
    .from(listeningLobbyMembers)
    .where(eq(listeningLobbyMembers.lobbyId, lobbyId));

  const queueRows = await db
    .select()
    .from(listeningLobbyQueue)
    .where(eq(listeningLobbyQueue.lobbyId, lobbyId))
    .orderBy(asc(listeningLobbyQueue.position), asc(listeningLobbyQueue.createdAt));

  const playback = await getLobbyPlayback(lobbyId);

  const memberDtos: LobbyMemberDto[] = members.map((m) => ({
    userId: m.userId,
    role: m.role as LobbyMemberDto['role'],
    displayName: m.displayName,
    joinedAt: m.joinedAt.toISOString(),
  }));

  const queue: LobbyQueueItemDto[] = queueRows.map((q) => ({
    id: q.id,
    position: q.position,
    track: toUnifiedTrack(q.track),
    suggestedBy: q.suggestedBy,
    status: q.status as LobbyQueueItemDto['status'],
    createdAt: q.createdAt.toISOString(),
  }));

  return {
    id: lobby.id,
    inviteCode: lobby.inviteCode,
    title: lobby.title,
    maxMembers: lobby.maxMembers,
    isPublic: lobby.isPublic,
    hostUserId: lobby.hostUserId,
    createdAt: lobby.createdAt.toISOString(),
    endedAt: lobby.endedAt?.toISOString() ?? null,
    members: memberDtos,
    queue,
    playback,
  };
}

export async function findActiveLobbyByCode(code: string) {
  const normalized = code.trim().toUpperCase();
  const [row] = await db
    .select()
    .from(listeningLobbies)
    .where(eq(listeningLobbies.inviteCode, normalized))
    .limit(1);
  if (!row || row.endedAt) return null;
  return row;
}

export async function isLobbyMember(lobbyId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: listeningLobbyMembers.userId })
    .from(listeningLobbyMembers)
    .where(and(eq(listeningLobbyMembers.lobbyId, lobbyId), eq(listeningLobbyMembers.userId, userId)))
    .limit(1);
  return !!row;
}

export async function countLobbyMembers(lobbyId: string): Promise<number> {
  const rows = await db
    .select({ userId: listeningLobbyMembers.userId })
    .from(listeningLobbyMembers)
    .where(eq(listeningLobbyMembers.lobbyId, lobbyId));
  return rows.length;
}

export async function endLobby(lobbyId: string): Promise<void> {
  await db
    .update(listeningLobbies)
    .set({ endedAt: new Date() })
    .where(eq(listeningLobbies.id, lobbyId));
}

export async function findUserActiveLobby(userId: string): Promise<string | null> {
  const rows = await db
    .select({ lobbyId: listeningLobbyMembers.lobbyId })
    .from(listeningLobbyMembers)
    .innerJoin(listeningLobbies, eq(listeningLobbyMembers.lobbyId, listeningLobbies.id))
    .where(and(eq(listeningLobbyMembers.userId, userId), isNull(listeningLobbies.endedAt)))
    .limit(1);
  return rows[0]?.lobbyId ?? null;
}
