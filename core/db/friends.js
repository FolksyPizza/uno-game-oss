const db = require('./index');

function ordered(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function sendRequest(fromId, toId) {
  if (fromId === toId) throw new Error('Cannot friend yourself');
  const [ua, ub] = ordered(fromId, toId);
  const exists = await db.query(
    'SELECT 1 FROM friendships WHERE user_a=$1 AND user_b=$2', [ua, ub]
  );
  if (exists.rows.length) throw new Error('Already friends');
  const dup = await db.query(
    'SELECT status FROM friend_requests WHERE from_user_id=$1 AND to_user_id=$2',
    [fromId, toId]
  );
  if (dup.rows.length) {
    if (dup.rows[0].status === 'pending') throw new Error('Request already sent');
    await db.query(
      'UPDATE friend_requests SET status=$1, created_at=now() WHERE from_user_id=$2 AND to_user_id=$3',
      ['pending', fromId, toId]
    );
    return;
  }
  const reverse = await db.query(
    'SELECT status FROM friend_requests WHERE from_user_id=$1 AND to_user_id=$2',
    [toId, fromId]
  );
  if (reverse.rows.length && reverse.rows[0].status === 'pending') {
    await acceptRequest(toId, fromId);
    return 'accepted';
  }
  await db.query(
    'INSERT INTO friend_requests (from_user_id, to_user_id) VALUES ($1,$2)',
    [fromId, toId]
  );
}

async function acceptRequest(fromId, accepterId) {
  const r = await db.query(
    'DELETE FROM friend_requests WHERE from_user_id=$1 AND to_user_id=$2 AND status=$3 RETURNING *',
    [fromId, accepterId, 'pending']
  );
  if (!r.rows.length) throw new Error('No pending request');
  const [ua, ub] = ordered(fromId, accepterId);
  await db.query(
    'INSERT INTO friendships (user_a, user_b) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [ua, ub]
  );
}

async function rejectRequest(fromId, rejecterId) {
  await db.query(
    'DELETE FROM friend_requests WHERE from_user_id=$1 AND to_user_id=$2 AND status=$3',
    [fromId, rejecterId, 'pending']
  );
}

async function removeFriend(userId, friendId) {
  const [ua, ub] = ordered(userId, friendId);
  await db.query('DELETE FROM friendships WHERE user_a=$1 AND user_b=$2', [ua, ub]);
}

async function getFriends(userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.display_name, u.avatar_url FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END
     WHERE f.user_a=$1 OR f.user_b=$1
     ORDER BY u.display_name`,
    [userId]
  );
  return rows;
}

async function getPendingRequests(userId) {
  const { rows } = await db.query(
    `SELECT fr.id, fr.from_user_id, u.display_name AS from_name, fr.created_at
     FROM friend_requests fr JOIN users u ON u.id=fr.from_user_id
     WHERE fr.to_user_id=$1 AND fr.status='pending'
     ORDER BY fr.created_at DESC`,
    [userId]
  );
  return rows;
}

async function getSentRequests(userId) {
  const { rows } = await db.query(
    `SELECT fr.id, fr.to_user_id, u.display_name AS to_name, fr.created_at
     FROM friend_requests fr JOIN users u ON u.id=fr.to_user_id
     WHERE fr.from_user_id=$1 AND fr.status='pending'
     ORDER BY fr.created_at DESC`,
    [userId]
  );
  return rows;
}

async function areFriends(a, b) {
  const [ua, ub] = ordered(a, b);
  const { rows } = await db.query(
    'SELECT 1 FROM friendships WHERE user_a=$1 AND user_b=$2', [ua, ub]
  );
  return rows.length > 0;
}

async function sendDM(fromId, toId, text) {
  if (fromId === toId) throw new Error('Cannot message yourself');
  // DMs are open: you can message anyone (friendship not required). The target
  // must be a real (non-guest) account, which the caller validates.
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) throw new Error('Empty message');
  const { rows } = await db.query(
    'INSERT INTO direct_messages (from_user_id, to_user_id, text) VALUES ($1,$2,$3) RETURNING *',
    [fromId, toId, trimmed]
  );
  return rows[0];
}

async function getConversation(userId, friendId, limit = 50) {
  const { rows } = await db.query(
    `SELECT id, from_user_id, to_user_id, text, read, ts FROM direct_messages
     WHERE (from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)
     ORDER BY ts DESC LIMIT $3`,
    [userId, friendId, limit]
  );
  return rows.reverse();
}

async function markRead(userId, fromId) {
  await db.query(
    'UPDATE direct_messages SET read=true WHERE to_user_id=$1 AND from_user_id=$2 AND read=false',
    [userId, fromId]
  );
}

// All DM threads for a user: each partner with the latest message + unread count.
// Independent of friendship (open DMs).
async function getConversations(userId, limit = 40) {
  const { rows } = await db.query(
    `WITH threads AS (
       SELECT CASE WHEN from_user_id=$1 THEN to_user_id ELSE from_user_id END AS partner,
              text, ts,
              (to_user_id=$1 AND read=false) AS is_unread
       FROM direct_messages
       WHERE from_user_id=$1 OR to_user_id=$1
     ),
     latest AS (
       SELECT DISTINCT ON (partner) partner, text AS last_text, ts AS last_ts
       FROM threads ORDER BY partner, ts DESC
     )
     SELECT l.partner AS id, u.display_name, u.avatar_url,
            l.last_text, l.last_ts,
            COALESCE((SELECT count(*) FROM threads t WHERE t.partner=l.partner AND t.is_unread), 0)::int AS unread
     FROM latest l JOIN users u ON u.id = l.partner
     ORDER BY l.last_ts DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function getUnreadCounts(userId) {
  const { rows } = await db.query(
    `SELECT from_user_id, count(*)::int AS n FROM direct_messages
     WHERE to_user_id=$1 AND read=false GROUP BY from_user_id`,
    [userId]
  );
  const map = {};
  for (const r of rows) map[r.from_user_id] = r.n;
  return map;
}

module.exports = {
  sendRequest, acceptRequest, rejectRequest, removeFriend,
  getFriends, getPendingRequests, getSentRequests, areFriends,
  sendDM, getConversation, getConversations, markRead, getUnreadCounts,
};
