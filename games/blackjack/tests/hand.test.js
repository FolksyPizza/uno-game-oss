'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHand, canSplitCards } = require('../game/hand');
const { getBasicStrategyAction } = require('../game/bot');

test('evaluates hard hands accurately', () => {
  const hand = [
    { rank: 10, suit: 'spades' },
    { rank: 7, suit: 'hearts' },
  ];
  const res = evaluateHand(hand);
  assert.equal(res.total, 17);
  assert.equal(res.isSoft, false);
  assert.equal(res.isBust, false);
  assert.equal(res.isBlackjack, false);
});

test('evaluates soft hands with Ace counted as 11', () => {
  const hand = [
    { rank: 1, suit: 'spades' },
    { rank: 6, suit: 'hearts' },
  ];
  const res = evaluateHand(hand);
  assert.equal(res.total, 17);
  assert.equal(res.isSoft, true);
  assert.equal(res.isBust, false);
  assert.equal(res.isBlackjack, false);
});

test('evaluates natural Blackjack (21 on 2 cards)', () => {
  const hand = [
    { rank: 1, suit: 'spades' },
    { rank: 12, suit: 'hearts' }, // Queen
  ];
  const res = evaluateHand(hand);
  assert.equal(res.total, 21);
  assert.equal(res.isSoft, true);
  assert.equal(res.isBlackjack, true);
  assert.equal(res.isBust, false);
});

test('converts Ace from 11 to 1 when exceeding 21', () => {
  const hand = [
    { rank: 1, suit: 'spades' },
    { rank: 8, suit: 'hearts' },
    { rank: 5, suit: 'clubs' },
  ]; // A (11) + 8 + 5 = 24 -> A becomes 1 -> 14
  const res = evaluateHand(hand);
  assert.equal(res.total, 14);
  assert.equal(res.isSoft, false);
  assert.equal(res.isBust, false);
});

test('handles multiple Aces correctly', () => {
  const hand = [
    { rank: 1, suit: 'spades' },
    { rank: 1, suit: 'hearts' },
    { rank: 9, suit: 'diamonds' },
  ]; // A (11) + A (1) + 9 = 21 (Soft 21)
  const res = evaluateHand(hand);
  assert.equal(res.total, 21);
  assert.equal(res.isSoft, true);
  assert.equal(res.isBlackjack, false); // 3 cards -> not natural blackjack
});

test('detects busts (> 21)', () => {
  const hand = [
    { rank: 10, suit: 'spades' },
    { rank: 8, suit: 'hearts' },
    { rank: 6, suit: 'diamonds' },
  ]; // 24
  const res = evaluateHand(hand);
  assert.equal(res.total, 24);
  assert.equal(res.isBust, true);
});

test('canSplitCards detects pairs of matching rank or value', () => {
  assert.equal(canSplitCards([{ rank: 8, suit: 'hearts' }, { rank: 8, suit: 'spades' }]), true);
  assert.equal(canSplitCards([{ rank: 1, suit: 'hearts' }, { rank: 1, suit: 'diamonds' }]), true);
  assert.equal(canSplitCards([{ rank: 10, suit: 'hearts' }, { rank: 11, suit: 'spades' }]), true); // 10 and J
  assert.equal(canSplitCards([{ rank: 5, suit: 'hearts' }, { rank: 7, suit: 'spades' }]), false);
});

test('bot basic strategy follows standard decisions', () => {
  // Always split Aces
  const splitAces = getBasicStrategyAction({
    cards: [{ rank: 1, suit: 'hearts' }, { rank: 1, suit: 'spades' }],
    dealerUpcard: { rank: 10, suit: 'diamonds' },
    canSplit: true,
  });
  assert.equal(splitAces, 'split');

  // Hard 16 vs Dealer 10: hit or surrender
  const hard16Hit = getBasicStrategyAction({
    cards: [{ rank: 10, suit: 'hearts' }, { rank: 6, suit: 'spades' }],
    dealerUpcard: { rank: 10, suit: 'diamonds' },
    canSurrender: false,
  });
  assert.equal(hard16Hit, 'hit');

  // Hard 16 vs Dealer 6: stand
  const hard16Stand = getBasicStrategyAction({
    cards: [{ rank: 10, suit: 'hearts' }, { rank: 6, suit: 'spades' }],
    dealerUpcard: { rank: 6, suit: 'diamonds' },
  });
  assert.equal(hard16Stand, 'stand');

  // Hard 11 vs Dealer 5: double down
  const double11 = getBasicStrategyAction({
    cards: [{ rank: 6, suit: 'hearts' }, { rank: 5, suit: 'spades' }],
    dealerUpcard: { rank: 5, suit: 'diamonds' },
    canDouble: true,
  });
  assert.equal(double11, 'double');
});
