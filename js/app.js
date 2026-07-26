/**
 * IRONFILTER PRO Studio — app.js
 * AI-powered person detection + selective professional editing
 * Uses BodyPix for segmentation, Canvas2D for pixel processing
 */

import { Processor }    from './processor.js';
import { AISegment }    from './segment.js';
import { FilterEngine } from './filters.js';
import { PosterEngine } from './poster.js';
import { History }      from './history.js';
import { toast, setLoader, clamp } from './utils.js';

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
const S = {
  // Image data
  originalBitmap: null,
  originalW: 0, originalH: 0,
  fileName: '',

  // Segmentation masks (Uint8Array same size as image)
  masks: {
    person: null,   // 1 = person pixel
    skin:   null,   // 1 = skin pixel
    face:   null,   // 1 = face pixel
    torso:  null,   // 1 = torso pixel
    bg:     null,   // 1 = background pixel
  },

  // Active zone
  zone: 'full',

  // Active filter
  activeFilter: null,
  filterIntensity: 1,

  // All adjustments
  adj: {
    // Light
    exposure: 0, brightness: 0, contrast: 0,
    shadows: 0, highlights: 0, whites: 0, blacks: 0,
    vignette: 0, vignetteSize: 50,

    // Color
    temp: 0, tint: 0, sat: 0, vibrance: 0, hue: 0,
    splitShadow: 0, splitHigh: 0,
    splitShadowColor: '#000000', splitHighColor: '#ffffff',

    // Detail
    sharp: 0, clarity: 0, texture: 0, soften: 0, grain: 0, grainSize: 2,

    // Person-specific
    skinBright: 0, skinWarm: 0, skinSat: 0, skinSmooth: 0,
    muscleCon: 0, muscleShadow: 0, muscleShine: 0, skinTexture: 0,
    bgDark: 0, bgBlur: 0, bgDesat: 0,
  },

  // Poster text
  poster: null,
  posterTextPos: 'bottom',
  overlayOpacity: 70,

  // Brush
  activeBrush: null,  // 'dodge'|'burn'|'sharpen-brush'|'blur-brush'
  brushSize: 40,
  brushStrength: 50,
  brushCanvas: null,  // extra layer for brush strokes

  // Viewport
  zoom: 1, panX: 0, panY: 0,

  // Compare
  compareMode: true,
  comparePos: 0.5,

  // Interaction
  isPanning: false, panStart: null,
  isBrushing: false,
};

/* ═══════════════════════════════════════
   CANVAS ELEMENTS
═══════════════════════════════════════ */
const cOriginal = document.getElementById('c-original');
const cResult   = document.getElementById('c-result');
const cOverlay  = document.getElementById('c-overlay');
const ctxOrig   = cOriginal.getContext('2d', { willReadFrequently: true });
const ctxResult = cResult.getContext('2d',   { willReadFrequently: true });
const ctxOver   = cOverlay.getContext('2d');
const wrap      = document.getElementById('canvas-wrap');
const stage     = document.getElementById('stage');

/* ═══════════════════════════════════════
   ENGINES
═══════════════════════════════════════ */
let processor    = null;
let aiSegment    = null;
let filterEngine = null;
let posterEngine = null;
let history      = null;

/* ═══════════════════════════════════════
   BOOT
═══════════════════════════════════════ */
async function boot() {
  setLoader(10, 'Iniciando motores…');
  await domReady();

  setLoader(20, 'Cargando motor de filtros…');
  filterEngine = new FilterEngine();
  buildFilterGrid();

  setLoader(35, 'Cargando BodyPix (IA detección de personas)…');
  aiSegment = new AISegment();
  await aiSegment.load((pct, msg) => setLoader(35 + pct * 0.5, msg));

  setLoader(88, 'Preparando procesador de imagen…');
  processor    = new Processor();
  posterEngine = new PosterEngine();
  history      = new History(captureState, restoreState, onHistoryUpdate);

  setLoader(100, '¡Listo!');
  bindAllEvents();

  setTimeout(() => {
    document.getElementById('loader').style.transition = 'opacity .4s';
    document.getElementById('loader').style.opacity = '0';
    setTimeout(() => {
      document.getElementById('loader').style.display = 'none';
      document.getElementById('app').classList.remove('hidden');
    }, 400);
  }, 300);
}

