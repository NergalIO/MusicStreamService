import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Код — 6 цифр'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createPlaylistSchema = z.object({
  name: z.string().min(1).max(200),
});

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v == null ? v : v.trim() || null));

/** Kotlin кодирует отсутствие как null, а z.number().optional() такой null отвергает. */
const optionalMs = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.number().int().min(0).optional(),
);

export const updatePlaylistSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalText(2000),
  author: optionalText(200),
});

export const addPlaylistTrackSchema = z.object({
  trackId: z.string().uuid(),
  position: z.number().int().min(0).optional(),
});

const artistRefSchema = z.object({ id: z.string().max(100), name: z.string().max(500) });

/** Только метаданные: сервер MSS не получает ни токенов, ни ссылок на поток. */
export const externalTrackSnapshotSchema = z.object({
  title: z.string().min(1).max(500),
  artist: z.string().max(500),
  artists: z.array(artistRefSchema).max(20).optional(),
  album: z.string().max(500).optional(),
  albumId: z.string().max(100).optional(),
  durationMs: optionalMs,
  coverUrl: z.string().url().max(1000).optional(),
  explicit: z.boolean().optional(),
});

export const playlistEntryInputSchema = z.union([
  z.object({ trackId: z.string().uuid() }),
  z.object({
    source: z.enum(['yandex', 'spotify', 'vk']),
    externalId: z.string().min(1).max(100),
    snapshot: externalTrackSnapshotSchema,
  }),
]);

export const addPlaylistEntriesSchema = z.object({
  items: z.array(playlistEntryInputSchema).min(1).max(5000),
});

export const reorderPlaylistSchema = z.object({
  entryIds: z.array(z.string().uuid()).max(10000),
});

export const updateTrackSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  artist: z.string().trim().min(1).max(500).optional(),
  album: optionalText(500),
});

const optionalYear = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.number().int().min(1000).max(2100).optional(),
);

export const albumTypeSchema = z.enum(['album', 'single', 'ep', 'compilation']);

export const createAlbumSchema = z.object({
  title: z.string().trim().min(1).max(500),
  artist: z.string().trim().min(1).max(500),
  year: optionalYear,
  type: albumTypeSchema.optional(),
  trackIds: z.array(z.string().uuid()).max(500).optional(),
});

export const updateAlbumSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  artist: z.string().trim().min(1).max(500).optional(),
  year: z.preprocess(
    (value) => (value === null || value === '' ? null : value),
    z.number().int().min(1000).max(2100).nullable().optional(),
  ),
  type: albumTypeSchema.optional(),
});

export const addAlbumTracksSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(500),
});

export const reorderAlbumSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(500),
});

export const artistLikeSchema = z.object({
  source: z.enum(['local', 'yandex', 'spotify', 'vk']),
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
  imageUrl: z.string().trim().max(2000).optional(),
  genres: z.array(z.string().trim().max(80)).max(20).optional(),
  trackCount: z.number().int().min(0).max(10000).optional(),
});

export const albumLikeSchema = z.object({
  source: z.enum(['local', 'yandex', 'spotify', 'vk']),
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(500),
  artist: z.string().trim().min(1).max(500),
  year: optionalYear,
  type: z.string().trim().max(40).optional(),
  coverUrl: z.string().trim().max(2000).optional(),
  trackCount: z.number().int().min(0).max(5000).optional(),
  genre: z.string().trim().max(200).optional(),
  artists: z.array(artistRefSchema).max(20).optional(),
});

export const registerTrackSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i, 'contentHash must be SHA-256 hex'),
  title: z.string().trim().min(1).max(500),
  artist: z.string().trim().min(1).max(500),
  album: optionalText(500),
  durationMs: optionalMs,
  sizeBytes: z.number().int().min(1).max(500 * 1024 * 1024),
  originalFilename: z.string().min(1).max(500),
  loudnessLufs: z.number().min(-70).max(0).optional(),
});

export const listeningEventSchema = z.object({
  clientEventId: z.string().uuid(),
  source: z.enum(['local', 'yandex', 'spotify', 'vk']),
  trackId: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  artist: z.string().max(500),
  artists: z.array(artistRefSchema).max(20).optional(),
  album: z.string().max(500).optional(),
  albumId: z.string().max(100).optional(),
  coverUrl: z.string().max(1000).optional(),
  durationMs: optionalMs,
  playedMs: z.number().int().min(0),
  completed: z.boolean(),
  playedAt: z.string().datetime(),
});

export const listeningEventsSchema = z.object({
  events: z.array(listeningEventSchema).min(1).max(500),
});

export const activatePromoSchema = z.object({
  code: z.string().min(1),
});

export const deviceRegisterSchema = z.object({
  deviceId: z.string().uuid(),
  name: z.string().min(1).max(100),
});

export const adminSubscriptionSchema = z.object({
  planCode: z.enum(['free', 'premium']),
  days: z.number().int().min(1).max(3650),
});

export const createLobbySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  maxMembers: z.number().int().min(2).max(32).optional(),
  isPublic: z.boolean().optional(),
});

export const joinLobbySchema = z.object({
  inviteCode: z.string().trim().min(4).max(12),
});

export const lobbySuggestSchema = z.object({
  track: z.object({
    source: z.enum(['local', 'spotify', 'yandex', 'vk']),
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(500),
    artist: z.string().max(500),
    album: z.string().max(500).optional(),
    albumId: z.string().max(100).optional(),
    durationMs: optionalMs,
    coverUrl: z.string().max(1000).optional(),
    playable: z.boolean().optional(),
  }),
});

export const lobbyPlaybackSchema = z.object({
  action: z.enum(['play', 'pause', 'skip', 'seek']),
  track: lobbySuggestSchema.shape.track.optional(),
  positionMs: optionalMs,
});
