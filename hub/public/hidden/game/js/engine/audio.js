// Tiny procedural sound via WebAudio — no asset files needed. Toggleable mute.

const SFX = {
  tick:  { freq: 440, dur: 0.05, type: 'square',   gain: 0.15 },
  catch: { freq: 660, dur: 0.07, type: 'triangle', gain: 0.20 },
  win:   { freq: 880, dur: 0.30, type: 'sine',     gain: 0.25, slide: 1320 },
  bust:  { freq: 140, dur: 0.30, type: 'sawtooth', gain: 0.25, slide: 70 },
  click: { freq: 520, dur: 0.04, type: 'square',   gain: 0.12 },
  coin:  { freq: 990, dur: 0.12, type: 'triangle', gain: 0.20, slide: 1480 },
  six:   { freq: 392, dur: 0.16, type: 'triangle', gain: 0.22 },
  seven: { freq: 587, dur: 0.34, type: 'triangle', gain: 0.26, slide: 784 },
};

export class Audio {
  constructor(muted = false) {
    this.muted = muted;
    this.ctx = null;
  }
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  play(name) {
    if (this.muted) return;
    this._ensure();
    if (!this.ctx) return;
    const s = SFX[name];
    if (!s) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = s.type;
    osc.frequency.setValueAtTime(s.freq, t0);
    if (s.slide) osc.frequency.exponentialRampToValueAtTime(s.slide, t0 + s.dur);
    gain.gain.setValueAtTime(s.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + s.dur);
  }
  setMuted(m) { this.muted = m; }
}
