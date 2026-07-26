/**
 * IRONFILTER PRO — segment.js
 * AI-powered person segmentation using TensorFlow BodyPix.
 * Generates pixel-level masks: person, skin, face, torso, background.
 */

/* BodyPix part IDs reference:
   0:left_face, 1:right_face
   2:left_upper_arm_front, 3:left_upper_arm_back
   4:right_upper_arm_front, 5:right_upper_arm_back
   6:left_lower_arm_front, 7:left_lower_arm_back
   8:right_lower_arm_front, 9:right_lower_arm_back
   10:left_hand, 11:right_hand
   12:torso_front, 13:torso_back
   14:left_upper_leg_front, 15:left_upper_leg_back
   16:right_upper_leg_front, 17:right_upper_leg_back
   18:left_lower_leg_front, 19:left_lower_leg_back
   20:right_lower_leg_front, 21:right_lower_leg_back
   22:left_foot, 23:right_foot
*/

const FACE_IDS   = new Set([0, 1]);
const TORSO_IDS  = new Set([12, 13]);
const SKIN_IDS   = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
const PERSON_IDS = new Set([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]);

export class AISegment {
  constructor() {
    this._model      = null;
    this._loaded     = false;
    this._loading    = false;
  }

  /**
   * Load the BodyPix model.
   * @param {Function} onProgress - (pct: 0-1, msg: string) => void
   */
  async load(onProgress = () => {}) {
    if (this._loaded || this._loading) return;
    this._loading = true;

    onProgress(0.1, 'Descargando modelo BodyPix…');

    try {
      // Use MobileNetV1 for speed — good accuracy at 0.75 multiplier
      this._model = await bodyPix.load({
        architecture:      'MobileNetV1',
        outputStride:      16,
        multiplier:        0.75,
        quantBytes:        2,
      });
      this._loaded  = true;
      this._loading = false;
      onProgress(1, 'Modelo IA cargado');
    } catch (e) {
      console.warn('[AISegment] BodyPix load failed, running without AI:', e);
      this._loaded  = false;
      this._loading = false;
      onProgress(1, 'Modo sin IA (BodyPix no disponible)');
    }
  }

  /**
   * Run full segmentation on the image canvas.
   * Returns masks as Uint8Array (1 = selected pixel, 0 = not).
   *
   * @param {HTMLCanvasElement} canvas
   * @param {number}            width
   * @param {number}            height
   * @returns {Promise<{ person, skin, face, torso, bg }>}
   */
  async segment(canvas, width, height) {
    const size = width * height;
    const empty = () => new Uint8Array(size);

    if (!this._loaded || !this._model) {
      // Fallback: no AI available — return empty masks
      return { person: null, skin: null, face: null, torso: null, bg: null };
    }

    try {
      // Run BodyPix part segmentation
      // Internal resize for performance — max 800px on longest side
      const maxDim    = 800;
      const scale     = Math.min(1, maxDim / Math.max(width, height));
      const inputW    = Math.round(width  * scale);
      const inputH    = Math.round(height * scale);

      // Downscale canvas for inference
      const offCanvas = new OffscreenCanvas(inputW, inputH);
      const offCtx    = offCanvas.getContext('2d');
      offCtx.drawImage(canvas, 0, 0, inputW, inputH);

      // Convert to ImageData for BodyPix
      const imgData   = offCtx.getImageData(0, 0, inputW, inputH);

      // Run part segmentation
      const partSeg = await this._model.segmentPersonParts(
        await this._imageDataToHTMLImage(imgData, inputW, inputH),
        {
          internalResolution:   'medium',
          segmentationThreshold: 0.6,
          maxDetections:         5,
          scoreThreshold:        0.3,
          nmsRadius:             20,
        }
      );

      // partSeg.data is Int32Array, same size as inference input
      // -1 = background, 0-23 = body part IDs
      const partData  = partSeg.data;
      const infW      = partSeg.width;
      const infH      = partSeg.height;

      // Build full-res masks by upscaling inference result
      const person = empty();
      const skin   = empty();
      const face   = empty();
      const torso  = empty();
      const bg     = empty();

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Map full-res pixel to inference pixel
          const ix = Math.min(Math.round(x * infW / width),  infW - 1);
          const iy = Math.min(Math.round(y * infH / height), infH - 1);
          const partId = partData[iy * infW + ix];
          const i      = y * width + x;

          if (partId === -1) {
            bg[i] = 1;
          } else {
            person[i] = 1;
            if (SKIN_IDS.has(partId))   skin[i]  = 1;
            if (FACE_IDS.has(partId))   face[i]  = 1;
            if (TORSO_IDS.has(partId))  torso[i] = 1;
          }
        }
      }

