import pg from 'pg';
import { config } from '../config.js';

const sql = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  artist VARCHAR(500) NOT NULL,
  album VARCHAR(500),
  duration_ms INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  codec VARCHAR(20),
  bitrate_kbps INTEGER,
  mime_type VARCHAR(100),
  storage_key_master TEXT,
  cover_storage_key TEXT,
  uploaded_by UUID REFERENCES users(id),
  original_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tracks_search_idx ON tracks USING gin ((title || ' ' || artist) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS author VARCHAR(200);
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS cover_storage_key TEXT;

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  price_display VARCHAR(50),
  features_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  status VARCHAR(20) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  source VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  duration_days INTEGER NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);

CREATE TABLE IF NOT EXISTS track_likes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS track_likes_user_idx ON track_likes (user_id, created_at DESC);

-- Интегральная громкость (EBU R128) для нормализации при воспроизведении.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS loudness_lufs REAL;

-- Плейлисты MSS могут хранить треки Яндекса и Spotify: вместо track_id — источник, id и снимок метаданных.
ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS external_source VARCHAR(20);
ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS snapshot JSONB;
ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'playlist_tracks_pkey' AND conrelid = 'playlist_tracks'::regclass AND array_length(conkey, 1) = 2
  ) THEN
    ALTER TABLE playlist_tracks DROP CONSTRAINT playlist_tracks_pkey;
    ALTER TABLE playlist_tracks ADD PRIMARY KEY (id);
  END IF;
END $$;
ALTER TABLE playlist_tracks ALTER COLUMN track_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS playlist_tracks_local_uq
  ON playlist_tracks (playlist_id, track_id) WHERE track_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS playlist_tracks_external_uq
  ON playlist_tracks (playlist_id, external_source, external_id) WHERE external_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS playlist_tracks_order_idx ON playlist_tracks (playlist_id, position);

-- История прослушиваний для статистики. client_event_id защищает от дублей при повторной отправке.
CREATE TABLE IF NOT EXISTS listening_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_event_id UUID NOT NULL UNIQUE,
  source VARCHAR(20) NOT NULL,
  track_id VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  artist VARCHAR(500) NOT NULL,
  artists JSONB,
  album VARCHAR(500),
  album_id VARCHAR(100),
  cover_url TEXT,
  duration_ms INTEGER,
  played_ms INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS listening_events_user_time_idx ON listening_events (user_id, played_at DESC);

-- Federated tracks: регистрация по hash, holdings, ephemeral cache.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS cache_expires_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS storage_key_original TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tracks_content_hash_uq ON tracks (content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS track_holdings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX IF NOT EXISTS track_holdings_track_idx ON track_holdings (track_id);

INSERT INTO track_holdings (user_id, track_id)
SELECT uploaded_by, id FROM tracks WHERE uploaded_by IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_verification_codes_user_idx ON email_verification_codes (user_id);

CREATE TABLE IF NOT EXISTS listening_lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code VARCHAR(12) NOT NULL UNIQUE,
  host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL DEFAULT 'Listening party',
  max_members INTEGER NOT NULL DEFAULT 8,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS listening_lobbies_host_idx ON listening_lobbies (host_user_id);

CREATE TABLE IF NOT EXISTS listening_lobby_members (
  lobby_id UUID NOT NULL REFERENCES listening_lobbies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL,
  display_name VARCHAR(100),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lobby_id, user_id)
);

CREATE TABLE IF NOT EXISTS listening_lobby_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID NOT NULL REFERENCES listening_lobbies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  track JSONB NOT NULL,
  suggested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS listening_lobby_queue_lobby_idx ON listening_lobby_queue (lobby_id, position);
`;

async function main() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('Migration complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
