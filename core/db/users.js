const db = require('./index');

// Insert or update a user by (provider, provider_id). Returns the user row.
// Handles display_name uniqueness: if the OAuth profile name collides with
// an existing user, suffixes a short id until unique.
async function upsertUser({ provider, providerId, displayName, email, avatarUrl }) {
  const baseName = (displayName || 'Player').trim().slice(0, 32) || 'Player';
  let name = baseName;

  // Existing row for (provider, provider_id) keeps its current name.
  const existing = await db.query(
    'SELECT * FROM users WHERE provider=$1 AND provider_id=$2',
    [provider, providerId]
  );
  if (existing.rows.length) {
    const row = existing.rows[0];
    await db.query(
      'UPDATE users SET email=$1, avatar_url=$2 WHERE id=$3',
      [email || row.email, avatarUrl || row.avatar_url, row.id]
    );
    return row;
  }

  // New user: pick a non-colliding display name
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await db.query('SELECT 1 FROM users WHERE display_name=$1', [name]);
    if (!taken.rows.length) break;
    name = `${baseName}${Math.floor(Math.random() * 9000 + 1000)}`;
  }

  const insert = await db.query(
    `INSERT INTO users (provider, provider_id, display_name, email, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [provider, providerId, name, email || null, avatarUrl || null]
  );
  return insert.rows[0];
}

// Guest display names look exactly like "Guest 4821". Registered users are
// forbidden from taking this shape (see updateDisplayName) so a guest slot can
// never be impersonated, and vice-versa.
const GUEST_NAME_RE = /^guest\s*#?\s*\d+$/i;

// Create a throwaway guest identity: "Guest ####", is_guest=true, no OAuth.
// display_name is UNIQUE (citext), so retry on the rare number collision.
async function createGuest() {
  const crypto = require('node:crypto');
  for (let attempt = 0; attempt < 8; attempt++) {
    // Widen the number space after a few collisions to keep it fast under load.
    const span = attempt < 4 ? 9000 : 900000;
    const floor = attempt < 4 ? 1000 : 100000;
    const name = `Guest ${Math.floor(Math.random() * span + floor)}`;
    try {
      const { rows } = await db.query(
        `INSERT INTO users (provider, provider_id, display_name, is_guest)
         VALUES ('guest', $1, $2, true)
         RETURNING *`,
        [crypto.randomUUID(), name]
      );
      return rows[0];
    } catch (e) {
      if (e.code === '23505') continue; // unique_violation → try another number
      throw e;
    }
  }
  throw new Error('Could not allocate a guest name');
}

// Delete guests with no live session, older than `olderThanHours`. Sessions
// cascade-delete, so a guest whose only session expired is safe to reap.
async function reapStaleGuests(olderThanHours = 48) {
  const { rowCount } = await db.query(
    `DELETE FROM users u
      WHERE u.is_guest
        AND u.created_at < now() - ($1 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.user_id = u.id AND s.expires_at > now()
        )`,
    [String(olderThanHours)]
  );
  return rowCount;
}

// Hard-delete sessions of guests idle for more than `hours` (the SQL guard in
// findUserBySession already treats them as logged out; this cleans them up so
// reapStaleGuests / purgeGuests can then remove the guest accounts themselves).
async function expireInactiveGuestSessions(hours = 12) {
  const { rowCount } = await db.query(
    `DELETE FROM sessions s USING users u
      WHERE s.user_id = u.id AND u.is_guest
        AND GREATEST(coalesce(u.last_seen, s.created_at), s.created_at)
            < now() - ($1 || ' hours')::interval`,
    [String(hours)]
  );
  return rowCount;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [id]);
  return rows[0] || null;
}

async function findByDisplayName(name) {
  if (!name) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE display_name=$1', [name]);
  return rows[0] || null;
}

// Directory search for starting DMs / friend requests. Registered accounts only
// (guests are excluded — they can't be messaged), case-insensitive prefix/substring.
async function searchByName(query, excludeId, limit = 10) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];
  const { rows } = await db.query(
    `SELECT id, display_name, avatar_url FROM users
     WHERE is_guest = false AND id <> $2 AND display_name ILIKE $1
     ORDER BY (display_name ILIKE $3) DESC, display_name
     LIMIT $4`,
    [`%${q}%`, excludeId || '00000000-0000-0000-0000-000000000000', `${q}%`, limit]
  );
  return rows;
}

async function createSession(userId, ttlDays = 30) {
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, expires_at)
     VALUES ($1, now() + ($2 || ' days')::interval)
     RETURNING sid`,
    [userId, String(ttlDays)]
  );
  return rows[0].sid;
}

