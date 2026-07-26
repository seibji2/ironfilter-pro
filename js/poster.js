/**
 * IRONFILTER PRO — poster.js
 * Draws fitness poster overlays on the result canvas.
 */
export class PosterEngine {
  /**
   * Draw poster overlay onto canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number}  w
   * @param {number}  h
   * @param {object}  data  - { line1, line2, sub, accent, position, type, texts }
   * @param {number}  opacity - [0..1] background gradient opacity
   */
  draw(ctx, w, h, data, opacity = 0.7) {
    if (!data) return;

    const accent   = data.accent || '#f5c400';
    const position = data.position || 'bottom';
    const baseSize = Math.max(22, w * 0.09);

    // Background gradient
    if (opacity > 0) {
      const grad = this._makeGrad(ctx, w, h, position);
      ctx.fillStyle = grad;
      ctx.globalAlpha = opacity;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Accent bar
    ctx.fillStyle = accent;
    if (position === 'bottom')      ctx.fillRect(0, h - 4, w, 4);
    else if (position === 'top')    ctx.fillRect(0, 0, w, 4);
    else                            ctx.fillRect(0, h/2 - 2, w, 4);

    // Text block
    let y = this._startY(h, baseSize, position, data);
    const mx = w * 0.06;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (data.line1) {
      this._drawText(ctx, data.line1.toUpperCase(), mx, y, baseSize * 1.05, '#ffffff', '900 italic');
      y += baseSize * 1.1;
    }
    if (data.line2) {
      this._drawText(ctx, data.line2.toUpperCase(), mx, y, baseSize * 0.78, accent, '900 italic');
      y += baseSize * 0.92;
    }
    if (data.sub) {
      ctx.font      = `500 ${baseSize * 0.32}px 'Barlow Condensed', sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.shadowColor = 'transparent';
      ctx.fillText(data.sub.toUpperCase(), mx, y);
    }

    // Free texts (draggable in future)
    if (data.texts) {
      data.texts.forEach(t => {
        this._drawText(ctx, t.text, t.x * w, t.y * h, t.size || 60, t.color || '#fff', '700');
      });
    }

    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor  = 'transparent';
    ctx.shadowBlur   = 0;
  }

  _makeGrad(ctx, w, h, pos) {
    let g;
    if (pos === 'bottom') {
      g = ctx.createLinearGradient(0, h*0.4, 0, h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.92)');
    } else if (pos === 'top') {
      g = ctx.createLinearGradient(0, 0, 0, h*0.6);
      g.addColorStop(0, 'rgba(0,0,0,0.9)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      g = ctx.createLinearGradient(0, h*0.3, 0, h*0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    }
    return g;
  }

  _startY(h, baseSize, pos, data) {
    const textH = (data.line1?baseSize*1.1:0) + (data.line2?baseSize*0.92:0) + (data.sub?baseSize*0.5:0);
    if (pos === 'top')    return h * 0.06;
    if (pos === 'center') return h/2 - textH/2;
    return h * 0.58;
  }

  _drawText(ctx, text, x, y, size, color, weight) {
    ctx.font        = `${weight} ${size}px 'Barlow Condensed', sans-serif`;
    ctx.fillStyle   = color;
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur  = size * 0.15;
    ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillText(text, x, y);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }
}
