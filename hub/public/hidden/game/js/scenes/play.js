// PlayScene: mechanic-agnostic host. Runs the active mechanic, draws the HUD,
// enforces the timer, handles pause, and routes to results on clear/fail.

import { W, H, rand, choice } from '../engine/utils.js';
import { LEVELS } from '../data/levels.js';
import { renderHud } from '../ui/hud.js';
import { Button, clickedButton } from '../ui/widgets.js';

import { Collector } from '../mechanics/collector.js';
import { Dodger } from '../mechanics/dodger.js';
import { Adder } from '../mechanics/adder.js';
import { Stopper } from '../mechanics/stopper.js';
import { Targets } from '../mechanics/targets.js';

const MECHANICS = { collector: Collector, dodger: Dodger, adder: Adder, stopper: Stopper, targets: Targets };

export class PlayScene {
  constructor(game) { this.game = game; }

  enter(data) {
    this.levelIndex = data.levelIndex;
    this.level = LEVELS[this.levelIndex - 1];
    const Mech = MECHANICS[this.level.mechanic];
    this.mech = new Mech(this.game, this.level.params);
    this.mech.enter();
    this.timeLeft = this.level.timeLimit;
    this.elapsed = 0;
    this.paused = false;
    // Chaos events: random mid-run modifiers, because a calm run is a boring run.
    this.chaosIn = rand(8, 14);
    this.chaos = null;        // { label, scale, dur }
    this.discoT = 0;
    this.pauseButtons = [
      new Button(W / 2 - 130, 300, 260, 54, 'RESUME', { kind: 'primary', data: 'resume' }),
      new Button(W / 2 - 130, 366, 260, 54, 'QUIT TO LEVELS', { kind: 'ghost', data: 'quit' }),
    ];
  }

  update(dt) {
    const inp = this.game.input;
    if (inp.justPressed('Escape') || inp.justPressed('KeyP')) this.paused = !this.paused;

    if (this.paused) {
      const b = clickedButton(this.pauseButtons, inp);
      if (b) {
        this.game.audio.play('click');
        if (b.data === 'resume') this.paused = false;
        else this.game.setScene('levelSelect');
      }
      return;
    }

    if (this.mech.status === 'playing') {
      // chaos event lifecycle
      this.chaosIn -= dt;
      if (this.chaos) {
        this.chaos.dur -= dt;
        if (this.chaos.id === 'disco') this.discoT += dt;
        if (this.chaos.dur <= 0) { this.chaos = null; this.chaosIn = rand(9, 16); }
      } else if (this.chaosIn <= 0) {
        this.startChaos();
      }
      const scale = this.chaos ? this.chaos.scale : 1;
      // forward clicks to the mechanic
      for (const c of inp.clicks) this.mech.handlePointer(c.x, c.y);
      this.mech.update(dt * scale);
      this.elapsed += dt;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.mech.fail('Time up'); }
    }

    if (this.mech.status === 'cleared') return this.finish(true);
    if (this.mech.status === 'failed') return this.finish(false);
  }

  startChaos() {
    const pick = choice([
      { id: 'speed', label: 'SPEED UP ⚡', scale: 1.6, dur: 4 },
      { id: 'slow',  label: 'SLO-MO 🧊', scale: 0.55, dur: 4 },
      { id: 'disco', label: 'DISCO MODE 🪩', scale: 1, dur: 5 },
      { id: 'gift',  label: '+5s AURA GIFT 🎁', scale: 1, dur: 0.01, gift: 5 },
      { id: 'tax',   label: 'TIMER TAX 🧾 -4s', scale: 1, dur: 0.01, gift: -4 },
    ]);
    this.chaos = { ...pick };
    this.game.hype.say(pick.label, { size: 44, color: '#ffd23f', life: 1.4, wobble: true });
    this.game.audio.play('coin');
    this.game.addShake(6);
    if (pick.gift) this.timeLeft = Math.max(1, this.timeLeft + pick.gift);
    if (pick.id === 'disco') this.game.hype.rain(['🪩', '✨', '🕺'], 14);
  }

  finish(win) {
    const lvl = this.level;
    const store = this.game.storage;
    let perfect = false, coins = 0;
    if (win) {
      perfect = this.mech.mistakes === 0 && this.elapsed <= lvl.perfectWindow;
      coins = 5;
      store.unlockUpTo(this.levelIndex + 1);
      store.recordTime(lvl.id, this.elapsed);
      if (perfect && !store.isPerfected(lvl.id)) coins += 15;
      else if (perfect) coins += 5;
      if (store.data.hardMode) coins += 5;
      if (perfect) store.markPerfect(lvl.id);
      store.addCoins(coins);
      this.game.audio.play('coin');
    }
    this.game.setScene('results', {
      win, perfect, coins,
      levelIndex: this.levelIndex,
      reason: this.mech.reason,
      time: this.elapsed,
    });
  }

  render(ctx) {
    this.mech.render(ctx);

    // disco wash
    if (this.chaos && this.chaos.id === 'disco') {
      ctx.fillStyle = `hsla(${(this.discoT * 240) % 360}, 90%, 60%, 0.10)`;
      ctx.fillRect(0, 0, W, H);
    }

    // penalty red wash
    if (this.mech.flash > 0) {
      ctx.fillStyle = `rgba(255,77,94,${this.mech.flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }

    renderHud(ctx, this.game, {
      score: this.mech.score,
      timeLeft: this.timeLeft,
      timeLimit: this.level.timeLimit,
      levelName: this.level.name,
      mistakes: this.mech.mistakes,
    });

    if (this.paused) {
      ctx.fillStyle = 'rgba(13,16,32,0.82)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 48px system-ui, sans-serif';
      ctx.fillText('PAUSED', W / 2, 210);
      for (const b of this.pauseButtons) b.draw(ctx, this.game.accent(), this.game.input.pointer);
    }
  }
}
