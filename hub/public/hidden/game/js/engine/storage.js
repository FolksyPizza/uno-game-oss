// Single source of truth for all persistence (localStorage). Every scene
// reads/writes through this — no scattered localStorage calls elsewhere.

const KEY = 'sixtyseven_save_v1';

function defaults() {
  return {
    unlockedLevels: 1,          // highest level index unlocked (1-based)
    perfected: {},              // { levelId: true } for Perfect-67 clears
    bestTimes: {},              // { levelId: seconds }
    coins: 0,
    perfectRuns: 0,             // total count, gates bonus levels
    skins: { owned: ['classic'], equipped: 'classic' },
    hardMode: false,
    settings: { muted: false },
  };
}

export class Storage {
  constructor() { this.data = this.load(); }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      return { ...defaults(), ...JSON.parse(raw) };
    } catch (e) {
      return defaults();
    }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  reset() { this.data = defaults(); this.save(); }

  // --- progression ---
  isUnlocked(levelIndex) { return levelIndex <= this.data.unlockedLevels; }
  unlockUpTo(levelIndex) {
    if (levelIndex > this.data.unlockedLevels) { this.data.unlockedLevels = levelIndex; this.save(); }
  }
  isPerfected(levelId) { return !!this.data.perfected[levelId]; }
  markPerfect(levelId) {
    if (!this.data.perfected[levelId]) {
      this.data.perfected[levelId] = true;
      this.data.perfectRuns++;
    }
    this.save();
  }
  recordTime(levelId, seconds) {
    const prev = this.data.bestTimes[levelId];
    if (prev === undefined || seconds < prev) { this.data.bestTimes[levelId] = seconds; this.save(); }
  }

  // --- economy / skins ---
  addCoins(n) { this.data.coins += n; this.save(); }
  spendCoins(n) {
    if (this.data.coins < n) return false;
    this.data.coins -= n; this.save(); return true;
  }
  ownsSkin(id) { return this.data.skins.owned.includes(id); }
  buySkin(id, price) {
    if (this.ownsSkin(id)) return true;
    if (!this.spendCoins(price)) return false;
    this.data.skins.owned.push(id); this.save(); return true;
  }
  equipSkin(id) { if (this.ownsSkin(id)) { this.data.skins.equipped = id; this.save(); } }

  // --- toggles ---
  setHardMode(v) { this.data.hardMode = v; this.save(); }
  setMuted(v) { this.data.settings.muted = v; this.save(); }
}