function domReady() {
  return new Promise(r => document.readyState !== 'loading' ? r() : document.addEventListener('DOMContentLoaded', r, { once: true }));
}

/* ═══════════════════════════════════════
   LOAD IMAGE
═══════════════════════════════════════ */
async function loadFile(file) {
  if (!file?.type.startsWith('image/')) return;
  showProcessing('Cargando imagen…');

  try {
    const url    = URL.createObjectURL(file);
    const bitmap = await createImageBitmap(await fetch(url).then(r => r.blob()));
    URL.revokeObjectURL(url);

    S.originalBitmap = bitmap;
    S.originalW      = bitmap.width;
    S.originalH      = bitmap.height;
    S.fileName       = file.name;

    // Reset state
    Object.keys(S.adj).forEach(k => {
      if (typeof S.adj[k] === 'number') {
        S.adj[k] = ['brushSize','brushStrength','grainSize','vignetteSize','overlayOpacity'].includes(k)
          ? S.adj[k] : 0;
      }
    });
    S.adj.vignetteSize = 50;
    S.adj.grainSize    = 2;
    S.activeFilter     = null;
    S.filterIntensity  = 1;
    S.poster           = null;
    S.masks            = { person: null, skin: null, face: null, torso: null, bg: null };

    // Reset brush canvas
    S.brushCanvas = null;

    // Size canvases
    [cOriginal, cResult, cOverlay].forEach(c => {
      c.width  = bitmap.width;
      c.height = bitmap.height;
    });

    // Draw original
    ctxOrig.drawImage(bitmap, 0, 0);

    // Hide dropzone, show canvas
    document.getElementById('dropzone').classList.add('hidden');

    // Zoom to fit
    zoomFit();
    applyTransform();

    // Update UI
    document.getElementById('file-info').textContent =
      `${file.name}  ·  ${bitmap.width}×${bitmap.height}px  ·  ${(file.size/1024/1024).toFixed(1)}MB`;
    document.getElementById('st-dims').textContent = `${bitmap.width}×${bitmap.height}`;

    // Run AI segmentation
    showProcessing('Detectando persona con IA…');
    const masks = await aiSegment.segment(cOriginal, bitmap.width, bitmap.height);
    Object.assign(S.masks, masks);

    // Update AI notice
    if (S.masks.person) {
      const personPct = Math.round(S.masks.person.filter(v => v).length / S.masks.person.length * 100);
      document.getElementById('ai-notice').innerHTML =
        `<span class="notice-icon">✅</span><span>Persona detectada (${personPct}% del encuadre). La edición selectiva por zona está activa.</span>`;
      document.getElementById('ai-notice').style.background = 'rgba(0,200,83,.08)';
      document.getElementById('ai-notice').style.borderColor = 'rgba(0,200,83,.3)';
      document.getElementById('st-ai').textContent = `IA: ${personPct}% persona`;
    } else {
      document.getElementById('st-ai').textContent = 'IA: sin persona';
    }

    // Initial render
    await render();
    history.push('Imagen cargada');

    // Update filter thumbnails
    updateFilterThumbs();

    toast(`✓ ${file.name} cargado`, 'ok');
  } catch (e) {
    console.error(e);
    toast('Error al cargar la imagen', 'err');
  } finally {
    hideProcessing();
  }
}

/* ═══════════════════════════════════════
   RENDER PIPELINE
═══════════════════════════════════════ */
async function render() {
  if (!S.originalBitmap) return;

  const w = S.originalW, h = S.originalH;

  // 1. Start from original
  ctxResult.drawImage(S.originalBitmap, 0, 0);
  let imageData = ctxResult.getImageData(0, 0, w, h);

  // 2. Get active mask for selective edits
  const mask = getMaskForZone(S.zone);

  // 3. Apply filter (zone-aware)
  if (S.activeFilter) {
    imageData = filterEngine.apply(imageData, S.activeFilter, S.filterIntensity, mask);
  }

  // 4. Apply person-specific retouching (uses segmentation masks)
  if (S.masks.person) {
    imageData = processor.applyPersonRetouching(imageData, S.adj, S.masks);
  }

  // 5. Apply global adjustments on active zone
  imageData = processor.applyAdjustments(imageData, S.adj, mask);

  // 6. Apply brush strokes layer
  if (S.brushCanvas) {
    imageData = processor.applyBrushLayer(imageData, S.brushCanvas, w, h);
  }

  // 7. Put result
  ctxResult.putImageData(imageData, 0, 0);

  // 8. Vignette (drawn on top)
  if (S.adj.vignette !== 0) {
    processor.drawVignette(ctxResult, w, h, S.adj.vignette, S.adj.vignetteSize);
  }

  // 9. Poster overlay
  if (S.poster) {
    posterEngine.draw(ctxResult, w, h, S.poster, S.overlayOpacity / 100);
  }

  // 10. Compare mode: show original on left
  drawCompare();

  // 11. Overlay (mask view, guides)
  drawOverlayGuides();
}

