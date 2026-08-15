'use strict';

/**
 * Returns point value of a single card without ace context.
 * Ace is 11 by default, face cards are 10, number cards are face value.
 */
function cardPointValue(card) {
  if (!card) return 0;
  if (card.rank === 1) return 11;
  if (card.rank >= 10) return 10;
  return card.rank;
}

/**
 * Evaluates a hand of cards.
 * @param {Array} cards - Array of card objects
 * @returns {{ total: number, isSoft: boolean, isBust: boolean, isBlackjack: boolean, aceCount: number }}
 */
function evaluateHand(cards = []) {
  if (!cards || cards.length === 0) {
    return { total: 0, isSoft: false, isBust: false, isBlackjack: false, aceCount: 0 };
  }

  let total = 0;
  let aceCount = 0;

  for (const card of cards) {
    if (card.rank === 1) {
      aceCount++;
      total += 11;
    } else if (card.rank >= 10) {
      total += 10;
    } else {
      total += card.rank;
    }
  }

  let acesAsEleven = aceCount;
  while (total > 21 && acesAsEleven > 0) {
    total -= 10;
    acesAsEleven--;
  }

  const isBust = total > 21;
  const isSoft = acesAsEleven > 0 && !isBust;
  const isBlackjack = cards.length === 2 && total === 21;

  return {
    total,
    isSoft,
    isBust,
    isBlackjack,
    aceCount,
  };
}

/**
 * Checks if two cards can be split.
 * In casino blackjack, equal value cards (e.g. 10-J or 8-8) or matching ranks can be split.
 */
function canSplitCards(cards) {
  if (!cards || cards.length !== 2) return false;
  const val1 = cardPointValue(cards[0]);
  const val2 = cardPointValue(cards[1]);
  return val1 === val2 || cards[0].rank === cards[1].rank;
}

module.exports = {
  cardPointValue,
  evaluateHand,
  canSplitCards,
};
