/**
 * IRONFILTER PRO — processor.js
 * Core pixel processing engine.
 *
 * Key capabilities:
 * - Person-specific retouching (skin, muscle, face) using segmentation masks
 * - Selective adjustments: apply any effect only to masked zone
 * - Muscle definition: local contrast, shadow deepening, highlight boosting
 * - Skin smoothing: frequency separation simulation
 * - Background: blur, darken, desaturate independently
 * - Split toning, vignette, grain
 */

import { clamp } from './utils.js';

export class Processor {

  /* ════════════════════════════════════════
     PERSON RETOUCHING (mask-based)
  ════════════════════════════════════════ */

  /**
   * Apply all person-specific retouching operations.
   * Each operation uses the appropriate segmentation mask.
   *
   * @param {ImageData} input
   * @param {object}    adj   - adjustment values
   * @param {object}    masks - { person, skin, face, torso, bg }
   * @returns {ImageData}
   */
  applyPersonRetouching(input, adj, masks) {
    const w   = input.width;
    const h   = input.height;
    const src = input.data;
    const out = new Uint8ClampedArray(src);

    // ── 1. BACKGROUND EFFECTS ──
    if (adj.bgDark > 0 || adj.bgDesat > 0) {
      const bgStrength = adj.bgDark  / 100;
      const bgDesatStr = adj.bgDesat / 100;

      for (let i = 0; i < out.length; i += 4) {
        const px = i >> 2;
        if (!masks.bg || !masks.bg[px]) continue;

        let r = out[i], g = out[i+1], b = out[i+2];

        // Darken background
        if (bgStrength > 0) {
          r = clamp(r * (1 - bgStrength * 0.7));
          g = clamp(g * (1 - bgStrength * 0.7));
          b = clamp(b * (1 - bgStrength * 0.7));
        }

        // Desaturate background
        if (bgDesatStr > 0) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = clamp(r + (gray - r) * bgDesatStr);
          g = clamp(g + (gray - g) * bgDesatStr);
          b = clamp(b + (gray - b) * bgDesatStr);
        }

        out[i] = r; out[i+1] = g; out[i+2] = b;
      }
    }

    // ── 2. BACKGROUND BLUR (Gaussian approximation) ──
    if (adj.bgBlur > 0 && masks.bg) {
      this._applyMaskedBlur(out, src, w, h, masks.bg, adj.bgBlur / 10);
    }

