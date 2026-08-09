// Dodger: move the avatar (arrows / WASD / drag) to soak up value orbs while
// avoiding moving hazards. Hazards reset your score. Reach exactly 67 to light
// the goal pad, then step on it to clear.

import { Mechanic } from './base.js';
import { W, H, weighted, rand, clamp, TARGET } from '../engine/utils.js';
import { drawShape } from '../ui/widgets.js';

export class Dodger extends Mechanic {
  enter() {
    this.autoWin = false;
    this.player = { x: W / 2, y: H - 80, r: 18 };
    this.speed = this.hk(this.params.speed);
    this.orbs = [];
    this.hazards = [];
    for (let i = 0; i < this.params.orbCount; i++) this.spawnOrb();
    const hs = this.hk(this.params.hazardSpeed);
    for (let i = 0; i < this.params.hazardCount; i++) {
      const a = rand(0, Math.PI * 2);
      this.hazards.push({
        x: rand(80, W - 80), y: rand(80, H - 200), r: 16,
        vx: Math.cos(a) * hs, vy: Math.sin(a) * hs,
      });
    }
    this.pad = { x: W / 2, y: 110, r: 40, active: false };
  }

  spawnOrb() {
    this.orbs.push({
      x: rand(50, W - 50), y: rand(50, H - 120), r: 14,
      v: weighted(this.params.orbValues),
    });
  }

  update(dt) {
    super.update(dt);
    const inp = this.game.input;
    let dx = 0, dy = 0;
    if (inp.isDown('ArrowLeft') || inp.isDown('KeyA')) dx -= 1;
    if (inp.isDown('ArrowRight') || inp.isDown('KeyD')) dx += 1;
    if (inp.isDown('ArrowUp') || inp.isDown('KeyW')) dy -= 1;
    if (inp.isDown('ArrowDown') || inp.isDown('KeyS')) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      this.player.x += (dx / len) * this.speed * dt;
      this.player.y += (dy / len) * this.speed * dt;
    } else if (inp.pointer.down) {
      // drag-to-move for touch / mouse
      this.player.x += (inp.pointer.x - this.player.x) * Math.min(1, dt * 10);
      this.player.y += (inp.pointer.y - this.player.y) * Math.min(1, dt * 10);
    }
    this.player.x = clamp(this.player.x, 20, W - 20);
    this.player.y = clamp(this.player.y, 70, H - 30);

    // hazards bounce around the arena
    for (const h of this.hazards) {
      h.x += h.vx * dt; h.y += h.vy * dt;
      if (h.x < 20 || h.x > W - 20) { h.vx *= -1; h.x = clamp(h.x, 20, W - 20); }
      if (h.y < 60 || h.y > H - 20) { h.vy *= -1; h.y = clamp(h.y, 60, H - 20); }
    }

    // orb pickups
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      if (this.hit(this.player, o)) {
        this.orbs.splice(i, 1);
        this.add(o.v, o.x, o.y);
        this.spawnOrb();
      }
    }

    // hazard collisions (only meaningful while we have score to lose)
    for (const h of this.hazards) {
      if (this.hit(this.player, h) && this.score > 0) {
        this.bust(this.player.x, this.player.y);
        break;
      }
    }

    this.pad.active = this.score === TARGET;
    if (this.pad.active && this.hit(this.player, this.pad)) {
      this.win(this.pad.x, this.pad.y);
    }
  }

  hit(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    const rr = a.r + b.r;
    return dx * dx + dy * dy <= rr * rr;
  }

  render(ctx) {
    // goal pad
    ctx.beginPath();
    ctx.arc(this.pad.x, this.pad.y, this.pad.r, 0, Math.PI * 2);
    ctx.strokeStyle = this.pad.active ? '#39ff88' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = this.pad.active ? 'rgba(57,255,136,0.18)' : 'transparent';
    ctx.fill();
    ctx.fillStyle = this.pad.active ? '#39ff88' : 'rgba(255,255,255,0.4)';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('67', this.pad.x, this.pad.y);

    // orbs
    for (const o of this.orbs) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fillStyle = '#39ff88';
      ctx.fill();
      ctx.fillStyle = '#0d1020';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText('+' + o.v, o.x, o.y);
    }

    // hazards
    for (const h of this.hazards) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4d5e';
      ctx.fill();
    }

    // player (skin-themed)
    drawShape(ctx, this.game.equippedSkin().shape, this.player.x, this.player.y, this.player.r, this.game.accent());

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Arrows / WASD / drag — avoid red, reach 67, touch the pad', W / 2, H - 12);
  }
}