function getMaskForZone(zone) {
  if (zone === 'full')   return null;
  if (zone === 'person') return S.masks.person;
  if (zone === 'skin')   return S.masks.skin;
  if (zone === 'face')   return S.masks.face;
  if (zone === 'torso')  return S.masks.torso;
  if (zone === 'bg')     return S.masks.bg;
  return null;
}

/* ═══════════════════════════════════════
   COMPARE MODE
═══════════════════════════════════════ */
function drawCompare() {
  if (!S.compareMode) return;

  const w = S.originalW, h = S.originalH;
  const splitX = Math.round(w * S.comparePos);

  // Clip left half and draw original
  ctxResult.save();
  ctxResult.beginPath();
  ctxResult.rect(0, 0, splitX, h);
  ctxResult.clip();
  ctxResult.drawImage(S.originalBitmap, 0, 0);
  ctxResult.restore();

  // Divider line
  ctxResult.fillStyle = '#f5c400';
  ctxResult.fillRect(splitX - 1, 0, 2, h);

  // Labels
  ctxResult.font = `bold 14px 'Barlow Condensed', sans-serif`;
  ctxResult.textAlign = 'center';

  const pill = (text, x, y) => {
    const tw = ctxResult.measureText(text).width + 20;
    ctxResult.fillStyle = 'rgba(0,0,0,.7)';
    ctxResult.fillRect(x - tw/2, y - 18, tw, 24);
    ctxResult.fillStyle = '#f5c400';
    ctxResult.fillText(text, x, y);
  };

  pill('ORIGINAL', splitX * 0.5, 28);
  pill('EDITADO',  splitX + (w - splitX) * 0.5, 28);
  ctxResult.textAlign = 'left';
}

/* ═══════════════════════════════════════
   OVERLAY GUIDES
═══════════════════════════════════════ */
function drawOverlayGuides() {
  const w = S.originalW, h = S.originalH;
  ctxOver.clearRect(0, 0, w, h);

  // Mask view
  if (document.getElementById('tool-mask-view').classList.contains('on')) {
    const mask = getMaskForZone(S.zone);
    if (mask) {
      ctxOver.fillStyle = 'rgba(245,196,0,0.5)';
      for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
          const x = i % w, y = Math.floor(i / w);
          ctxOver.fillRect(x, y, 1, 1);
        }
      }
    }
  }
}

/* ═══════════════════════════════════════
   VIEWPORT TRANSFORM
═══════════════════════════════════════ */
function zoomFit() {
  const sr = stage.getBoundingClientRect();
  const sw = sr.width  - 80;
  const sh = sr.height - 60;
  S.zoom = Math.min(sw / S.originalW, sh / S.originalH, 1);
  S.panX = 0; S.panY = 0;
}

function applyTransform() {
  if (!S.originalW) return;
  wrap.style.width  = `${S.originalW}px`;
  wrap.style.height = `${S.originalH}px`;
  wrap.style.transform = `translate(calc(-50% + ${S.panX}px), calc(-50% + ${S.panY}px)) scale(${S.zoom})`;
  wrap.style.left = '50%';
  wrap.style.top  = '50%';
  document.getElementById('st-zoom').textContent = `${Math.round(S.zoom * 100)}%`;
}

function setZoom(z) {
  S.zoom = clamp(z, 0.05, 16);
  applyTransform();
}

