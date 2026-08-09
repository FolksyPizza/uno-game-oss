-- Audit log: an append-only record of security- and moderation-relevant events
-- across the whole platform (auth, accounts, social, moderation, games).

CREATE TABLE IF NOT EXISTS audit_log (
  id             bigserial PRIMARY KEY,
  ts             timestamptz NOT NULL DEFAULT now(),
  event          text NOT NULL,                 -- e.g. 'auth.login', 'chat.blocked'
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name     text,                          -- denormalized for readability if user is deleted
  ip             text,
  target         text,                          -- affected entity (room code, target user, etc.)
  meta           jsonb,                         -- event-specific details
  service        text                           -- 'hub' | 'uno' | 'holdem' | ...
);

CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_event_idx ON audit_log(event);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_user_id);
