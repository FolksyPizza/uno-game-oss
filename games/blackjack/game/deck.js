'use strict';

const crypto = require('node:crypto');

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function createDeck(deckIdx = 0) {
  return SUITS.flatMap(suit => RANKS.map(rank => ({
    id: `${deckIdx}-${suit}-${rank}`,
    suit,
    rank,
    deckIdx,
  })));
}

function createShoe(deckCount = 6) {
  const shoe = [];
  for (let i = 0; i < deckCount; i++) {
    shoe.push(...createDeck(i));
  }
  return shoe;
}

function shuffle(cards, randomInt = crypto.randomInt) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function cardLabel(card) {
  if (!card) return '??';
  const rank = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || String(card.rank);
  const suit = ({ clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' })[card.suit] || '';
  return `${rank}${suit}`;
}

function cardSymbol(card) {
  if (!card) return { rank: '?', suit: '', symbol: '?', isRed: false };
  const rank = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || String(card.rank);
  const symbol = ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' })[card.suit] || '';
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  return { rank, suit: card.suit, symbol, isRed };
}

module.exports = {
  SUITS,
  RANKS,
  createDeck,
  createShoe,
  shuffle,
  cardLabel,
  cardSymbol,
};
