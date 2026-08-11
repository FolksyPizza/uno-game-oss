'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeck } = require('../game/deck');
const {
  startMatch, openingPass, drawDiscard, drawStock, discard, finishHand,
  calculateFinalScores, pauseMatch, resumeMatch, viewFor,
} = require('../game/match');

const C = (rank, suit) => ({ id: `${suit}-${rank}`, rank, suit });
function makeRoom(bot = false) {
  const p1 = { id: 'p1', name: 'Alice', hand: [], isConnected: true, isBot: false };
  const p2 = { id: 'p2', name: bot ? 'Bot' : 'Bob', hand: [], isConnected: true, isBot: bot, difficulty: 'hard' };
  return { code: 'TEST', hostId: 'p1', playerOrder: ['p1', 'p2'], players: new Map([['p1', p1], ['p2', p2]]), phase: 'waiting', match: null };
}

test('deals ten cards each and offers the upcard to the non-dealer first', () => {
  const room = makeRoom();
  startMatch(room, { dealerId: 'p1', deck: createDeck() });
  assert.equal(room.players.get('p1').hand.length, 10);
  assert.equal(room.players.get('p2').hand.length, 10);
  assert.equal(room.match.stock.length, 31);
  assert.equal(room.match.discardPile.length, 1);
  assert.equal(room.match.activePlayerId, 'p2');
  assert.equal(room.match.phase, 'opening_offer_non_dealer');
});

test('both opening passes force the non-dealer to draw stock', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  openingPass(room, 'p2');
  assert.equal(room.match.phase, 'opening_offer_dealer'); assert.equal(room.match.activePlayerId, 'p1');
  openingPass(room, 'p1');
  assert.equal(room.match.phase, 'must_draw_stock'); assert.equal(room.match.activePlayerId, 'p2');
  assert.throws(() => drawDiscard(room, 'p2'), /Cannot draw the discard/);
  drawStock(room, 'p2'); assert.equal(room.players.get('p2').hand.length, 11);
});

test('cannot immediately discard a card picked up from the discard pile', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  const card = drawDiscard(room, 'p2');
  assert.throws(() => discard(room, 'p2', card.id), /cannot immediately discard/i);
});

test('rejects out-of-turn and duplicate draws', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  assert.throws(() => drawDiscard(room, 'p1'), /Not your turn/);
  drawDiscard(room, 'p2');
  assert.throws(() => drawStock(room, 'p2'), /Cannot draw from stock/);
});

test('a non-knocking discard cancels the hand when stock reaches two cards', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  room.match.phase = 'draw'; room.match.activePlayerId = 'p2'; room.match.stock = room.match.stock.slice(0, 3);
  drawStock(room, 'p2');
  const dealer = room.match.dealerId;
  const result = discard(room, 'p2', room.players.get('p2').hand[0].id, false);
  assert.equal(result.handEnded, true); assert.equal(room.match.lastResult.type, 'draw');
  assert.equal(room.match.phase, 'hand_result'); assert.equal(room.match.dealerId, dealer);
  assert.deepEqual(room.match.scores, { p1: 0, p2: 0 });
});

test('knocking is optional at ten or less and rejected above ten', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  room.match.phase = 'discard'; room.match.activePlayerId = 'p1';
  room.players.get('p1').hand = [C(1,'clubs'),C(2,'clubs'),C(3,'clubs'),C(7,'clubs'),C(7,'diamonds'),C(7,'hearts'),C(2,'spades'),C(3,'diamonds'),C(4,'hearts'),C(13,'spades'),C(12,'spades')];
  assert.throws(() => discard(room, 'p1', 'clubs-1', true), /10 or fewer/);
  room.players.get('p1').hand = [C(1,'clubs'),C(2,'clubs'),C(3,'clubs'),C(7,'clubs'),C(7,'diamonds'),C(7,'hearts'),C(1,'spades'),C(1,'diamonds'),C(1,'hearts'),C(10,'clubs'),C(13,'spades')];
  const result = discard(room, 'p1', 'spades-13', false);
  assert.equal(result.handEnded, false); assert.equal(room.match.phase, 'draw');
});

test('an ordinary knock scores the deadwood difference after layoffs', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  room.players.get('p1').hand = [C(3,'clubs'),C(4,'clubs'),C(5,'clubs'),C(9,'clubs')];
  room.players.get('p2').hand = [C(6,'clubs'),C(13,'spades')];
  const { result } = finishHand(room, 'p1');
  assert.equal(result.type, 'knock');
  assert.equal(result.solutions.p2.deadwoodValue, 10);
  assert.equal(result.points, 1);
});

test('scores gin as 20 plus defender deadwood and forbids layoffs', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  room.players.get('p1').hand = [C(1,'clubs'),C(2,'clubs'),C(3,'clubs'),C(4,'clubs'),C(5,'clubs'),C(6,'hearts'),C(7,'hearts'),C(8,'hearts'),C(9,'hearts'),C(10,'hearts')];
  room.players.get('p2').hand = [C(6,'clubs'),C(7,'clubs'),C(8,'clubs'),C(9,'clubs'),C(13,'spades'),C(12,'diamonds'),C(11,'spades'),C(10,'diamonds'),C(9,'diamonds'),C(8,'spades')];
  const { result } = finishHand(room, 'p1');
  assert.equal(result.type, 'gin');
  assert.equal(result.points, 20 + result.solutions.p2.deadwoodValue);
  assert.deepEqual(result.solutions.p2.layoffs, []);
});

test('a tie undercuts the knocker for the 10 point bonus', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  room.players.get('p1').hand = [C(1,'clubs'),C(2,'clubs'),C(3,'clubs'),C(7,'clubs')];
  room.players.get('p2').hand = [C(1,'diamonds'),C(2,'diamonds'),C(3,'diamonds'),C(7,'spades')];
  const { result } = finishHand(room, 'p1');
  assert.equal(result.type, 'undercut'); assert.equal(result.winnerId, 'p2'); assert.equal(result.points, 10);
});

test('match scorecard applies game, box, and shutout bonuses', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  room.match.scores = { p1: 105, p2: 0 }; room.match.handWins = { p1: 3, p2: 0 };
  const score = calculateFinalScores(room, 'p1');
  assert.equal(score.bonuses.game.p1, 100); assert.equal(score.bonuses.boxes.p1, 60);
  assert.equal(score.bonuses.shutout.p1, 100); assert.equal(score.totals.p1, 365);
});

test('disconnect pause preserves private state and resumes when humans return', () => {
  const room = makeRoom(); startMatch(room, { dealerId: 'p1', deck: createDeck() });
  const before = room.match.phase; room.players.get('p2').isConnected = false; pauseMatch(room);
  assert.equal(room.match.phase, 'paused'); assert.equal(room.match.resumePhase, before);
  assert.equal(viewFor(room, 'p1').players.find(p => p.id === 'p2').hand, null);
  assert.equal(resumeMatch(room), false);
  room.players.get('p2').isConnected = true; assert.equal(resumeMatch(room), true); assert.equal(room.match.phase, before);
});
