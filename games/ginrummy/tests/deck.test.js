'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeck, shuffle, cardValue } = require('../game/deck');

test('creates one standard 52-card deck with unique cards', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(c => c.id)).size, 52);
  assert.deepEqual(new Set(deck.map(c => c.suit)), new Set(['clubs', 'diamonds', 'hearts', 'spades']));
  for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) {
    assert.deepEqual(deck.filter(c => c.suit === suit).map(c => c.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  }
});

test('uses official deadwood card values', () => {
  assert.equal(cardValue({ rank: 1 }), 1);
  assert.equal(cardValue({ rank: 7 }), 7);
  assert.equal(cardValue({ rank: 11 }), 10);
  assert.equal(cardValue({ rank: 13 }), 10);
});

test('Fisher-Yates shuffle keeps the same cards', () => {
  const original = createDeck();
  const shuffled = shuffle(original.slice(), max => max - 1);
  assert.deepEqual(shuffled.map(c => c.id).sort(), original.map(c => c.id).sort());
});
