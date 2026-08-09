const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const path = require('path');
const cookieParser = require('cookie-parser');
const { createRoom, joinRoom, addBot, removeBot } = require('./game/room');
const {
  initGame, playCard, drawCard, passTurn, chooseColor, autoChooseColor,
  sayUno, catchUno, buildGameStateForPlayer, advanceTurn, executeSevenSwap,
} = require('./game/gameState');
const { getBotAction, getBotColorChoice, getBotSwapTarget } = require('./game/bot');
const core = require('../../core');
const { db, oauth, notify, audit, createSocialRouter, quickchat } = core;
const { filterMessage, containsBadWord } = core.profanity;
const userStore = require('../../core/db/users');
const friendsStore = require('../../core/db/friends');
const chatStore = require('../../core/db/chat');
const resultsStore = require('../../core/db/results');

const app = express();

// HTTPS if TLS_CERT + TLS_KEY are set; HTTP otherwise.
let server;
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  try {
    server = https.createServer({
      cert: fs.readFileSync(process.env.TLS_CERT),
      key:  fs.readFileSync(process.env.TLS_KEY),
    }, app);
    console.log('[SERVER] TLS enabled');
  } catch (e) {
    console.error('[SERVER] TLS cert/key unreadable, falling back to HTTP:', e.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server });

const rooms = new Map();

app.use(express.json());
oauth.register(app, cookieParser);

// Shared social API (accounts, friends, DMs) — identical across hub + all games.
app.use(createSocialRouter({
  getOnlineUserIds: () => {
    const ids = new Set();
    for (const ws of wss.clients) { if (ws.userId) ids.add(ws.userId); }
    return ids;
  },
  notifyUser: notify.notifyUser,
}));

app.get('/api/online', (req, res) => {
  let players = 0;
  let games = 0;
  for (const room of rooms.values()) {
    const humans = [...room.players.values()].filter(p => p.isConnected && !p.isBot).length;
    players += humans;
    if (room.phase === 'playing') games++;
  }
  res.json({ players, games, connections: wss.clients.size });
});

// ── Auth middleware helper ───────────────────────────────────────────────────
async function authFromReq(req) {
  if (!db.isReady()) return null;
  const sid = req.cookies?.[oauth.SESSION_COOKIE];
  if (!sid) return null;
  return userStore.findUserBySession(sid).catch(() => null);
}

// ── Game invite (room-specific; friends/DM live in the shared social router) ───
app.post('/api/invite', async (req, res) => {
  const user = await authFromReq(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  if (user.is_guest) return res.status(403).json({ error: 'Sign in to invite players' });
  const { friendId, roomCode } = req.body || {};
  if (!friendId || !roomCode) return res.status(400).json({ error: 'Missing fields' });
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const base = (process.env.PUBLIC_URL || 'http://localhost:5050').replace(/\/+$/, '');
  const joinBase = (process.env.JOIN_URL || '').replace(/\/+$/, '');
  // Prefer the short join. host (join.rosemont.place/uno/CODE → redirects into
  // the room); fall back to a direct deep link when JOIN_URL isn't configured.
  const url = joinBase
    ? `${joinBase}/uno/${encodeURIComponent(roomCode)}`
    : `${base}/uno/?room=${encodeURIComponent(roomCode)}`;
  // Push a live invite (toast on the hub / in games) AND persist a DM so the
  // invite lives in Messages with a one-click join link.
  notify.notifyUser(friendId, {
    type: 'game_invite', game: 'uno', fromName: user.display_name, fromId: user.id, roomCode, url,
  });
  friendsStore.sendDM(user.id, friendId, `🎮 Join my UNO room: ${url}`).catch(() => {});
  audit.log('game.invite', { actorUserId: user.id, actorName: user.display_name, req, target: friendId, meta: { game: 'uno', roomCode } });
  res.json({ ok: true });
});

const HASH_SECRET = process.env.ROOM_HASH_SECRET || crypto.randomBytes(32).toString('hex');
const roomHashMap = new Map();

function hashRoomCode(code) {
  return crypto.createHmac('sha256', HASH_SECRET).update(code).digest('hex').slice(0, 16);
}

function ensureRoomHash(code) {
  const h = hashRoomCode(code);
  roomHashMap.set(h, code);
  return h;
}

app.get('/api/room-hash/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!rooms.has(code)) return res.status(404).json({ error: 'Room not found' });
  res.json({ hash: ensureRoomHash(code) });
});

