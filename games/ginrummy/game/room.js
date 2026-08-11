'use strict';

const crypto = require('node:crypto');

const BOT_NAMES = ['Marlowe', 'Violet', 'Knox', 'Ruby', 'Dapper', 'Ginger', 'Ace', 'Rummy'];
const BOT_DIFFICULTIES = ['easy', 'medium', 'hard'];

function generateRoomCode(rooms) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join(''); } while (rooms.has(code));
  return code;
}

function humanPlayer(name, ws, isHost) {
  return {
    id: crypto.randomUUID(), reconnectToken: crypto.randomBytes(24).toString('base64url'),
    name, ws, userId: ws.userId || null, hand: [], isConnected: true,
    isHost, isBot: false, isAdmin: !!(ws.user?.is_admin && ws.user?.show_admin_badge !== false),
  };
}

function createRoom(rooms, name, ws, isPublic = false) {
  const player = humanPlayer(name, ws, true);
  const room = {
    code: generateRoomCode(rooms), hostId: player.id,
    players: new Map([[player.id, player]]), playerOrder: [player.id],
    phase: 'waiting', match: null, chat: [], isPublic: !!isPublic,
    createdAt: Date.now(), lastActiveAt: Date.now(),
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
      existing.ws = ws; existing.isConnected = true;
      ws.playerId = existing.id; ws.roomCode = code;
      room.lastActiveAt = Date.now();
      return { room, player: existing, reconnected: true };
    }
  }
  if (room.phase !== 'waiting') throw new Error('Match already in progress');
  if (room.players.size >= 2) throw new Error('Room is full');
  if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already taken');
  const player = humanPlayer(name, ws, false);
  room.players.set(player.id, player); room.playerOrder.push(player.id);
  ws.playerId = player.id; ws.roomCode = code; room.lastActiveAt = Date.now();
  return { room, player, reconnected: false };
}

function addBot(room, difficulty = 'medium') {
  if (room.phase !== 'waiting') throw new Error('Bots can only be changed before a match');
  if (room.players.size >= 2) throw new Error('Room is full');
  const used = new Set([...room.players.values()].map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || 'Gin Bot';
  const bot = {
    id: crypto.randomUUID(), name, ws: null, userId: null, hand: [],
    isConnected: true, isHost: false, isBot: true,
    difficulty: BOT_DIFFICULTIES.includes(difficulty) ? difficulty : 'medium',
  };
  room.players.set(bot.id, bot); room.playerOrder.push(bot.id);
  return bot;
}

function removeBot(room, botId) {
  const bot = room.players.get(botId);
  if (!bot?.isBot || room.phase !== 'waiting') throw new Error('Bot cannot be removed now');
  room.players.delete(botId);
  room.playerOrder = room.playerOrder.filter(id => id !== botId);
}

function removeWaitingPlayer(room, playerId) {
  room.players.delete(playerId);
  room.playerOrder = room.playerOrder.filter(id => id !== playerId);
  if (room.hostId === playerId) {
    const next = room.playerOrder.find(id => !room.players.get(id)?.isBot);
    room.hostId = next || null;
    if (next) room.players.get(next).isHost = true;
  }
}

module.exports = { BOT_NAMES, BOT_DIFFICULTIES, generateRoomCode, createRoom, joinRoom, addBot, removeBot, removeWaitingPlayer };
