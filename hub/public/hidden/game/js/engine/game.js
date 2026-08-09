// Top-level orchestrator + scene manager. Holds all shared services and
// drives the active scene. Scenes are registered by main.js.

import { Input } from './input.js';
import { Audio } from './audio.js';
import { Storage } from './storage.js';
import { Particles } from './particles.js';
import { Hype } from './hype.js';
import { W, H, rand } from './utils.js';
import { SKINS } from '../data/skins.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.storage = new Storage();
    this.input = new Input(canvas);
    this.audio = new Audio(this.storage.data.settings.muted);
    this.particles = new Particles();
    this.hype = new Hype(this);

    this.scenes = {};
    this.scene = null;
    this.sceneName = '';
    this.shake = 0;

    // Shared run context, populated by levelSelect -> play -> results.
    this.run = null;
  }

  registerScene(name, scene) { this.scenes[name] = scene; }

  setScene(name, data = {}) {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = this.scenes[name];
    this.sceneName = name;
    this.particles.clear();
    this.hype.clear();
    if (this.scene && this.scene.enter) this.scene.enter(data);
  }

  // Accent color from the equipped skin — used across HUD/menus.
  accent() {
    const id = this.storage.data.skins.equipped;
    const s = SKINS.find((k) => k.id === id) || SKINS[0];
    return s.accent;
  }
  equippedSkin() {
    const id = this.storage.data.skins.equipped;
    return SKINS.find((k) => k.id === id) || SKINS[0];
  }

  addShake(amount) { this.shake = Math.min(this.shake + amount, 24); }

  update(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    this.particles.update(dt);
    this.hype.update(dt);
    if (this.scene && this.scene.update) this.scene.update(dt);
  }

  render() {
    const { ctx } = this;
    ctx.save();
    if (this.shake > 0) {
      ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
    }
    // background
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(-30, -30, W + 60, H + 60);
    if (this.scene && this.scene.render) this.scene.render(ctx);
    this.particles.render(ctx);
    this.hype.render(ctx);
    ctx.restore();
    this.input.endFrame();
  }
}
