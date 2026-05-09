const { v4: uuidv4 } = require('uuid');

const BOT_NAMES = [
  'Blaze', 'Nova', 'Pixel', 'Chip', 'Bolt', 'Sparky', 'Echo', 'Glitch',
  'Vector', 'Cipher', 'Turbo', 'Nexus', 'Zap', 'Neon', 'Orbit', 'Comet',
  'Flux', 'Byte', 'Vortex', 'Phantom', 'Pulse', 'Rogue', 'Drift', 'Apex',
  'Surge', 'Titan', 'Frost', 'Storm', 'Cruz', 'Blip', 'Arch', 'Jolt',
];

const DEFAULT_HOUSE_RULES = {
  stackDrawCards: false,
  drawUntilMatch: false,
  forcePlay: false,
  sevenO: false,
};

function generateRoomCode(rooms) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(rooms, playerName, ws, isPublic = false) {
  const code = generateRoomCode(rooms);
  const playerId = uuidv4();
  const player = {
    id: playerId,
    name: playerName,
    ws,
    hand: [],
    isConnected: true,
    isHost: true,
    isBot: false,
    saidUno: false,
  };
  const room = {
    code,
    hostId: playerId,
    players: new Map([[playerId, player]]),
    playerOrder: [playerId],
    phase: 'waiting',
    gameState: null,
    houseRules: { ...DEFAULT_HOUSE_RULES },
    chat: [],
    isPublic,
  };
  rooms.set(code, room);
  ws.playerId = playerId;
  ws.roomCode = code;
  return room;
}

function joinRoom(rooms, code, playerName, ws, reconnectId = null) {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found');

  if (reconnectId) {
    const byId = room.players.get(reconnectId);
    if (byId && !byId.isConnected) {
      byId.ws = ws;
      byId.isConnected = true;
      ws.playerId = byId.id;
      ws.roomCode = code;
      return { player: byId, reconnected: true };
    }
  }

  const byName = [...room.players.values()].find(p => p.name === playerName && !p.isConnected && !p.isBot);
  if (byName) {
    byName.ws = ws;
    byName.isConnected = true;
    ws.playerId = byName.id;
    ws.roomCode = code;
    return { player: byName, reconnected: true };
  }

  if (room.phase !== 'waiting') throw new Error('Game already in progress');
  if (room.players.size >= 8) throw new Error('Room is full (max 8 players)');
  if ([...room.players.values()].some(p => p.isConnected && p.name === playerName)) {
    throw new Error('That name is already taken in this room');
  }

  const playerId = uuidv4();
  const player = {
    id: playerId,
    name: playerName,
    ws,
    hand: [],
    isConnected: true,
    isHost: false,
    isBot: false,
    saidUno: false,
  };
  room.players.set(playerId, player);
  room.playerOrder.push(playerId);
  ws.playerId = playerId;
  ws.roomCode = code;
  return { player, reconnected: false };
}

function addBot(room) {
  if (room.players.size >= 8) throw new Error('Room is full (max 8 players)');
  const usedNames = new Set([...room.players.values()].map(p => p.name));
  const available = BOT_NAMES.filter(n => !usedNames.has(n));
  const botName = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : `Bot ${[...room.players.values()].filter(p => p.isBot).length + 1}`;
  const botId = uuidv4();
  const bot = {
    id: botId,
    name: botName,
    ws: null,
    hand: [],
    isConnected: true,
    isHost: false,
    isBot: true,
    saidUno: false,
  };
  room.players.set(botId, bot);
  room.playerOrder.push(botId);
  return bot;
}

function removeBot(room, botId) {
  const bot = room.players.get(botId);
  if (!bot || !bot.isBot) throw new Error('Not a bot');
  room.players.delete(botId);
  room.playerOrder = room.playerOrder.filter(id => id !== botId);
}

module.exports = { createRoom, joinRoom, generateRoomCode, addBot, removeBot, DEFAULT_HOUSE_RULES, BOT_NAMES };
