// Hype layer: floating meme popups, emoji confetti, combo tracking, the
// "six... SEVEN!!!" chant, and chaos-event banners. Pure canvas — rendered
// last so it sits on top of everything. This is where the brainrot lives.

import { W, H, rand, choice } from './utils.js';

const BUST_LINES = [
  'COOKED 💀', "NAH THAT AIN'T IT", 'BACK TO ZERO 😭', 'CHAT, IS THIS REAL?',
  'AURA -999', 'BRO OVERSHOT 💔', 'GG GO NEXT', 'NOT THE 68 ☠️', 'CAUGHT IN 4K 📸',
];
const NEAR_LINES = ['SO CLOSE 👀', 'ONE MORE 🗣️', "DON'T CHOKE", 'EASY MONEY 💸', 'COOK.'];
const COMBO_LINES = {
  3: 'HEATING UP 🔥',
  5: 'LOCKED IN 🔒',
  8: 'ABSOLUTE CINEMA 🎬',
  12: 'UNLIMITED AURA ♾️',
  16: 'GOATED 🐐',
  20: 'BEYOND SIGMA 🌌',
};
const WIN_EMOJI = ['6️⃣', '7️⃣', '🔥', '🗣️', '💯', '🎉'];

export class Hype {
  constructor(game) {
    this.game = game;
    this.pops = [];      // floating text
    this.emojis = [];    // emoji particles
    this.timeline = [];  // scheduled callbacks {t, fn}
    this.combo = 0;
    this.comboTimer = 0;
    this.saidNear = false;
  }

  clear() {
    this.pops.length = 0;
    this.emojis.length = 0;
    this.timeline.length = 0;
    this.combo = 0;
    this.saidNear = false;
  }

  say(text, opts = {}) {
    this.pops.push({
      text,
      x: opts.x ?? W / 2,
      y: opts.y ?? H / 2 - 70,
      size: opts.size ?? 34,
      color: opts.color ?? '#ffffff',
      life: opts.life ?? 1.15,
      max: opts.life ?? 1.15,
      rise: opts.rise ?? 42,
      wobble: opts.wobble ?? false,
    });
  }

  emoji(x, y, chars = ['🔥'], count = 10, speed = 280) {
    for (let i = 0; i < count; i++) {
      const a = rand(-Math.PI, 0); // fountain upward
      const sp = rand(speed * 0.4, speed);
      this.emojis.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        char: choice(chars),
        life: rand(0.8, 1.5),
        max: 1.5,
        size: rand(18, 34),
        spin: rand(-4, 4),
        rot: rand(0, Math.PI * 2),
      });
    }
  }

  rain(chars = WIN_EMOJI, count = 26) {
    for (let i = 0; i < count; i++) {
      this.emojis.push({
        x: rand(0, W), y: rand(-80, -10),
        vx: rand(-30, 30), vy: rand(180, 380),
        char: choice(chars),
        life: rand(1.4, 2.4), max: 2.4,
        size: rand(20, 40),
        spin: rand(-3, 3), rot: rand(0, Math.PI * 2),
      });
    }
  }

  after(t, fn) { this.timeline.push({ t, fn }); }

  // Called on every successful scoring action.
  bump(x, y, score) {
    this.combo++;
    this.comboTimer = 3;
    const line = COMBO_LINES[this.combo];
    if (line) {
      this.say(line, { y: 150, size: 30, color: '#ffd23f' });
      this.emoji(x ?? W / 2, y ?? H / 2, ['🔥', '💯'], 6, 220);
      this.game.audio.play('coin');
    }
    // tension zone: 61..66 — one hype line per approach
    if (score >= 61 && score < 67 && !this.saidNear) {
      this.saidNear = true;
      this.say(choice(NEAR_LINES), { y: 190, size: 26, color: '#7ad7ff' });
    }
    if (score < 61) this.saidNear = false;
  }

  bust() {
    this.combo = 0;
    this.saidNear = false;
    this.say(choice(BUST_LINES), { size: 40, color: '#ff4d5e', life: 1.3, wobble: true });
    this.rain(['💀', '😭', '📉'], 10);
  }

  // The win moment: the chant.
  win(x, y) {
    this.say('six...', { x, y: (y ?? H / 2) - 30, size: 30, color: 'rgba(255,255,255,.85)' });
    this.after(0.38, () => {
      this.say('SEVEN!!! 🗣️', { size: 64, color: '#39ff88', life: 1.5, wobble: true });
      this.game.audio.play('seven');
      this.rain(WIN_EMOJI, 34);
    });
    this.game.audio.play('six');
  }

  update(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      const it = this.timeline[i];
      it.t -= dt;
      if (it.t <= 0) { this.timeline.splice(i, 1); it.fn(); }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      p.y -= (p.rise * dt) * (p.life / p.max);
      if (p.life <= 0) this.pops.splice(i, 1);
    }
    for (let i = this.emojis.length - 1; i >= 0; i--) {
      const e = this.emojis[i];
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.vy += 420 * dt;
      e.rot += e.spin * dt;
      e.life -= dt;
      if (e.life <= 0 || e.y > H + 60) this.emojis.splice(i, 1);
    }
  }

  render(ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const e of this.emojis) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, e.life / 0.5));
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rot);
      ctx.font = `${e.size}px system-ui, sans-serif`;
      ctx.fillText(e.char, 0, 0);
      ctx.restore();
    }
    for (const p of this.pops) {
      const k = p.life / p.max;
      // pop in fast, fade out
      const scale = k > 0.85 ? 1 + (1 - k) * 3 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, k * 2));
      ctx.translate(p.x, p.y);
      if (p.wobble) ctx.rotate(Math.sin(p.life * 24) * 0.04);
      ctx.scale(scale, scale);
      ctx.font = `bold ${p.size}px system-ui, sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
