const db = require('./index');

async function record({ roomCode, winnerUserId, players, startedAt }) {
  await db.query(
    `INSERT INTO game_results (room_code, winner_user_id, players_json, started_at)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [roomCode, winnerUserId || null, JSON.stringify(players), startedAt]
  );
}

module.exports = { record };
