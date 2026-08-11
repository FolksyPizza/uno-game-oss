'use strict';

const { cardValue } = require('./deck');
const { solveHand } = require('./meld');

function possibleDiscards(hand, forbiddenId = null) {
  return hand.map((card, index) => ({ card, index })).filter(x => x.card.id !== forbiddenId);
}

function opponentHelpRisk(card, publicHistory) {
  let risk = 0;
  const takes = publicHistory.filter(e => e.type === 'take_discard');
  for (const event of takes) {
    if (event.card.rank === card.rank) risk += 5;
    if (event.card.suit === card.suit && Math.abs(event.card.rank - card.rank) <= 2) risk += 3;
  }
  return risk;
}

function rankDiscardChoices(hand, difficulty, publicHistory, forbiddenId) {
  return possibleDiscards(hand, forbiddenId).map(({ card }) => {
    const after = hand.filter(c => c.id !== card.id);
    const solved = solveHand(after);
    let score = solved.deadwoodValue * 10 + cardValue(card) * -0.15;
    if (difficulty === 'hard') score += opponentHelpRisk(card, publicHistory);
    return { card, solution: solved, score };
  }).sort((a, b) => a.score - b.score || a.card.id.localeCompare(b.card.id));
}

function shouldTakeOpeningOrDiscard(room, botId) {
  const bot = room.players.get(botId);
  const top = room.match.discardPile.at(-1);
  const current = solveHand(bot.hand).deadwoodValue;
  const ranked = rankDiscardChoices([...bot.hand, top], bot.difficulty, room.match.publicHistory, top.id);
  if (bot.difficulty === 'easy') return Math.random() < (ranked[0].solution.deadwoodValue < current ? 0.7 : 0.2);
  return ranked[0].solution.deadwoodValue < current;
}

function chooseDraw(room, botId) {
  return shouldTakeOpeningOrDiscard(room, botId) ? 'discard' : 'stock';
}

function chooseDiscard(room, botId) {
  const bot = room.players.get(botId);
  const ranked = rankDiscardChoices(bot.hand, bot.difficulty, room.match.publicHistory, room.match.drawnDiscardCardId);
  let choice = ranked[0];
  if (bot.difficulty === 'easy' && ranked.length > 1) {
    const pool = ranked.slice(0, Math.min(4, ranked.length));
    choice = pool[Math.floor(Math.random() * pool.length)];
  }
  const deadwood = choice.solution.deadwoodValue;
  let knock = false;
  if (deadwood === 0) knock = true;
  else if (deadwood <= 10) {
    if (bot.difficulty === 'easy') knock = deadwood <= 5 && Math.random() < 0.6;
    else if (bot.difficulty === 'medium') knock = deadwood <= 7 || room.match.stock.length <= 12;
    else knock = deadwood <= 5 || room.match.stock.length <= 18 || room.match.publicHistory.length >= 12;
  }
  return { cardId: choice.card.id, knock };
}

module.exports = { possibleDiscards, opponentHelpRisk, rankDiscardChoices, shouldTakeOpeningOrDiscard, chooseDraw, chooseDiscard };
