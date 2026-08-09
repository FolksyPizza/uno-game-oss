// The shared HUD: current score vs 67, timer bar, level name, coins, mistakes.

import { W, TARGET, scoreColor, clamp } from '../engine/utils.js';

export function renderHud(ctx, game, s) {
  // top bar background
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, W, 56);

  // level name (left)
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(s.levelName, 20, 28);

  // aura (right)
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('AURA ◉ ' + game.storage.data.coins, W - 20, 28);

  // combo (under aura)
  if (game.hype.combo >= 2) {
    ctx.fillStyle = '#ff9f43';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(game.hype.combo + 'x COMBO 🔥', W - 20, 48);
  }

  // score / 67 (center) — pulses when you're in the danger zone (61-66)
  ctx.textAlign = 'center';
  ctx.fillStyle = scoreColor(s.score);
  const tense = s.score >= 61 && s.score < 67;
  const pulse = tense ? 1 + Math.sin(performance.now() / 90) * 0.08 : 1;
  ctx.font = `bold ${Math.round(40 * pulse)}px system-ui, sans-serif`;
  ctx.fillText(String(s.score), W / 2 - 26, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('/ ' + TARGET, W / 2 + 34, 32);

  // timer bar
  const frac = clamp(s.timeLeft / s.timeLimit, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, 56, W, 6);
  ctx.fillStyle = frac < 0.25 ? '#ff4d5e' : game.accent();
  ctx.fillRect(0, 56, W * frac, 6);

  // mistakes dots (perfect run = none)
  if (s.mistakes > 0) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff4d5e';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText("💀 L's: " + s.mistakes, 20, 48);
  } else {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#39ff88';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('LOCKED IN 🔒', 20, 48);
  }
}
