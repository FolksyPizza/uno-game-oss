'use strict';

const { createDeck, shuffle, cardLabel } = require('./deck');
const { solveHand, solveDefender } = require('./meld');

const MATCH_TARGET = 100;
const GIN_BONUS = 20;
const UNDERCUT_BONUS = 10;
const GAME_BONUS = 100;
const BOX_BONUS = 20;
const SHUTOUT_BONUS = 100;

function otherId(room, playerId) {
  return room.playerOrder.find(id => id !== playerId);
}

function assertMatch(room) {
  if (!room.match || room.phase !== 'playing') throw new Error('No active match');
  if (room.match.phase === 'paused') throw new Error('Match is paused while a player reconnects');
  return room.match;
}

function log(match, message) {
  match.log.push(message);
  if (match.log.length > 20) match.log.shift();
}

function startMatch(room, options = {}) {
  if (room.playerOrder.length !== 2) throw new Error('Gin Rummy requires exactly two players');
  const dealerId = options.dealerId || room.playerOrder[Math.floor((options.random || Math.random)() * 2)];
  room.match = {
    phase: 'waiting', resumePhase: null, dealerId, activePlayerId: null,
    stock: [], discardPile: [], drawnDiscardCardId: null,
    scores: Object.fromEntries(room.playerOrder.map(id => [id, 0])),
    handWins: Object.fromEntries(room.playerOrder.map(id => [id, 0])),
    handNumber: 0, log: [], publicHistory: [], lastResult: null,
    startedAt: Date.now(), winnerId: null, finalScores: null,
  };
  room.phase = 'playing';
  startHand(room, dealerId, options.deck);
  return room.match;
}

function startHand(room, dealerId = room.match.dealerId, suppliedDeck = null) {
  const match = room.match;
  match.dealerId = dealerId;
  match.handNumber++;
  match.lastResult = null;
  match.drawnDiscardCardId = null;
  match.log = [];
  match.publicHistory = [];
  const deck = suppliedDeck ? suppliedDeck.slice() : shuffle(createDeck());
  for (const id of room.playerOrder) room.players.get(id).hand = [];
  const nonDealerId = otherId(room, dealerId);
  const order = [nonDealerId, dealerId];
  for (let n = 0; n < 10; n++) {
    for (const id of order) room.players.get(id).hand.push(deck.pop());
  }
  match.discardPile = [deck.pop()];
  match.stock = deck;
  match.activePlayerId = nonDealerId;
  match.phase = 'opening_offer_non_dealer';
  log(match, `${room.players.get(dealerId).name} deals hand ${match.handNumber}.`);
  log(match, `${room.players.get(nonDealerId).name} may take the opening card or pass.`);
  return match;
}

function openingPass(room, playerId) {
  const match = assertMatch(room);
  if (match.activePlayerId !== playerId) throw new Error('Not your turn');
  if (match.phase === 'opening_offer_non_dealer') {
    match.activePlayerId = match.dealerId;
    match.phase = 'opening_offer_dealer';
    log(match, `${room.players.get(playerId).name} passes the opening card.`);
  } else if (match.phase === 'opening_offer_dealer') {
    match.activePlayerId = otherId(room, match.dealerId);
    match.phase = 'must_draw_stock';
    log(match, `${room.players.get(playerId).name} passes; the non-dealer must draw from stock.`);
  } else throw new Error('The opening card is not being offered');
}

function drawDiscard(room, playerId) {
  const match = assertMatch(room);
  if (match.activePlayerId !== playerId) throw new Error('Not your turn');
  if (!['opening_offer_non_dealer', 'opening_offer_dealer', 'draw'].includes(match.phase)) throw new Error('Cannot draw the discard now');
  const card = match.discardPile.pop();
  if (!card) throw new Error('Discard pile is empty');
  room.players.get(playerId).hand.push(card);
  match.drawnDiscardCardId = card.id;
  match.phase = 'discard';
  match.publicHistory.push({ type: 'take_discard', playerId, card });
  log(match, `${room.players.get(playerId).name} takes ${cardLabel(card)} from the discard pile.`);
  return card;
}

function drawStock(room, playerId) {
  const match = assertMatch(room);
  if (match.activePlayerId !== playerId) throw new Error('Not your turn');
  if (!['must_draw_stock', 'draw'].includes(match.phase)) throw new Error('Cannot draw from stock now');
  if (match.stock.length <= 2) throw new Error('The stock is closed');
  const card = match.stock.pop();
  room.players.get(playerId).hand.push(card);
  match.drawnDiscardCardId = null;
  match.phase = 'discard';
  match.publicHistory.push({ type: 'draw_stock', playerId });
  log(match, `${room.players.get(playerId).name} draws from stock.`);
  return card;
}

