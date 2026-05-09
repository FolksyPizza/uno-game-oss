const { canPlayCard } = require('./gameState');
const { TYPES } = require('./deck');

function getBotAction(room, botId) {
  const gs = room.gameState;
  const bot = room.players.get(botId);
  const topCard = gs.discardPile[gs.discardPile.length - 1];
  const effectiveColor = gs.topCardEffectiveColor;
  const pendingDraw = gs.pendingDraw || 0;
  const pendingDrawType = pendingDraw > 0 ? 'draw_two' : null;

  const playable = bot.hand
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => canPlayCard(card, topCard, effectiveColor, bot.hand, pendingDrawType));

  if (playable.length === 0) return { action: 'draw' };

  // Scoring: prefer action cards that match color; save wilds for last resort
  function score(card) {
    if (card.type === TYPES.wild_draw_four) return 1;
    if (card.type === TYPES.wild) return 2;
    const matchesColor = card.color === effectiveColor;
    if (card.type === TYPES.draw_two) return matchesColor ? 9 : 5;
    if (card.type === TYPES.skip || card.type === TYPES.reverse) return matchesColor ? 8 : 4;
    return matchesColor ? 6 : 3;
  }

  playable.sort((a, b) => score(b.card) - score(a.card));
  return { action: 'play', cardIndex: playable[0].index };
}

function getBotColorChoice(room, botId) {
  const bot = room.players.get(botId);
  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of bot.hand) {
    if (counts[c.color] !== undefined) counts[c.color]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || 'red';
}

function getBotSwapTarget(room, botId) {
  let minCards = Infinity;
  let targetId = null;
  for (const [id, p] of room.players) {
    if (id !== botId && p.isConnected && p.hand.length < minCards) {
      minCards = p.hand.length;
      targetId = id;
    }
  }
  return targetId;
}

module.exports = { getBotAction, getBotColorChoice, getBotSwapTarget };
