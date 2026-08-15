'use strict';

const crypto = require('node:crypto');
const { Table, MAX_SEATS, START_CHIPS } = require('./table');

const BOT_NAMES = ['Monte', 'Vegas', 'Ace', 'Jack', 'Ruby', 'Chip', 'Lucky', 'Sinatra', 'Reno', 'Duke'];

function generateRoomCode(rooms) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function humanPlayer(name, ws, isHost) {
  return {
    id: crypto.randomUUID(),
    reconnectToken: crypto.randomBytes(24).toString('base64url'),
    name,
    ws,
    userId: ws.userId || null,
    isConnected: true,
    isHost,
    isBot: false,
    isAdmin: !!(ws.user?.is_admin && ws.user?.show_admin_badge !== false),
  };
}

function createRoom(rooms, name, ws, isPublic = false, houseRules = {}) {
  const player = humanPlayer(name, ws, true);
  const table = new Table(houseRules);
  table.addPlayer({
    id: player.id,
    name: player.name,
    isBot: false,
    isGuest: !!ws.user?.is_guest,
    isAdmin: player.isAdmin,
  });

  const room = {
    code: generateRoomCode(rooms),
    hostId: player.id,
    table,
    players: new Map([[player.id, player]]),
    playerOrder: [player.id],
    chat: [],
    isPublic: !!isPublic,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  rooms.set(room.code, room);
  ws.playerId = player.id;
  ws.roomCode = room.code;
  return { room, player };
}

function joinRoom(rooms, code, name, ws, reconnectId, reconnectToken) {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found');

  if (reconnectId) {
    const existing = room.players.get(reconnectId);
    const accountMatch = existing?.userId && ws.userId && existing.userId === ws.userId;
    const tokenMatch = existing?.reconnectToken && reconnectToken === existing.reconnectToken;
    if (existing && !existing.isBot && !existing.isConnected && (accountMatch || tokenMatch)) {
      existing.ws = ws;
      existing.isConnected = true;
      ws.playerId = existing.id;
      ws.roomCode = code;
      room.table.setConnected(existing.id, true);
      room.lastActiveAt = Date.now();
      return { room, player: existing, reconnected: true };
    }
  }

  if (room.table.seats.length >= MAX_SEATS) throw new Error('Table is full (5 seats max)');
  if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('That name is already taken at this table');
  }

  const player = humanPlayer(name, ws, false);
  room.players.set(player.id, player);
  room.playerOrder.push(player.id);
  room.table.addPlayer({
    id: player.id,
    name: player.name,
    isBot: false,
    isGuest: !!ws.user?.is_guest,
    isAdmin: player.isAdmin,
  });

  ws.playerId = player.id;
  ws.roomCode = code;
  room.lastActiveAt = Date.now();
  return { room, player, reconnected: false };
}

function addBot(room) {
  if (room.table.seats.length >= MAX_SEATS) throw new Error('Table is full');
  const used = new Set([...room.players.values()].map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${room.players.size + 1}`;
  const botId = crypto.randomUUID();

  const botPlayer = {
    id: botId,
    name,
    ws: null,
    userId: null,
    isConnected: true,
    isHost: false,
    isBot: true,
    isAdmin: false,
  };

  room.players.set(botId, botPlayer);
  room.playerOrder.push(botId);
  room.table.addPlayer({
    id: botId,
    name,
    isBot: true,
    isGuest: false,
    isAdmin: false,
  });

  return botPlayer;
}

function removeBot(room, botId) {
  const bot = room.players.get(botId);
  if (!bot?.isBot) throw new Error('Not a bot');
  room.players.delete(botId);
  room.playerOrder = room.playerOrder.filter(id => id !== botId);
  room.table.removePlayer(botId);
}

function removeWaitingPlayer(room, playerId) {
  room.players.delete(playerId);
  room.playerOrder = room.playerOrder.filter(id => id !== playerId);
  room.table.removePlayer(playerId);

  if (room.hostId === playerId) {
    const next = room.playerOrder.find(id => !room.players.get(id)?.isBot);
    room.hostId = next || null;
    if (next && room.players.has(next)) {
      room.players.get(next).isHost = true;
    }
  }
}

module.exports = {
  BOT_NAMES,
  generateRoomCode,
  createRoom,
  joinRoom,
  addBot,
  removeBot,
  removeWaitingPlayer,
};
