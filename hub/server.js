// Rosemont Games hub — the central catalog at gamehub.rosemont.place.
//
// Owns the unified sign-in (central OAuth → cookie scoped to .rosemont.place)
// and the shared social API; serves the game catalog. A lightweight WebSocket
// endpoint registers signed-in browsers for cross-service notifications (DMs,
// friend requests, game invites) via core/notify.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const core = require('../core');
const { db, oauth, notify, createSocialRouter, createAdminRouter } = core;
const userStore = require('../core/db/users');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
oauth.register(app, cookieParser);

// Shared social API (accounts, friends, DMs) — identical to every game server.
app.use(createSocialRouter({
  getOnlineUserIds: () => notify.onlineUserIds(),
  notifyUser: notify.notifyUser,
}));
app.use(createAdminRouter());

app.get('/api/online', (req, res) => {
  res.json({ players: notify.onlineUserIds().size, connections: wss.clients.size });
});

// Serve the landing page with ABSOLUTE social-preview URLs. Link scrapers
// (iMessage, Twitter, Facebook) don't run JS, so og:image/og:url must be
// absolute in the raw HTML — computed once at boot from PUBLIC_URL.
const PUBLIC_BASE = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5060}`).replace(/\/+$/, '');
const INDEX_HTML = (() => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html
      .replace(/(<meta property="og:image" content=")og\.png(")/, `$1${PUBLIC_BASE}/og.png$2`)
      .replace(/(<meta name="twitter:image" content=")og\.png(")/, `$1${PUBLIC_BASE}/og.png$2`);
    if (!/property="og:url"/.test(html)) {
      html = html.replace('</title>', `</title>\n  <meta property="og:url" content="${PUBLIC_BASE}/">`);
    }
    return html;
  } catch { return null; }
})();

app.get(['/', '/index.html'], (req, res, next) => {
  if (!INDEX_HTML) return next();
  res.type('html').send(INDEX_HTML);
});

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', async (ws, req) => {
  ws.isAlive = true;
  ws.userId = null;
  try {
    const sid = oauth.readSidFromCookieHeader(req.headers.cookie);
    if (sid) {
      const u = await userStore.findUserBySession(sid).catch(() => null);
      if (u) ws.userId = u.id;
    }
  } catch {}
  notify.register(ws, ws.userId);
  if (ws.userId) userStore.touchLastSeen(ws.userId);
  ws.on('pong', () => { ws.isAlive = true; if (ws.userId) userStore.touchLastSeen(ws.userId); });
  ws.on('close', () => notify.unregister(ws));
  ws.on('error', () => notify.unregister(ws));
});

// Guest lifecycle: sessions die after 12h of inactivity (enforced at read time
// in findUserBySession too — this reaper just cleans up), then the idle guest
// accounts themselves get deleted. The hub owns this so games don't race on it.
async function reapGuests() {
  try {
    await userStore.expireInactiveGuestSessions(12);
    await userStore.reapStaleGuests(12);
  } catch {}
}
const guestReaper = setInterval(reapGuests, 60 * 60 * 1000);

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

const PORT = process.env.PORT || 5060;
db.init()
  .then(() => notify.init(process.env.DATABASE_URL))
  .catch(() => {})
  .finally(() => {
    reapGuests();   // first sweep once the DB is actually ready
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[HUB]  Rosemont Games hub → http://localhost:${PORT}`);
    });
  });

function shutdown(signal) {
  console.log(`[HUB]  Received ${signal}, shutting down`);
  clearInterval(heartbeat);
  clearInterval(guestReaper);
  for (const ws of wss.clients) { try { ws.close(1001, 'server shutdown'); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
