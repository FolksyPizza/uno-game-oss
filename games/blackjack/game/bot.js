'use strict';

const { evaluateHand, canSplitCards, cardPointValue } = require('./hand');

/**
 * Returns basic strategy action for a given hand and dealer upcard.
 *
 * @param {Object} params
 * @param {Array} params.cards - player's cards in this hand
 * @param {Object} params.dealerUpcard - dealer's single visible card
 * @param {boolean} params.canDouble - whether player can double down
 * @param {boolean} params.canSplit - whether player can split
 * @param {boolean} params.canSurrender - whether player can surrender
 * @returns {'hit'|'stand'|'double'|'split'|'surrender'}
 */
function getBasicStrategyAction({ cards, dealerUpcard, canDouble = false, canSplit = false, canSurrender = false }) {
  const evalResult = evaluateHand(cards);
  if (evalResult.isBust || evalResult.total >= 21) {
    return 'stand';
  }

  // Normalize dealer upcard value: Ace is 11, 10/J/Q/K is 10, 2-9 is rank.
  const dVal = dealerUpcard.rank === 1 ? 11 : Math.min(dealerUpcard.rank, 10);
  const total = evalResult.total;
  const isSoft = evalResult.isSoft;

  // 1. Pairs / Splits (only on 2 cards)
  if (canSplit && cards.length === 2 && canSplitCards(cards)) {
    const rank = cards[0].rank;
    // Always split Aces and 8s
    if (rank === 1 || rank === 8) return 'split';
    // Never split 10s / Face cards (rank >= 10)
    if (rank >= 10) return 'stand';
    // 9s: Split vs 2-9 except 7; stand vs 7, 10, A (11)
    if (rank === 9) {
      if ((dVal >= 2 && dVal <= 6) || dVal === 8 || dVal === 9) return 'split';
      return 'stand';
    }
    // 7s: Split vs 2-7, else hit
    if (rank === 7) {
      return (dVal >= 2 && dVal <= 7) ? 'split' : 'hit';
    }
    // 6s: Split vs 2-6, else hit
    if (rank === 6) {
      return (dVal >= 2 && dVal <= 6) ? 'split' : 'hit';
    }
    // 5s: Treat as hard 10 (never split 5s)
    if (rank === 5) {
      if (canDouble && dVal >= 2 && dVal <= 9) return 'double';
      return 'hit';
    }
    // 4s: Split vs 5-6 if double allowed, else hit
    if (rank === 4) {
      if (canDouble && (dVal === 5 || dVal === 6)) return 'split';
      return 'hit';
    }
    // 2s and 3s: Split vs 2-7, else hit
    if (rank === 2 || rank === 3) {
      return (dVal >= 2 && dVal <= 7) ? 'split' : 'hit';
    }
  }

  // 2. Soft Totals (A counted as 11)
  if (isSoft) {
    if (total >= 20) return 'stand';
    if (total === 19) {
      if (canDouble && dVal === 6) return 'double';
      return 'stand';
    }
    if (total === 18) {
      if (canDouble && dVal >= 2 && dVal <= 6) return 'double';
      if (dVal === 7 || dVal === 8) return 'stand';
      return 'hit';
    }
    if (total === 17) {
      if (canDouble && dVal >= 3 && dVal <= 6) return 'double';
      return 'hit';
    }
    if (total === 15 || total === 16) {
      if (canDouble && dVal >= 4 && dVal <= 6) return 'double';
      return 'hit';
    }
    if (total === 13 || total === 14) {
      if (canDouble && (dVal === 5 || dVal === 6)) return 'double';
      return 'hit';
    }
  }

  // 3. Hard Totals
  if (total >= 17) return 'stand';

  if (total === 16) {
    if (canSurrender && cards.length === 2 && (dVal === 9 || dVal === 10 || dVal === 11)) return 'surrender';
    return (dVal >= 2 && dVal <= 6) ? 'stand' : 'hit';
  }

  if (total === 15) {
    if (canSurrender && cards.length === 2 && dVal === 10) return 'surrender';
    return (dVal >= 2 && dVal <= 6) ? 'stand' : 'hit';
  }

  if (total === 13 || total === 14) {
    return (dVal >= 2 && dVal <= 6) ? 'stand' : 'hit';
  }

  if (total === 12) {
    return (dVal >= 4 && dVal <= 6) ? 'stand' : 'hit';
  }

  if (total === 11) {
    if (canDouble && dVal <= 10) return 'double';
    return 'hit';
  }

  if (total === 10) {
    if (canDouble && dVal >= 2 && dVal <= 9) return 'double';
    return 'hit';
  }

  if (total === 9) {
    if (canDouble && dVal >= 3 && dVal <= 6) return 'double';
    return 'hit';
  }

  // 8 or below
  return 'hit';
}

/**
 * Decides whether bot takes insurance when dealer shows an Ace.
 * Standard basic strategy always declines insurance (house edge is high).
 */
function getBotInsuranceDecision() {
  return false;
}

/**
 * Chooses a standard bet for a bot based on chip stack.
 */
function getBotBetAmount(chips) {
  if (chips >= 500) return 50;
  if (chips >= 200) return 25;
  if (chips >= 50) return 10;
  return Math.min(chips, 5);
}

module.exports = {
  getBasicStrategyAction,
  getBotInsuranceDecision,
  getBotBetAmount,
};
