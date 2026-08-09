-- Guest accounts: temporary "Guest ####" identities with no OAuth, limited scope
-- (play + join rooms + quick-chat only). Stored in users so they get a real id,
-- session, and an upgrade path, but flagged so the social layer can gate them.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

-- Partial index to make guest reaping / lookups cheap.
CREATE INDEX IF NOT EXISTS users_is_guest_idx ON users(is_guest) WHERE is_guest;
