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

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [id]);
  return rows[0] || null;
}

async function findByDisplayName(name) {
  if (!name) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE display_name=$1', [name]);
  return rows[0] || null;
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
  const { rows } = await db.query(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.sid = $1 AND s.expires_at > now()`,
    [sid]
  );
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

module.exports = {
  upsertUser, findById, findByDisplayName,
  createSession, findUserBySession, destroySession,
  getStats,
};
