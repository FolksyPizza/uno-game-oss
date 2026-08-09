// Targets: valued targets drift across the arena. Click to accumulate toward
// 67. Decoys carry negative values — clicking them subtracts. Overshoot busts.

import { Mechanic } from './base.js';
import { W, H, weighted, rand, dist2 } from '../engine/utils.js';

export class Targets extends Mechanic {
  enter() {
    this.targets = [];
    this.spawnTimer = 0;
    this.spawnRate = this.hk(this.params.spawnRate);
    this.speed = this.hk(this.params.speed);
  }

  spawn() {
    const p = this.params;
    const decoy = p.decoyChance && Math.random() < p.decoyChance && p.decoyValues;
    const v = weighted(decoy ? p.decoyValues : p.values);
    // enter from a random side, drift across
    const fromLeft = Math.random() < 0.5;
    const y = rand(90, H - 90);
    const angle = rand(-0.4, 0.4);
    const sp = this.speed;
    this.targets.push({
      x: fromLeft ? -30 : W + 30,
      y,
      r: 26,
      v,
      decoy,
      vx: (fromLeft ? 1 : -1) * sp * Math.cos(angle),
      vy: sp * Math.sin(angle),
    });
  }

  update(dt) {
    super.update(dt);
    this.spawnTimer += dt;
    const interval = 1 / this.spawnRate;
    while (this.spawnTimer >= interval) { this.spawnTimer -= interval; this.spawn(); }
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.x += t.vx * dt; t.y += t.vy * dt;
      if (t.y < 60 || t.y > H - 40) t.vy *= -1;
      if (t.x < -60 || t.x > W + 60) this.targets.splice(i, 1);
    }
  }

  handlePointer(x, y) {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (dist2(x, y, t.x, t.y) <= t.r * t.r) {
        this.targets.splice(i, 1);
        this.add(t.v, t.x, t.y);
        return;
      }
    }
  }

  render(ctx) {
    for (const t of this.targets) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fillStyle = t.decoy ? '#ff4d5e' : this.game.accent();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#0d1020';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((t.v > 0 ? '+' : '') + t.v, t.x, t.y);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Click drifting targets — dodge red decoys, hit exactly 67', W / 2, H - 16);
  }
}
