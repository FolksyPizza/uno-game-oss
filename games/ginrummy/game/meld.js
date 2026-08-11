'use strict';

const { cardValue } = require('./deck');

function compareCards(a, b) {
  return a.suit.localeCompare(b.suit) || a.rank - b.rank || a.id.localeCompare(b.id);
}

function bits(mask) {
  let count = 0;
  while (mask) { count += mask & 1; mask >>>= 1; }
  return count;
}

function meldKey(meld) {
  return meld.cards.map(c => c.id).sort().join(',');
}

function enumerateMelds(hand) {
  const melds = [];

  for (let rank = 1; rank <= 13; rank++) {
    const indices = hand.map((c, i) => c.rank === rank ? i : -1).filter(i => i >= 0);
    if (indices.length < 3) continue;
    const variants = indices.length === 4
      ? [indices, ...indices.map((_, omit) => indices.filter((__, i) => i !== omit))]
      : [indices];
    for (const idx of variants) {
      melds.push({
        type: 'set',
        rank,
        mask: idx.reduce((m, i) => m | (1 << i), 0),
        cards: idx.map(i => hand[i]).sort(compareCards),
      });
    }
  }

  for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) {
    const suited = hand.map((c, i) => ({ c, i })).filter(x => x.c.suit === suit).sort((a, b) => a.c.rank - b.c.rank);
    for (let start = 0; start < suited.length; start++) {
      for (let end = start + 2; end < suited.length; end++) {
        const slice = suited.slice(start, end + 1);
        if (slice.every((x, i) => i === 0 || x.c.rank === slice[i - 1].c.rank + 1)) {
          melds.push({
            type: 'run', suit,
            minRank: slice[0].c.rank,
            maxRank: slice[slice.length - 1].c.rank,
            mask: slice.reduce((m, x) => m | (1 << x.i), 0),
            cards: slice.map(x => x.c),
          });
        }
      }
    }
  }

  return melds.sort((a, b) => meldKey(a).localeCompare(meldKey(b)));
}

function enumerateArrangements(hand) {
  const melds = enumerateMelds(hand);
  const out = [];
  function walk(start, usedMask, chosen) {
    out.push({ usedMask, melds: chosen.slice() });
    for (let i = start; i < melds.length; i++) {
      if (melds[i].mask & usedMask) continue;
      chosen.push(melds[i]);
      walk(i + 1, usedMask | melds[i].mask, chosen);
      chosen.pop();
    }
  }
  walk(0, 0, []);
  return out;
}

function arrangementResult(hand, arrangement) {
  const deadwood = hand.filter((_, i) => !(arrangement.usedMask & (1 << i))).sort(compareCards);
  return {
    melds: arrangement.melds.map(m => ({ type: m.type, cards: m.cards.slice() })),
    deadwood,
    deadwoodValue: deadwood.reduce((sum, c) => sum + cardValue(c), 0),
    usedMask: arrangement.usedMask,
  };
}

function solutionKey(solution) {
  return solution.melds.map(m => meldKey(m)).sort().join('|');
}

function solveHand(hand) {
  if (!Array.isArray(hand) || hand.length > 31) throw new Error('Invalid hand');
  let best = null;
  for (const arrangement of enumerateArrangements(hand)) {
    const result = arrangementResult(hand, arrangement);
    if (!best
      || result.deadwoodValue < best.deadwoodValue
      || (result.deadwoodValue === best.deadwoodValue && result.deadwood.length < best.deadwood.length)
      || (result.deadwoodValue === best.deadwoodValue && result.deadwood.length === best.deadwood.length
        && solutionKey(result) < solutionKey(best))) best = result;
  }
  return best || { melds: [], deadwood: hand.slice(), deadwoodValue: hand.reduce((s, c) => s + cardValue(c), 0), usedMask: 0 };
}

function meldState(melds) {
  return melds.map(m => {
    const cards = m.cards.slice();
    if (m.type === 'set') return { type: 'set', rank: cards[0].rank, count: cards.length, cards };
    const ranks = cards.map(c => c.rank);
    return { type: 'run', suit: cards[0].suit, minRank: Math.min(...ranks), maxRank: Math.max(...ranks), cards };
  });
}

function attachable(card, meld) {
  if (meld.type === 'set') return meld.rank === card.rank && meld.count < 4;
  return meld.suit === card.suit && (card.rank === meld.minRank - 1 || card.rank === meld.maxRank + 1);
}

function attach(card, meld) {
  if (meld.type === 'set') meld.count++;
  else { meld.minRank = Math.min(meld.minRank, card.rank); meld.maxRank = Math.max(meld.maxRank, card.rank); }
  meld.cards.push(card);
}

function stateKey(remaining, melds) {
  const rem = remaining.map(c => c.id).sort().join(',');
  const ms = melds.map(m => m.type === 'set' ? `s${m.rank}:${m.count}` : `r${m.suit}:${m.minRank}-${m.maxRank}`).join('|');
  return `${rem}/${ms}`;
}

function bestLayoff(deadwood, knockerMelds) {
  const memo = new Map();
  function search(remaining, states) {
    const key = stateKey(remaining, states);
    if (memo.has(key)) return memo.get(key);
    let best = { laidOff: [], remaining: remaining.slice(), value: 0 };
    for (let i = 0; i < remaining.length; i++) {
      for (let m = 0; m < states.length; m++) {
        if (!attachable(remaining[i], states[m])) continue;
        const card = remaining[i];
        const nextRemaining = remaining.filter((_, idx) => idx !== i);
        const nextStates = states.map(s => ({ ...s, cards: s.cards.slice() }));
        attach(card, nextStates[m]);
        const tail = search(nextRemaining, nextStates);
        const candidate = {
          laidOff: [{ card, meldIndex: m }, ...tail.laidOff],
          remaining: tail.remaining,
          value: cardValue(card) + tail.value,
        };
        if (candidate.value > best.value
          || (candidate.value === best.value && candidate.laidOff.length > best.laidOff.length)) best = candidate;
      }
    }
    memo.set(key, best);
    return best;
  }
  return search(deadwood.slice().sort(compareCards), meldState(knockerMelds));
}

function solveDefender(hand, knockerMelds, allowLayoff = true) {
  let best = null;
  for (const arrangement of enumerateArrangements(hand)) {
    const base = arrangementResult(hand, arrangement);
    const layoff = allowLayoff ? bestLayoff(base.deadwood, knockerMelds) : { laidOff: [], remaining: base.deadwood, value: 0 };
    const result = {
      melds: base.melds,
      layoffs: layoff.laidOff,
      deadwood: layoff.remaining.sort(compareCards),
      deadwoodValue: layoff.remaining.reduce((sum, c) => sum + cardValue(c), 0),
    };
    if (!best
      || result.deadwoodValue < best.deadwoodValue
      || (result.deadwoodValue === best.deadwoodValue && result.deadwood.length < best.deadwood.length)
      || (result.deadwoodValue === best.deadwoodValue && result.deadwood.length === best.deadwood.length
        && solutionKey(result) < solutionKey(best))) best = result;
  }
  return best;
}

module.exports = { enumerateMelds, enumerateArrangements, solveHand, bestLayoff, solveDefender };
