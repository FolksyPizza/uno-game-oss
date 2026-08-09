// Boot screen — also captures the first user gesture so WebAudio can start.

import { W, H } from '../engine/utils.js';

export class BootScene {
  constructor(game) { this.game = game; this.t = 0; }
  enter() { this.t = 0; }
  update(dt) {
    this.t += dt;
    const inp = this.game.input;
    if (this.t > 0.4 && (inp.clicked || inp.anyKeyPressed())) {
      this.game.audio.play('click');
      this.game.setScene('menu');
    }
  }
  render(ctx) {
    ctx.fillStyle = this.game.accent();
    ctx.font = 'bold 160px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('67', W / 2, H / 2 - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '22px system-ui, sans-serif';
    const blink = Math.sin(this.t * 4) > 0;
    if (blink) ctx.fillText('click or press any key to start', W / 2, H / 2 + 110);
  }
}