      // Dilate masks slightly to avoid hard edges
      this._dilateMask(person, width, height, 2);
      this._erodeMask(bg,      width, height, 2);

      return { person, skin, face, torso, bg };

    } catch (e) {
      console.warn('[AISegment] Segmentation failed:', e);
      return { person: null, skin: null, face: null, torso: null, bg: null };
    }
  }

  /**
   * Convert ImageData to HTMLImageElement for BodyPix.
   * @param {ImageData} imgData
   * @param {number}    w
   * @param {number}    h
   * @returns {Promise<HTMLImageElement>}
   */
  async _imageDataToHTMLImage(imgData, w, h) {
    const tmp    = new OffscreenCanvas(w, h);
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.putImageData(imgData, 0, 0);
    const blob   = await tmp.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const url    = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img    = new Image(w, h);
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src     = url;
    });
  }

  /**
   * Morphological dilation on a binary mask.
   * Expands selected region by `radius` pixels.
   * @param {Uint8Array} mask
   * @param {number}     w
   * @param {number}     h
   * @param {number}     radius
   */
  _dilateMask(mask, w, h, radius) {
    const copy = new Uint8Array(mask);
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        if (copy[y * w + x] === 0) continue;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            mask[(y + dy) * w + (x + dx)] = 1;
          }
        }
      }
    }
  }

  /**
   * Morphological erosion on a binary mask.
   * Shrinks selected region by `radius` pixels.
   * @param {Uint8Array} mask
   * @param {number}     w
   * @param {number}     h
   * @param {number}     radius
   */
  _erodeMask(mask, w, h, radius) {
    const copy = new Uint8Array(mask);
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        if (copy[y * w + x] === 0) continue;
        let allSet = true;
        outer: for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (!copy[(y + dy) * w + (x + dx)]) { allSet = false; break outer; }
          }
        }
        if (!allSet) mask[y * w + x] = 0;
      }
    }
  }

  /**
   * Build a soft feathered edge mask from a hard binary mask.
   * Returns Float32Array [0..1] per pixel.
   * @param {Uint8Array} mask
   * @param {number}     w
   * @param {number}     h
   * @param {number}     feather - pixels of feathering
   * @returns {Float32Array}
   */
  featherMask(mask, w, h, feather = 8) {
    const soft = new Float32Array(mask.length);
    for (let i = 0; i < mask.length; i++) {
      soft[i] = mask[i] ? 1.0 : 0.0;
    }

    if (feather <= 0) return soft;

    // Simple box blur for feathering
    const tmp = new Float32Array(soft.length);
    const r   = feather;

    // Horizontal
    for (let y = 0; y < h; y++) {
      let sum = 0, count = 0;
      for (let x = 0; x < Math.min(r, w); x++) { sum += soft[y * w + x]; count++; }
      for (let x = 0; x < w; x++) {
        if (x + r < w)  { sum += soft[y * w + x + r]; count++; }
        if (x - r > 0)  { sum -= soft[y * w + x - r - 1]; count--; }
        tmp[y * w + x] = sum / count;
      }
    }

    // Vertical
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let y = 0; y < Math.min(r, h); y++) { sum += tmp[y * w + x]; count++; }
      for (let y = 0; y < h; y++) {
        if (y + r < h)  { sum += tmp[(y + r) * w + x]; count++; }
        if (y - r > 0)  { sum -= tmp[(y - r - 1) * w + x]; count--; }
        soft[y * w + x] = sum / count;
      }
    }

    return soft;
  }

  /** @returns {boolean} Whether AI model is loaded */
  get isLoaded() { return this._loaded; }
}
