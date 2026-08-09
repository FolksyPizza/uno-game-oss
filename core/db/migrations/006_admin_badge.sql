-- Whether an admin's "ADMIN" badge is shown publicly (next to their name).
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_admin_badge boolean NOT NULL DEFAULT true;
