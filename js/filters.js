/**
 * IRONFILTER PRO — filters.js
 * 40+ professional filters. All support selective zone masks.
 * Organized by category: fitness, studio, cinema, bw.
 */

import { clamp } from './utils.js';

/* ── Tiny LUT builder ── */
function lut(fn) {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = clamp(Math.round(fn(i)));
  return t;
}

/* ── Apply LUT to all 3 channels ── */
function applyLUT3(data, r, g, b, mask) {
  for (let i = 0; i < data.length; i += 4) {
    if (mask && !mask[i >> 2]) continue;
    data[i]   = r[data[i]];
    data[i+1] = g[data[i+1]];
    data[i+2] = b[data[i+2]];
  }
}

/* ── Base pixel processor ── */
function processPixels(imageData, fn, mask) {
  const d   = new Uint8ClampedArray(imageData.data);
  const len = d.length;
  for (let i = 0; i < len; i += 4) {
    if (mask && !mask[i >> 2]) continue;
    const r = d[i], g = d[i+1], b = d[i+2];
    const [nr, ng, nb] = fn(r, g, b);
    d[i] = clamp(nr); d[i+1] = clamp(ng); d[i+2] = clamp(nb);
  }
  return new ImageData(d, imageData.width, imageData.height);
}

/* ── LUT-based fast filter ── */
function lutFilter(imageData, opts, mask) {
  const {
    brightness = 0, contrast = 0, saturation = 0,
    tintR = 0, tintG = 0, tintB = 0,
    tintColor = null, tintAmt = 0,
    shadowR = 1, shadowG = 1, shadowB = 1,
    highlightR = 1, highlightG = 1, highlightB = 1,
    gammaR = 1, gammaG = 1, gammaB = 1,
    sepia = 0, bw = false,
  } = opts;

  const b  = brightness / 100;
  const c  = contrast   / 100;
  const s  = saturation / 100;

  const buildCh = (tint, shad, high, gam) => lut(i => {
    let v = Math.pow(i / 255, 1 / gam) * 255;
    v += b * 255;
    v = (v - 128) * (1 + c) + 128;
    v += tint;
    const lum = i / 255;
    v = lum < 0.5 ? v * shad : 255 - (255 - v) * (2 - high);
    return v;
  });

  const rT = buildCh(tintR, shadowR, highlightR, gammaR);
  const gT = buildCh(tintG, shadowG, highlightG, gammaG);
  const bT = buildCh(tintB, shadowB, highlightB, gammaB);

  return processPixels(imageData, (r, g, bl) => {
    let nr = rT[r], ng = gT[g], nb = bT[bl];

    if (s !== 0) {
      const gray = 0.299*nr + 0.587*ng + 0.114*nb;
      nr = gray + (nr - gray) * (1+s);
      ng = gray + (ng - gray) * (1+s);
      nb = gray + (nb - gray) * (1+s);
    }

    if (bw) {
      const bwv = 0.299*clamp(nr)+0.587*clamp(ng)+0.114*clamp(nb);
      nr = ng = nb = bwv;
    }

    if (sepia > 0) {
      const sr = clamp(nr*0.393+ng*0.769+nb*0.189);
      const sg = clamp(nr*0.349+ng*0.686+nb*0.168);
      const sb = clamp(nr*0.272+ng*0.534+nb*0.131);
      nr = nr*(1-sepia)+sr*sepia;
      ng = ng*(1-sepia)+sg*sepia;
      nb = nb*(1-sepia)+sb*sepia;
    }

    if (tintColor && tintAmt > 0) {
      nr = clamp(nr)*(1-tintAmt) + tintColor[0]*tintAmt;
      ng = clamp(ng)*(1-tintAmt) + tintColor[1]*tintAmt;
      nb = clamp(nb)*(1-tintAmt) + tintColor[2]*tintAmt;
    }

    return [nr, ng, nb];
  }, mask);
}

