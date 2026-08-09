const { canPlayCard } = require('./gameState');
const { TYPES } = require('./deck');

// Difficulty tiers. IMPORTANT: bot logic may only read its OWN hand's card values.
// For opponents it may read hand.length (a publicly-visible count) but NEVER their
// card values — not even for other bots. Every strategy below respects that.
const DIFFICULTIES = ['easy', 'medium', 'hard'];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Publicly-known count of cards held by the player who acts after `botId`,
// following the current turn direction. Used only for target selection.
function nextOpponentCount(room, botId) {
  const gs = room.gameState;
  const order = room.playerOrder;
  const len = order.length;
  if (len < 2) return Infinity;
  const idx = order.indexOf(botId);
  if (idx < 0) return Infinity;
  const nextIdx = (idx + gs.direction + len) % len;
  const next = room.players.get(order[nextIdx]);
  return next ? next.hand.length : Infinity;
}

function playableCards(room, bot) {
  const gs = room.gameState;
  const topCard = gs.discardPile[gs.discardPile.length - 1];
  const effectiveColor = gs.topCardEffectiveColor;
  const pendingDrawType = (gs.pendingDraw || 0) > 0 ? 'draw_two' : null;
  return bot.hand
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => canPlayCard(card, topCard, effectiveColor, bot.hand, pendingDrawType));
}

function getBotAction(room, botId) {
  const gs = room.gameState;
  const bot = room.players.get(botId);
  const effectiveColor = gs.topCardEffectiveColor;
  const difficulty = bot.difficulty || 'medium';

  const playable = playableCards(room, bot);
  if (playable.length === 0) return { action: 'draw' };

  // Easy: no strategy — play a random legal card.
  if (difficulty === 'easy') {
    return { action: 'play', cardIndex: pickRandom(playable).index };
  }

  const isAction = (t) => t === TYPES.draw_two || t === TYPES.skip || t === TYPES.reverse;

  // Baseline scoring (medium): dump matched action cards, hoard wilds for last.
  function score(card) {
    if (card.type === TYPES.wild_draw_four) return 1;
    if (card.type === TYPES.wild) return 2;
    const matchesColor = card.color === effectiveColor;
    if (card.type === TYPES.draw_two) return matchesColor ? 9 : 5;
    if (card.type === TYPES.skip || card.type === TYPES.reverse) return matchesColor ? 8 : 4;
    return matchesColor ? 6 : 3;
  }

  // Hard: same baseline, but weaponize the next opponent's public card count.
  // When they're at/near UNO, aggressively prefer offensive cards (and unleash
  // the wild draw four instead of hoarding it) to blunt their win.
  if (difficulty === 'hard') {
    const threat = nextOpponentCount(room, botId) <= 2;
    function hardScore(card) {
      let s = score(card);
      if (threat) {
        if (card.type === TYPES.wild_draw_four) s = 12;      // best disruption available
        else if (card.type === TYPES.draw_two) s += 6;
        else if (card.type === TYPES.skip || card.type === TYPES.reverse) s += 6;
      }
      // With a big hand, shed high-value number cards a touch sooner.
      if (!isAction(card.type) && card.type !== TYPES.wild && card.type !== TYPES.wild_draw_four
          && typeof card.value === 'number' && card.value >= 7) {
        s += 0.5;
      }
      return s;
    }
    playable.sort((a, b) => hardScore(b.card) - hardScore(a.card));
    return { action: 'play', cardIndex: playable[0].index };
  }

  playable.sort((a, b) => score(b.card) - score(a.card));
  return { action: 'play', cardIndex: playable[0].index };
}

function getBotColorChoice(room, botId) {
  const bot = room.players.get(botId);
  // Easy bots pick a random color they actually hold (still no cheating);
  // medium/hard pick their most-held color to maximize follow-up plays.
  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of bot.hand) {
    if (counts[c.color] !== undefined) counts[c.color]++;
  }
  if ((bot.difficulty || 'medium') === 'easy') {
    const held = Object.keys(counts).filter(k => counts[k] > 0);
    return held.length ? pickRandom(held) : pickRandom(Object.keys(counts));
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || 'red';
}

function getBotSwapTarget(room, botId) {
  // Target the connected opponent with the fewest cards (public count only).
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

module.exports = { getBotAction, getBotColorChoice, getBotSwapTarget, DIFFICULTIES };
