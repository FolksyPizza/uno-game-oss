// Stopper (reflex): a counter races 0..max on a loop. Tap Space or click to
// lock it. Land on exactly 67 to clear; anything else busts.

import { Mechanic } from './base.js';
import { W, TARGET } from '../engine/utils.js';

export class Stopper extends Mechanic {
  enter() {
    this.value = 0;
    this.max = this.params.max || 99;
    this.speed = this.hk(this.params.speed);
    this.locked = false;
  }

  update(dt) {
    super.update(dt);
    if (this.status === 'playing' && !this.locked) {
      this.value = (this.value + this.speed * dt) % (this.max + 1);
      this.score = Math.round(this.value); // HUD reflects the racing number
    }
    if (this.game.input.justPressed('Space')) this.lock();
  }

  handlePointer() { this.lock(); }

  lock() {
    if (this.status !== 'playing') return;
    const v = Math.round(this.value);
    this.score = v;
    if (v === TARGET) {
      this.locked = true;
      this.win(W / 2, 300);
    } else {
      this.bust(W / 2, 300); // counts a mistake, keeps racing from 0
      this.value = 0;
    }
  }

  render(ctx) {
    const v = Math.round(this.value);
    // big racing number
    ctx.fillStyle = v === TARGET ? '#39ff88' : '#ffffff';
    ctx.font = 'bold 140px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(v), W / 2, 250);

    // track 0..max with a 67 marker
    const tx = 180, tw = W - 360, ty = 380;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(tx, ty, tw, 10);
    const markerX = tx + (TARGET / this.max) * tw;
    ctx.fillStyle = '#39ff88';
    ctx.fillRect(markerX - 2, ty - 12, 4, 34);
    ctx.fillStyle = '#39ff88';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('67', markerX, ty - 22);
    // current position
    const curX = tx + (this.value / this.max) * tw;
    ctx.fillStyle = this.game.accent();
    ctx.beginPath();
    ctx.arc(curX, ty + 5, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Press SPACE or click to lock on 67', W / 2, 460);
  }
}
