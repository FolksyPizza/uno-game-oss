// Platform-wide audit logging.
//
// Every notable event (auth, account changes, social actions, moderation, game
// lifecycle) is written both to stdout (structured, always) and to the audit_log
// table (best-effort — never blocks or throws into the caller). Set SERVICE_NAME
// in each service so rows are attributable.

const db = require('./db');

const SERVICE = process.env.SERVICE_NAME || null;

// Extract the client IP, honoring the X-Forwarded-For set by nginx.
function ipFromReq(req) {
  if (!req) return null;
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress || null;
}

// Fire-and-forget. `event` is a dotted category, e.g. 'auth.login'.
function log(event, {
  actorUserId = null, actorName = null, ip = null, target = null, meta = null, req = null,
} = {}) {
  if (req && !ip) ip = ipFromReq(req);

  // Always emit a structured stdout line, even in degraded (no-DB) mode.
  const line = {
    t: new Date().toISOString(), svc: SERVICE || undefined, event,
    actor: actorName || actorUserId || undefined, ip: ip || undefined,
    target: target || undefined, ...(meta ? { meta } : {}),
  };
  console.log('[AUDIT] ' + JSON.stringify(line));

  if (!db.isReady()) return;
  // Persist without awaiting; swallow errors so auditing never breaks a request.
  db.query(
    `INSERT INTO audit_log (event, actor_user_id, actor_name, ip, target, meta, service)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [event, actorUserId, actorName, ip, target, meta ? JSON.stringify(meta) : null, SERVICE]
  ).catch((e) => console.error('[AUDIT] persist failed:', e.message));
}

// Read recent audit entries (for an admin view / debugging).
async function recent({ limit = 100, event = null } = {}) {
  if (!db.isReady()) return [];
  const params = [];
  let where = '';
  if (event) { params.push(event); where = 'WHERE event = $1'; }
  params.push(Math.min(limit, 1000));
  const { rows } = await db.query(
    `SELECT * FROM audit_log ${where} ORDER BY ts DESC LIMIT $${params.length}`, params
  );
  return rows;
}

module.exports = { log, recent, ipFromReq };