/* ═══════════════════════════════════════
   FILTER GRID
═══════════════════════════════════════ */
function buildFilterGrid(cat = 'all') {
  const grid = document.getElementById('filters-grid');
  grid.innerHTML = '';

  filterEngine.getFilters(cat).forEach(f => {
    const thumb = document.createElement('div');
    thumb.className = 'fthumb' + (S.activeFilter === f.id ? ' active' : '');
    thumb.dataset.id = f.id;

    const prev = document.createElement('div');
    prev.className = 'fprev';
    const c = document.createElement('canvas');
    c.id = `ft-${f.id}`; c.width = 70; c.height = 50;
    prev.appendChild(c);

    const lbl = document.createElement('div');
    lbl.className = 'flabel'; lbl.textContent = f.name;

    thumb.appendChild(prev); thumb.appendChild(lbl);
    thumb.addEventListener('click', async () => {
      if (S.activeFilter === f.id) {
        S.activeFilter = null;
      } else {
        S.activeFilter = f.id;
      }
      document.querySelectorAll('.fthumb').forEach(t => t.classList.remove('active'));
      if (S.activeFilter) thumb.classList.add('active');
      await render();
      history.push(`Filtro: ${f.name}`);
    });
    grid.appendChild(thumb);
  });

  if (S.originalBitmap) updateFilterThumbs();
}

function updateFilterThumbs() {
  filterEngine.getFilters('all').forEach(f => {
    const c = document.getElementById(`ft-${f.id}`);
    if (!c) return;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(S.originalBitmap, 0, 0, 70, 50);
    if (f.id !== 'original') {
      const id = ctx.getImageData(0, 0, 70, 50);
      const res = filterEngine.apply(id, f.id, 1, null);
      ctx.putImageData(res, 0, 0);
    }
  });
}

/* ═══════════════════════════════════════
   PROCESSING OVERLAY
═══════════════════════════════════════ */
let procEl = null;

function showProcessing(msg = 'Procesando…') {
  if (procEl) procEl.remove();
  procEl = document.createElement('div');
  procEl.className = 'processing';
  procEl.innerHTML = `
    <div class="processing-inner">
      <div class="spinner"></div>
      <div class="proc-label">${msg}</div>
    </div>`;
  stage.appendChild(procEl);
}

function hideProcessing() {
  if (procEl) { procEl.remove(); procEl = null; }
}

/* ═══════════════════════════════════════
   HISTORY
═══════════════════════════════════════ */
function captureState() {
  return {
    adj:             JSON.parse(JSON.stringify(S.adj)),
    zone:            S.zone,
    activeFilter:    S.activeFilter,
    filterIntensity: S.filterIntensity,
    poster:          S.poster ? JSON.parse(JSON.stringify(S.poster)) : null,
    overlayOpacity:  S.overlayOpacity,
  };
}

function restoreState(snap) {
  Object.assign(S.adj, snap.adj);
  S.zone            = snap.zone;
  S.activeFilter    = snap.activeFilter;
  S.filterIntensity = snap.filterIntensity;
  S.poster          = snap.poster;
  S.overlayOpacity  = snap.overlayOpacity;
  syncSlidersToState();
  render();
}

function onHistoryUpdate({ canUndo, canRedo }) {
  document.getElementById('btn-undo').disabled = !canUndo;
  document.getElementById('btn-redo').disabled = !canRedo;
}

function syncSlidersToState() {
  const sliders = document.querySelectorAll('[data-param]');
  sliders.forEach(sl => {
    const p = sl.dataset.param;
    if (p in S.adj) {
      sl.value = S.adj[p];
      const vid = `v-${sl.id.replace('sl-', '')}`;
      const disp = document.getElementById(vid);
      if (disp) disp.textContent = formatVal(p, S.adj[p]);
    }
  });
}

function formatVal(param, v) {
  if (param === 'hue') return `${Math.round(v)}°`;
  return Math.round(v);
}

