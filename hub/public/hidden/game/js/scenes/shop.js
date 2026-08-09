// Shop: buy skins with coins and equip them. Equipped skin re-themes the
// avatar + HUD accent everywhere.

import { W, H } from '../engine/utils.js';
import { SKINS } from '../data/skins.js';
import { Button, clickedButton, roundRect, drawShape } from '../ui/widgets.js';

export class ShopScene {
  constructor(game) { this.game = game; }

  enter() {
    this.msg = '';
    this.msgT = 0;
    const rowW = 560, rowH = 64, x = (W - rowW) / 2;
    this.rows = SKINS.map((skin, i) => ({
      skin, x, y: 110 + i * (rowH + 14), w: rowW, h: rowH,
    }));
    this.back = new Button(20, H - 64, 140, 46, '← Back', { kind: 'ghost', data: 'back' });
  }

  update(dt) {
    if (this.msgT > 0) this.msgT -= dt;
    if (clickedButton([this.back], this.game.input)) {
      this.game.audio.play('click');
      this.game.setScene('menu');
      return;
    }
    const store = this.game.storage;
    for (const c of this.game.input.clicks) {
      for (const row of this.rows) {
        if (c.x >= row.x && c.x <= row.x + row.w && c.y >= row.y && c.y <= row.y + row.h) {
          const { id, price } = row.skin;
          if (store.ownsSkin(id)) {
            store.equipSkin(id);
            this.flash('Equipped ' + row.skin.name);
            this.game.audio.play('click');
          } else if (store.buySkin(id, price)) {
            store.equipSkin(id);
            this.flash('Bought + equipped ' + row.skin.name);
            this.game.audio.play('coin');
          } else {
            this.flash('Not enough coins');
            this.game.audio.play('bust');
          }
          return;
        }
      }
    }
  }

  flash(t) { this.msg = t; this.msgT = 1.6; }

  render(ctx) {
    const store = this.game.storage;
    const accent = this.game.accent();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('SKIN SHOP', W / 2, 56);
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('◉ ' + store.data.coins + ' coins', W / 2, 86);

    for (const row of this.rows) {
      const owned = store.ownsSkin(row.skin.id);
      const equipped = store.data.skins.equipped === row.skin.id;
      const hover = row.x <= this.game.input.pointer.x && this.game.input.pointer.x <= row.x + row.w &&
                    row.y <= this.game.input.pointer.y && this.game.input.pointer.y <= row.y + row.h;
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
      roundRect(ctx, row.x, row.y, row.w, row.h, 12); ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = equipped ? '#39ff88' : 'rgba(255,255,255,0.15)';
      roundRect(ctx, row.x, row.y, row.w, row.h, 12); ctx.stroke();

      drawShape(ctx, row.skin.shape, row.x + 42, row.y + row.h / 2, 18, row.skin.accent);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText(row.skin.name, row.x + 80, row.y + row.h / 2);

      ctx.textAlign = 'right';
      if (equipped) { ctx.fillStyle = '#39ff88'; ctx.fillText('EQUIPPED', row.x + row.w - 20, row.y + row.h / 2); }
      else if (owned) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('tap to equip', row.x + row.w - 20, row.y + row.h / 2); }
      else { ctx.fillStyle = '#ffd23f'; ctx.fillText('◉ ' + row.skin.price, row.x + row.w - 20, row.y + row.h / 2); }
    }

    if (this.msgT > 0) {
      ctx.globalAlpha = Math.min(1, this.msgT);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText(this.msg, W / 2, H - 90);
      ctx.globalAlpha = 1;
    }

    this.back.draw(ctx, accent, this.game.input.pointer);
  }
}
