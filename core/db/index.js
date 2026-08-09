// Postgres connection + migration runner.
//
// If DATABASE_URL is unset or unreachable, the module exports a no-op
// stub and the server runs in "degraded mode" (guests-only, no auth,
// no chat persistence, no stats).

const fs = require('node:fs');
const path = require('node:path');

let pool = null;
let ready = false;

async function init() {
  if (!process.env.DATABASE_URL) {
    console.warn('[DB]   DATABASE_URL not set — running in degraded mode (guests only, no auth/stats)');
    return false;
  }

  let Pool;
  try { ({ Pool } = require('pg')); }
  catch {
    console.warn('[DB]   pg module not installed — degraded mode');
    return false;
  }

  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

  // Retry connection with backoff (db service may still be starting)
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (e) {
      if (attempt === 10) {
        console.error('[DB]   Could not connect after 10 attempts:', e.message);
        pool = null;
        return false;
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  await migrate();
  ready = true;
  console.log('[DB]   Connected and migrated');
  return true;
}

// A fixed key so every service serializes on the SAME advisory lock.
const MIGRATION_LOCK_KEY = 727274;

async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  // Serialize migrations across all services (hub + games boot concurrently and
  // share one Postgres). Without this, two services race on the same migration
  // and the loser's INSERT hits the _migrations PK → its db.init() rejects and
  // the service comes up degraded (auth/guests broken). The advisory lock must
  // be held on a single dedicated connection.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        run_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query('SELECT name FROM _migrations');
    const done = new Set(rows.map(r => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      console.log(`[DB]   Running migration ${f}`);
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [f]);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

function isReady() { return ready; }

async function query(text, params) {
  if (!ready) throw new Error('DB not available');
  return pool.query(text, params);
}

async function close() {
  if (pool) await pool.end();
  pool = null;
  ready = false;
}

module.exports = { init, query, isReady, close };
