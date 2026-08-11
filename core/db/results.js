const db = require('./index');

async function record({ roomCode, winnerUserId, players, startedAt, gameKey = 'uno', score = null }) {
  await db.query(
    `INSERT INTO game_results
       (room_code, winner_user_id, players_json, started_at, game_key, score_json)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb)`,
    [roomCode, winnerUserId || null, JSON.stringify(players), startedAt, gameKey, score ? JSON.stringify(score) : null]
  );
}

module.exports = { record };