function findCardIndex(hand, cardId) {
  const index = hand.findIndex(c => c.id === cardId);
  if (index < 0) throw new Error('Card is not in your hand');
  return index;
}

function discard(room, playerId, cardId, knock = false) {
  const match = assertMatch(room);
  if (match.activePlayerId !== playerId) throw new Error('Not your turn');
  if (match.phase !== 'discard') throw new Error('Draw a card before discarding');
  if (cardId === match.drawnDiscardCardId) throw new Error('You cannot immediately discard the card you picked up');
  const player = room.players.get(playerId);
  const index = findCardIndex(player.hand, cardId);
  const remaining = player.hand.filter((_, i) => i !== index);
  const solution = solveHand(remaining);
  if (knock && solution.deadwoodValue > 10) throw new Error('You may only knock with 10 or fewer deadwood points');

  const [card] = player.hand.splice(index, 1);
  match.discardPile.push(card);
  match.publicHistory.push({ type: knock ? 'knock' : 'discard', playerId, card });
  match.drawnDiscardCardId = null;
  log(match, `${player.name} discards ${cardLabel(card)}${knock ? ' and knocks' : ''}.`);

  if (knock) return finishHand(room, playerId, solution);
  if (match.stock.length === 2) return cancelHand(room);
  match.activePlayerId = otherId(room, playerId);
  match.phase = 'draw';
  return { handEnded: false };
}

function finishHand(room, knockerId, knockerSolution = solveHand(room.players.get(knockerId).hand)) {
  const match = room.match;
  const defenderId = otherId(room, knockerId);
  const gin = knockerSolution.deadwoodValue === 0;
  const defenderSolution = solveDefender(room.players.get(defenderId).hand, knockerSolution.melds, !gin);
  let winnerId;
  let points;
  let outcome;
  if (gin) {
    winnerId = knockerId;
    points = GIN_BONUS + defenderSolution.deadwoodValue;
    outcome = 'gin';
  } else if (knockerSolution.deadwoodValue < defenderSolution.deadwoodValue) {
    winnerId = knockerId;
    points = defenderSolution.deadwoodValue - knockerSolution.deadwoodValue;
    outcome = 'knock';
  } else {
    winnerId = defenderId;
    points = UNDERCUT_BONUS + knockerSolution.deadwoodValue - defenderSolution.deadwoodValue;
    outcome = 'undercut';
  }

  match.scores[winnerId] += points;
  match.handWins[winnerId]++;
  match.lastResult = {
    type: outcome, knockerId, defenderId, winnerId, points,
    hands: Object.fromEntries(room.playerOrder.map(id => [id, room.players.get(id).hand.slice()])),
    solutions: { [knockerId]: { ...knockerSolution, layoffs: [] }, [defenderId]: defenderSolution },
    scores: { ...match.scores },
  };
  log(match, `${room.players.get(winnerId).name} scores ${points} point${points === 1 ? '' : 's'} (${outcome}).`);

  if (match.scores[winnerId] >= MATCH_TARGET) {
    match.winnerId = winnerId;
    match.finalScores = calculateFinalScores(room, winnerId);
    match.phase = 'match_result';
  } else {
    match.dealerId = winnerId;
    match.phase = 'hand_result';
  }
  return { handEnded: true, result: match.lastResult };
}

function calculateFinalScores(room, winnerId) {
  const match = room.match;
  const loserId = otherId(room, winnerId);
  const bonuses = {
    game: { [winnerId]: GAME_BONUS, [loserId]: 0 },
    boxes: Object.fromEntries(room.playerOrder.map(id => [id, match.handWins[id] * BOX_BONUS])),
    shutout: { [winnerId]: match.scores[loserId] === 0 ? SHUTOUT_BONUS : 0, [loserId]: 0 },
  };
  const totals = Object.fromEntries(room.playerOrder.map(id => [id,
    match.scores[id] + bonuses.game[id] + bonuses.boxes[id] + bonuses.shutout[id],
  ]));
  return { handPoints: { ...match.scores }, handWins: { ...match.handWins }, bonuses, totals };
}

