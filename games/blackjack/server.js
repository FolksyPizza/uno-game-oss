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
const { getBasicStrategyAction, getBotInsuranceDecision, getBotBetAmount } = require('./game/bot');

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
    if (room.table.phase === 'player_turns' || room.table.phase === 'dealer_turn') games++;
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
  const base = (process.env.PUBLIC_URL || 'http://localhost:5090').replace(/\/+$/, '');
  const joinBase = (process.env.JOIN_URL || '').replace(/\/+$/, '');
  const url = joinBase
    ? `${joinBase}/blackjack/${encodeURIComponent(roomCode)}`
    : `${base}/blackjack/?room=${encodeURIComponent(roomCode)}`;
  notify.notifyUser(friendId, { type: 'game_invite', game: 'blackjack', fromName: user.display_name, fromId: user.id, roomCode, url });
  friendsStore.sendDM(user.id, friendId, `🎮 Join my Blackjack table: ${url}`).catch(() => {});
  audit.log('blackjack.invite', { actorUserId: user.id, actorName: user.display_name, req, target: friendId, meta: { roomCode } });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

function send(ws, payload) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(payload));
}

function sendError(ws, message) { send(ws, { type: 'error', message }); }

function roomPlayers(room) {
  return room.playerOrder.map(id => room.players.get(id)).filter(Boolean).map(p => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    connected: !!p.isConnected,
    isHost: room.hostId === p.id,
  }));
}

function roomInfo(room) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    players: roomPlayers(room),
    isPublic: room.isPublic,
    phase: room.table.phase,
    houseRules: room.table.houseRules,
  };
}

function broadcast(room, payload, excludeId = null) {
  for (const p of room.players.values()) {
    if (!p.isBot && p.isConnected && p.id !== excludeId) send(p.ws, payload);
  }
}

function broadcastRoom(room) {
  broadcast(room, { type: 'room_updated', ...roomInfo(room) });
}

