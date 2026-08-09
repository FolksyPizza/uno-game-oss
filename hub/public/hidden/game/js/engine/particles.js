// Lightweight particle system for juice: bursts on catch / clear / penalty.

import { rand } from './utils.js';

export class Particles {
  constructor() { this.list = []; }

  burst(x, y, color, count = 14, speed = 220) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(speed * 0.3, speed);
      this.list.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.4, 0.9),
        max: 0.9,
        size: rand(2, 5),
        color,
      });
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 360 * dt;       // gravity
      p.vx *= 0.98;
      p.life -= dt;
      if (p.life <= 0) this.list.splice(i, 1);
    }
  }

  render(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  clear() { this.list.length = 0; }
}
