// Title menu: Play, Shop, Hard Mode toggle, Sound toggle.

import { W, H } from '../engine/utils.js';
const TAGLINES = [
  'the forbidden number',
  '"six seven!!!"  — everyone, always',
  '67% skill. 33% aura.',
  'no 66. no 68. we are not the same.',
  'certified sigma arcade experience',
  'hit 67 or get cooked 💀',
  'my honest reaction: 6️⃣7️⃣',
  'unlimited aura awaits',
];
import { Button, clickedButton } from '../ui/widgets.js';

export class MenuScene {
  constructor(game) { this.game = game; this.t = 0; }

  enter() { this.t = 0; this.build(); }

  build() {
    const sd = this.game.storage.data;
    const bw = 280, bh = 60, cx = W / 2 - bw / 2;
    this.buttons = [
      new Button(cx, 270, bw, bh, 'PLAY', { kind: 'primary', data: 'play' }),
      new Button(cx, 345, bw, bh, 'SHOP', { kind: 'ghost', data: 'shop',
        sub: sd.coins + ' aura' }),
      new Button(cx, 420, bw / 2 - 6, bh, sd.hardMode ? 'HARD: ON' : 'HARD: OFF',
        { kind: 'ghost', data: 'hard' }),
      new Button(cx + bw / 2 + 6, 420, bw / 2 - 6, bh,
        sd.settings.muted ? 'SOUND: OFF' : 'SOUND: ON', { kind: 'ghost', data: 'sound' }),
    ];
  }

  update(dt) {
    this.t += dt;
    const b = clickedButton(this.buttons, this.game.input);
    if (!b) return;
    this.game.audio.play('click');
    switch (b.data) {
      case 'play': this.game.setScene('levelSelect'); break;
      case 'shop': this.game.setScene('shop'); break;
      case 'hard':
        this.game.storage.setHardMode(!this.game.storage.data.hardMode);
        this.build();
        break;
      case 'sound': {
        const m = !this.game.storage.data.settings.muted;
        this.game.storage.setMuted(m);
        this.game.audio.setMuted(m);
        this.build();
        break;
      }
    }
  }

  render(ctx) {
    const accent = this.game.accent();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // hue-cycling, bobbing, occasionally glitching title
    const bob = Math.sin(this.t * 2) * 8;
    const glitch = Math.sin(this.t * 13) > 0.98 ? (Math.random() * 8 - 4) : 0;
    ctx.save();
    ctx.translate(W / 2 + glitch, 140 + bob);
    ctx.rotate(Math.sin(this.t * 1.3) * 0.03);
    ctx.fillStyle = `hsl(${(this.t * 50) % 360} 90% 62%)`;
    ctx.font = 'bold 132px system-ui, sans-serif';
    ctx.fillText('67', 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('SIX SEVEN', W / 2, 222);
    // rotating tagline
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'italic 17px system-ui, sans-serif';
    ctx.fillText(TAGLINES[Math.floor(this.t / 3) % TAGLINES.length], W / 2, 250);

    for (const b of this.buttons) b.draw(ctx, accent, this.game.input.pointer);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Hit EXACTLY 67 in every mode. Overshoot = instant regret.', W / 2, H - 30);
  }
}