function broadcastState(room) {
  for (const p of room.players.values()) {
    if (!p.isBot && p.isConnected) {
      send(p.ws, {
        type: 'state',
        state: room.table.viewFor(p.id),
        chat: room.chat.slice(-30),
      });
    }
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

function recordRoundResult(room) {
  const table = room.table;
  if (!table.roundSummary) return;

  audit.log('blackjack.round.complete', {
    actorUserId: null,
    actorName: 'Dealer',
    target: room.code,
    meta: { round: table.roundNumber, summary: table.roundSummary },
  });

  if (!db.isReady()) return;

  const players = room.playerOrder.map(id => {
    const p = room.players.get(id);
    return { userId: p.userId || null, displayName: p.name, isBot: !!p.isBot };
  });

  resultsStore.record({
    roomCode: room.code,
    winnerUserId: null,
    players,
    startedAt: new Date().toISOString(),
    gameKey: 'blackjack',
    score: table.roundSummary,
  }).catch(e => console.error('[DB] Blackjack result record failed:', e.message));
}

const botTimers = new Map();

function clearBotTimer(roomCode) {
  if (botTimers.has(roomCode)) {
    clearTimeout(botTimers.get(roomCode));
    botTimers.delete(roomCode);
  }
}

function triggerBot(room) {
  clearBotTimer(room.code);
  const table = room.table;

  // 1. Bot actions during insurance phase
  if (table.phase === 'insurance') {
    const timer = setTimeout(() => {
      botTimers.delete(room.code);
      let acted = false;
      for (const seat of table.seats) {
        if (seat.isBot && seat.insurance.offered) {
          table.handleInsurance(seat.id, getBotInsuranceDecision());
          acted = true;
        }
      }
      if (acted) {
        touch(room);
        broadcastState(room);
        triggerBot(room);
      }
    }, 600);
    botTimers.set(room.code, timer);
    return;
  }

  // 2. Bot actions during player turns
  if (table.phase === 'player_turns') {
    const currentSeat = table.seats[table.activeSeatIndex];
    if (currentSeat && currentSeat.isBot) {
      const timer = setTimeout(() => {
        botTimers.delete(room.code);
        if (table.phase !== 'player_turns' || table.seats[table.activeSeatIndex]?.id !== currentSeat.id) return;

        const hand = currentSeat.hands[currentSeat.activeHandIndex];
        if (!hand || hand.status !== 'active') {
          table.advancePlayerTurn();
          touch(room);
          broadcastState(room);
          triggerBot(room);
          return;
        }

        const dealerUpcard = table.dealer.cards[0];
        const canDouble = hand.cards.length === 2 && currentSeat.chips >= hand.bet;
        const canSplit = hand.cards.length === 2 && currentSeat.hands.length < 2 && currentSeat.chips >= hand.bet;
        const canSurrender = hand.cards.length === 2 && currentSeat.hands.length === 1 && table.houseRules.allowSurrender;

        const action = getBasicStrategyAction({
          cards: hand.cards,
          dealerUpcard,
          canDouble,
          canSplit,
          canSurrender,
        });

        try {
          table.handleAction(currentSeat.id, action);
        } catch (e) {
          // Fallback to stand
          table.handleAction(currentSeat.id, 'stand');
        }

        touch(room);
        if (table.phase === 'round_result') {
          recordRoundResult(room);
        }
        broadcastState(room);
        triggerBot(room);
      }, 750);
      botTimers.set(room.code, timer);
      return;
    }
  }

  // 3. Auto-place bets for bots between rounds
  if (table.phase === 'waiting' || table.phase === 'betting' || table.phase === 'round_result') {
    let botBetsPlaced = false;
    for (const seat of table.seats) {
      if (seat.isBot && seat.bet === 0 && seat.chips >= table.houseRules.minBet) {
        seat.bet = getBotBetAmount(seat.chips);
        seat.acted = true;
        botBetsPlaced = true;
      }
    }
    if (botBetsPlaced) {
      broadcastState(room);
    }
  }
}

wss.on('connection', async (ws, req) => {
  ws.isAlive = true;
  ws.userId = null;
  ws.user = null;
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

  ws.on('pong', () => {
    ws.isAlive = true;
    if (ws.userId) userStore.touchLastSeen(ws.userId);
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    touchUser(ws);

    try {
      switch (msg.type) {
        case 'list_rooms': {
          const publicRooms = [];
          for (const r of rooms.values()) {
            if (r.isPublic) {
              const humans = [...r.players.values()].filter(p => !p.isBot && p.isConnected).length;
              const bots = [...r.players.values()].filter(p => p.isBot).length;
              publicRooms.push({
                code: r.code,
                hostName: r.players.get(r.hostId)?.name || 'Host',
                playerCount: humans + bots,
                humanCount: humans,
                phase: r.table.phase,
              });
            }
          }
          send(ws, { type: 'rooms_list', rooms: publicRooms });
          break;
        }

        case 'create_room': {
          const name = await validateName(ws, msg.playerName);
          const isPublic = !!msg.isPublic;
          const { room, player } = createRoom(rooms, name, ws, isPublic, msg.houseRules || {});
          send(ws, {
            type: 'room_created',
            ...roomInfo(room),
            ...playerCredentials(player),
            state: room.table.viewFor(player.id),
          });
          broadcastRoom(room);
          broadcastState(room);
          break;
        }

        case 'join_room': {
          const code = String(msg.roomCode || '').toUpperCase().trim();
          const name = await validateName(ws, msg.playerName);
          const { room, player, reconnected } = joinRoom(
            rooms, code, name, ws, msg.playerId, msg.reconnectToken
          );
          send(ws, {
            type: reconnected ? 'reconnected' : 'room_joined',
            ...roomInfo(room),
            ...playerCredentials(player),
            state: room.table.viewFor(player.id),
          });
          broadcastRoom(room);
          broadcastState(room);
          triggerBot(room);
          break;
        }

        case 'leave_room': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          removeWaitingPlayer(room, ws.playerId);
          if ([...room.players.values()].filter(p => !p.isBot).length === 0) {
            clearBotTimer(room.code);
            rooms.delete(room.code);
          } else {
            broadcastRoom(room);
            broadcastState(room);
            triggerBot(room);
          }
          ws.roomCode = null;
          ws.playerId = null;
          break;
        }

        case 'add_bot': {
          const room = rooms.get(ws.roomCode);
          if (!room || room.hostId !== ws.playerId) return sendError(ws, 'Only the host can add bots');
          addBot(room);
          touch(room);
          broadcastRoom(room);
          broadcastState(room);
          triggerBot(room);
          break;
        }

        case 'remove_bot': {
          const room = rooms.get(ws.roomCode);
          if (!room || room.hostId !== ws.playerId) return sendError(ws, 'Only the host can remove bots');
          removeBot(room, msg.botId);
          touch(room);
          broadcastRoom(room);
          broadcastState(room);
          break;
        }

        case 'set_visibility': {
          const room = rooms.get(ws.roomCode);
          if (!room || room.hostId !== ws.playerId) return sendError(ws, 'Only the host can change visibility');
          room.isPublic = !!msg.isPublic;
          broadcastRoom(room);
          break;
        }

        case 'place_bet': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          room.table.placeBet(ws.playerId, msg.amount);
          touch(room);
          broadcastState(room);
          triggerBot(room);
          break;
        }

        case 'clear_bet': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          room.table.clearBet(ws.playerId);
          touch(room);
          broadcastState(room);
          break;
        }

        case 'top_up': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          room.table.topUpChips(ws.playerId);
          touch(room);
          broadcastState(room);
          break;
        }

        case 'start_round': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          // Anyone seated can start deal once bets are placed, or host
          const ok = room.table.startRound();
          if (!ok) return sendError(ws, 'Place bets first to start the deal');
          touch(room);
          if (room.table.phase === 'round_result') {
            recordRoundResult(room);
          }
          broadcastState(room);
          triggerBot(room);
          break;
        }

        case 'action': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          room.table.handleAction(ws.playerId, msg.action);
          touch(room);
          if (room.table.phase === 'round_result') {
            recordRoundResult(room);
          }
          broadcastState(room);
          triggerBot(room);
          break;
        }

        case 'insurance': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          room.table.handleInsurance(ws.playerId, !!msg.take);
          touch(room);
          if (room.table.phase === 'round_result') {
            recordRoundResult(room);
          }
          broadcastState(room);
          triggerBot(room);
          break;
        }

        case 'chat_message': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          const player = room.players.get(ws.playerId);
          if (!player) return;
          const cleanText = filterMessage(String(msg.text || '').trim().slice(0, 200));
          if (!cleanText) return;
          const chatEntry = { name: player.name, text: cleanText, ts: Date.now() };
          room.chat.push(chatEntry);
          if (room.chat.length > 50) room.chat.shift();
          broadcast(room, { type: 'chat_broadcast', ...chatEntry });
          if (db.isReady() && ws.userId) {
            chatStore.record({ roomCode: room.code, userId: ws.userId, name: player.name, text: cleanText }).catch(() => {});
          }
          break;
        }

        case 'quickchat': {
          const room = rooms.get(ws.roomCode);
          if (!room || !ws.playerId) return;
          const player = room.players.get(ws.playerId);
          if (!player) return;
          const phrase = quickchat.get(msg.phraseId);
          if (!phrase) return;
          const chatEntry = { name: player.name, text: phrase.text, ts: Date.now() };
          room.chat.push(chatEntry);
          broadcast(room, { type: 'chat_broadcast', ...chatEntry });
          break;
        }
      }
    } catch (err) {
      sendError(ws, err.message);
    }
  });

  ws.on('close', () => {
    notify.unregister(ws);
    const room = rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return;
    const player = room.players.get(ws.playerId);
    if (player) {
      player.isConnected = false;
      player.ws = null;
      room.table.setConnected(player.id, false);
      const remainingHumans = [...room.players.values()].filter(p => !p.isBot && p.isConnected).length;
      if (remainingHumans === 0 && room.table.phase === 'waiting') {
        clearBotTimer(room.code);
        rooms.delete(room.code);
      } else {
        broadcastRoom(room);
        broadcastState(room);
        triggerBot(room);
      }
    }
  });
});

function touchUser(ws) {
  if (ws.userId) userStore.touchLastSeen(ws.userId);
}

// 30s Heartbeat
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

// Clean up inactive rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const liveHumans = [...room.players.values()].filter(p => !p.isBot && p.isConnected).length;
    if (liveHumans === 0 && now - room.lastActiveAt > 15 * 60 * 1000) {
      clearBotTimer(code);
      rooms.delete(code);
    }
  }
}, 60000);

const PORT = process.env.PORT || 5090;
db.init()
  .then(() => notify.init(process.env.DATABASE_URL))
  .catch(() => {})
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[BLACKJACK] Blackjack service → http://localhost:${PORT}`);
    });
  });
