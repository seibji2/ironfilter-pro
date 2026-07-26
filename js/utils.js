/**
 * IRONFILTER PRO — utils.js
 * Shared pure utilities.
 */

/** Clamp value between min and max. */
export function clamp(v, min = 0, max = 255) {
  return Math.max(min, Math.min(max, v));
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Set loader progress bar and message. */
export function setLoader(pct, msg) {
  const bar    = document.getElementById('loader-fill');
  const msgEl  = document.getElementById('loader-msg');
  if (bar)   bar.style.width = `${clamp(pct, 0, 100)}%`;
  if (msgEl && msg) msgEl.textContent = msg;
}

/** Show a toast notification. */
let _toastTimer = null;
export function toast(message, type = 'info', duration = 2500) {
  const area = document.getElementById('toast-area');
  if (!area) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  area.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(12px)';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/** Parse hex color to {r,g,b}. */
export function hexToRgb(hex) {
  const c = hex.replace('#', '');
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

/** Debounce a function call. */
export function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

/** RAF throttle. */
export function rafThrottle(fn) {
  let id = null;
  return (...args) => {
    if (id) return;
    id = requestAnimationFrame(() => { fn(...args); id = null; });
  };
}
