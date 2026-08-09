// Adder puzzle: a randomized grid of number tiles. Click tiles to build a
// running sum to exactly 67. Overshoot busts (clears your picks). A guaranteed
// solution subset is always present.

import { Mechanic } from './base.js';
import { W, randInt, pointInRect } from '../engine/utils.js';

export class Adder extends Mechanic {
  enter() {
    const cols = this.params.cols, rows = this.params.rows;
    const values = this.generate(cols * rows);

    const gx = 150, gy = 140, gw = W - 300, gh = 300;
    const cw = gw / cols, ch = gh / rows;
    const pad = 10;
    this.tiles = [];
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.tiles.push({
          x: gx + c * cw + pad, y: gy + r * ch + pad,
          w: cw - pad * 2, h: ch - pad * 2,
          v: values[k++], used: false,
        });
      }
    }
  }

  // Build a set that always contains a subset summing to 67.
  generate(count) {
    const sol = [];
    let remaining = 67;
    while (remaining > 0) {
      if (remaining <= 34) { sol.push(remaining); remaining = 0; }
      else { const x = randInt(8, Math.min(34, remaining - 8)); sol.push(x); remaining -= x; }
    }
    const out = sol.slice();
    while (out.length < count) out.push(randInt(3, 33));
    // shuffle
    for (let i = out.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.slice(0, count);
  }

  handlePointer(x, y) {
    for (const t of this.tiles) {
      if (!t.used && pointInRect(x, y, t.x, t.y, t.w, t.h)) {
        const wasBust = this.score + t.v > 67;
        t.used = true;
        this.add(t.v, t.x + t.w / 2, t.y + t.h / 2);
        if (wasBust) { for (const u of this.tiles) u.used = false; } // bust resets the board
        return;
      }
    }
  }

  render(ctx) {
    for (const t of this.tiles) {
      ctx.fillStyle = t.used ? 'rgba(255,255,255,0.08)' : this.game.accent();
      ctx.globalAlpha = t.used ? 0.5 : 0.92;
      this.roundRect(ctx, t.x, t.y, t.w, t.h, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.used ? 'rgba(255,255,255,0.3)' : '#0d1020';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(t.v), t.x + t.w / 2, t.y + t.h / 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Tap tiles to sum to exactly 67 — going over resets the board', W / 2, 470);
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