function cancelHand(room) {
  const match = room.match;
  match.lastResult = {
    type: 'draw', winnerId: null, points: 0,
    hands: Object.fromEntries(room.playerOrder.map(id => [id, room.players.get(id).hand.slice()])),
    solutions: Object.fromEntries(room.playerOrder.map(id => [id, { ...solveHand(room.players.get(id).hand), layoffs: [] }])),
    scores: { ...match.scores },
  };
  match.phase = 'hand_result';
  log(match, 'Only two stock cards remain. The hand is cancelled with no score.');
  return { handEnded: true, result: match.lastResult };
}

function nextHand(room, playerId, options = {}) {
  const match = assertMatch(room);
  if (room.hostId !== playerId) throw new Error('Only the host can deal the next hand');
  if (match.phase !== 'hand_result') throw new Error('The current hand is not complete');
  return startHand(room, match.dealerId, options.deck);
}

function pauseMatch(room) {
  if (!room.match || room.phase !== 'playing' || ['paused', 'match_result'].includes(room.match.phase)) return;
  room.match.resumePhase = room.match.phase;
  room.match.phase = 'paused';
  log(room.match, 'Match paused while a player reconnects.');
}

function resumeMatch(room) {
  if (!room.match || room.match.phase !== 'paused') return false;
  const humansReady = [...room.players.values()].filter(p => !p.isBot).every(p => p.isConnected);
  if (!humansReady) return false;
  room.match.phase = room.match.resumePhase || 'draw';
  room.match.resumePhase = null;
  log(room.match, 'All players reconnected. Match resumed.');
  return true;
}

function legalActions(room, playerId) {
  const m = room.match;
  const mine = !!m && m.activePlayerId === playerId && m.phase !== 'paused';
  return {
    openingPass: mine && ['opening_offer_non_dealer', 'opening_offer_dealer'].includes(m.phase),
    drawStock: mine && ['must_draw_stock', 'draw'].includes(m.phase) && m.stock.length > 2,
    drawDiscard: mine && ['opening_offer_non_dealer', 'opening_offer_dealer', 'draw'].includes(m.phase),
    discard: mine && m.phase === 'discard',
    knock: mine && m.phase === 'discard',
    nextHand: room.hostId === playerId && m.phase === 'hand_result',
    endMatch: room.hostId === playerId || m.phase === 'paused',
  };
}

function publicPlayer(room, player) {
  return { id: player.id, name: player.name, isBot: !!player.isBot, difficulty: player.difficulty, connected: !!player.isConnected, isHost: room.hostId === player.id };
}

function viewFor(room, playerId) {
  const match = room.match;
  const reveal = ['hand_result', 'match_result'].includes(match.phase);
  const ownHand = room.players.get(playerId)?.hand || [];
  const discardOptions = match.phase === 'discard' && match.activePlayerId === playerId
    ? ownHand.map(card => {
      const forbidden = card.id === match.drawnDiscardCardId;
      const deadwoodValue = forbidden ? null : solveHand(ownHand.filter(c => c.id !== card.id)).deadwoodValue;
      return { cardId: card.id, forbidden, deadwoodValue, canKnock: !forbidden && deadwoodValue <= 10 };
    })
    : [];
  const players = room.playerOrder.map(id => {
    const p = room.players.get(id);
    return { ...publicPlayer(room, p), cardCount: p.hand.length, hand: id === playerId || reveal ? p.hand.slice() : null };
  });
  return {
    roomCode: room.code,
    hostId: room.hostId,
    phase: match.phase,
    pausedFrom: match.resumePhase,
    handNumber: match.handNumber,
    dealerId: match.dealerId,
    activePlayerId: match.activePlayerId,
    players,
    hand: ownHand.slice(),
    discardTop: match.discardPile.at(-1) || null,
    stockCount: match.stock.length,
    scores: { ...match.scores },
    handWins: { ...match.handWins },
    log: match.log.slice(),
    legal: legalActions(room, playerId),
    discardOptions,
    lastResult: reveal ? match.lastResult : null,
    winnerId: match.winnerId,
    finalScores: match.phase === 'match_result' ? match.finalScores : null,
  };
}

module.exports = {
  MATCH_TARGET, GIN_BONUS, UNDERCUT_BONUS, GAME_BONUS, BOX_BONUS, SHUTOUT_BONUS,
  otherId, startMatch, startHand, openingPass, drawDiscard, drawStock, discard,
  finishHand, calculateFinalScores, cancelHand, nextHand, pauseMatch, resumeMatch,
  legalActions, viewFor,
};
