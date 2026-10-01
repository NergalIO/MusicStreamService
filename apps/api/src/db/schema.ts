import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('user'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const emailVerificationCodes = pgTable('email_verification_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 500 }).notNull(),
  artist: varchar('artist', { length: 500 }).notNull(),
  album: varchar('album', { length: 500 }),
  durationMs: integer('duration_ms'),
  status: varchar('status', { length: 20 }).notNull().default('processing'),
  codec: varchar('codec', { length: 20 }),
  bitrateKbps: integer('bitrate_kbps'),
  mimeType: varchar('mime_type', { length: 100 }),
  storageKeyMaster: text('storage_key_master'),
  storageKeyOriginal: text('storage_key_original'),
  coverStorageKey: text('cover_storage_key'),
  storageKeyLyrics: text('storage_key_lyrics'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  originalFilename: text('original_filename'),
  loudnessLufs: real('loudness_lufs'),
  /** SHA-256 hex — канонический ключ файла в глобальном каталоге. */
  contentHash: varchar('content_hash', { length: 64 }),
  sizeBytes: integer('size_bytes'),
  /** Ephemeral-кэш на сервере; NULL — постоянное legacy-хранилище. */
  cacheExpiresAt: timestamp('cache_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const trackHoldings = pgTable(
  'track_holdings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  author: varchar('author', { length: 200 }),
  coverStorageKey: text('cover_storage_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Снимок метаданных внешнего трека: воспроизводит его клиент, у сервера нет доступа к источнику. */
export interface ExternalTrackSnapshot {
  title: string;
  artist: string;
  artists?: { id: string; name: string }[];
  album?: string;
  albumId?: string;
  durationMs?: number;
  coverUrl?: string;
  explicit?: boolean;
}

export const playlistTracks = pgTable('playlist_tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  playlistId: uuid('playlist_id')
    .notNull()
    .references(() => playlists.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'cascade' }),
  externalSource: varchar('external_source', { length: 20 }),
  externalId: varchar('external_id', { length: 100 }),
  snapshot: jsonb('snapshot').$type<ExternalTrackSnapshot>(),
  position: integer('position').notNull().default(0),
  addedAt: timestamp('added_at').defaultNow().notNull(),
});

export const listeningEvents = pgTable('listening_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientEventId: uuid('client_event_id').notNull().unique(),
  source: varchar('source', { length: 20 }).notNull(),
  trackId: varchar('track_id', { length: 100 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  artist: varchar('artist', { length: 500 }).notNull(),
  artists: jsonb('artists').$type<{ id: string; name: string }[]>(),
  album: varchar('album', { length: 500 }),
  albumId: varchar('album_id', { length: 100 }),
  coverUrl: text('cover_url'),
  durationMs: integer('duration_ms'),
  playedMs: integer('played_ms').notNull(),
  completed: boolean('completed').notNull().default(false),
  playedAt: timestamp('played_at', { withTimezone: true }).defaultNow().notNull(),
});

export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  priceDisplay: varchar('price_display', { length: 50 }),
  featuresJson: jsonb('features_json').notNull(),
});

export const userSubscriptions = pgTable('user_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => subscriptionPlans.id),
  status: varchar('status', { length: 20 }).notNull(),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at'),
  source: varchar('source', { length: 50 }).notNull(),
});

export const promoCodes = pgTable('promo_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => subscriptionPlans.id),
  durationDays: integer('duration_days').notNull(),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
});

export const userDevices = pgTable(
  'user_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (t) => [unique('user_devices_user_device').on(t.userId, t.deviceId)],
);

export const trackLikes = pgTable(
  'track_likes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);

export type LobbyQueueStatus = 'suggested' | 'queued' | 'playing' | 'played' | 'rejected';

export interface LobbyTrackSnapshot {
  source: 'local' | 'spotify' | 'yandex' | 'vk';
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  durationMs?: number;
  coverUrl?: string;
  playable?: boolean;
}

export const listeningLobbies = pgTable('listening_lobbies', {
  id: uuid('id').primaryKey().defaultRandom(),
  inviteCode: varchar('invite_code', { length: 12 }).notNull().unique(),
  hostUserId: uuid('host_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull().default('Listening party'),
  maxMembers: integer('max_members').notNull().default(8),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const listeningLobbyMembers = pgTable(
  'listening_lobby_members',
  {
    lobbyId: uuid('lobby_id')
      .notNull()
      .references(() => listeningLobbies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 10 }).notNull(),
    displayName: varchar('display_name', { length: 100 }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.lobbyId, t.userId] })],
);

export const listeningLobbyQueue = pgTable('listening_lobby_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  lobbyId: uuid('lobby_id')
    .notNull()
    .references(() => listeningLobbies.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  track: jsonb('track').$type<LobbyTrackSnapshot>().notNull(),
  suggestedBy: uuid('suggested_by').references(() => users.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
