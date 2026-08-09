CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,                       -- 'google' | 'github'
  provider_id   text NOT NULL,
  display_name  citext NOT NULL UNIQUE,
  email         text,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           bigserial PRIMARY KEY,
  room_code    text NOT NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  text         text NOT NULL,
  ts           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_room_idx ON chat_messages(room_code, ts DESC);

CREATE TABLE IF NOT EXISTS game_results (
  id             bigserial PRIMARY KEY,
  room_code      text NOT NULL,
  winner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  players_json   jsonb NOT NULL,                     -- [{userId, displayName, isBot}]
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_results_winner_idx ON game_results(winner_user_id);