/* ═══════════════════════════════════════
   EXPORT
═══════════════════════════════════════ */
async function exportImage() {
  if (!S.originalBitmap) { toast('Sube una imagen primero', 'err'); return; }

  showProcessing('Exportando en máxima calidad…');
  try {
    // Render without compare
    const wasCompare = S.compareMode;
    S.compareMode = false;
    await render();
    S.compareMode = wasCompare;

    // Export from result canvas
    const off = new OffscreenCanvas(S.originalW, S.originalH);
    const offCtx = off.getContext('2d');
    offCtx.drawImage(cResult, 0, 0);

    const blob = await off.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const name = S.fileName.replace(/\.[^.]+$/, '');
    a.download = `${name}-ironfilter-pro.jpg`;
    a.href     = url;
    a.click();
    URL.revokeObjectURL(url);

    await render(); // restore compare
    toast('✓ Imagen exportada', 'ok');
  } catch (e) {
    toast('Error al exportar', 'err');
  } finally {
    hideProcessing();
  }
}

/* ═══════════════════════════════════════
   BRUSH TOOLS
═══════════════════════════════════════ */
function initBrushCanvas() {
  if (S.brushCanvas) return;
  S.brushCanvas        = document.createElement('canvas');
  S.brushCanvas.width  = S.originalW;
  S.brushCanvas.height = S.originalH;
}

function applyBrushStroke(x, y) {
  if (!S.activeBrush || !S.originalBitmap) return;
  initBrushCanvas();

  const ctx      = S.brushCanvas.getContext('2d');
  const strength = S.brushStrength / 100;
  const size     = S.brushSize;

  // Convert viewport coords to image coords
  const ix = (x - stage.getBoundingClientRect().left - S.panX) / S.zoom + S.originalW / 2 - (wrap.offsetWidth / 2 / S.zoom);
  const iy = (y - stage.getBoundingClientRect().top  - S.panY) / S.zoom + S.originalH / 2 - (wrap.offsetHeight / 2 / S.zoom);

  if (S.activeBrush === 'dodge') {
    ctx.fillStyle = `rgba(255,255,255,${strength * 0.15})`;
  } else if (S.activeBrush === 'burn') {
    ctx.fillStyle = `rgba(0,0,0,${strength * 0.15})`;
  } else {
    return; // sharpen/blur handled differently
  }

  ctx.beginPath();
  const grad = ctx.createRadialGradient(ix, iy, 0, ix, iy, size / 2);
  grad.addColorStop(0, ctx.fillStyle);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.arc(ix, iy, size / 2, 0, Math.PI * 2);
  ctx.fill();
}

