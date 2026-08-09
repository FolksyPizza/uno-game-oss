CREATE TABLE IF NOT EXISTS friendships (
  user_a    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id          bigserial PRIMARY KEY,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_user_id)
);

CREATE INDEX IF NOT EXISTS fr_to_idx ON friend_requests(to_user_id, status);

CREATE TABLE IF NOT EXISTS direct_messages (
  id          bigserial PRIMARY KEY,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text         text NOT NULL,
  read         boolean NOT NULL DEFAULT false,
  ts           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dm_conv_idx ON direct_messages(
  LEAST(from_user_id, to_user_id),
  GREATEST(from_user_id, to_user_id),
  ts DESC
);
