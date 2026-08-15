'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeck, createShoe, shuffle, cardLabel, cardSymbol } = require('../game/deck');

test('creates a standard 52-card single deck', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  const ids = new Set(deck.map(c => c.id));
  assert.equal(ids.size, 52);
});

test('creates a 6-deck shoe with 312 cards', () => {
  const shoe = createShoe(6);
  assert.equal(shoe.length, 312);
  const ids = new Set(shoe.map(c => c.id));
  assert.equal(ids.size, 312);
});

test('shuffles shoe without losing cards', () => {
  const shoe = createShoe(6);
  const copy = [...shoe];
  shuffle(shoe);
  assert.equal(shoe.length, copy.length);
  const sortedOriginal = copy.map(c => c.id).sort();
  const sortedShuffled = shoe.map(c => c.id).sort();
  assert.deepEqual(sortedShuffled, sortedOriginal);
});

test('cardLabel formats rank and suit correctly', () => {
  assert.equal(cardLabel({ rank: 1, suit: 'hearts' }), 'AH');
  assert.equal(cardLabel({ rank: 10, suit: 'spades' }), '10S');
  assert.equal(cardLabel({ rank: 11, suit: 'diamonds' }), 'JD');
  assert.equal(cardLabel({ rank: 12, suit: 'clubs' }), 'QC');
  assert.equal(cardLabel({ rank: 13, suit: 'hearts' }), 'KH');
});

test('cardSymbol returns correct color and symbol', () => {
  assert.deepEqual(cardSymbol({ rank: 1, suit: 'hearts' }), {
    rank: 'A',
    suit: 'hearts',
    symbol: '♥',
    isRed: true,
  });
  assert.deepEqual(cardSymbol({ rank: 10, suit: 'spades' }), {
    rank: '10',
    suit: 'spades',
    symbol: '♠',
    isRed: false,
  });
});
