// Results: win/fail summary, Perfect-67 badge, coins earned, and next steps.

import { W, H, choice } from '../engine/utils.js';
const FAIL_LINES = ['YOU GOT COOKED 💀', 'GG GO NEXT', 'AURA -1000', 'CHAT IS THIS REAL?', 'SKILL ISSUE 😭'];
const WIN_LINES = ['SIX SEVEN!!! 🗣️', "67'D IT 🔥", 'ABSOLUTE CINEMA 🎬', 'W IN THE CHAT'];
import { LEVELS, isBonusUnlocked } from '../data/levels.js';
import { Button, clickedButton, drawStar } from '../ui/widgets.js';

export class ResultsScene {
  constructor(game) { this.game = game; this.t = 0; }

  enter(data) {
    this.data = data;
    this.t = 0;
    this.headline = data.win ? choice(WIN_LINES) : choice(FAIL_LINES);
    if (data.win) this.game.hype.rain(['6️⃣', '7️⃣', '🔥', '💯'], 20);
    const cx = W / 2, bw = 200, bh = 52;
    this.buttons = [];

    const nextIndex = data.levelIndex + 1;
    const nextLevel = LEVELS[nextIndex - 1];
    const nextPlayable = data.win && nextLevel &&
      this.game.storage.isUnlocked(nextIndex) &&
      isBonusUnlocked(nextLevel, this.game.storage.data.perfectRuns);

    if (nextPlayable) {
      this.buttons.push(new Button(cx - bw - 12, 410, bw, bh, 'NEXT →', { kind: 'primary', data: 'next' }));
      this.buttons.push(new Button(cx + 12, 410, bw, bh, 'RUN IT BACK', { kind: 'ghost', data: 'retry' }));
    } else {
      this.buttons.push(new Button(cx - bw - 12, 410, bw, bh, 'RUN IT BACK', { kind: 'primary', data: 'retry' }));
      this.buttons.push(new Button(cx + 12, 410, bw, bh, 'LEVELS', { kind: 'ghost', data: 'levels' }));
    }
    this.buttons.push(new Button(cx - bw / 2, 478, bw, 46, 'MENU', { kind: 'ghost', data: 'menu' }));
  }

  update(dt) {
    this.t += dt;
    const b = clickedButton(this.buttons, this.game.input);
    if (!b) return;
    this.game.audio.play('click');
    switch (b.data) {
      case 'next': this.game.setScene('play', { levelIndex: this.data.levelIndex + 1 }); break;
      case 'retry': this.game.setScene('play', { levelIndex: this.data.levelIndex }); break;
      case 'levels': this.game.setScene('levelSelect'); break;
      case 'menu': this.game.setScene('menu'); break;
    }
  }

  render(ctx) {
    const d = this.data;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    ctx.fillStyle = d.win ? '#39ff88' : '#ff4d5e';
    const squish = 1 + Math.sin(this.t * 5) * 0.02;
    ctx.save();
    ctx.translate(W / 2, 140);
    ctx.scale(squish, 1 / squish);
    ctx.font = `bold ${this.headline.length > 14 ? 54 : 66}px system-ui, sans-serif`;
    ctx.fillText(this.headline, 0, 0);
    ctx.restore();

    if (d.win && d.perfect) {
      const scale = 1 + Math.sin(this.t * 6) * 0.05;
      drawStar(ctx, W / 2 - 130, 210, 18 * scale, '#ffd23f');
      drawStar(ctx, W / 2 + 130, 210, 18 * scale, '#ffd23f');
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.fillText('PERFECT 67 · CERTIFIED SIGMA', W / 2, 210);
    } else if (!d.win) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillText(d.reason || 'Try again', W / 2, 205);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '22px system-ui, sans-serif';
    if (d.win) {
      ctx.fillText(`Time: ${d.time.toFixed(1)}s`, W / 2, 290);
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(`+${d.coins} AURA  (◉ ${this.game.storage.data.coins})`, W / 2, 330);
    }

    for (const b of this.buttons) b.draw(ctx, this.game.accent(), this.game.input.pointer);
  }
}
