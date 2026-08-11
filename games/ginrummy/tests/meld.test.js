'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { solveHand, solveDefender } = require('../game/meld');

const C = (rank, suit) => ({ id: `${suit}-${rank}`, rank, suit });

test('recognizes sets, suited runs, and ace-low runs', () => {
  const hand = [C(1, 'hearts'), C(2, 'hearts'), C(3, 'hearts'), C(7, 'clubs'), C(7, 'diamonds'), C(7, 'spades'), C(13, 'clubs')];
  const solved = solveHand(hand);
  assert.equal(solved.melds.length, 2);
  assert.equal(solved.deadwoodValue, 10);
  assert.deepEqual(solved.deadwood.map(c => c.id), ['clubs-13']);
});

test('does not treat ace as high after a king', () => {
  const solved = solveHand([C(11, 'spades'), C(12, 'spades'), C(13, 'spades'), C(1, 'spades')]);
  assert.equal(solved.melds.length, 1);
  assert.deepEqual(solved.melds[0].cards.map(c => c.rank), [11, 12, 13]);
  assert.equal(solved.deadwoodValue, 1);
});

test('chooses the optimal partition when a card can be in a set or run', () => {
  const hand = [
    C(7, 'clubs'), C(7, 'diamonds'), C(7, 'hearts'),
    C(8, 'hearts'), C(9, 'hearts'), C(10, 'hearts'),
  ];
  const solved = solveHand(hand);
  assert.equal(solved.deadwoodValue, 0);
  assert.equal(solved.melds.length, 2);
});

test('deterministically resolves equivalent meld arrangements', () => {
  const hand = [C(3, 'clubs'), C(4, 'clubs'), C(5, 'clubs'), C(6, 'clubs'), C(7, 'clubs')];
  assert.deepEqual(solveHand(hand), solveHand(hand));
  assert.equal(solveHand(hand).deadwoodValue, 0);
});

test('defender layoffs can extend both ends of a run in sequence', () => {
  const knocker = solveHand([C(5, 'hearts'), C(6, 'hearts'), C(7, 'hearts')]);
  const defender = [C(3, 'hearts'), C(4, 'hearts'), C(8, 'hearts'), C(9, 'hearts'), C(13, 'clubs')];
  const solved = solveDefender(defender, knocker.melds, true);
  assert.equal(solved.layoffs.length, 4);
  assert.equal(solved.deadwoodValue, 10);
});

test('gin prevents all defender layoffs', () => {
  const knocker = solveHand([C(5, 'hearts'), C(6, 'hearts'), C(7, 'hearts')]);
  const defender = [C(4, 'hearts'), C(8, 'hearts')];
  const solved = solveDefender(defender, knocker.melds, false);
  assert.equal(solved.layoffs.length, 0);
  assert.equal(solved.deadwoodValue, 12);
});