/* ═══════════════════════════════════════
   EVENT BINDING
═══════════════════════════════════════ */
function bindAllEvents() {
  // File input
  const fi = document.getElementById('file-input');
  document.getElementById('btn-open').addEventListener('click',  () => fi.click());
  document.getElementById('btn-open2')?.addEventListener('click', () => fi.click());
  fi.addEventListener('change', e => loadFile(e.target.files[0]));

  // Drag & drop on stage
  const dz = document.getElementById('dropzone');
  [stage, dz].forEach(el => {
    el.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag'); });
    el.addEventListener('dragleave', ()  => dz.classList.remove('drag'));
    el.addEventListener('drop',      e  => {
      e.preventDefault(); dz.classList.remove('drag');
      loadFile(e.dataTransfer.files[0]);
    });
  });

  // Paste
  document.addEventListener('paste', e => {
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) { loadFile(item.getAsFile()); break; }
    }
  });

  // Export
  document.getElementById('btn-download').addEventListener('click', exportImage);

  // Undo/Redo
  document.getElementById('btn-undo').addEventListener('click', () => { history.undo(); });
  document.getElementById('btn-redo').addEventListener('click', () => { history.redo(); });

  // Compare
  document.getElementById('btn-compare').addEventListener('click', () => {
    S.compareMode = !S.compareMode;
    document.getElementById('btn-compare').classList.toggle('active', S.compareMode);
    render();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
      tab.classList.add('active');
      const panel = document.getElementById(`tab-${tab.dataset.tab}`);
      if (panel) { panel.classList.add('active'); panel.style.display = 'flex'; }
    });
  });

  // Zone buttons
  document.querySelectorAll('[data-zone]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.zone = btn.dataset.zone;
      document.querySelectorAll('[data-zone]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('st-zone').textContent = `Zona: ${btn.title || btn.dataset.zone}`;
      render();
    });
  });

  // Filter categories
  document.querySelectorAll('.cat').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildFilterGrid(btn.dataset.cat);
    });
  });

  // Filter intensity
  const slInt = document.getElementById('sl-filter-intensity');
  slInt.addEventListener('input', () => {
    S.filterIntensity = parseInt(slInt.value) / 100;
    document.getElementById('v-filter-intensity').textContent = slInt.value + '%';
    scheduleRender();
  });
  slInt.addEventListener('mouseup', () => history.push('Intensidad filtro'));

  // All parameter sliders
  document.querySelectorAll('.sl[data-param]').forEach(sl => {
    sl.addEventListener('input', () => {
      const p   = sl.dataset.param;
      const val = parseFloat(sl.value);
      S.adj[p]  = val;
      const vid  = 'v-' + sl.id.replace('sl-', '');
      const disp = document.getElementById(vid);
      if (disp) disp.textContent = formatVal(p, val);
      scheduleRender();
    });
    sl.addEventListener('mouseup',  () => history.push(`Ajuste`));
    sl.addEventListener('touchend', () => history.push(`Ajuste`));
  });

  // Brush size & strength
  const slBS = document.getElementById('sl-brush-size');
  slBS.addEventListener('input', () => {
    S.brushSize = parseInt(slBS.value);
    document.getElementById('v-brush-size').textContent = S.brushSize;
    updateBrushCursor();
  });
  const slBStr = document.getElementById('sl-brush-strength');
  slBStr.addEventListener('input', () => {
    S.brushStrength = parseInt(slBStr.value);
    document.getElementById('v-brush-strength').textContent = S.brushStrength;
  });

  // Split toning colors
  document.getElementById('cp-shadows').addEventListener('input', e => {
    S.adj.splitShadowColor = e.target.value; scheduleRender();
  });
  document.getElementById('cp-highlights').addEventListener('input', e => {
    S.adj.splitHighColor = e.target.value; scheduleRender();
  });

  // Tool buttons (brush modes)
  ['tool-dodge','tool-burn','tool-sharpen-brush','tool-blur-brush'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      const tool = id.replace('tool-', '');
      if (S.activeBrush === tool) {
        S.activeBrush = null;
        e.currentTarget.classList.remove('on');
      } else {
        S.activeBrush = tool;
        ['tool-dodge','tool-burn','tool-sharpen-brush','tool-blur-brush'].forEach(i => {
          document.getElementById(i)?.classList.remove('on');
        });
        e.currentTarget.classList.add('on');
        updateBrushCursor();
      }
    });
  });

  // Mask view
  document.getElementById('tool-mask-view')?.addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('on');
    drawOverlayGuides();
  });

  // Zoom
  document.getElementById('btn-zoom-in')?.addEventListener('click',  () => { setZoom(S.zoom * 1.25); });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => { setZoom(S.zoom / 1.25); });
  document.getElementById('btn-zoom-fit')?.addEventListener('click', () => { zoomFit(); applyTransform(); });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });

  // Poster templates
  document.querySelectorAll('.poster-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.poster-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activatePoster(btn.dataset.poster);
    });
  });

  // Poster text inputs
  ['pt-line1','pt-line2','pt-sub','pt-accent'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      if (S.poster) {
        S.poster.line1  = document.getElementById('pt-line1').value;
        S.poster.line2  = document.getElementById('pt-line2').value;
        S.poster.sub    = document.getElementById('pt-sub').value;
        S.poster.accent = document.getElementById('pt-accent').value;
        scheduleRender();
      }
    });
  });

  // Poster position
  document.querySelectorAll('.pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.posterTextPos = btn.dataset.pos;
      if (S.poster) { S.poster.position = S.posterTextPos; scheduleRender(); }
    });
  });

  // Overlay opacity
  const slOO = document.getElementById('sl-overlay-opacity');
  slOO?.addEventListener('input', () => {
    S.overlayOpacity = parseInt(slOO.value);
    document.getElementById('v-overlay-opacity').textContent = S.overlayOpacity;
    scheduleRender();
  });

  // Free text
  document.getElementById('btn-add-text')?.addEventListener('click', () => {
    const text  = document.getElementById('free-text').value.trim();
    const color = document.getElementById('free-color').value;
    const size  = parseInt(document.getElementById('sl-free-size').value);
    if (!text || !S.originalBitmap) return;
    if (!S.poster) S.poster = { type: 'free', texts: [] };
    if (!S.poster.texts) S.poster.texts = [];
    S.poster.texts.push({ text, color, size, x: 0.1, y: 0.85 });
    render(); history.push('Texto añadido');
  });

  const slFS = document.getElementById('sl-free-size');
  slFS?.addEventListener('input', () => {
    document.getElementById('v-free-size').textContent = slFS.value;
  });

  // Canvas interactions: pan, wheel, brush
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup',   onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);

  // Compare slider drag
  bindCompareSlider();

  // Keyboard shortcuts
  document.addEventListener('keydown', onKey);
}

