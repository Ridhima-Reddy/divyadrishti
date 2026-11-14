// Full-screen checkerboard for camera lensometry (see measure/lensometer.js).
// The engine compares the pattern's period through the lens with the period
// seen directly, so the absolute square size does not matter; it only has to
// be sharp, high-contrast and a few camera pixels per square.
//   ?mm=4      square size in millimetres (default 4)
//   ?pxmm=3.78 CSS pixels per millimetre of this screen (default 96 dpi)
// On paper the squares are true millimetres (CSS mm in print).

const CSS_PX_PER_MM = 96 / 25.4;

function param(name, fallback, lo, hi) {
  const v = Number.parseFloat(new URLSearchParams(location.search).get(name));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

const mm = param('mm', 4, 0.5, 50);
const pxmm = param('pxmm', CSS_PX_PER_MM, 0.5, 40);
const calibrated = new URLSearchParams(location.search).has('pxmm');

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
let squareDevicePx = 0;

// Squares are a whole number of device pixels so every edge is sharp; the
// rounding changes the size slightly, which does not matter for the method.
function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const s = Math.max(2, Math.round(mm * pxmm * dpr));
  squareDevicePx = s;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  for (let y = 0, row = 0; y < h; y += s, row++) {
    for (let x = (row % 2) * s; x < w; x += 2 * s) ctx.fillRect(x, y, s, s);
  }
  updateText(dpr);
}

// Print: an SVG pattern in true millimetres (user units are CSS px, 96 per inch).
function setPaperPattern() {
  const s = mm * CSS_PX_PER_MM;
  const pattern = document.getElementById('checks');
  pattern.setAttribute('width', String(2 * s));
  pattern.setAttribute('height', String(2 * s));
  const [a, b] = pattern.querySelectorAll('rect');
  for (const r of [a, b]) { r.setAttribute('width', String(s)); r.setAttribute('height', String(s)); }
  b.setAttribute('x', String(s));
  b.setAttribute('y', String(s));
}

function updateText(dpr) {
  const size = `${calibrated ? '' : '≈'}${mm} mm squares (${Math.round(squareDevicePx / dpr)} px)`;
  document.getElementById('meta').textContent = `${size}. Keep the screen square to the phone. Print this page for a paper target.`;
  document.getElementById('printLabel').textContent = `DivyaDrishti lensometry target · ${mm} mm squares · phone 40 cm from the paper, glasses halfway`;
}

const caption = document.getElementById('caption');
const toggleCaption = (show = caption.hidden) => { caption.hidden = !show; };
document.getElementById('hide').addEventListener('click', () => toggleCaption(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleCaption(false);
  else if (e.key === 'h' || e.key === 'H' || e.key === '?') toggleCaption();
});

// Full screen hides the browser bars; a wake lock stops the screen dimming
// halfway through a measurement. Both are optional.
const fsButton = document.getElementById('fullscreen');
if (document.fullscreenEnabled) {
  fsButton.hidden = false;
  fsButton.addEventListener('click', async () => {
    try { await document.documentElement.requestFullscreen(); } catch { /* not allowed here */ }
    try { await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
    toggleCaption(false);
  });
}

setPaperPattern();
document.documentElement.classList.add('has-canvas');
draw();
window.addEventListener('resize', draw);
