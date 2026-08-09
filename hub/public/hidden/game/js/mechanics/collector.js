// Collector: numbered items fall; click one to bank its value. Good items add
// small amounts; "bad" items add big jumps that can bust you past 67.

import { Mechanic } from './base.js';
import { W, H, weighted, rand, dist2 } from '../engine/utils.js';

export class Collector extends Mechanic {
  enter() {
    this.items = [];
    this.spawnTimer = 0;
    this.spawnRate = this.hk(this.params.spawnRate);
    this.fallSpeed = this.hk(this.params.fallSpeed);
  }

  spawn() {
    const p = this.params;
    const bad = p.badChance && Math.random() < p.badChance && p.badValues;
    const v = weighted(bad ? p.badValues : p.values);
    this.items.push({
      x: rand(60, W - 60),
      y: -30,
      r: 24,
      v,
      bad,
      wob: rand(0, Math.PI * 2),
    });
  }

  update(dt) {
    super.update(dt);
    this.spawnTimer += dt;
    const interval = 1 / this.spawnRate;
    while (this.spawnTimer >= interval) {
      this.spawnTimer -= interval;
      this.spawn();
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.y += this.fallSpeed * dt;
      it.x += Math.sin(it.wob + it.y * 0.02) * 18 * dt;
      if (it.y > H + 40) this.items.splice(i, 1);
    }
  }

  handlePointer(x, y) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (dist2(x, y, it.x, it.y) <= it.r * it.r) {
        this.items.splice(i, 1);
        this.add(it.v, it.x, it.y);
        return;
      }
    }
  }

  render(ctx) {
    for (const it of this.items) {
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
      ctx.fillStyle = it.bad ? '#ff4d5e' : this.game.accent();
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0d1020';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((it.bad ? '+' : '+') + it.v, it.x, it.y);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Click falling numbers — land on exactly 67', W / 2, H - 24);
  }
}
