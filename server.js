const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { createRoom, joinRoom, addBot, removeBot } = require('./game/room');
const {
  initGame, playCard, drawCard, passTurn, chooseColor, autoChooseColor,
  sayUno, catchUno, buildGameStateForPlayer, advanceTurn, executeSevenSwap,
} = require('./game/gameState');
const { filterMessage, containsBadWord } = require('./game/profanity');
const { getBotAction, getBotColorChoice, getBotSwapTarget } = require('./game/bot');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

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
    .map(p => ({ id: p.id, name: p.name, isBot: p.isBot || false }));
}

function roomInfo(room) {
  return {
    players: roomPlayers(room),
    hostId: room.hostId,
    houseRules: room.houseRules,
  };
}

function handleGameOver(room) {
  const winner = room.players.get(room.gameState.winnerId);
  room.phase = 'over';
  console.log(`[WIN]  ${winner.name} wins in ${room.code}!`);
  broadcast(room, { type: 'game_over', winnerId: winner.id, winnerName: winner.name });

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
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;

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

    if (connected.length === 1 && room.playerOrder.filter(id => {
      const p = room.players.get(id);
      return p && p.isConnected;
    }).length <= 1) {
      room.gameState.winnerId = connected[0].id;
      handleGameOver(room);
      return;
    }

    const gs = room.gameState;
    if (room.playerOrder[gs.currentPlayerIndex] === ws.playerId) {
      if (gs.pendingColorChoice && gs.pendingColorPlayerId === ws.playerId) {
        autoChooseColor(room);
      } else if (gs.pendingSevenSwap && gs.pendingSevenSwapPlayerId === ws.playerId) {
        // Auto-pick swap target
        const target = [...room.players.values()].find(p => p.id !== ws.playerId && p.isConnected);
        if (target) {
          try { executeSevenSwap(room, ws.playerId, target.id); } catch {}
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
        try { chooseColor(room, chooser.id, color); } catch {}
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
        const targetId = getBotSwapTarget(room, swapper.id);
        if (targetId) {
          try { executeSevenSwap(room, swapper.id, targetId); } catch {}
          console.log(`[BOT]  ${swapper.name} swapped with ${room.players.get(targetId).name}`);
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
    try { advanceTurn(room, 1); } catch {}
  }

  // Say UNO after playing if 1 card left
  if (bot.hand.length === 1 && !bot.saidUno) sayUno(room, botId);

  broadcastGameState(room);
  checkAndTriggerBot(room);
}

// ── WebSocket ────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.roomCode = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return sendError(ws, 'Invalid JSON'); }
    handleMessage(ws, msg);
  });
  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => handleDisconnect(ws));
});

function handleMessage(ws, msg) {
  const { type } = msg;
  const d = (msg.payload && typeof msg.payload === 'object') ? msg.payload : msg;

  try {
    switch (type) {

      case 'create_room': {
        const name = d.playerName?.trim();
        if (!name) return sendError(ws, 'Name is required');
        if (containsBadWord(name)) return sendError(ws, 'Please choose a different name');
        const room = createRoom(rooms, name, ws);
        console.log(`[ROOM] ${room.code} created by ${name}`);
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
        const name = d.playerName?.trim();
        const code = d.roomCode?.trim().toUpperCase();
        const reconnectId = d.playerId || null;
        if (!name) return sendError(ws, 'Name is required');
        if (!code) return sendError(ws, 'Room code is required');
        if (containsBadWord(name)) return sendError(ws, 'Please choose a different name');

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

        playCard(room, ws.playerId, Number(d.cardIndex));

        const player = room.players.get(ws.playerId);
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
        const text = filterMessage(raw);
        if (!text) return;

        const entry = { name: player.name, text, ts: Date.now() };
        room.chat.push(entry);
        if (room.chat.length > 100) room.chat.shift();

        broadcast(room, { type: 'chat_broadcast', ...entry });
        console.log(`[CHAT] ${room.code} ${player.name}: ${text}`);
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

        const bot = addBot(room);
        console.log(`[BOT]  ${bot.name} added to ${room.code}`);
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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Uno running → http://localhost:${PORT}`);
});
