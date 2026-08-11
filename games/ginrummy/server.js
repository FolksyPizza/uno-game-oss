'use strict';

const express = require('express');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const core = require('../../core');
const { db, oauth, notify, audit, createSocialRouter, quickchat } = core;
const { filterMessage, containsBadWord } = core.profanity;
const userStore = require('../../core/db/users');
const friendsStore = require('../../core/db/friends');
const chatStore = require('../../core/db/chat');
const resultsStore = require('../../core/db/results');
const { createRoom, joinRoom, addBot, removeBot, removeWaitingPlayer } = require('./game/room');
const {
  startMatch, openingPass, drawDiscard, drawStock, discard, nextHand,
  pauseMatch, resumeMatch, viewFor,
} = require('./game/match');
const { shouldTakeOpeningOrDiscard, chooseDraw, chooseDiscard } = require('./game/bot');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

app.use(express.json());
oauth.register(app, cookieParser);
app.use(createSocialRouter({
  getOnlineUserIds: () => new Set([...wss.clients].map(ws => ws.userId).filter(Boolean)),
  notifyUser: notify.notifyUser,
}));

app.get('/api/online', (req, res) => {
  let players = 0, games = 0;
  for (const room of rooms.values()) {
    players += [...room.players.values()].filter(p => !p.isBot && p.isConnected).length;
    if (room.phase === 'playing') games++;
  }
  res.json({ players, games, connections: wss.clients.size });
});

async function authFromReq(req) {
  if (!db.isReady()) return null;
  const sid = req.cookies?.[oauth.SESSION_COOKIE];
  return sid ? userStore.findUserBySession(sid).catch(() => null) : null;
}

