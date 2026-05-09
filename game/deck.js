const { v4: uuidv4 } = require('uuid');

const COLORS = ['red', 'blue', 'green', 'yellow'];
const TYPES = {
  number: 'number',
  skip: 'skip',
  reverse: 'reverse',
  draw_two: 'draw_two',
  wild: 'wild',
  wild_draw_four: 'wild_draw_four',
};

function createDeck() {
  const cards = [];
  COLORS.forEach(color => {
    cards.push({ id: uuidv4(), type: TYPES.number, color, value: 0 });
    for (let val = 1; val <= 9; val++) {
      cards.push({ id: uuidv4(), type: TYPES.number, color, value: val });
      cards.push({ id: uuidv4(), type: TYPES.number, color, value: val });
    }
    [TYPES.skip, TYPES.reverse, TYPES.draw_two].forEach(action => {
      cards.push({ id: uuidv4(), type: action, color, value: null });
      cards.push({ id: uuidv4(), type: action, color, value: null });
    });
  });
  for (let i = 0; i < 4; i++) {
    cards.push({ id: uuidv4(), type: TYPES.wild, color: 'wild', value: null });
    cards.push({ id: uuidv4(), type: TYPES.wild_draw_four, color: 'wild', value: null });
  }
  return cards;
}

function shuffleDeck(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function dealHands(deck, playerCount) {
  const hands = {};
  for (let i = 0; i < playerCount; i++) hands[i] = [];
  for (let i = 0; i < 7; i++) {
    for (let p = 0; p < playerCount; p++) {
      const card = deck.pop();
      if (card) hands[p].push(card);
    }
  }
  return { hands, remaining: deck };
}

module.exports = { COLORS, TYPES, createDeck, shuffleDeck, dealHands };
