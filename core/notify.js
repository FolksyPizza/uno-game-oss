// Cross-service user notifications via Postgres LISTEN/NOTIFY.
//
// Each service (hub, uno, future games) keeps a local registry of live
// WebSocket connections keyed by userId. To deliver a DM / friend request /
// game invite to a user who may be connected to a *different* service, we
// publish on a shared Postgres channel; every service (including the origin)
// receives the notification via LISTEN and fans it out to its own local
// sockets. Single delivery path → no double-sends. No Redis/new infra needed.
//
// In degraded mode (no DATABASE_URL) we fall back to local-only delivery so a
// single process still works for development.

const CHANNEL = 'rg_user_notify';

const localConns = new Map(); // userId -> Set<ws>
let listenClient = null;
let ready = false;

function register(ws, userId) {
  if (!userId) return;
  if (!localConns.has(userId)) localConns.set(userId, new Set());
  localConns.get(userId).add(ws);
}

function unregister(ws) {
  for (const [userId, set] of localConns) {
    if (set.delete(ws) && set.size === 0) localConns.delete(userId);
  }
}

function onlineUserIds() {
  return new Set(localConns.keys());
}

function deliverLocal(userId, payload) {
  const set = localConns.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) {
      try { ws.send(data); } catch {}
    }
  }
}

async function init(connectionString) {
  if (!connectionString) return false;
  let Client;
  try { ({ Client } = require('pg')); } catch { return false; }
  try {
    listenClient = new Client({ connectionString });
    await listenClient.connect();
    await listenClient.query(`LISTEN ${CHANNEL}`);
    listenClient.on('notification', (msg) => {
      try {
        const { userId, payload } = JSON.parse(msg.payload);
        deliverLocal(userId, payload);
      } catch {}
    });
    listenClient.on('error', (e) => console.error('[NOTIFY] listen error:', e.message));
    ready = true;
    console.log('[NOTIFY] cross-service channel ready');
    return true;
  } catch (e) {
    console.warn('[NOTIFY] LISTEN unavailable, local-only delivery:', e.message);
    listenClient = null;
    return false;
  }
}

async function notifyUser(userId, payload) {
  if (!userId) return;
  if (ready && listenClient) {
    try {
      await listenClient.query(`SELECT pg_notify($1, $2)`, [
        CHANNEL,
        JSON.stringify({ userId, payload }),
      ]);
      return;
    } catch (e) {
      console.error('[NOTIFY] publish failed, delivering locally:', e.message);
    }
  }
  deliverLocal(userId, payload); // degraded / single-process fallback
}

async function close() {
  if (listenClient) { try { await listenClient.end(); } catch {} }
  listenClient = null;
  ready = false;
}

module.exports = { init, register, unregister, onlineUserIds, notifyUser, close };