app.get('/join/:hash', (req, res) => {
  const code = roomHashMap.get(req.params.hash);
  if (code && rooms.has(code)) {
    // Relative redirect so it stays under the mount prefix: behind nginx uno
    // sees "/join/:hash" but the browser is at "/uno/join/:hash", so "../?room="
    // resolves to "/uno/?room=" (prod) or "/?room=" (dev root).
    return res.redirect(`../?room=${encodeURIComponent(code)}`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──────────────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

function broadcast(room, payload, excludeId = null) {
  for (const p of room.players.values()) {
    if (p.isConnected && !p.isBot && p.id !== excludeId) send(p.ws, payload);
  }
}

function broadcastGameState(room) {
  for (const p of room.players.values()) {
    if (p.isConnected && !p.isBot && p.ws) {
      send(p.ws, { type: 'game_state_update', ...buildGameStateForPlayer(room, p.id) });
    }
  }
}

function roomPlayers(room) {
  return Array.from(room.players.values())
    .filter(p => p.isConnected)
    .map(p => ({ id: p.id, name: p.name, isBot: p.isBot || false, isAdmin: p.isAdmin || false, difficulty: p.isBot ? (p.difficulty || 'medium') : undefined }));
}

function roomInfo(room) {
  return {
    players: roomPlayers(room),
    hostId: room.hostId,
    houseRules: room.houseRules,
    isPublic: room.isPublic || false,
  };
}

function handleGameOver(room) {
  const winner = room.players.get(room.gameState.winnerId);
  room.phase = 'over';
  console.log(`[WIN]  ${winner.name} wins in ${room.code}!`);
  broadcast(room, { type: 'game_over', winnerId: winner.id, winnerName: winner.name });

  if (db.isReady() && room.gameStartedAt) {
    const players = [...room.players.values()].map(p => ({
      userId: p.userId || null, displayName: p.name, isBot: p.isBot,
    }));
    resultsStore.record({
      roomCode: room.code,
      winnerUserId: winner.userId || null,
      players,
      startedAt: new Date(room.gameStartedAt).toISOString(),
    }).catch(e => console.error('[DB] result record failed:', e.message));
  }

  setTimeout(() => {
    if (!rooms.has(room.code)) return;

    for (const [id, p] of room.players) {
      if (!p.isConnected && !p.isBot) {
        room.players.delete(id);
        room.playerOrder = room.playerOrder.filter(oid => oid !== id);
      }
    }

    for (const p of room.players.values()) {
      p.hand = [];
      p.saidUno = false;
    }

    room.phase = 'waiting';
    room.gameState = null;

    if (!room.players.has(room.hostId) && room.playerOrder.length > 0) {
      const newHostId = room.playerOrder.find(id => !room.players.get(id).isBot) || room.playerOrder[0];
      const newHost = room.players.get(newHostId);
      newHost.isHost = true;
      room.hostId = newHostId;
      console.log(`[HOST] ${newHost.name} became host of ${room.code} after reset`);
    }

    console.log(`[ROOM] ${room.code} reset to waiting (${room.players.size} player(s))`);
    broadcast(room, { type: 'room_updated', ...roomInfo(room) });
  }, 5000);
}

function handleDisconnect(ws) {
  if (ws._disconnectHandled) return;
  ws._disconnectHandled = true;

  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;
  // If the player has already been replaced by a new ws (reconnect), ignore.
  if (player.ws && player.ws !== ws) return;

  player.isConnected = false;
  player.ws = null;
  console.log(`[DISC] ${player.name} disconnected from ${code} (phase: ${room.phase})`);

  if (room.phase === 'waiting') {
    room.players.delete(ws.playerId);
    room.playerOrder = room.playerOrder.filter(id => id !== ws.playerId);

    if (room.hostId === ws.playerId && room.playerOrder.length > 0) {
      const newHostId = room.playerOrder.find(id => !room.players.get(id).isBot) || room.playerOrder[0];
      const newHost = room.players.get(newHostId);
      newHost.isHost = true;
      room.hostId = newHostId;
      console.log(`[HOST] ${newHost.name} is now host of ${code}`);
    }

    if (room.players.size === 0 || room.players.size === [...room.players.values()].filter(p => p.isBot).length) {
      rooms.delete(code);
      console.log(`[ROOM] ${code} deleted (no humans)`);
      return;
    }

    broadcast(room, { type: 'room_updated', ...roomInfo(room) });
    return;
  }

  if (room.phase === 'playing') {
    const connected = [...room.players.values()].filter(p => p.isConnected && !p.isBot);

    if (connected.length === 0) {
      rooms.delete(code);
      console.log(`[ROOM] ${code} deleted (all humans disconnected)`);
      return;
    }

    // Don't auto-end game — disconnected players' turns are skipped; they can rejoin
    const gs = room.gameState;
    if (room.playerOrder[gs.currentPlayerIndex] === ws.playerId) {
      if (gs.pendingColorChoice && gs.pendingColorPlayerId === ws.playerId) {
        autoChooseColor(room);
      } else if (gs.pendingSevenSwap && gs.pendingSevenSwapPlayerId === ws.playerId) {
        // Auto-pick swap target
        const target = [...room.players.values()].find(p => p.id !== ws.playerId && p.isConnected);
        if (target) {
          try { executeSevenSwap(room, ws.playerId, target.id); }
          catch (e) { console.error('[SWAP ERR]', e.message); advanceTurn(room, 1); gs.pendingSevenSwap = false; gs.pendingSevenSwapPlayerId = null; }
        } else {
          gs.pendingSevenSwap = false;
          gs.pendingSevenSwapPlayerId = null;
          advanceTurn(room, 1);
        }
      } else {
        advanceTurn(room, 1);
      }
    }

    broadcastGameState(room);
    checkAndTriggerBot(room);
  }
}

// ── Bot execution ────────────────────────────────────────────────────────────

function checkAndTriggerBot(room) {
  if (room.phase !== 'playing' || !room.gameState) return;
  const gs = room.gameState;

  if (gs.pendingColorChoice) {
    const chooser = room.players.get(gs.pendingColorPlayerId);
    if (chooser && chooser.isBot) {
      setTimeout(() => {
        if (!rooms.has(room.code) || room.phase !== 'playing' || !room.gameState) return;
        if (!room.gameState.pendingColorChoice) return;
        const color = getBotColorChoice(room, chooser.id);
        try { chooseColor(room, chooser.id, color); }
        catch (e) { console.error('[BOT COLOR ERR]', e.message); return; }
        console.log(`[BOT]  ${chooser.name} chose ${color} in ${room.code}`);
        broadcastGameState(room);
        checkAndTriggerBot(room);
      }, 900 + Math.random() * 400);
    }
    return;
  }

  if (gs.pendingSevenSwap) {
    const swapper = room.players.get(gs.pendingSevenSwapPlayerId);
    if (swapper && swapper.isBot) {
      setTimeout(() => {
        if (!rooms.has(room.code) || room.phase !== 'playing' || !room.gameState) return;
        if (!room.gameState.pendingSevenSwap) return;
        let targetId = getBotSwapTarget(room, swapper.id);
        let target = targetId ? room.players.get(targetId) : null;
        // Re-validate: target may have disconnected since bot picked
        if (!target || !target.isConnected) {
          target = [...room.players.values()].find(p => p.id !== swapper.id && p.isConnected);
          targetId = target ? target.id : null;
        }
        if (target) {
          try { executeSevenSwap(room, swapper.id, targetId); console.log(`[BOT]  ${swapper.name} swapped with ${target.name}`); }
          catch (e) { console.error('[BOT SWAP ERR]', e.message); room.gameState.pendingSevenSwap = false; room.gameState.pendingSevenSwapPlayerId = null; advanceTurn(room, 1); }
        } else {
          room.gameState.pendingSevenSwap = false;
          room.gameState.pendingSevenSwapPlayerId = null;
          advanceTurn(room, 1);
        }
        broadcastGameState(room);
        checkAndTriggerBot(room);
      }, 900);
    }
    return;
  }

  const currentId = room.playerOrder[gs.currentPlayerIndex];
  const current = room.players.get(currentId);
  if (current && current.isBot) {
    setTimeout(() => executeBotTurn(room, currentId), 800 + Math.random() * 700);
  }
}

function executeBotTurn(room, botId) {
  if (!rooms.has(room.code) || room.phase !== 'playing' || !room.gameState) return;
  const gs = room.gameState;
  if (room.playerOrder[gs.currentPlayerIndex] !== botId) return;
  if (gs.pendingColorChoice || gs.pendingSevenSwap) return;

  const bot = room.players.get(botId);
  if (!bot) return;

  const action = getBotAction(room, botId);

  try {
    if (action.action === 'draw') {
      drawCard(room, botId);
      console.log(`[BOT]  ${bot.name} drew in ${room.code}`);

      // After drawing, check if the drawn card is playable
      if (gs.drawnCardPlayerId === botId) {
        const drawnCard = bot.hand[bot.hand.length - 1];
        const topCard = gs.discardPile[gs.discardPile.length - 1];
        const { canPlayCard } = require('./game/gameState');
        if (canPlayCard(drawnCard, topCard, gs.topCardEffectiveColor, bot.hand)) {
          playCard(room, botId, bot.hand.length - 1);
          console.log(`[BOT]  ${bot.name} played drawn card in ${room.code}`);
          if (gs.winnerId) { handleGameOver(room); return; }
        } else {
          passTurn(room, botId);
        }
      }
    } else {
      // Say UNO if this play will leave 1 card
      if (bot.hand.length === 2) sayUno(room, botId);
      playCard(room, botId, action.cardIndex);
      console.log(`[BOT]  ${bot.name} played card in ${room.code}`);
      if (gs.winnerId) { handleGameOver(room); return; }
    }
  } catch (e) {
    console.error(`[BOT ERR] ${bot.name}: ${e.message}`);
    // Safety: advance turn if bot is stuck
    try { advanceTurn(room, 1); } catch (advErr) { console.error('[BOT ADVANCE ERR]', advErr.message); }
  }

  // Say UNO after playing if 1 card left
  if (bot.hand.length === 1 && !bot.saidUno) sayUno(room, botId);

  broadcastGameState(room);
  checkAndTriggerBot(room);
}

// ── WebSocket ────────────────────────────────────────────────────────────────

wss.on('connection', async (ws, req) => {
  ws.playerId = null;
  ws.roomCode = null;
  ws.isAlive = true;
  ws.userId = null;
  ws.user = null;

  // Resolve account from session cookie if present
  try {
    const sid = oauth.readSidFromCookieHeader(req.headers.cookie);
    if (sid) {
      const u = await userStore.findUserBySession(sid).catch(() => null);
      if (u) { ws.userId = u.id; ws.user = u; }
    }
  } catch {}

  // Register for cross-service notifications (DMs, friend requests, invites).
  notify.register(ws, ws.userId);
  if (ws.userId) userStore.touchLastSeen(ws.userId);

  ws.on('pong', () => { ws.isAlive = true; if (ws.userId) userStore.touchLastSeen(ws.userId); });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return sendError(ws, 'Invalid JSON'); }
    handleMessage(ws, msg);
  });
  ws.on('close', () => { notify.unregister(ws); handleDisconnect(ws); });
  ws.on('error', () => { notify.unregister(ws); handleDisconnect(ws); });
});

// Heartbeat: detect dead connections within ~60s instead of waiting for TCP timeout.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

async function handleMessage(ws, msg) {
  const { type } = msg;
  const d = (msg.payload && typeof msg.payload === 'object') ? msg.payload : msg;

  try {
    switch (type) {

      case 'create_room': {
        let name = d.playerName?.trim();
        if (ws.user) name = ws.user.display_name;
        if (!name) return sendError(ws, 'Name is required');
        if (containsBadWord(name)) return sendError(ws, 'Please choose a different name');
        if (!ws.user) {
          const reserved = await userStore.findByDisplayName(name).catch(() => null);
          if (reserved) return sendError(ws, 'That name is reserved by a registered account — log in to use it');
        }
        const room = createRoom(rooms, name, ws, !!d.isPublic);
        ensureRoomHash(room.code);
        console.log(`[ROOM] ${room.code} created by ${name} (${room.isPublic ? 'public' : 'private'})`);
        send(ws, {
          type: 'room_created',
          roomCode: room.code,
          playerId: ws.playerId,
          ...roomInfo(room),
          chatHistory: room.chat.slice(-20),
        });
        break;
      }

      case 'join_room': {
        let name = d.playerName?.trim();
        const code = d.roomCode?.trim().toUpperCase();
        const reconnectId = d.playerId || null;
        if (ws.user) name = ws.user.display_name;
        if (!name) return sendError(ws, 'Name is required');
        if (!code) return sendError(ws, 'Room code is required');
        if (containsBadWord(name)) return sendError(ws, 'Please choose a different name');
        if (!ws.user) {
          const reserved = await userStore.findByDisplayName(name).catch(() => null);
          if (reserved) return sendError(ws, 'That name is reserved by a registered account — log in to use it');
        }

        const { reconnected } = joinRoom(rooms, code, name, ws, reconnectId);
        const room = rooms.get(code);
        console.log(`[JOIN] ${name} ${reconnected ? 're' : ''}joined ${code}`);

        if (reconnected && room.phase === 'playing' && room.gameState) {
          send(ws, { type: 'game_state_update', ...buildGameStateForPlayer(room, ws.playerId) });
          broadcast(room, { type: 'room_updated', ...roomInfo(room) }, ws.playerId);
        } else {
          send(ws, {
            type: 'room_joined',
            roomCode: code,
            playerId: ws.playerId,
            ...roomInfo(room),
            chatHistory: room.chat.slice(-20),
          });
          broadcast(room, { type: 'room_updated', ...roomInfo(room) }, ws.playerId);
        }
        break;
      }

      case 'start_game': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Room not found');
        if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can start the game');
        if (room.phase !== 'waiting') return sendError(ws, 'Game is already running');
        const connected = [...room.players.values()].filter(p => p.isConnected);
        if (connected.length < 2) return sendError(ws, 'Need at least 2 players to start');

        initGame(room);
        room.phase = 'playing';
        room.gameStartedAt = Date.now();

        const names = room.playerOrder.map(id => room.players.get(id).name).join(', ');
        const top = room.gameState.discardPile[0];
        console.log(`[GAME] Started in ${room.code} — players: ${names} — top: ${top.color} ${top.type}${top.value != null ? ' ' + top.value : ''}`);

        broadcast(room, { type: 'game_started' });
        broadcastGameState(room);

        if (room.gameState.pendingColorChoice) {
          const firstId = room.playerOrder[room.gameState.currentPlayerIndex];
          const first = room.players.get(firstId);
          if (first && !first.isBot && first.isConnected) send(first.ws, { type: 'choose_color_prompt' });
        }
        checkAndTriggerBot(room);
        break;
      }

      case 'play_card': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.phase !== 'playing') return sendError(ws, 'No active game');
        const gs = room.gameState;
        if (gs.pendingColorChoice) return sendError(ws, 'Waiting for color choice');
        if (gs.pendingSevenSwap && gs.pendingSevenSwapPlayerId !== ws.playerId) return sendError(ws, 'Waiting for swap');
        if (room.playerOrder[gs.currentPlayerIndex] !== ws.playerId) return sendError(ws, 'Not your turn');

        const idx = Number(d.cardIndex);
        const player = room.players.get(ws.playerId);
        if (!Number.isInteger(idx) || idx < 0 || !player || idx >= player.hand.length) {
          return sendError(ws, 'Invalid card index');
        }
        playCard(room, ws.playerId, idx);

        const played = gs.discardPile[gs.discardPile.length - 1];
        console.log(`[PLAY] ${player.name} played ${played.color} ${played.type}${played.value != null ? ' ' + played.value : ''} in ${room.code}`);

        if (gs.winnerId) {
          handleGameOver(room);
        } else {
          broadcastGameState(room);
          if (gs.pendingColorChoice) {
            const currentId = room.playerOrder[gs.currentPlayerIndex];
            const current = room.players.get(currentId);
            if (current && !current.isBot && current.isConnected) send(current.ws, { type: 'choose_color_prompt' });
          }
          checkAndTriggerBot(room);
        }
        break;
      }

      case 'draw_card': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.phase !== 'playing') return sendError(ws, 'No active game');
        const gs = room.gameState;
        if (gs.pendingColorChoice) return sendError(ws, 'Waiting for color choice');
        if (room.playerOrder[gs.currentPlayerIndex] !== ws.playerId) return sendError(ws, 'Not your turn');
        if (gs.drawnCardPlayerId === ws.playerId) return sendError(ws, 'Already drew — play it or pass');

        drawCard(room, ws.playerId);
        console.log(`[DRAW] ${room.players.get(ws.playerId).name} drew in ${room.code}`);
        broadcastGameState(room);
        checkAndTriggerBot(room);
        break;
      }

      case 'pass_turn': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.phase !== 'playing') return sendError(ws, 'No active game');
        if (room.gameState.drawnCardPlayerId !== ws.playerId) return sendError(ws, 'Must draw a card first');
        passTurn(room, ws.playerId);
        broadcastGameState(room);
        checkAndTriggerBot(room);
        break;
      }

      case 'choose_color': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.phase !== 'playing') return sendError(ws, 'No active game');
        const gs = room.gameState;
        if (!gs.pendingColorChoice) return sendError(ws, 'No color choice pending');
        if (gs.pendingColorPlayerId !== ws.playerId) return sendError(ws, 'Not your color choice');
        if (!['red', 'blue', 'green', 'yellow'].includes(d.color)) return sendError(ws, 'Invalid color');

        chooseColor(room, ws.playerId, d.color);
        const p = room.players.get(ws.playerId);
        console.log(`[COLOR] ${p.name} chose ${d.color} in ${room.code}`);
        broadcastGameState(room);
        checkAndTriggerBot(room);
        break;
      }

      case 'say_uno': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.phase !== 'playing') return;
        sayUno(room, ws.playerId);
        const p = room.players.get(ws.playerId);
        console.log(`[UNO]  ${p.name} said UNO in ${room.code}`);
        broadcastGameState(room);
        break;
      }

      case 'catch_uno': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.phase !== 'playing') return;
        if (!d.targetPlayerId || typeof d.targetPlayerId !== 'string') return sendError(ws, 'Invalid catch target');
        if (!room.players.has(d.targetPlayerId)) return sendError(ws, 'Catch target not in room');
        catchUno(room, ws.playerId, d.targetPlayerId);
        const caller = room.players.get(ws.playerId);
        const target = room.players.get(d.targetPlayerId);
        if (caller && target) console.log(`[CATCH] ${caller.name} caught ${target.name} in ${room.code}`);
        broadcastGameState(room);
        break;
      }

      case 'seven_swap_target': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.phase !== 'playing') return sendError(ws, 'No active game');
        const gs = room.gameState;
        if (!gs.pendingSevenSwap) return sendError(ws, 'No swap pending');
        if (gs.pendingSevenSwapPlayerId !== ws.playerId) return sendError(ws, 'Not your swap');
        if (!d.targetPlayerId) return sendError(ws, 'Target required');
        if (d.targetPlayerId === ws.playerId) return sendError(ws, 'Cannot swap with yourself');

        executeSevenSwap(room, ws.playerId, d.targetPlayerId);
        const p = room.players.get(ws.playerId);
        const t = room.players.get(d.targetPlayerId);
        console.log(`[SWAP] ${p.name} swapped with ${t ? t.name : '?'} in ${room.code}`);
        broadcastGameState(room);
        checkAndTriggerBot(room);
        break;
      }

      case 'chat_message': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Not in a room');
        const player = room.players.get(ws.playerId);
        if (!player) return;
        const raw = typeof d.text === 'string' ? d.text : '';

        // Guests are limited to the pre-chosen quick-chat phrase bank.
        if (ws.user?.is_guest) {
          if (!quickchat.isQuickChat(raw)) return;
          const gEntry = { name: player.name, text: raw, ts: Date.now() };
          room.chat.push(gEntry);
          if (room.chat.length > 100) room.chat.shift();
          broadcast(room, { type: 'chat_broadcast', ...gEntry });
          break;
        }

        const text = filterMessage(raw);
        if (!text) return;
        if (text !== raw.trim().slice(0, 200)) {
          audit.log('chat.blocked', {
            actorUserId: player.userId || null, actorName: player.name,
            target: room.code, meta: { channel: 'room' },
          });
        }

        const entry = { name: player.name, text, ts: Date.now() };
        room.chat.push(entry);
        if (room.chat.length > 100) room.chat.shift();

        broadcast(room, { type: 'chat_broadcast', ...entry });
        console.log(`[CHAT] ${room.code} ${player.name}: ${text}`);

        if (db.isReady() && player.userId) {
          chatStore.record({
            roomCode: room.code, userId: player.userId,
            displayName: player.name, text,
          }).catch(e => console.error('[DB] chat record failed:', e.message));
        }
        break;
      }

      case 'configure_rules': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Room not found');
        if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can change rules');
        if (room.phase !== 'waiting') return sendError(ws, 'Cannot change rules mid-game');

        const allowed = ['stackDrawCards', 'drawUntilMatch', 'forcePlay', 'sevenO'];
        const rules = d.rules || {};
        for (const key of allowed) {
          if (typeof rules[key] === 'boolean') room.houseRules[key] = rules[key];
        }
        console.log(`[RULE] ${room.code} rules updated by ${room.players.get(ws.playerId).name}`);
        broadcast(room, { type: 'room_updated', ...roomInfo(room) });
        // Also send to self (host)
        send(ws, { type: 'room_updated', ...roomInfo(room) });
        break;
      }

      case 'add_bot': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Room not found');
        if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can add bots');
        if (room.phase !== 'waiting') return sendError(ws, 'Cannot add bots mid-game');

        const bot = addBot(room, d.difficulty);
        console.log(`[BOT]  ${bot.name} (${bot.difficulty}) added to ${room.code}`);
        broadcast(room, { type: 'room_updated', ...roomInfo(room) });
        send(ws, { type: 'room_updated', ...roomInfo(room) });
        break;
      }

      case 'remove_bot': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Room not found');
        if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can remove bots');
        if (room.phase !== 'waiting') return sendError(ws, 'Cannot remove bots mid-game');

        removeBot(room, d.botId);
        console.log(`[BOT]  Bot removed from ${room.code}`);
        broadcast(room, { type: 'room_updated', ...roomInfo(room) });
        send(ws, { type: 'room_updated', ...roomInfo(room) });
        break;
      }

      case 'set_visibility': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Room not found');
        if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can change visibility');
        if (room.phase !== 'waiting') return sendError(ws, 'Cannot change visibility mid-game');
        room.isPublic = !!d.isPublic;
        console.log(`[VIS]  ${room.code} is now ${room.isPublic ? 'public' : 'private'}`);
        broadcast(room, { type: 'room_updated', ...roomInfo(room) });
        send(ws, { type: 'room_updated', ...roomInfo(room) });
        break;
      }

      case 'kick_player': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Room not found');
        if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can kick players');
        if (room.phase !== 'waiting') return sendError(ws, 'Cannot kick players mid-game');
        const target = room.players.get(d.targetId);
        if (!target || target.isBot) return sendError(ws, 'Invalid target');
        if (d.targetId === ws.playerId) return sendError(ws, 'Cannot kick yourself');

        send(target.ws, { type: 'kicked', message: 'You were removed from the room by the host.' });
        target.ws = null;
        target.isConnected = false;
        room.players.delete(d.targetId);
        room.playerOrder = room.playerOrder.filter(id => id !== d.targetId);
        console.log(`[KICK] ${target.name} kicked from ${room.code} by host`);

        if (room.players.size === 0 || [...room.players.values()].every(p => p.isBot)) {
          rooms.delete(room.code);
          return;
        }
        broadcast(room, { type: 'room_updated', ...roomInfo(room) });
        send(ws, { type: 'room_updated', ...roomInfo(room) });
        break;
      }

      case 'end_game': {
        const room = rooms.get(ws.roomCode);
        if (!room) return sendError(ws, 'Room not found');
        if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can end the game');
        if (room.phase !== 'playing') return sendError(ws, 'No active game');

        for (const p of room.players.values()) { p.hand = []; p.saidUno = false; }
        room.phase = 'waiting';
        room.gameState = null;
        console.log(`[END]  Host ended game early in ${room.code}`);
        broadcast(room, { type: 'room_updated', ...roomInfo(room) });
        send(ws, { type: 'room_updated', ...roomInfo(room) });
        break;
      }

      case 'leave_game': {
        const room = rooms.get(ws.roomCode);
        if (!room) break;
        const player = room.players.get(ws.playerId);
        if (!player) break;

        const wasCurrentTurn = room.phase === 'playing'
          && room.gameState
          && room.playerOrder[room.gameState.currentPlayerIndex] === ws.playerId;

        // Hard remove (intent is leave, not transient disconnect).
        try { player.ws = null; } catch (_) {}
        player.isConnected = false;
        room.players.delete(ws.playerId);
        room.playerOrder = room.playerOrder.filter(id => id !== ws.playerId);
        ws._disconnectHandled = true;
        ws.roomCode = null;
        ws.playerId = null;

        console.log(`[LEAVE] ${player.name} left ${room.code} (phase: ${room.phase})`);

        // Reassign host if the leaver was host
        if (room.hostId === player.id && room.playerOrder.length > 0) {
          const newHostId = room.playerOrder.find(id => !room.players.get(id).isBot) || room.playerOrder[0];
          const newHost = room.players.get(newHostId);
          if (newHost) {
            newHost.isHost = true;
            room.hostId = newHostId;
            console.log(`[HOST] ${newHost.name} is now host of ${room.code}`);
          }
        }

        // If room is empty (or only bots), drop it.
        const humans = [...room.players.values()].filter(p => !p.isBot);
        if (room.players.size === 0 || humans.length === 0) {
          rooms.delete(room.code);
          console.log(`[ROOM] ${room.code} deleted (empty after leave)`);
          break;
        }

        // Mid-game cleanup: if the leaver was mid-decision or mid-turn, recover the game state.
        if (room.phase === 'playing' && room.gameState) {
          const gs = room.gameState;
          // Clear any pending state owned by the leaver
          if (gs.pendingColorChoice && gs.pendingColorPlayerId === player.id) {
            gs.pendingColorChoice = false;
            gs.pendingColorPlayerId = null;
          }
          if (gs.pendingSevenSwap && gs.pendingSevenSwapPlayerId === player.id) {
            gs.pendingSevenSwap = false;
            gs.pendingSevenSwapPlayerId = null;
          }
          // Fix currentPlayerIndex now that the order array is shorter
          if (gs.currentPlayerIndex >= room.playerOrder.length) {
            gs.currentPlayerIndex = 0;
          } else if (wasCurrentTurn) {
            // The leaver was the active player; advance the index isn't needed because
            // the array shrunk under us — currentPlayerIndex now points at the next player.
            // Just clamp:
            gs.currentPlayerIndex = gs.currentPlayerIndex % room.playerOrder.length;
          }

          // If only one player remains, end the game cleanly.
          const remainingPlayables = room.playerOrder.filter(id => {
            const p = room.players.get(id);
            return p && (p.isBot || p.isConnected);
          });
          if (remainingPlayables.length < 2) {
            console.log(`[GAME] ${room.code} ending — not enough players after leave`);
            for (const p of room.players.values()) { p.hand = []; p.saidUno = false; }
            room.phase = 'waiting';
            room.gameState = null;
            broadcast(room, { type: 'room_updated', ...roomInfo(room) });
            break;
          }

          broadcastGameState(room);
          checkAndTriggerBot(room);
        }

        broadcast(room, { type: 'room_updated', ...roomInfo(room) });
        break;
      }

      case 'list_rooms': {
        const publicRooms = [...rooms.values()]
          .filter(r => r.isPublic && r.phase === 'waiting')
          .map(r => ({
            code: r.code,
            hostName: r.players.get(r.hostId)?.name || '?',
            playerCount: [...r.players.values()].filter(p => p.isConnected && !p.isBot).length,
            botCount: [...r.players.values()].filter(p => p.isBot).length,
          }));
        send(ws, { type: 'rooms_list', rooms: publicRooms });
        break;
      }

      default:
        sendError(ws, 'Unknown message type');
    }
  } catch (e) {
    console.error(`[ERROR] ${e.message}`, e.stack);
    sendError(ws, e.message);
  }
}

setInterval(() => {
  for (const [code, room] of rooms) {
    const allGone = [...room.players.values()].every(p => !p.isConnected || p.isBot);
    if (allGone) {
      console.log(`[CLEAN] Removing stale room ${code}`);
      rooms.delete(code);
    }
  }
}, 15 * 60 * 1000);

const PORT = process.env.PORT || 5050;
db.init()
  .then(() => notify.init(process.env.DATABASE_URL))
  .catch(() => {})
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[SERVER] Uno running → http://localhost:${PORT}`);
    });
  });

function shutdown(signal) {
  console.log(`[SERVER] Received ${signal}, shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) { try { ws.close(1001, 'server shutdown'); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
