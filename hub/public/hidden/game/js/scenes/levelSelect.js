// Level select grid: lock state, perfect stars, bonus gating.

import { W, H } from '../engine/utils.js';
import { LEVELS, isBonusUnlocked } from '../data/levels.js';
import { Button, clickedButton, roundRect, drawStar } from '../ui/widgets.js';

export class LevelSelectScene {
  constructor(game) { this.game = game; }

  enter() {
    const cols = 4, cardW = 200, cardH = 96, gap = 20;
    const startX = (W - (cols * cardW + (cols - 1) * gap)) / 2;
    const startY = 96;
    this.cells = [];
    LEVELS.forEach((level, idx) => {
      const i = idx + 1;
      const c = idx % cols, r = Math.floor(idx / cols);
      const linUnlocked = this.game.storage.isUnlocked(i);
      const unlocked = linUnlocked && isBonusUnlocked(level, this.game.storage.data.perfectRuns);
      this.cells.push({
        x: startX + c * (cardW + gap), y: startY + r * (cardH + gap),
        w: cardW, h: cardH, index: i, level, unlocked,
        perfected: this.game.storage.isPerfected(level.id),
      });
    });
    this.back = new Button(20, H - 64, 140, 46, '← Back', { kind: 'ghost', data: 'back' });
  }

  update() {
    if (clickedButton([this.back], this.game.input)) {
      this.game.audio.play('click');
      this.game.setScene('menu');
      return;
    }
    for (const c of this.game.input.clicks) {
      for (const cell of this.cells) {
        if (cell.unlocked && c.x >= cell.x && c.x <= cell.x + cell.w &&
            c.y >= cell.y && c.y <= cell.y + cell.h) {
          this.game.audio.play('click');
          this.game.setScene('play', { levelIndex: cell.index });
          return;
        }
      }
    }
  }

  render(ctx) {
    const accent = this.game.accent();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('SELECT LEVEL', W / 2, 50);

    for (const cell of this.cells) {
      ctx.globalAlpha = cell.unlocked ? 1 : 0.4;
      ctx.fillStyle = cell.unlocked ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 12); ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cell.level.bonus ? '#ffd23f' : accent;
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 12); ctx.stroke();

      const cx = cell.x + cell.w / 2;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 19px system-ui, sans-serif';
      ctx.fillText(cell.level.name, cx, cell.y + 32);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(cell.level.mechanic.toUpperCase(), cx, cell.y + 54);

      if (!cell.unlocked) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '20px system-ui, sans-serif';
        const need = cell.level.bonus ? `★ needs ${cell.level.perfectsRequired} perfects` : '🔒 locked';
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText(need, cx, cell.y + 76);
      } else if (cell.perfected) {
        drawStar(ctx, cx, cell.y + 76, 9, '#ffd23f');
        ctx.fillStyle = '#ffd23f';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillText('PERFECT 67', cx + 30, cell.y + 76);
      }
      ctx.globalAlpha = 1;
    }

    this.back.draw(ctx, accent, this.game.input.pointer);
    ctx.fillStyle = '#ffd23f';
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText('◉ ' + this.game.storage.data.coins, W - 24, H - 40);
  }
}