/* ═══════════════════════════════════════
   POINTER EVENTS (pan + brush)
═══════════════════════════════════════ */
function onPointerDown(e) {
  if (!S.originalBitmap) return;
  if (S.activeBrush) {
    S.isBrushing = true;
    stage.setPointerCapture(e.pointerId);
    applyBrushStroke(e.clientX, e.clientY);
    scheduleRender();
    return;
  }
  // Pan
  S.isPanning = true;
  S.panStart  = { x: e.clientX - S.panX, y: e.clientY - S.panY };
  stage.setPointerCapture(e.pointerId);
  stage.style.cursor = 'grabbing';
}

function onPointerMove(e) {
  updateBrushCursorPos(e.clientX, e.clientY);
  if (S.isBrushing) {
    applyBrushStroke(e.clientX, e.clientY);
    scheduleRender();
    return;
  }
  if (S.isPanning) {
    S.panX = e.clientX - S.panStart.x;
    S.panY = e.clientY - S.panStart.y;
    applyTransform();
  }
}

function onPointerUp(e) {
  if (S.isBrushing) {
    S.isBrushing = false;
    history.push('Pincel');
    stage.releasePointerCapture(e.pointerId);
    return;
  }
  if (S.isPanning) {
    S.isPanning = false;
    stage.style.cursor = '';
    stage.releasePointerCapture(e.pointerId);
  }
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  setZoom(S.zoom * factor);
}

