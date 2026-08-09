// Shared constants and small helpers used everywhere.

export const TARGET = 67;      // the magic number — every mode aims for exactly this
export const W = 960;          // logical canvas width
export const H = 600;          // logical canvas height

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Seedable RNG (mulberry32) so "randomized" rounds can be reproduced/tested.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted pick: items = [{ v, weight }] -> returns a v.
export function weighted(items) {
  let total = 0;
  for (const it of items) total += it.weight;
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.v;
  }
  return items[items.length - 1].v;
}

export const pointInRect = (px, py, x, y, w, h) =>
  px >= x && px <= x + w && py >= y && py <= y + h;

export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

// Pull a contrasting color tone for HUD score based on distance to TARGET.
export function scoreColor(score) {
  if (score > TARGET) return '#ff4d5e';
  if (score === TARGET) return '#39ff88';
  if (score >= TARGET - 6) return '#ffd23f';
  return '#7ad7ff';
}
