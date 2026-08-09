// Reusable UI drawing: buttons, shapes, star ratings, panels.

import { pointInRect } from '../engine/utils.js';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Button {
  constructor(x, y, w, h, label, opts = {}) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.label = label;
    this.disabled = opts.disabled || false;
    this.kind = opts.kind || 'primary'; // primary | ghost
    this.data = opts.data;              // arbitrary payload
    this.sub = opts.sub || null;        // optional sub-label
  }
  contains(px, py) { return pointInRect(px, py, this.x, this.y, this.w, this.h); }

  draw(ctx, accent, pointer) {
    const hover = !this.disabled && this.contains(pointer.x, pointer.y);
    ctx.globalAlpha = this.disabled ? 0.4 : 1;
    if (this.kind === 'primary') {
      ctx.fillStyle = hover ? accent : 'rgba(255,255,255,0.06)';
      roundRect(ctx, this.x, this.y, this.w, this.h, 12);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      roundRect(ctx, this.x, this.y, this.w, this.h, 12);
      ctx.stroke();
      ctx.fillStyle = hover ? '#0d1020' : '#ffffff';
    } else {
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
      roundRect(ctx, this.x, this.y, this.w, this.h, 10);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
    }
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.label, this.x + this.w / 2, this.y + this.h / 2 + (this.sub ? -8 : 0));
    if (this.sub) {
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = this.kind === 'primary' && hover ? 'rgba(13,16,32,0.8)' : 'rgba(255,255,255,0.6)';
      ctx.fillText(this.sub, this.x + this.w / 2, this.y + this.h / 2 + 16);
    }
    ctx.globalAlpha = 1;
  }
}

// Returns the first button containing any click this frame (or null).
export function clickedButton(buttons, input) {
  for (const c of input.clicks) {
    for (const b of buttons) {
      if (!b.disabled && b.contains(c.x, c.y)) return b;
    }
  }
  return null;
}

export function drawShape(ctx, shape, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (shape) {
    case 'square':
      ctx.rect(x - r, y - r, r * 2, r * 2);
      break;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.45;
        const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    default: // circle
      ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

export function drawStar(ctx, x, y, r, color) { drawShape(ctx, 'star', x, y, r, color); }
