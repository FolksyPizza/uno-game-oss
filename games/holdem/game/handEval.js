// 7-card Texas Hold'em hand evaluator.
//
// evaluate7(cards) → { rank, tiebreak, name } where a higher [rank, ...tiebreak]
// tuple (compared lexicographically) is a better hand. rank: 8=straight flush,
// 7=quads, 6=full house, 5=flush, 4=straight, 3=trips, 2=two pair, 1=pair, 0=high.
//
// compare(a, b) returns >0 if a beats b, <0 if b beats a, 0 if tied.

const CATEGORY = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

function combos5(cards) {
  const out = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++)
            out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return out;
}

// Best straight high card from a set of distinct ranks (handles wheel A-2-3-4-5).
function straightHigh(ranksDesc) {
  const uniq = [...new Set(ranksDesc)].sort((x, y) => y - x);
  const withWheel = uniq.includes(14) ? [...uniq, 1] : uniq;
  let run = 1;
  for (let i = 1; i < withWheel.length; i++) {
    if (withWheel[i] === withWheel[i - 1] - 1) {
      run++;
      if (run >= 5) return withWheel[i] + 4;
    } else {
      run = 1;
    }
  }
  return 0;
}

function rank5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const sHigh = straightHigh(ranks);

  // Count rank multiplicities.
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  // Groups sorted by (count desc, rank desc) → primary tiebreak ordering.
  const groups = Object.entries(counts)
    .map(([r, n]) => [n, Number(r)])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map(g => g[0]);            // e.g. [3,2] full house
  const byRank = groups.map(g => g[1]);           // ranks in group order

  if (isFlush && sHigh) return [8, sHigh];
  if (shape[0] === 4) return [7, byRank[0], byRank[1]];
  if (shape[0] === 3 && shape[1] === 2) return [6, byRank[0], byRank[1]];
  if (isFlush) return [5, ...ranks];
  if (sHigh) return [4, sHigh];
  if (shape[0] === 3) return [3, byRank[0], ...byRank.slice(1)];
  if (shape[0] === 2 && shape[1] === 2) return [2, byRank[0], byRank[1], byRank[2]];
  if (shape[0] === 2) return [1, byRank[0], ...byRank.slice(1)];
  return [0, ...ranks];
}

function cmpTuple(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function evaluate7(cards) {
  let best = null;
  for (const five of combos5(cards)) {
    const t = rank5(five);
    if (!best || cmpTuple(t, best) > 0) best = t;
  }
  return { rank: best[0], tiebreak: best, name: CATEGORY[best[0]] };
}

function compare(a, b) {
  return cmpTuple(a.tiebreak, b.tiebreak);
}

module.exports = { evaluate7, compare, CATEGORY };