/* ═══════════════════════════════════════
   COMPARE SLIDER
═══════════════════════════════════════ */
function bindCompareSlider() {
  const bar    = document.getElementById('compare-bar');
  const line   = bar.querySelector('.compare-line');
  const handle = bar.querySelector('.compare-handle');
  let dragging = false;

  handle.addEventListener('pointerdown', e => { dragging = true; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const wRect = wrap.getBoundingClientRect();
    const pos   = clamp((e.clientX - wRect.left) / wRect.width, 0.02, 0.98);
    S.comparePos = pos;
    const pct = (pos * 100).toFixed(1) + '%';
    line.style.left   = pct;
    handle.style.left = pct;
    render();
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}

/* ═══════════════════════════════════════
   BRUSH CURSOR
═══════════════════════════════════════ */
function updateBrushCursor() {
  const cur = document.getElementById('brush-cursor');
  const sz  = S.brushSize * S.zoom;
  cur.style.width  = `${sz}px`;
  cur.style.height = `${sz}px`;
  cur.style.display = S.activeBrush ? 'block' : 'none';
  stage.style.cursor = S.activeBrush ? 'none' : '';
}

function updateBrushCursorPos(x, y) {
  const cur = document.getElementById('brush-cursor');
  const sr  = stage.getBoundingClientRect();
  cur.style.left = `${x - sr.left}px`;
  cur.style.top  = `${y - sr.top}px`;
}

/* ═══════════════════════════════════════
   PRESETS
═══════════════════════════════════════ */
const PRESETS = {
  natural: {
    skinBright: 12, skinWarm: 8, skinSat: 5, skinSmooth: 15,
    muscleCon: 10, muscleShine: 8, bgDark: 15, contrast: 5, temp: 5,
  },
  magazine: {
    skinBright: 25, skinWarm: 15, skinSat: -10, skinSmooth: 40,
    muscleCon: 20, muscleShine: 20, muscleShadow: 15,
    bgDark: 40, bgBlur: 30, bgDesat: 50,
    contrast: 15, highlights: -10, shadows: 10, temp: 8,
  },
  competition: {
    skinBright: 5, skinWarm: 5, skinSat: -15, skinSmooth: 5,
    muscleCon: 55, muscleShadow: 40, muscleShine: 30, skinTexture: 40,
    bgDark: 60, bgDesat: 80,
    contrast: 35, shadows: -15, highlights: -20, clarity: 20,
  },
  golden: {
    skinBright: 20, skinWarm: 35, skinSat: 10,
    muscleCon: 15, muscleShine: 25,
    bgDark: 20, temp: 35, sat: 10, shadows: 10, vignette: 30,
  },
  cinematic: {
    skinBright: 0, skinWarm: 10, skinSat: -20, skinSmooth: 10,
    bgDark: 50, bgDesat: 40, bgBlur: 15,
    contrast: 25, shadows: -20, highlights: -15, sat: -15, temp: 10,
    vignette: 50, grain: 20,
  },
  editorial: {
    skinBright: 30, skinWarm: 5, skinSat: -25, skinSmooth: 50,
    muscleCon: 25, muscleShine: 30,
    bgDark: 70, bgBlur: 50, bgDesat: 90,
    contrast: 10, highlights: -15, shadows: 15, sharp: 20,
  },
};

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  // Reset person params
  ['skinBright','skinWarm','skinSat','skinSmooth','muscleCon','muscleShadow','muscleShine','skinTexture','bgDark','bgBlur','bgDesat'].forEach(k => S.adj[k] = 0);
  Object.assign(S.adj, preset);
  syncSlidersToState();
  render();
  history.push(`Preset: ${name}`);
}

/* ═══════════════════════════════════════
   POSTER TEMPLATES
═══════════════════════════════════════ */
const POSTER_DEFAULTS = {
  champion:       { line1: 'CHAMPION', line2: 'MINDSET', sub: 'TRAIN HARD. WIN HARDER.', accent: '#f5c400', position: 'bottom' },
  motivation:     { line1: 'NO EXCUSES', line2: 'NO LIMITS', sub: 'YOUR BODY. YOUR CHOICE.', accent: '#e02020', position: 'bottom' },
  pr:             { line1: 'NEW PR', line2: '250 KG', sub: 'PERSONAL RECORD · 2025', accent: '#f5c400', position: 'center' },
  transformation: { line1: 'MY', line2: 'TRANSFORMATION', sub: '12 SEMANAS · -15KG', accent: '#00c853', position: 'bottom' },
  gym:            { line1: 'GYM NAME', line2: 'BE STRONGER', sub: 'JOIN TODAY · €29/MES', accent: '#f5c400', position: 'bottom' },
  competition:    { line1: 'IFBB PRO', line2: 'ATHLETE', sub: 'ARNOLD CLASSIC 2025', accent: '#e02020', position: 'bottom' },
};

function activatePoster(type) {
  const def = POSTER_DEFAULTS[type];
  if (!def) return;
  S.poster = { type, ...JSON.parse(JSON.stringify(def)) };
  document.getElementById('pt-line1').value   = S.poster.line1;
  document.getElementById('pt-line2').value   = S.poster.line2;
  document.getElementById('pt-sub').value     = S.poster.sub;
  document.getElementById('pt-accent').value  = S.poster.accent;
  document.getElementById('poster-editor').style.display = '';
  render();
  history.push(`Poster: ${type}`);
}

/* ═══════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════ */
function onKey(e) {
  const tag = e.target.tagName;
  if (['INPUT','TEXTAREA'].includes(tag)) return;

  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'z') { e.preventDefault(); history.undo(); }
  if (ctrl && e.key === 'y') { e.preventDefault(); history.redo(); }
  if (ctrl && e.key === 's') { e.preventDefault(); exportImage(); }
  if (e.key === 'f' || e.key === 'F') { zoomFit(); applyTransform(); }
  if (e.key === 'c' || e.key === 'C') { document.getElementById('btn-compare').click(); }
  if (e.key === '+' || e.key === '=') setZoom(S.zoom * 1.2);
  if (e.key === '-') setZoom(S.zoom / 1.2);
}

/* ═══════════════════════════════════════
   RENDER SCHEDULER (debounced RAF)
═══════════════════════════════════════ */
let _rafId = null;
function scheduleRender() {
  if (_rafId) return;
  _rafId = requestAnimationFrame(async () => {
    _rafId = null;
    await render();
  });
}

/* ═══════════════════════════════════════
   BOOT
═══════════════════════════════════════ */
boot().catch(e => console.error('[IRONFILTER PRO] Boot error:', e));