/* ══════════════════════════════════════════
   FILTER CATALOGUE
══════════════════════════════════════════ */

const CATALOGUE = [
  /* ─── ALL ─── */
  { id:'original',   name:'Original',     cat:'all',     apply:(d,i,m)=>d },

  /* ─── FITNESS ─── */
  { id:'iron',       name:'Iron',         cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:8,contrast:45,saturation:-20,tintR:12,tintG:4,tintColor:[255,190,140],tintAmt:0.07,shadowG:0.92,shadowB:0.88,highlightR:1.06},m) },
  { id:'beast',      name:'Beast Mode',   cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:-8,contrast:65,saturation:15,tintR:18,tintG:4,tintB:-8,tintColor:[255,90,0],tintAmt:0.09,shadowR:0.85,shadowG:0.80,shadowB:0.75,highlightR:1.1},m) },
  { id:'champion',   name:'Champion',     cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:15,contrast:38,saturation:10,tintColor:[245,196,0],tintAmt:0.16,tintR:8,tintG:4,highlightR:1.08},m) },
  { id:'sweat',      name:'Sweat',        cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:20,contrast:28,saturation:-12,tintColor:[255,215,100],tintAmt:0.14,highlightR:1.04,highlightG:1.02},m) },
  { id:'powerlifting',name:'Powerlifting',cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:-12,contrast:70,saturation:-35,tintColor:[50,30,10],tintAmt:0.08,shadowR:0.80,shadowG:0.78,shadowB:0.72,gammaR:0.9,gammaG:0.92,gammaB:0.95},m) },
  { id:'crossfit',   name:'CrossFit',     cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:5,contrast:55,saturation:25,tintColor:[0,220,200],tintAmt:0.08,tintR:-5,tintB:8},m) },
  { id:'bodybuilding',name:'Bodybuilding',cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:12,contrast:50,saturation:-15,tintColor:[255,180,100],tintAmt:0.1,highlightR:1.1,highlightG:1.05,shadowB:0.85},m) },
  { id:'golden',     name:'Golden Hour',  cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:18,contrast:25,saturation:15,tintColor:[255,200,80],tintAmt:0.18,tintR:15,tintG:8,tintB:-10,highlightR:1.06},m) },
  { id:'gymraw',     name:'Gym Raw',      cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:-5,contrast:60,saturation:-50,tintColor:[80,70,60],tintAmt:0.1,shadowR:0.88,shadowG:0.86,shadowB:0.80},m) },
  { id:'shred',      name:'Shred',        cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:-10,contrast:75,saturation:-25,tintColor:[30,20,10],tintAmt:0.06,shadowR:0.70,shadowG:0.68,shadowB:0.65,highlightR:1.15},m) },
  { id:'bulk',       name:'Bulk Season',  cat:'fitness', apply:(d,i,m)=>lutFilter(d,{brightness:10,contrast:30,saturation:20,tintColor:[255,160,80],tintAmt:0.12,highlightR:1.06},m) },

  /* ─── STUDIO ─── */
  { id:'studio-clean',name:'Studio Clean',cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:15,contrast:20,saturation:-8,tintColor:[240,240,255],tintAmt:0.06,highlightR:1.04,highlightG:1.04,highlightB:1.06},m) },
  { id:'studio-dark', name:'Studio Dark', cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:-15,contrast:55,saturation:-20,tintColor:[20,20,30],tintAmt:0.08,shadowR:0.75,shadowG:0.75,shadowB:0.80},m) },
  { id:'magazine',   name:'Magazine',     cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:20,contrast:25,saturation:-15,tintColor:[255,245,235],tintAmt:0.1,highlightR:1.05,highlightG:1.04,highlightB:1.02},m) },
  { id:'editorial',  name:'Editorial',    cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:8,contrast:35,saturation:-30,tintColor:[220,215,210],tintAmt:0.08,highlightR:1.06},m) },
  { id:'highkey',    name:'High Key',     cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:35,contrast:10,saturation:-20,highlightR:1.08,highlightG:1.08,highlightB:1.1},m) },
  { id:'lowkey',     name:'Low Key',      cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:-20,contrast:60,saturation:-30,shadowR:0.65,shadowG:0.65,shadowB:0.65,highlightR:1.1},m) },
  { id:'skin-glow',  name:'Skin Glow',    cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:18,contrast:15,saturation:8,tintColor:[255,220,180],tintAmt:0.12,highlightR:1.06,highlightG:1.04},m) },
  { id:'dramatic',   name:'Dramatic',     cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:-5,contrast:70,saturation:-10,shadowR:0.72,shadowG:0.72,shadowB:0.72,highlightR:1.12},m) },
  { id:'warm-studio',name:'Warm Studio',  cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:12,contrast:22,saturation:8,tintColor:[255,210,160],tintAmt:0.1,tintR:12,tintB:-8},m) },
  { id:'cool-studio',name:'Cool Studio',  cat:'studio', apply:(d,i,m)=>lutFilter(d,{brightness:8,contrast:20,saturation:-5,tintColor:[180,200,255],tintAmt:0.1,tintR:-10,tintB:15},m) },
  { id:'teal-orange',name:'Teal & Orange',cat:'studio', apply:(d,i,m)=>processPixels(d,(r,g,b)=>{
    const lum=(r+g+b)/3/255;
    const warm=Math.max(0,lum-0.5)*2;
    const cool=Math.max(0,0.4-lum)*2;
    let nr=clamp(r+warm*30-cool*15);
    let ng=clamp(g+warm*10-cool*5);
    let nb=clamp(b-warm*20+cool*20);
    nr=clamp((nr-128)*1.35+128);ng=clamp((ng-128)*1.30+128);nb=clamp((nb-128)*1.30+128);
    return[nr,ng,nb];
  },m) },

  /* ─── CINEMA ─── */
  { id:'cinema',     name:'Cinema',       cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:-5,contrast:42,saturation:-22,tintColor:[60,50,80],tintAmt:0.1,shadowB:1.15,shadowG:0.95,highlightR:1.05,highlightG:0.98,gammaR:0.95},m) },
  { id:'moody',      name:'Moody',        cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:-12,contrast:38,saturation:-28,tintColor:[100,80,140],tintAmt:0.12,shadowB:1.12,shadowG:0.92},m) },
  { id:'epic',       name:'Epic',         cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:0,contrast:60,saturation:10,tintColor:[255,150,0],tintAmt:0.08,shadowB:1.1,highlightR:1.08,gammaR:0.92},m) },
  { id:'midnight',   name:'Midnight',     cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:-22,contrast:52,saturation:-30,tintColor:[0,50,180],tintAmt:0.14,shadowR:0.75,shadowG:0.75,shadowB:0.90,gammaB:1.12},m) },
  { id:'analog',     name:'Analog',       cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:5,contrast:20,saturation:-15,tintColor:[255,230,180],tintAmt:0.1,shadowR:0.95,shadowG:0.90,shadowB:0.82,highlightR:1.05,gammaB:1.08},m) },
  { id:'kodak',      name:'Kodak',        cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:12,contrast:22,saturation:5,tintColor:[255,235,190],tintAmt:0.08,shadowR:0.95,shadowG:0.88,shadowB:0.80,highlightR:1.04},m) },
  { id:'neon',       name:'Neon Nights',  cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:-10,contrast:50,saturation:55,tintColor:[0,255,200],tintAmt:0.06,shadowB:1.15},m) },
  { id:'danger',     name:'Danger',       cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:-5,contrast:58,saturation:-15,tintColor:[200,0,0],tintAmt:0.14,shadowR:1.1,shadowG:0.72,shadowB:0.72},m) },
  { id:'urban',      name:'Urban',        cat:'cinema', apply:(d,i,m)=>lutFilter(d,{brightness:-5,contrast:42,saturation:-18,tintColor:[70,90,110],tintAmt:0.1,shadowB:1.08},m) },

  /* ─── B&W ─── */
  { id:'bw-classic', name:'Classic B&W',  cat:'bw',     apply:(d,i,m)=>lutFilter(d,{contrast:50,bw:true,shadowR:0.75,highlightR:1.08},m) },
  { id:'bw-silver',  name:'Silver',       cat:'bw',     apply:(d,i,m)=>lutFilter(d,{brightness:8,contrast:30,bw:true,tintColor:[200,210,220],tintAmt:0.08},m) },
  { id:'bw-dramatic',name:'Dramatic',     cat:'bw',     apply:(d,i,m)=>lutFilter(d,{brightness:-8,contrast:75,bw:true,shadowR:0.65,highlightR:1.12,gammaR:0.88},m) },
  { id:'bw-studio',  name:'Studio BW',    cat:'bw',     apply:(d,i,m)=>lutFilter(d,{brightness:5,contrast:55,bw:true,highlightR:1.06,shadowR:0.80},m) },
  { id:'bw-film',    name:'Film Noir',    cat:'bw',     apply:(d,i,m)=>lutFilter(d,{brightness:-5,contrast:65,bw:true,sepia:0.15,shadowR:0.70,highlightR:1.1},m) },
  { id:'bw-high',    name:'High Key BW',  cat:'bw',     apply:(d,i,m)=>lutFilter(d,{brightness:25,contrast:20,bw:true,highlightR:1.1},m) },
  { id:'bw-low',     name:'Low Key BW',   cat:'bw',     apply:(d,i,m)=>lutFilter(d,{brightness:-15,contrast:70,bw:true,shadowR:0.60,highlightR:1.15},m) },
  { id:'infrared',   name:'Infrared',     cat:'bw',     apply:(d,i,m)=>processPixels(d,(r,g,b)=>{
    const ir=clamp(r*0.2+g*0.9+b*0.1);
    const v=clamp((ir-128)*1.6+180);
    return[v,v,v];
  },m) },
];