    // ── 3. SKIN ADJUSTMENTS ──
    const hasSkinAdj = adj.skinBright !== 0 || adj.skinWarm !== 0 ||
                       adj.skinSat !== 0 || adj.skinSmooth > 0;
    if (hasSkinAdj && masks.person) {
      const mask = masks.skin || masks.person;

      // Skin smoothing (blur skin, preserve edges)
      if (adj.skinSmooth > 0 && mask) {
        const smoothed = new Uint8ClampedArray(out);
        this._applyMaskedBlur(smoothed, out, w, h, mask, adj.skinSmooth / 25);
        // Blend: smooth in midtones (avoid smoothing brightest/darkest skin highlights)
        for (let i = 0; i < out.length; i += 4) {
          const px = i >> 2;
          if (!mask[px]) continue;
          const lum    = (out[i] + out[i+1] + out[i+2]) / 3 / 255;
          const blend  = Math.sin(lum * Math.PI) * (adj.skinSmooth / 100);
          out[i]   = clamp(out[i]   + (smoothed[i]   - out[i])   * blend);
          out[i+1] = clamp(out[i+1] + (smoothed[i+1] - out[i+1]) * blend);
          out[i+2] = clamp(out[i+2] + (smoothed[i+2] - out[i+2]) * blend);
        }
      }

      // Skin brightness, warmth, saturation
      for (let i = 0; i < out.length; i += 4) {
        const px = i >> 2;
        if (!mask[px]) continue;

        let r = out[i], g = out[i+1], b = out[i+2];

        // Brightness
        if (adj.skinBright !== 0) {
          const db = adj.skinBright / 100 * 60;
          r = clamp(r + db); g = clamp(g + db); b = clamp(b + db);
        }

        // Warmth (shift towards red/yellow)
        if (adj.skinWarm !== 0) {
          const dw = adj.skinWarm / 100;
          r = clamp(r + dw * 25);
          g = clamp(g + dw * 8);
          b = clamp(b - dw * 20);
        }

        // Saturation
        if (adj.skinSat !== 0) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const s    = adj.skinSat / 100;
          r = clamp(gray + (r - gray) * (1 + s));
          g = clamp(gray + (g - gray) * (1 + s));
          b = clamp(gray + (b - gray) * (1 + s));
        }

        out[i] = r; out[i+1] = g; out[i+2] = b;
      }
    }

    // ── 4. MUSCLE DEFINITION ──
    const hasMuscle = adj.muscleCon > 0 || adj.muscleShadow > 0 ||
                      adj.muscleShine > 0 || adj.skinTexture > 0;

    if (hasMuscle && masks.person) {
      const mask = masks.torso || masks.person;

      for (let i = 0; i < out.length; i += 4) {
        const px = i >> 2;
        if (!mask[px]) continue;

        let r = out[i], g = out[i+1], b = out[i+2];
        const lum = (r + g + b) / 3 / 255; // 0..1

        // Muscle contrast: deepen shadows, brighten highlights
        if (adj.muscleCon > 0) {
          const strength = adj.muscleCon / 100;
          // S-curve on luminance
          r = clamp((r - 128) * (1 + strength * 0.8) + 128);
          g = clamp((g - 128) * (1 + strength * 0.8) + 128);
          b = clamp((b - 128) * (1 + strength * 0.8) + 128);
        }

        // Shadow deepening (only dark areas of person)
        if (adj.muscleShadow > 0) {
          const t = Math.max(0, 1 - lum * 2.5); // weights dark pixels
          const drop = adj.muscleShadow / 100 * t * 70;
          r = clamp(r - drop);
          g = clamp(g - drop * 0.9);
          b = clamp(b - drop * 0.8);
        }

        // Highlight shine (only bright areas)
        if (adj.muscleShine > 0) {
          const t = Math.max(0, lum * 2 - 1); // weights bright pixels
          const boost = adj.muscleShine / 100 * t * 55;
          r = clamp(r + boost);
          g = clamp(g + boost * 0.95);
          b = clamp(b + boost * 0.85);
        }

        // Skin texture (high-pass layer simulation)
        if (adj.skinTexture > 0) {
          const orig  = src[i];
          const sharp = clamp(r + (r - orig) * (adj.skinTexture / 100 * 1.5));
          r = clamp(r + (sharp - r) * 0.6);
        }

        out[i] = r; out[i+1] = g; out[i+2] = b;
      }
    }

    return new ImageData(out, w, h);
  }

  /* ════════════════════════════════════════
     GLOBAL ADJUSTMENTS (zone-masked)
  ════════════════════════════════════════ */

  /**
   * Apply all global adjustments to the image.
   * If mask is provided, only applies to masked pixels.
   *
   * @param {ImageData}   input
   * @param {object}      adj
   * @param {Uint8Array|null} mask
   * @returns {ImageData}
   */
  applyAdjustments(input, adj, mask) {
    const w   = input.width;
    const h   = input.height;
    const src = input.data;
    const out = new Uint8ClampedArray(src);
    const len = src.length;

    // Precompute look-up tables for speed
    const expFactor   = Math.pow(2, (adj.exposure   || 0) / 100 * 3);
    const bri         = (adj.brightness || 0) / 100 * 80;
    const con         = (adj.contrast   || 0) / 100;
    const sha         = (adj.shadows    || 0) / 100;
    const hil         = (adj.highlights || 0) / 100;
    const whi         = (adj.whites     || 0) / 100;
    const bla         = (adj.blacks     || 0) / 100;
    const tmp         = (adj.temp       || 0) / 100;
    const tin         = (adj.tint       || 0) / 100;
    const sat         = (adj.sat        || 0) / 100;
    const vib         = (adj.vibrance   || 0) / 100;
    const hue         = (adj.hue        || 0);
    const sharp       = (adj.sharp      || 0) / 100;
    const clarity     = (adj.clarity    || 0) / 100;
    const soften      = (adj.soften     || 0) / 100;

    // Hue rotation matrix
    let cosH = 1, sinH = 0;
    if (hue !== 0) {
      const rad = hue * Math.PI / 180;
      cosH = Math.cos(rad);
      sinH = Math.sin(rad);
    }

    // Split toning colors
    const shadowColor = this._hexToRgb(adj.splitShadowColor || '#000000');
    const highColor   = this._hexToRgb(adj.splitHighColor   || '#ffffff');
    const splitSha    = (adj.splitShadow || 0) / 100;
    const splitHi     = (adj.splitHigh   || 0) / 100;

    const hasLight  = adj.exposure || adj.brightness || adj.contrast || adj.shadows || adj.highlights || adj.whites || adj.blacks;
    const hasColor  = adj.temp || adj.tint || adj.sat || adj.vibrance || adj.hue;
    const hasSplit  = adj.splitShadow || adj.splitHigh;

    for (let i = 0; i < len; i += 4) {
      const px = i >> 2;

      // Skip non-masked pixels when a zone mask is active
      if (mask && !mask[px]) continue;

      let r = out[i], g = out[i+1], b = out[i+2];

      // ── LIGHT ──
      if (hasLight) {
        // Exposure
        r *= expFactor; g *= expFactor; b *= expFactor;

        // Brightness
        r += bri; g += bri; b += bri;

        // Contrast
        if (con !== 0) {
          r = (r - 128) * (1 + con) + 128;
          g = (g - 128) * (1 + con) + 128;
          b = (b - 128) * (1 + con) + 128;
        }

        const lum = clamp(r * 0.299 + g * 0.587 + b * 0.114) / 255;

        // Shadows
        if (sha !== 0) {
          const t = Math.max(0, 0.5 - lum) / 0.5;
          r += sha * 80 * t; g += sha * 80 * t; b += sha * 80 * t;
        }
        // Highlights
        if (hil !== 0) {
          const t = Math.max(0, lum - 0.5) / 0.5;
          r += hil * 80 * t; g += hil * 80 * t; b += hil * 80 * t;
        }
        // Whites
        if (whi !== 0) {
          const t = Math.pow(lum, 2);
          r += whi * 80 * t; g += whi * 80 * t; b += whi * 80 * t;
        }
        // Blacks
        if (bla !== 0) {
          const t = Math.pow(1 - lum, 2);
          r += bla * 80 * t; g += bla * 80 * t; b += bla * 80 * t;
        }
      }

      // ── COLOR ──
      if (hasColor) {
        // Temperature
        if (tmp !== 0) {
          r = clamp(r + tmp * 40);
          b = clamp(b - tmp * 40);
          g = clamp(g + tmp * 8);
        }

        // Tint (magenta/green)
        if (tin !== 0) {
          r = clamp(r + tin * 18);
          b = clamp(b + tin * 18);
          g = clamp(g - tin * 18);
        }

        // Saturation
        if (sat !== 0) {
          const gray = 0.299 * clamp(r) + 0.587 * clamp(g) + 0.114 * clamp(b);
          r = gray + (clamp(r) - gray) * (1 + sat);
          g = gray + (clamp(g) - gray) * (1 + sat);
          b = gray + (clamp(b) - gray) * (1 + sat);
        }

        // Vibrance (protects already-saturated colors)
        if (vib !== 0) {
          const cr = clamp(r), cg = clamp(g), cb = clamp(b);
          const mx  = Math.max(cr, cg, cb);
          const mn  = Math.min(cr, cg, cb);
          const curSat = mx === 0 ? 0 : (mx - mn) / mx;
          const boost  = vib * (1 - curSat) * 0.5;
          const gray   = 0.299 * cr + 0.587 * cg + 0.114 * cb;
          r = gray + (cr - gray) * (1 + boost);
          g = gray + (cg - gray) * (1 + boost);
          b = gray + (cb - gray) * (1 + boost);
        }

        // Hue rotation
        if (hue !== 0) {
          const cr = clamp(r), cg = clamp(g), cb = clamp(b);
          r = clamp(cr*(0.213+cosH*0.787-sinH*0.213) + cg*(0.715-cosH*0.715-sinH*0.715) + cb*(0.072-cosH*0.072+sinH*0.928));
          g = clamp(cr*(0.213-cosH*0.213+sinH*0.143) + cg*(0.715+cosH*0.285+sinH*0.140) + cb*(0.072-cosH*0.072-sinH*0.283));
          b = clamp(cr*(0.213-cosH*0.213-sinH*0.787) + cg*(0.715-cosH*0.715+sinH*0.715) + cb*(0.072+cosH*0.928+sinH*0.072));
        }
      }

      // ── SPLIT TONING ──
      if (hasSplit) {
        const cr  = clamp(r), cg = clamp(g), cb = clamp(b);
        const lum = (cr * 0.299 + cg * 0.587 + cb * 0.114) / 255;
        // Shadow toning
        if (splitSha > 0) {
          const t = Math.max(0, 1 - lum * 2) * splitSha * 0.3;
          r = clamp(cr + (shadowColor.r - cr) * t);
          g = clamp(cg + (shadowColor.g - cg) * t);
          b = clamp(cb + (shadowColor.b - cb) * t);
        }
        // Highlight toning
        if (splitHi > 0) {
          const t = Math.max(0, lum * 2 - 1) * splitHi * 0.3;
          r = clamp(clamp(r) + (highColor.r - clamp(r)) * t);
          g = clamp(clamp(g) + (highColor.g - clamp(g)) * t);
          b = clamp(clamp(b) + (highColor.b - clamp(b)) * t);
        }
      }

      out[i]   = clamp(r);
      out[i+1] = clamp(g);
      out[i+2] = clamp(b);
    }

    let result = new ImageData(out, w, h);

    // ── CLARITY (large-radius unsharp mask) ──
    if (adj.clarity !== 0) {
      result = this._applyClarity(result, adj.clarity / 100, mask);
    }

    // ── SHARPEN / SOFTEN ──
    if (adj.sharp > 0 || adj.soften > 0) {
      result = this._applySharpenSoften(result, adj.sharp / 100, adj.soften / 100, mask);
    }

    // ── GRAIN ──
    if ((adj.grain || 0) > 0) {
      result = this._applyGrain(result, adj.grain, adj.grainSize || 2, mask);
    }

    return result;
  }

  /* ════════════════════════════════════════
     BRUSH LAYER
  ════════════════════════════════════════ */

  /**
   * Composite brush strokes canvas on top of result.
   * @param {ImageData}          input
   * @param {HTMLCanvasElement}  brushCanvas
   * @param {number}             w
   * @param {number}             h
   * @returns {ImageData}
   */
  applyBrushLayer(input, brushCanvas, w, h) {
    const ctx     = brushCanvas.getContext('2d', { willReadFrequently: true });
    const brushData = ctx.getImageData(0, 0, w, h).data;
    const out       = new Uint8ClampedArray(input.data);

    for (let i = 0; i < out.length; i += 4) {
      const ba = brushData[i + 3] / 255; // brush alpha
      if (ba <= 0) continue;

      const br = brushData[i];
      const bg = brushData[i + 1];
      const bb = brushData[i + 2];

      // Soft-light blend for dodge/burn
      out[i]   = clamp(this._softLight(out[i],   br, ba));
      out[i+1] = clamp(this._softLight(out[i+1], bg, ba));
      out[i+2] = clamp(this._softLight(out[i+2], bb, ba));
    }

    return new ImageData(out, w, h);
  }

  /* ════════════════════════════════════════
     VIGNETTE
  ════════════════════════════════════════ */

  /**
   * Draw a vignette effect on a canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number}  w
   * @param {number}  h
   * @param {number}  amount   - [-100..100]
   * @param {number}  size     - [10..100]
   */
  drawVignette(ctx, w, h, amount, size = 50) {
    const strength = Math.abs(amount) / 100;
    const color    = amount > 0 ? `rgba(0,0,0,${0.95 * strength})` : `rgba(255,255,255,${0.85 * strength})`;
    const innerR   = Math.min(w, h) * (size / 100) * 0.2;
    const outerR   = Math.max(w, h) * 0.82;

    const grad = ctx.createRadialGradient(w/2, h/2, innerR, w/2, h/2, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, color);

    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /* ════════════════════════════════════════
     PRIVATE: PIXEL OPERATIONS
  ════════════════════════════════════════ */

  /**
   * Apply masked box blur.
   * Only blurs pixels where mask[px] === 1.
   * Non-masked pixels are kept from 'original'.
   */
  _applyMaskedBlur(out, original, w, h, mask, radius) {
    const r = Math.max(1, Math.round(radius));
    const tmp = new Float32Array(out.length);

    // Horizontal pass — only on masked pixels
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = y * w + x;
        if (!mask[px]) { tmp[px*4]=out[px*4]; tmp[px*4+1]=out[px*4+1]; tmp[px*4+2]=out[px*4+2]; tmp[px*4+3]=out[px*4+3]; continue; }
        let sr=0,sg=0,sb=0,cnt=0;
        for (let dx=-r; dx<=r; dx++) {
          const nx = Math.max(0, Math.min(w-1, x+dx));
          const ni = (y*w+nx)*4;
          sr+=out[ni]; sg+=out[ni+1]; sb+=out[ni+2]; cnt++;
        }
        tmp[px*4]=sr/cnt; tmp[px*4+1]=sg/cnt; tmp[px*4+2]=sb/cnt; tmp[px*4+3]=out[px*4+3];
      }
    }

    // Vertical pass
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const px = y*w+x;
        if (!mask[px]) continue;
        let sr=0,sg=0,sb=0,cnt=0;
        for (let dy=-r; dy<=r; dy++) {
          const ny = Math.max(0, Math.min(h-1, y+dy));
          const ni = (ny*w+x)*4;
          sr+=tmp[ni]; sg+=tmp[ni+1]; sb+=tmp[ni+2]; cnt++;
        }
        out[px*4]=clamp(sr/cnt); out[px*4+1]=clamp(sg/cnt); out[px*4+2]=clamp(sb/cnt);
      }
    }
  }

  /**
   * Clarity: large-radius unsharp mask for mid-tone contrast.
   */
  _applyClarity(imageData, amount, mask) {
    const w   = imageData.width;
    const h   = imageData.height;
    const src = imageData.data;
    const blurred = this._boxBlurFull(src, w, h, 8);
    const out = new Uint8ClampedArray(src);

    const str = Math.abs(amount);
    const sign = amount > 0 ? 1 : -1;

    for (let i = 0; i < src.length; i += 4) {
      const px = i >> 2;
      if (mask && !mask[px]) continue;
      for (let ch = 0; ch < 3; ch++) {
        const diff = src[i+ch] - blurred[i+ch];
        out[i+ch]  = clamp(src[i+ch] + sign * diff * str * 1.5);
      }
    }
    return new ImageData(out, w, h);
  }

  /**
   * Sharpen (unsharp mask) or soften (blur) with optional mask.
   */
  _applySharpenSoften(imageData, sharp, soften, mask) {
    const w   = imageData.width;
    const h   = imageData.height;
    const src = imageData.data;
    const out = new Uint8ClampedArray(src);

    if (sharp > 0) {
      const blurred = this._boxBlurFull(src, w, h, 1);
      for (let i = 0; i < src.length; i += 4) {
        const px = i >> 2;
        if (mask && !mask[px]) continue;
        for (let ch = 0; ch < 3; ch++) {
          out[i+ch] = clamp(src[i+ch] + (src[i+ch] - blurred[i+ch]) * sharp * 2.5);
        }
      }
    }

    if (soften > 0) {
      const blurred = this._boxBlurFull(src, w, h, Math.round(soften * 5));
      for (let i = 0; i < src.length; i += 4) {
        const px = i >> 2;
        if (mask && !mask[px]) continue;
        for (let ch = 0; ch < 3; ch++) {
          out[i+ch] = clamp(out[i+ch] + (blurred[i+ch] - out[i+ch]) * soften);
        }
      }
    }

    return new ImageData(out, w, h);
  }

  /**
   * Film grain.
   */
  _applyGrain(imageData, amount, grainSize, mask) {
    const strength = (amount / 100) * 45;
    const data = new Uint8ClampedArray(imageData.data);

    for (let i = 0; i < data.length; i += 4) {
      const px  = i >> 2;
      if (mask && !mask[px]) continue;
      const lum = (data[i] + data[i+1] + data[i+2]) / 3 / 255;
      const midWeight = 4 * lum * (1 - lum);
      const noise = (Math.random() - 0.5) * strength * midWeight;
      data[i]   = clamp(data[i]   + noise);
      data[i+1] = clamp(data[i+1] + noise);
      data[i+2] = clamp(data[i+2] + noise);
    }
    return new ImageData(data, imageData.width, imageData.height);
  }

  /**
   * Fast box blur on full pixel array.
   * Returns blurred Uint8ClampedArray.
   */
  _boxBlurFull(src, w, h, radius) {
    const r   = Math.max(1, radius);
    const tmp = new Float32Array(src.length);
    const out = new Uint8ClampedArray(src.length);

    // H pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sr=0,sg=0,sb=0,cnt=0;
        for (let dx=-r;dx<=r;dx++){
          const nx=Math.max(0,Math.min(w-1,x+dx));
          const ni=(y*w+nx)*4;
          sr+=src[ni];sg+=src[ni+1];sb+=src[ni+2];cnt++;
        }
        const i=(y*w+x)*4;
        tmp[i]=sr/cnt;tmp[i+1]=sg/cnt;tmp[i+2]=sb/cnt;tmp[i+3]=src[i+3];
      }
    }
    // V pass
    for (let x=0;x<w;x++){
      for (let y=0;y<h;y++){
        let sr=0,sg=0,sb=0,cnt=0;
        for (let dy=-r;dy<=r;dy++){
          const ny=Math.max(0,Math.min(h-1,y+dy));
          const ni=(ny*w+x)*4;
          sr+=tmp[ni];sg+=tmp[ni+1];sb+=tmp[ni+2];cnt++;
        }
        const i=(y*w+x)*4;
        out[i]=clamp(sr/cnt);out[i+1]=clamp(sg/cnt);out[i+2]=clamp(sb/cnt);out[i+3]=src[i+3];
      }
    }
    return out;
  }

  /**
   * Soft-light blend formula.
   */
  _softLight(base, blend, alpha) {
    const b = base / 255, bl = blend / 255;
    let result;
    if (bl <= 0.5) {
      result = b - (1 - 2*bl) * b * (1 - b);
    } else {
      const d = b <= 0.25 ? ((16*b - 12)*b + 4)*b : Math.sqrt(b);
      result = b + (2*bl - 1) * (d - b);
    }
    return clamp(base + (result * 255 - base) * alpha);
  }

  /**
   * Parse hex color to {r,g,b}.
   */
  _hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
      r: parseInt(clean.slice(0,2), 16),
      g: parseInt(clean.slice(2,4), 16),
      b: parseInt(clean.slice(4,6), 16),
    };
  }
}
