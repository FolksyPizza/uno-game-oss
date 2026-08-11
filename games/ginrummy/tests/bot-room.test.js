'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoom, joinRoom, addBot } = require('../game/room');
const { startMatch } = require('../game/match');
const { createDeck } = require('../game/deck');
const { chooseDraw, chooseDiscard } = require('../game/bot');

function ws(userId = null) { return { userId, user: null }; }

test('room is limited to two seats and only one bot', () => {
  const rooms = new Map(); const first = ws();
  const { room } = createRoom(rooms, 'Alice', first);
  addBot(room, 'hard');
  assert.equal(room.players.size, 2);
  assert.throws(() => addBot(room, 'easy'), /full/);
  assert.throws(() => joinRoom(rooms, room.code, 'Bob', ws()), /full/);
});

test('reconnect requires the account identity or secret token', () => {
  const rooms = new Map(); const firstWs = ws('account-a');
  const { room, player } = createRoom(rooms, 'Alice', firstWs);
  player.isConnected = false; player.ws = null; room.phase = 'playing';
  assert.throws(() => joinRoom(rooms, room.code, 'Alice', ws('attacker'), player.id, 'wrong'), /in progress/);
  const good = joinRoom(rooms, room.code, 'Alice', ws('account-a'), player.id, 'wrong');
  assert.equal(good.reconnected, true); assert.equal(good.player.id, player.id);
});

test('hard bot decisions do not depend on the hidden opponent hand', () => {
  function botRoom(opponentHand) {
    const room = {
      code: 'BOT', hostId: 'human', phase: 'waiting', playerOrder: ['human', 'bot'],
      players: new Map([
        ['human', { id: 'human', name: 'Human', hand: opponentHand, isBot: false, isConnected: true }],
        ['bot', { id: 'bot', name: 'Bot', hand: [], isBot: true, isConnected: true, difficulty: 'hard' }],
      ]), match: null,
    };
    startMatch(room, { dealerId: 'human', deck: createDeck() });
    room.players.get('bot').hand = [
      {id:'clubs-1',rank:1,suit:'clubs'},{id:'clubs-2',rank:2,suit:'clubs'},{id:'clubs-3',rank:3,suit:'clubs'},
      {id:'hearts-7',rank:7,suit:'hearts'},{id:'diamonds-7',rank:7,suit:'diamonds'},{id:'spades-7',rank:7,suit:'spades'},
      {id:'clubs-9',rank:9,suit:'clubs'},{id:'diamonds-10',rank:10,suit:'diamonds'},{id:'hearts-11',rank:11,suit:'hearts'},{id:'spades-13',rank:13,suit:'spades'},
      {id:'hearts-4',rank:4,suit:'hearts'},
    ];
    room.match.phase = 'discard'; room.match.activePlayerId = 'bot'; room.match.drawnDiscardCardId = null;
    room.match.publicHistory = [{ type: 'take_discard', playerId: 'human', card: { id:'clubs-8',rank:8,suit:'clubs' } }];
    return room;
  }
  const a = botRoom([{ id: 'secret-a', rank: 5, suit: 'clubs' }]);
  const b = botRoom([{ id: 'secret-b', rank: 13, suit: 'spades' }]);
  assert.equal(chooseDraw(a, 'bot'), chooseDraw(b, 'bot'));
  assert.deepEqual(chooseDiscard(a, 'bot'), chooseDiscard(b, 'bot'));
});

test('all difficulty levels choose legal discard cards', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const room = {
      playerOrder: ['human','bot'], phase: 'playing',
      players: new Map([
        ['human',{id:'human',hand:[],isBot:false,isConnected:true}],
        ['bot',{id:'bot',hand:createDeck().slice(0,11),isBot:true,isConnected:true,difficulty}],
      ]),
      match: { phase:'discard',activePlayerId:'bot',drawnDiscardCardId:createDeck()[0].id,publicHistory:[],discardPile:[],stock:[] },
    };
    const action = chooseDiscard(room, 'bot');
    assert.ok(room.players.get('bot').hand.some(c => c.id === action.cardId));
    assert.notEqual(action.cardId, room.match.drawnDiscardCardId);
  }
});