/* ══════════════════════════════════════════
   FILTER ENGINE
══════════════════════════════════════════ */
export class FilterEngine {
  constructor() {
    this._map = new Map(CATALOGUE.map(f => [f.id, f]));
  }

  /**
   * Get filters for a category.
   * @param {string} cat
   * @returns {Array}
   */
  getFilters(cat = 'all') {
    if (cat === 'all') return CATALOGUE;
    return CATALOGUE.filter(f => f.cat === cat || f.id === 'original');
  }

  /**
   * Apply a filter to ImageData with optional zone mask and intensity blend.
   * @param {ImageData}      imageData
   * @param {string}         filterId
   * @param {number}         intensity - [0..1]
   * @param {Uint8Array|null} mask
   * @returns {ImageData}
   */
  apply(imageData, filterId, intensity = 1, mask = null) {
    const filter = this._map.get(filterId);
    if (!filter || filterId === 'original') return imageData;

    const filtered = filter.apply(imageData, intensity, mask);

    // Blend intensity
    if (intensity >= 1) return filtered;
    if (intensity <= 0) return imageData;

    const src = imageData.data;
    const flt = filtered.data;
    const out = new Uint8ClampedArray(src.length);

    for (let i = 0; i < src.length; i += 4) {
      const px = i >> 2;
      if (mask && !mask[px]) { out[i]=src[i];out[i+1]=src[i+1];out[i+2]=src[i+2];out[i+3]=src[i+3]; continue; }
      out[i]   = clamp(src[i]   * (1-intensity) + flt[i]   * intensity);
      out[i+1] = clamp(src[i+1] * (1-intensity) + flt[i+1] * intensity);
      out[i+2] = clamp(src[i+2] * (1-intensity) + flt[i+2] * intensity);
      out[i+3] = src[i+3];
    }

    return new ImageData(out, imageData.width, imageData.height);
  }
}
