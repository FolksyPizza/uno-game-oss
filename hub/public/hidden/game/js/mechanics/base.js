// Common contract for every mechanic. PlayScene is mechanic-agnostic: it only
// calls enter/update/render/handlePointer and reads { score, status, mistakes }.
//
// status: 'playing' | 'cleared' | 'failed'
// Most modes funnel points through add(): exactly TARGET => win, over => bust.

import { TARGET } from '../engine/utils.js';

export class Mechanic {
  constructor(game, params) {
    this.game = game;
    this.params = params;
    this.score = 0;
    this.mistakes = 0;
    this.status = 'playing';
    this.reason = '';
    this.flash = 0;          // red penalty flash timer (seconds)
    this.autoWin = true;     // if false, reaching TARGET does not auto-clear
    this.hard = game.storage.data.hardMode;
  }

  // Scale a difficulty value up in hard mode.
  hk(v) { return this.hard ? v * 1.35 : v; }

  enter() {}
  exit() {}
  update(dt) { if (this.flash > 0) this.flash = Math.max(0, this.flash - dt); }
  render(ctx) {}
  handlePointer(x, y) {}

  add(n, x, y) {
    this.score += n;
    if (this.score < 0) this.score = 0;
    if (this.score > TARGET) return this.bust(x, y);
    if (this.score === TARGET && this.autoWin) return this.win(x, y);
    if (n !== 0) {
      this.game.audio.play('catch');
      if (x != null) this.game.particles.burst(x, y, this.game.accent(), 8, 150);
      if (n > 0) this.game.hype.bump(x, y, this.score);
    }
  }

  win(x, y) {
    if (this.status !== 'playing') return;
    this.status = 'cleared';
    this.game.audio.play('win');
    this.game.particles.burst(x ?? 480, y ?? 300, '#39ff88', 40, 320);
    this.game.addShake(8);
    this.game.hype.win(x ?? 480, y ?? 300);
  }

  // Overshoot / wrong action: lose progress, flash, count a mistake.
  bust(x, y) {
    this.mistakes++;
    this.flash = 0.4;
    this.score = 0;
    this.game.audio.play('bust');
    this.game.addShake(14);
    this.game.hype.bust();
    if (x != null) this.game.particles.burst(x, y, '#ff4d5e', 22, 260);
  }

  fail(reason) {
    if (this.status !== 'playing') return;
    this.status = 'failed';
    this.reason = reason;
  }
}
