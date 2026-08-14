'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoom, joinRoom, addBot, removeBot, removeWaitingPlayer } = require('../game/room');

test('creates a room and joins host', () => {
  const rooms = new Map();
  const ws = { userId: null };
  const { room, player } = createRoom(rooms, 'HostPlayer', ws, true);

  assert.ok(room);
  assert.equal(room.players.size, 1);
  assert.equal(room.hostId, player.id);
  assert.equal(room.isPublic, true);
  assert.equal(room.table.seats.length, 1);
});

test('allows adding and removing bots up to 5 seats', () => {
  const rooms = new Map();
  const ws = { userId: null };
  const { room } = createRoom(rooms, 'HostPlayer', ws);

  const bot1 = addBot(room);
  const bot2 = addBot(room);
  assert.equal(room.table.seats.length, 3);

  removeBot(room, bot1.id);
  assert.equal(room.table.seats.length, 2);
});

test('handles human joining and leaving', () => {
  const rooms = new Map();
  const ws1 = { userId: null };
  const { room } = createRoom(rooms, 'Alice', ws1);

  const ws2 = { userId: null };
  const { player: bob } = joinRoom(rooms, room.code, 'Bob', ws2);
  assert.equal(room.players.size, 2);
  assert.equal(room.table.seats.length, 2);

  removeWaitingPlayer(room, bob.id);
  assert.equal(room.players.size, 1);
  assert.equal(room.table.seats.length, 1);
});
