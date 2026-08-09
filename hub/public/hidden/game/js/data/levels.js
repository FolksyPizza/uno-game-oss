// The level table — the difficulty curve. Cycles through mechanics so variety
// rises as the player advances. `perfectWindow` = seconds within which a clean
// (no-mistake) clear counts as a Perfect 67.

export const LEVELS = [
  // 1-5: gentle introduction to each mechanic
  { id: 'l1', name: 'Catch 67', mechanic: 'collector', timeLimit: 40, perfectWindow: 25,
    params: { spawnRate: 1.1, fallSpeed: 120, values: [{ v: 1, weight: 6 }, { v: 5, weight: 2 }, { v: 10, weight: 1 }], badChance: 0.0 } },

  { id: 'l2', name: 'Sum Sixty-Seven', mechanic: 'adder', timeLimit: 35, perfectWindow: 22,
    params: { tiles: [3, 5, 7, 9, 11, 13, 15, 17, 20, 25, 30, 33], cols: 4, rows: 3 } },

  { id: 'l3', name: 'Lock On 67', mechanic: 'stopper', timeLimit: 40, perfectWindow: 30,
    params: { speed: 22, max: 99 } },

  { id: 'l4', name: 'Orb Run', mechanic: 'dodger', timeLimit: 45, perfectWindow: 30,
    params: { speed: 220, orbCount: 9, hazardCount: 3, hazardSpeed: 70, orbValues: [{ v: 1, weight: 5 }, { v: 5, weight: 2 }, { v: 10, weight: 1 }] } },

  { id: 'l5', name: 'Pick Off 67', mechanic: 'targets', timeLimit: 40, perfectWindow: 26,
    params: { spawnRate: 0.9, speed: 70, values: [{ v: 1, weight: 5 }, { v: 5, weight: 2 }, { v: 10, weight: 1 }], decoyChance: 0.0 } },

  // 6-10: heat rises — faster, decoys/bad items, tighter time
  { id: 'l6', name: 'Falling Fast', mechanic: 'collector', timeLimit: 35, perfectWindow: 20,
    params: { spawnRate: 1.6, fallSpeed: 200, values: [{ v: 1, weight: 5 }, { v: 5, weight: 3 }, { v: 10, weight: 2 }], badChance: 0.18, badValues: [{ v: 13, weight: 1 }] } },

  { id: 'l7', name: 'Tight Sum', mechanic: 'adder', timeLimit: 26, perfectWindow: 16,
    params: { tiles: [4, 6, 8, 12, 14, 16, 18, 19, 21, 23, 29, 31], cols: 4, rows: 3 } },

  { id: 'l8', name: 'Snap 67', mechanic: 'stopper', timeLimit: 35, perfectWindow: 24,
    params: { speed: 40, max: 99 } },

  { id: 'l9', name: 'Hazard Field', mechanic: 'dodger', timeLimit: 40, perfectWindow: 26,
    params: { speed: 250, orbCount: 11, hazardCount: 7, hazardSpeed: 130, orbValues: [{ v: 1, weight: 4 }, { v: 5, weight: 3 }, { v: 10, weight: 2 }] } },

  { id: 'l10', name: 'Decoy Hunt', mechanic: 'targets', timeLimit: 36, perfectWindow: 22,
    params: { spawnRate: 1.3, speed: 130, values: [{ v: 1, weight: 4 }, { v: 5, weight: 3 }, { v: 10, weight: 2 }], decoyChance: 0.35, decoyValues: [{ v: -5, weight: 1 }, { v: -10, weight: 1 }] } },

  // 11-12: expert
  { id: 'l11', name: 'Storm Catch', mechanic: 'collector', timeLimit: 30, perfectWindow: 18,
    params: { spawnRate: 2.2, fallSpeed: 280, values: [{ v: 1, weight: 4 }, { v: 5, weight: 4 }, { v: 10, weight: 3 }], badChance: 0.28, badValues: [{ v: 13, weight: 1 }, { v: 17, weight: 1 }] } },

  { id: 'l12', name: 'Reflex 67', mechanic: 'stopper', timeLimit: 30, perfectWindow: 20,
    params: { speed: 62, max: 99 } },

  // Bonus levels — unlocked via perfect runs (see storage.perfectRuns)
  { id: 'b1', name: '★ Bonus: Blitz', mechanic: 'targets', timeLimit: 28, perfectWindow: 18, bonus: true, perfectsRequired: 3,
    params: { spawnRate: 1.8, speed: 180, values: [{ v: 1, weight: 3 }, { v: 5, weight: 4 }, { v: 10, weight: 3 }], decoyChance: 0.45, decoyValues: [{ v: -5, weight: 1 }, { v: -10, weight: 2 }] } },

  { id: 'b2', name: '★ Bonus: Chaos Orbs', mechanic: 'dodger', timeLimit: 34, perfectWindow: 22, bonus: true, perfectsRequired: 6,
    params: { speed: 270, orbCount: 13, hazardCount: 11, hazardSpeed: 170, orbValues: [{ v: 1, weight: 3 }, { v: 5, weight: 3 }, { v: 10, weight: 3 }] } },
];

export function levelByIndex(i) { return LEVELS[i - 1]; }
export function isBonusUnlocked(level, perfectRuns) {
  if (!level.bonus) return true;
  return perfectRuns >= (level.perfectsRequired || 0);
}