app.post('/api/invite', async (req, res) => {
  const user = await authFromReq(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  if (user.is_guest) return res.status(403).json({ error: 'Sign in to invite players' });
  const friendId = req.body?.friendId;
  const roomCode = String(req.body?.roomCode || '').toUpperCase();
  if (!friendId || !rooms.has(roomCode)) return res.status(404).json({ error: 'Room not found' });
  const base = (process.env.PUBLIC_URL || 'http://localhost:5080').replace(/\/+$/, '');
  const joinBase = (process.env.JOIN_URL || '').replace(/\/+$/, '');
  const url = joinBase
    ? `${joinBase}/ginrummy/${encodeURIComponent(roomCode)}`
    : `${base}/ginrummy/?room=${encodeURIComponent(roomCode)}`;
  notify.notifyUser(friendId, { type: 'game_invite', game: 'ginrummy', fromName: user.display_name, fromId: user.id, roomCode, url });
  friendsStore.sendDM(user.id, friendId, `🎮 Join my Gin Rummy room: ${url}`).catch(() => {});
  audit.log('ginrummy.invite', { actorUserId: user.id, actorName: user.display_name, req, target: friendId, meta: { roomCode } });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

function send(ws, payload) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(payload));
}

function sendError(ws, message) { send(ws, { type: 'error', message }); }

function roomPlayers(room) {
  return room.playerOrder.map(id => room.players.get(id)).filter(Boolean).map(p => ({
    id: p.id, name: p.name, isBot: !!p.isBot, difficulty: p.difficulty,
    connected: !!p.isConnected, isHost: room.hostId === p.id,
  }));
}

function roomInfo(room) {
  return { roomCode: room.code, hostId: room.hostId, players: roomPlayers(room), isPublic: room.isPublic, phase: room.phase };
}

function broadcast(room, payload, excludeId = null) {
  for (const p of room.players.values()) {
    if (!p.isBot && p.isConnected && p.id !== excludeId) send(p.ws, payload);
  }
}

function broadcastRoom(room) { broadcast(room, { type: 'room_updated', ...roomInfo(room) }); }

function broadcastState(room) {
  if (!room.match) return;
  for (const p of room.players.values()) {
    if (!p.isBot && p.isConnected) send(p.ws, { type: 'state', state: viewFor(room, p.id) });
  }
}

function playerCredentials(player) {
  return { playerId: player.id, reconnectToken: player.reconnectToken };
}

function touch(room) { room.lastActiveAt = Date.now(); }

async function validateName(ws, raw) {
  const name = ws.user ? ws.user.display_name : String(raw || '').trim().slice(0, 20);
  if (!name) throw new Error('Name is required');
  if (containsBadWord(name)) throw new Error('Please choose a different name');
  if (!ws.user) {
    const reserved = await userStore.findByDisplayName(name).catch(() => null);
    if (reserved) throw new Error('That name belongs to a registered account');
  }
  return name;
}

function maybeRecordMatch(room) {
  const match = room.match;
  if (!match || match.phase !== 'match_result' || match.resultRecorded) return;
  match.resultRecorded = true;
  const winner = room.players.get(match.winnerId);
  audit.log('ginrummy.match.complete', {
    actorUserId: winner?.userId || null, actorName: winner?.name,
    target: room.code, meta: { scores: match.finalScores?.totals },
  });
  if (!db.isReady()) return;
  const players = room.playerOrder.map(id => {
    const p = room.players.get(id);
    return { userId: p.userId || null, displayName: p.name, isBot: !!p.isBot };
  });
  resultsStore.record({
    roomCode: room.code, winnerUserId: winner?.userId || null, players,
    startedAt: new Date(match.startedAt).toISOString(), gameKey: 'ginrummy',
    score: match.finalScores,
  }).catch(e => console.error('[DB] Gin Rummy result record failed:', e.message));
}

function afterAction(room) {
  touch(room);
  maybeRecordMatch(room);
  broadcastState(room);
  triggerBot(room);
}

const botTimers = new Map();
function triggerBot(room) {
  const match = room.match;
  if (!match || room.phase !== 'playing' || ['paused', 'hand_result', 'match_result'].includes(match.phase)) return;
  const bot = room.players.get(match.activePlayerId);
  if (!bot?.isBot || botTimers.has(room.code)) return;
  const marker = `${match.handNumber}:${match.phase}:${match.activePlayerId}:${match.log.length}`;
  const timer = setTimeout(() => {
    botTimers.delete(room.code);
    if (!rooms.has(room.code) || room.match !== match) return;
    const now = `${match.handNumber}:${match.phase}:${match.activePlayerId}:${match.log.length}`;
    if (now !== marker || room.players.get(match.activePlayerId)?.id !== bot.id) return;
    try {
      if (['opening_offer_non_dealer', 'opening_offer_dealer'].includes(match.phase)) {
        if (shouldTakeOpeningOrDiscard(room, bot.id)) drawDiscard(room, bot.id);
        else openingPass(room, bot.id);
      } else if (match.phase === 'must_draw_stock') {
        drawStock(room, bot.id);
      } else if (match.phase === 'draw') {
        if (chooseDraw(room, bot.id) === 'discard') drawDiscard(room, bot.id);
        else drawStock(room, bot.id);
      } else if (match.phase === 'discard') {
        const action = chooseDiscard(room, bot.id);
        discard(room, bot.id, action.cardId, action.knock);
      }
      console.log(`[BOT]  ${bot.name} acted in ${room.code}`);
      afterAction(room);
    } catch (e) {
      console.error(`[BOT]  ${bot.name} failed in ${room.code}: ${e.message}`);
    }
  }, 650);
  botTimers.set(room.code, timer);
}

function resetToWaiting(room) {
  for (const [id, p] of room.players) {
    p.hand = [];
    if (!p.isBot && !p.isConnected) {
      room.players.delete(id);
      room.playerOrder = room.playerOrder.filter(pid => pid !== id);
    }
  }
  room.match = null;
  room.phase = 'waiting';
  if (!room.players.has(room.hostId)) {
    room.hostId = room.playerOrder.find(id => !room.players.get(id)?.isBot) || null;
  }
  broadcastRoom(room);
}

wss.on('connection', async (ws, req) => {
  ws.isAlive = true; ws.userId = null; ws.user = null; ws.playerId = null; ws.roomCode = null; ws._closed = false;
  try {
    const sid = oauth.readSidFromCookieHeader(req.headers.cookie);
    if (sid) {
      const user = await userStore.findUserBySession(sid).catch(() => null);
      if (user) { ws.userId = user.id; ws.user = user; }
    }
  } catch {}
  notify.register(ws, ws.userId);
  if (ws.userId) userStore.touchLastSeen(ws.userId);
  ws.on('pong', () => { ws.isAlive = true; if (ws.userId) userStore.touchLastSeen(ws.userId); });
  ws.on('message', buf => {
    let message;
    try { message = JSON.parse(buf); } catch { return sendError(ws, 'Invalid message'); }
    handleMessage(ws, message).catch(e => { console.error('[GIN]', e); sendError(ws, e.message); });
  });
  const close = () => { if (ws._closed) return; ws._closed = true; notify.unregister(ws); handleDisconnect(ws); };
  ws.on('close', close); ws.on('error', close);
});

async function handleMessage(ws, d) {
  const type = d.type;
  if (type === 'create_room') {
    const name = await validateName(ws, d.playerName);
    const { room, player } = createRoom(rooms, name, ws, d.isPublic);
    audit.log('ginrummy.room.create', { actorUserId: ws.userId, actorName: name, target: room.code });
    return send(ws, { type: 'room_joined', ...roomInfo(room), ...playerCredentials(player), chat: [] });
  }
  if (type === 'join_room') {
    const name = await validateName(ws, d.playerName);
    const code = String(d.roomCode || '').trim().toUpperCase();
    const { room, player, reconnected } = joinRoom(rooms, code, name, ws, d.playerId, d.reconnectToken);
    const resumed = reconnected ? resumeMatch(room) : false;
    audit.log('ginrummy.room.join', { actorUserId: ws.userId, actorName: name, target: code, meta: { reconnected } });
    send(ws, { type: 'room_joined', ...roomInfo(room), ...playerCredentials(player), chat: room.chat.slice(-30), reconnected });
    broadcastRoom(room);
    if (room.match) broadcastState(room);
    if (resumed) triggerBot(room);
    return;
  }
  if (type === 'list_rooms') {
    const list = [...rooms.values()].filter(r => r.isPublic && r.phase === 'waiting' && r.players.size < 2).map(r => ({
      code: r.code, hostName: r.players.get(r.hostId)?.name || 'Player', playerCount: r.players.size,
    }));
    return send(ws, { type: 'rooms_list', rooms: list });
  }

  const room = rooms.get(ws.roomCode);
  const player = room?.players.get(ws.playerId);
  if (!room || !player) throw new Error('Join a room first');
  touch(room);

  switch (type) {
    case 'set_visibility':
      if (room.hostId !== player.id || room.phase !== 'waiting') throw new Error('Only the host can change visibility before the match');
      room.isPublic = !!d.isPublic; broadcastRoom(room); break;
    case 'add_bot':
      if (room.hostId !== player.id) throw new Error('Only the host can add a bot');
      addBot(room, d.difficulty); broadcastRoom(room); break;
    case 'remove_bot':
      if (room.hostId !== player.id) throw new Error('Only the host can remove a bot');
      removeBot(room, d.botId); broadcastRoom(room); break;
    case 'start_match':
      if (room.hostId !== player.id) throw new Error('Only the host can start the match');
      if (room.phase !== 'waiting' || room.players.size !== 2) throw new Error('Two players are required');
      if ([...room.players.values()].some(p => !p.isConnected)) throw new Error('Both players must be connected');
      startMatch(room); audit.log('ginrummy.match.start', { actorUserId: ws.userId, actorName: player.name, target: room.code });
      broadcastRoom(room); afterAction(room); break;
    case 'opening_pass': openingPass(room, player.id); afterAction(room); break;
    case 'draw_stock': drawStock(room, player.id); afterAction(room); break;
    case 'draw_discard': drawDiscard(room, player.id); afterAction(room); break;
    case 'discard': discard(room, player.id, String(d.cardId || ''), false); afterAction(room); break;
    case 'knock': discard(room, player.id, String(d.cardId || ''), true); afterAction(room); break;
    case 'next_hand': nextHand(room, player.id); afterAction(room); break;
    case 'end_match':
      if (room.hostId !== player.id && room.match?.phase !== 'paused') throw new Error('Only the host can end an active match');
      audit.log('ginrummy.match.end', { actorUserId: ws.userId, actorName: player.name, target: room.code });
      resetToWaiting(room); break;
    case 'chat_message': {
      const raw = String(d.text || '');
      let text;
      if (ws.user?.is_guest) {
        if (!quickchat.isQuickChat(raw)) throw new Error('Guests may use quick chat only');
        text = raw;
      } else {
        text = filterMessage(raw);
        if (!text) return;
      }
      const entry = { name: player.name, text, ts: Date.now() };
      room.chat.push(entry); if (room.chat.length > 100) room.chat.shift();
      broadcast(room, { type: 'chat_broadcast', message: entry });
      if (db.isReady() && player.userId) chatStore.record({ roomCode: `gin:${room.code}`, userId: player.userId, displayName: player.name, text }).catch(() => {});
      break;
    }
    default: throw new Error('Unknown message type');
  }
}

function handleDisconnect(ws) {
  const room = rooms.get(ws.roomCode);
  const player = room?.players.get(ws.playerId);
  if (!room || !player || player.ws !== ws) return;
  player.ws = null; player.isConnected = false; touch(room);
  console.log(`[DISC] ${player.name} disconnected from ${room.code}`);
  if (room.phase === 'waiting') {
    removeWaitingPlayer(room, player.id);
    if (![...room.players.values()].some(p => !p.isBot)) rooms.delete(room.code);
    else broadcastRoom(room);
  } else {
    pauseMatch(room); broadcastRoom(room); broadcastState(room);
  }
}

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false; try { ws.ping(); } catch {}
  }
}, 30000);

const cleanup = setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [code, room] of rooms) {
    const noHumans = [...room.players.values()].every(p => p.isBot || !p.isConnected);
    // Active matches deliberately remain reconnectable indefinitely. Only
    // abandoned waiting rooms are eligible for routine cleanup.
    if (room.phase === 'waiting' && noHumans && room.lastActiveAt < cutoff) rooms.delete(code);
  }
}, 15 * 60 * 1000);

const PORT = process.env.PORT || 5080;
db.init().then(() => notify.init(process.env.DATABASE_URL)).catch(() => {}).finally(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`[GIN]  Gin Rummy → http://localhost:${PORT}`));
});

function shutdown(signal) {
  console.log(`[GIN]  Received ${signal}, shutting down`);
  clearInterval(heartbeat); clearInterval(cleanup);
  for (const timer of botTimers.values()) clearTimeout(timer);
  for (const ws of wss.clients) { try { ws.close(1001, 'server shutdown'); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, rooms };
