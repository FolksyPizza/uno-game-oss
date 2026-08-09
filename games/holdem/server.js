// Texas Hold'em service. A simple, room-based no-limit table on the shared core
// (auth, social, notifications, audit). One Table per room; seats fill on join,
// any seated player can deal when ≥2 are seated and no hand is live.

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('node:crypto');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const core = require('../../core');
const { db, oauth, notify, audit, createSocialRouter, quickchat } = core;
const { filterMessage } = core.profanity;
const userStore = require('../../core/db/users');
const friendsStore = require('../../core/db/friends');
const { Table } = require('./game/table');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // code -> { table, chat: [] }

app.use(express.json());
oauth.register(app, cookieParser);
app.use(createSocialRouter({
  getOnlineUserIds: () => {
    const ids = new Set();
    for (const ws of wss.clients) if (ws.userId) ids.add(ws.userId);
    return ids;
  },
  notifyUser: notify.notifyUser,
}));

app.get('/api/online', (req, res) => {
  let players = 0, games = 0;
  for (const { table } of rooms.values()) {
    players += table.seats.filter(p => p.connected).length;
    if (table.phase !== 'waiting' && table.phase !== 'showdown') games++;
  }
  res.json({ players, games, connections: wss.clients.size });
});

// One-click invite: DM a specific player a join link to this table.
app.post('/api/invite', async (req, res) => {
  const sid = oauth.readSidFromCookieHeader(req.headers.cookie);
  const user = sid ? await userStore.findUserBySession(sid).catch(() => null) : null;
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  if (user.is_guest) return res.status(403).json({ error: 'Sign in to invite players' });
  const { friendId, roomCode } = req.body || {};
  if (!friendId || !roomCode) return res.status(400).json({ error: 'Missing fields' });
  const code = String(roomCode).toUpperCase();
  if (!rooms.has(code)) return res.status(404).json({ error: 'Table not found' });
  const base = (process.env.PUBLIC_URL || 'http://localhost:5070').replace(/\/+$/, '');
  const joinBase = (process.env.JOIN_URL || '').replace(/\/+$/, '');
  const url = joinBase
    ? `${joinBase}/holdem/${encodeURIComponent(code)}`
    : `${base}/holdem/?room=${encodeURIComponent(code)}`;
  notify.notifyUser(friendId, { type: 'game_invite', game: 'holdem', fromName: user.display_name, fromId: user.id, roomCode: code, url });
  friendsStore.sendDM(user.id, friendId, `🎮 Join my Texas Hold'em table: ${url}`).catch(() => {});
  audit.log('holdem.invite', { actorUserId: user.id, actorName: user.display_name, req, target: friendId, meta: { roomCode: code } });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

function roomCode() {
  let c;
  do { c = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5); } while (rooms.has(c));
  return c;
}
function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { table: new Table(), chat: [] });
  return rooms.get(code);
}

function send(ws, msg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const ws of wss.clients) {
    if (ws.roomCode !== code) continue;
    send(ws, { type: 'state', state: room.table.viewFor(ws.playerId), chat: room.chat.slice(-30) });
  }
}

wss.on('connection', async (ws, req) => {
  ws.isAlive = true;
  ws.userId = null;
  ws.playerId = null;
  ws.roomCode = null;
  try {
    const sid = oauth.readSidFromCookieHeader(req.headers.cookie);
    if (sid) {
      const u = await userStore.findUserBySession(sid).catch(() => null);
      if (u) { ws.userId = u.id; ws.user = u; }
    }
  } catch {}
  notify.register(ws, ws.userId);
  if (ws.userId) userStore.touchLastSeen(ws.userId);
  ws.on('pong', () => { ws.isAlive = true; if (ws.userId) userStore.touchLastSeen(ws.userId); });

  ws.on('message', (buf) => {
    let d; try { d = JSON.parse(buf); } catch { return; }
    handle(ws, d);
  });
  ws.on('close', () => {
    notify.unregister(ws);
    if (ws.roomCode) {
      const room = rooms.get(ws.roomCode);
      if (room) { room.table.setConnected(ws.playerId, false); broadcast(ws.roomCode); }
    }
  });
  ws.on('error', () => notify.unregister(ws));
});

function handle(ws, d) {
  switch (d.type) {
    case 'join': {
      const code = (d.code && String(d.code).toUpperCase()) || roomCode();
      const room = getRoom(code);
      ws.roomCode = code;
      ws.playerId = ws.userId || `guest-${crypto.randomBytes(4).toString('hex')}`;
      const name = ws.user ? ws.user.display_name : (String(d.name || '').trim().slice(0, 20) || 'Player');
      ws.playerName = name;
      const seated = room.table.addPlayer({ id: ws.playerId, name, isGuest: !ws.userId || !!ws.user?.is_guest });
      send(ws, { type: 'joined', code, playerId: ws.playerId, seated });
      audit.log('holdem.join', { actorUserId: ws.userId, actorName: name, target: code });
      broadcast(code);
      break;
    }
    case 'deal': {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      if (room.table.canStart()) { room.table.startHand(); broadcast(ws.roomCode); }
      break;
    }
    case 'action': {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const r = room.table.act(ws.playerId, { type: d.action, amount: d.amount });
      if (r && r.error) send(ws, { type: 'error', error: r.error });
      broadcast(ws.roomCode);
      break;
    }
    case 'chat': {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const isGuest = !ws.userId || !!ws.user?.is_guest;
      let text;
      if (isGuest) {
        // Guests: quick-chat phrases only (no free text).
        if (!quickchat.isQuickChat(d.text)) return;
        text = d.text;
      } else {
        text = filterMessage(String(d.text || ''));
        if (!text) return;
      }
      room.chat.push({ name: ws.playerName || 'Player', text, ts: Date.now() });
      if (room.chat.length > 60) room.chat.shift();
      broadcast(ws.roomCode);
      break;
    }
    case 'leave': {
      const room = rooms.get(ws.roomCode);
      if (room) { room.table.removePlayer(ws.playerId); broadcast(ws.roomCode); }
      ws.roomCode = null;
      break;
    }
  }
}

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

const PORT = process.env.PORT || 5070;
db.init()
  .then(() => notify.init(process.env.DATABASE_URL))
  .catch(() => {})
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => console.log(`[HOLDEM] → http://localhost:${PORT}`));
  });

function shutdown(sig) {
  console.log(`[HOLDEM] ${sig}, shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) { try { ws.close(1001); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
