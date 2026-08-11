'use strict';

const crypto = require('node:crypto');

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function createDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({
    id: `${suit}-${rank}`,
    suit,
    rank,
  })));
}

function shuffle(cards, randomInt = crypto.randomInt) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function cardValue(card) {
  return Math.min(card.rank, 10);
}

function cardLabel(card) {
  const rank = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || String(card.rank);
  const suit = ({ clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' })[card.suit];
  return `${rank}${suit}`;
}

module.exports = { SUITS, RANKS, createDeck, shuffle, cardValue, cardLabel };
