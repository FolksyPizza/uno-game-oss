const db = require('./index');

async function record({ roomCode, userId, displayName, text }) {
  await db.query(
    `INSERT INTO chat_messages (room_code, user_id, display_name, text)
     VALUES ($1, $2, $3, $4)`,
    [roomCode, userId || null, displayName, text]
  );
}

async function recentForRoom(roomCode, limit = 50) {
  const { rows } = await db.query(
    `SELECT display_name AS name, text, ts
     FROM chat_messages
     WHERE room_code = $1
     ORDER BY ts DESC
     LIMIT $2`,
    [roomCode, limit]
  );
  return rows.reverse().map(r => ({ name: r.name, text: r.text, ts: new Date(r.ts).getTime() }));
}

module.exports = { record, recentForRoom };