async function findUserBySession(sid) {
  if (!sid) return null;
  // Guests auto-log-out after 12 hours of inactivity (last_seen is bumped on
  // WS connect + heartbeat across all services; fall back to session age).
  const { rows } = await db.query(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.sid = $1 AND s.expires_at > now()
       AND (u.is_guest = false
            OR GREATEST(coalesce(u.last_seen, s.created_at), s.created_at) > now() - interval '12 hours')`,
    [sid]
  );
  // Banned accounts are treated as logged-out everywhere (no game, no social).
  if (rows[0] && rows[0].is_banned) return null;
  return rows[0] || null;
}

async function destroySession(sid) {
  if (!sid) return;
  await db.query('DELETE FROM sessions WHERE sid=$1', [sid]);
}

async function getStats(userId) {
  const wins = await db.query(
    'SELECT count(*)::int AS n FROM game_results WHERE winner_user_id=$1',
    [userId]
  );
  const games = await db.query(
    `SELECT count(*)::int AS n FROM game_results
     WHERE players_json @> jsonb_build_array(jsonb_build_object('userId', $1::text))`,
    [userId]
  );
  return {
    wins: wins.rows[0].n,
    games: games.rows[0].n,
    losses: Math.max(0, games.rows[0].n - wins.rows[0].n),
  };
}

async function updateDisplayName(userId, newName) {
  const trimmed = (newName || '').trim().slice(0, 20);
  if (!trimmed) throw new Error('Name cannot be empty');
  if (GUEST_NAME_RE.test(trimmed)) throw new Error('That name is reserved for guests');
  const taken = await db.query(
    'SELECT 1 FROM users WHERE display_name=$1 AND id != $2', [trimmed, userId]
  );
  if (taken.rows.length) throw new Error('That name is already taken');
  await db.query('UPDATE users SET display_name=$1 WHERE id=$2', [trimmed, userId]);
  return trimmed;
}

// ── Presence + admin/moderation ─────────────────────────────────────────────

// Cross-service presence: bump last_seen (called on WS connect + heartbeat).
async function touchLastSeen(userId) {
  if (!userId) return;
  await db.query('UPDATE users SET last_seen = now() WHERE id = $1', [userId]).catch(() => {});
}

// Everyone active within the window (any service). Admin online view.
async function getOnlineUsers(withinSeconds = 120) {
  const { rows } = await db.query(
    `SELECT id, display_name, is_guest, is_admin, is_banned, last_seen
     FROM users
     WHERE last_seen > now() - ($1 || ' seconds')::interval
     ORDER BY is_admin DESC, is_guest, display_name`,
    [String(withinSeconds)]
  );
  return rows;
}

// Admin player directory. Registered accounts only by default (guests are
// ephemeral and just clutter the list); pass includeGuests to see them.
async function listPlayers({ q = '', limit = 50, includeGuests = false } = {}) {
  const like = `%${String(q).trim()}%`;
  const { rows } = await db.query(
    `SELECT id, display_name, provider, is_guest, is_admin, is_banned, ban_reason,
            created_at, last_seen
     FROM users
     WHERE ($1 = '' OR display_name ILIKE $2)
       AND ($4 OR is_guest = false)
     ORDER BY is_admin DESC, last_seen DESC NULLS LAST, display_name
     LIMIT $3`,
    [String(q).trim(), like, limit, !!includeGuests]
  );
  return rows;
}

// Admin: delete guest accounts that have no active (unexpired) session.
async function purgeGuests() {
  const { rowCount } = await db.query(
    `DELETE FROM users u WHERE u.is_guest = true
       AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now())`
  );
  return rowCount;
}

// Platform-wide counts for the admin dashboard.
async function platformStats() {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM users WHERE is_guest = false)::int AS accounts,
       (SELECT count(*) FROM users WHERE is_guest = true)::int  AS guests,
       (SELECT count(*) FROM users WHERE is_admin = true)::int  AS admins,
       (SELECT count(*) FROM users WHERE is_banned = true)::int AS banned,
       (SELECT count(*) FROM users WHERE last_seen > now() - interval '120 seconds')::int AS online`
  );
  return rows[0];
}

async function setAdminBadge(userId, show) {
  const { rows } = await db.query(
    'UPDATE users SET show_admin_badge = $2 WHERE id = $1 RETURNING id, show_admin_badge',
    [userId, !!show]
  );
  return rows[0] || null;
}

async function setBanned(userId, banned, reason = null) {
  const { rows } = await db.query(
    'UPDATE users SET is_banned = $2, ban_reason = $3 WHERE id = $1 RETURNING id, display_name, is_banned',
    [userId, !!banned, banned ? (reason || null) : null]
  );
  return rows[0] || null;
}

async function setAdmin(userId, admin) {
  const { rows } = await db.query(
    'UPDATE users SET is_admin = $2 WHERE id = $1 RETURNING id, display_name, is_admin',
    [userId, !!admin]
  );
  return rows[0] || null;
}

// Grant admin by email (used to bootstrap admins from ADMIN_EMAILS on login).
async function grantAdminByEmail(email) {
  if (!email) return;
  await db.query('UPDATE users SET is_admin = true WHERE lower(email) = lower($1)', [email]).catch(() => {});
}

module.exports = {
  upsertUser, findById, findByDisplayName, searchByName,
  createGuest, reapStaleGuests, expireInactiveGuestSessions, GUEST_NAME_RE,
  createSession, findUserBySession, destroySession,
  getStats, updateDisplayName,
  touchLastSeen, getOnlineUsers, listPlayers, setBanned, setAdmin, grantAdminByEmail,
  purgeGuests, platformStats, setAdminBadge,
};
