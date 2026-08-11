ALTER TABLE game_results
  ADD COLUMN IF NOT EXISTS game_key text NOT NULL DEFAULT 'uno',
  ADD COLUMN IF NOT EXISTS score_json jsonb;

CREATE INDEX IF NOT EXISTS game_results_game_key_idx ON game_results(game_key);
