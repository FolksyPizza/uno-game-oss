// Standard 52-card deck. A card is { rank: 2..14, suit: 'c'|'d'|'h'|'s' }.
// rank 11=J, 12=Q, 13=K, 14=A.

const SUITS = ['c', 'd', 'h', 's'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function freshDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  return deck;
}

// Fisher–Yates using crypto for fair shuffling.
function shuffle(deck) {
  const crypto = require('node:crypto');
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardLabel(card) {
  return (RANK_LABEL[card.rank] || String(card.rank)) + card.suit;
}

module.exports = { SUITS, RANKS, RANK_LABEL, freshDeck, shuffle, cardLabel };
