// Virtual try-on: frames drawn on the patient's photo at true size (scaled by
// the measured PD, or an average 63 mm), with the lens options shown the way
// they look in wear: clear with and without anti-reflection, blue-light
// filter, photochromic from indoors to outdoors, sun tints, and where a
// progressive or office lens keeps its sharp zones. The photo stays on this
// phone: it is drawn on a canvas and never saved or sent.
import { loadLandmarker, startCamera, stopCamera, track } from './measure/face.js';
import { ic } from './icons.js';

// Typical frame sizes in mm: lens width, lens height, bridge.
const FRAMES = {
  rect: { label: 'Rectangle', w: 53, h: 36, bridge: 18, rim: 2.4 },
  round: { label: 'Round', w: 47, h: 45, bridge: 20, rim: 1.6 },
  cateye: { label: 'Cat-eye', w: 52, h: 40, bridge: 17, rim: 2.6 },
  aviator: { label: 'Aviator', w: 56, h: 48, bridge: 16, rim: 1.2 },
  rimless: { label: 'Rimless', w: 52, h: 34, bridge: 18, rim: 0.5 },
  browline: { label: 'Browline', w: 52, h: 40, bridge: 19, rim: 0.9, brow: true },
  oval: { label: 'Oval', w: 50, h: 37, bridge: 19, rim: 1.4 },
  hexagon: { label: 'Hexagon', w: 51, h: 44, bridge: 19, rim: 1.3 },
  square: { label: 'Bold square', w: 54, h: 46, bridge: 18, rim: 3.2 },
};
// Frame finishes: solid acetate, patterned acetate, two-tone, crystal, metal.
const COLOURS = {
  black: { label: 'Black', c: '#16181d' },
  tortoise: { label: 'Tortoise', pattern: ['#4f260f', '#86461b', '#c98b3c'] },
  havana: { label: 'Light havana', pattern: ['#8b5a2b', '#bf8a4b', '#ecc993'] },
  navy: { label: 'Navy', c: '#22365f' },
  burgundy: { label: 'Burgundy', c: '#6b1f2e' },
  olive: { label: 'Olive', c: '#55603a' },
  twotone: { label: 'Black and crystal', two: ['#16181d', 'rgba(222,230,238,0.65)'] },
  crystal: { label: 'Crystal', c: 'rgba(225,232,240,0.85)' },
  pink: { label: 'Crystal pink', c: 'rgba(238,165,188,0.88)' },
  sky: { label: 'Crystal blue', c: 'rgba(138,178,230,0.88)' },
  gold: { label: 'Gold', metal: ['#8a6a1f', '#ecd27d', '#b08d2e'] },
  silver: { label: 'Silver', metal: ['#787e86', '#f0f3f6', '#a5abb2'] },
  rosegold: { label: 'Rose gold', metal: ['#985a4a', '#f2c6b4', '#c7836f'] },
  gunmetal: { label: 'Gunmetal', metal: ['#2a2e34', '#7d848d', '#454a51'] },
};
const swatchCss = (v) => (v.c || (v.metal ? `linear-gradient(135deg, ${v.metal.join(', ')})`
  : v.two ? `linear-gradient(180deg, ${v.two[0]} 50%, #dfe6ee 50%)`
    : `radial-gradient(circle at 30% 30%, ${v.pattern[2]} 0 16%, transparent 18%), radial-gradient(circle at 68% 62%, ${v.pattern[1]} 0 24%, transparent 26%), ${v.pattern[0]}`));
const solidOf = (v) => v.c || (v.metal ? v.metal[1] : v.two ? v.two[0] : v.pattern[1]);
const patterns = {};
function paintFor(g, key, F) {
  const v = COLOURS[key];
  if (v.c) return v.c;
  if (v.metal) { const gr = g.createLinearGradient(-F.w / 2, -F.h / 2, F.w / 2, F.h / 2); v.metal.forEach((c, i) => gr.addColorStop(i / 2, c)); return gr; }
  if (v.two) { const gr = g.createLinearGradient(0, -F.h / 2, 0, F.h / 2); gr.addColorStop(0, v.two[0]); gr.addColorStop(0.42, v.two[0]); gr.addColorStop(0.58, v.two[1]); gr.addColorStop(1, v.two[1]); return gr; }
  if (!patterns[key]) { // mottled acetate, same every time
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const x = c.getContext('2d'); x.fillStyle = v.pattern[0]; x.fillRect(0, 0, 48, 48);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 26; i++) { x.globalAlpha = 0.55 + rnd() * 0.4; x.fillStyle = v.pattern[1 + (i % 2)]; x.beginPath(); x.ellipse(rnd() * 48, rnd() * 48, 2 + rnd() * 6, 1.5 + rnd() * 4, rnd() * 3, 0, Math.PI * 2); x.fill(); }
    patterns[key] = c;
  }
  const pat = g.createPattern(patterns[key], 'repeat');
  pat.setTransform?.(new DOMMatrix().scale(0.25));
  return pat;
}
// Lenses by group, each with a preview colour for its chip.
const LENSES = {
  ar: { label: 'Clear, anti-reflective', group: 'Clear', dot: '#e9f2ff' },
  plain: { label: 'Clear, no coating', group: 'Clear', dot: '#ffffff' },
  blue: { label: 'Blue-light filter', group: 'Clear', dot: '#fff3c4' },
  photo: { label: 'Photochromic grey', group: 'Light-adaptive', dot: 'linear-gradient(135deg, #e9eef2, #4e5157)' },
  photob: { label: 'Photochromic brown', group: 'Light-adaptive', dot: 'linear-gradient(135deg, #f2e6da, #6b4426)' },
  grey: { label: 'Sun grey', group: 'Sun', dot: '#2e3036' },
  brown: { label: 'Sun brown', group: 'Sun', dot: '#5c3416' },
  green: { label: 'Sun green (G-15)', group: 'Sun', dot: '#2e3e2c' },
  grad: { label: 'Gradient grey', group: 'Sun', dot: 'linear-gradient(180deg, #2e3036, #e9eef2)' },
  gradb: { label: 'Gradient brown', group: 'Sun', dot: 'linear-gradient(180deg, #5c3416, #f2e6da)' },
  polar: { label: 'Polarised grey', group: 'Sun', dot: '#1e2024' },
  rose: { label: 'Rose tint', group: 'Tints and mirrors', dot: '#f0a7bb' },
  yellow: { label: 'Yellow, for contrast', group: 'Tints and mirrors', dot: '#f5d24a' },
  mblue: { label: 'Blue mirror', group: 'Tints and mirrors', dot: 'linear-gradient(135deg, #4f8cff, #a35bff)' },
  msilver: { label: 'Silver mirror', group: 'Tints and mirrors', dot: 'linear-gradient(135deg, #e6ebf0, #8c96a0)' },
  mgold: { label: 'Gold mirror', group: 'Tints and mirrors', dot: 'linear-gradient(135deg, #ffcf5a, #d4842c)' },
};

function roundRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
}
// One lens outline in mm, centred on 0,0, outer (temple) side towards +x.
function lensPath(g, shape, w, h) {
  g.beginPath();
  if (shape === 'round') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === 'rect' || shape === 'rimless') roundRect(g, -w / 2, -h / 2, w, h, shape === 'rect' ? 7 : 11);
  else if (shape === 'oval') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === 'square') roundRect(g, -w / 2, -h / 2, w, h, 5);
  else if (shape === 'browline') roundRect(g, -w / 2, -h / 2, w, h, 12);
  else if (shape === 'hexagon') { g.moveTo(-w / 2, 0); g.lineTo(-w / 4, -h / 2); g.lineTo(w / 4, -h / 2); g.lineTo(w / 2, 0); g.lineTo(w / 4, h / 2); g.lineTo(-w / 4, h / 2); }
  else if (shape === 'cateye') {
    g.moveTo(-w / 2, -h * 0.22);
    g.bezierCurveTo(-w * 0.3, -h * 0.55, w * 0.25, -h * 0.56, w / 2, -h * 0.64);
    g.bezierCurveTo(w * 0.56, -h * 0.1, w * 0.45, h * 0.46, w * 0.08, h / 2);
    g.bezierCurveTo(-w * 0.32, h * 0.55, -w / 2, h * 0.2, -w / 2, -h * 0.22);
  } else { // aviator: a teardrop that drops towards the nose
    g.moveTo(-w / 2, -h * 0.4);
    g.bezierCurveTo(-w * 0.2, -h * 0.56, w * 0.3, -h * 0.56, w / 2, -h * 0.38);
    g.bezierCurveTo(w * 0.56, h * 0.16, w * 0.2, h * 0.56, -w * 0.16, h / 2);
    g.bezierCurveTo(-w * 0.46, h * 0.45, -w * 0.56, h * 0.05, -w / 2, -h * 0.4);
  }
  g.closePath();
}

function fillLens(g, lens, outdoor, w, h) {
  const band = (x, alpha, colour = '255,255,255') => {
    g.fillStyle = `rgba(${colour},${alpha})`;
    g.beginPath(); g.moveTo(x, -h); g.lineTo(x + 7, -h); g.lineTo(x - 9, h); g.lineTo(x - 16, h); g.closePath(); g.fill();
  };
  const tint = (rgb, top, bottom) => {
    const gr = g.createLinearGradient(0, -h / 2, 0, h / 2);
    gr.addColorStop(0, `rgba(${rgb},${top})`); gr.addColorStop(1, `rgba(${rgb},${bottom})`);
    g.fillStyle = gr; g.fillRect(-w, -h, 2 * w, 2 * h);
  };
  if (lens === 'ar') { tint('215,235,255', 0.07, 0.04); g.strokeStyle = 'rgba(120,220,160,0.35)'; g.lineWidth = 0.7; g.beginPath(); g.arc(-w * 0.1, h * 0.1, w * 0.42, Math.PI * 1.1, Math.PI * 1.45); g.stroke(); }
  if (lens === 'plain') { tint('255,255,255', 0.1, 0.06); band(-w * 0.05, 0.38); band(w * 0.22, 0.2); }
  if (lens === 'blue') { tint('255,232,140', 0.13, 0.09); band(w * 0.05, 0.22, '110,140,255'); }
  if (lens === 'photo') tint('42,44,50', 0.08 + 0.74 * outdoor, 0.05 + 0.6 * outdoor);
  if (lens === 'grey') tint('34,35,40', 0.84, 0.62);
  if (lens === 'brown') tint('92,52,22', 0.8, 0.58);
  if (lens === 'photob') tint('92,58,30', 0.07 + 0.7 * outdoor, 0.05 + 0.56 * outdoor);
  if (lens === 'green') tint('40,62,42', 0.84, 0.64);
  if (lens === 'grad') tint('34,35,40', 0.88, 0.04);
  if (lens === 'gradb') tint('92,52,22', 0.84, 0.04);
  if (lens === 'polar') tint('28,30,34', 0.88, 0.76);
  if (lens === 'rose') tint('235,120,150', 0.24, 0.18);
  if (lens === 'yellow') tint('245,205,60', 0.32, 0.26);
  const mirror = { mblue: ['80,140,255', '170,90,255'], msilver: ['232,236,242', '150,160,172'], mgold: ['255,205,90', '220,140,40'] }[lens];
  if (mirror) {
    tint('24,26,32', 0.88, 0.76);
    const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    gr.addColorStop(0, `rgba(${mirror[0]},0.75)`); gr.addColorStop(1, `rgba(${mirror[1]},0.6)`);
    g.fillStyle = gr; g.fillRect(-w, -h, 2 * w, 2 * h);
    band(-w * 0.08, 0.3); band(w * 0.18, 0.16);
  }
}

// Sharp zones of the suggested design, nasal side towards -x.
function zonesOverlay(g, design, w, h) {
  const sharp = 'rgba(20,184,166,0.30)';
  const soft = 'rgba(120,128,140,0.30)';
  g.fillStyle = soft; g.fillRect(-w, -h, 2 * w, 2 * h);
  g.fillStyle = sharp;
  g.beginPath();
  if (design === 'progressive') {
    g.ellipse(0, -h * 0.28, w * 0.48, h * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-w * 0.05, -h * 0.05); g.lineTo(w * 0.03, -h * 0.05); g.lineTo(-w * 0.03, h * 0.22); g.lineTo(-w * 0.12, h * 0.22); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(-w * 0.08, h * 0.32, w * 0.15, h * 0.1, 0, 0, Math.PI * 2);
  } else if (design === 'office') {
    g.ellipse(0, -h * 0.12, w * 0.46, h * 0.28, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(-w * 0.04, h * 0.3, w * 0.3, h * 0.14, 0, 0, Math.PI * 2);
  } else {
    g.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
  }
  g.fill();
}

// A plain illustrated face for demos (no camera, or no real person to photograph).
function drawSampleFace(cv) {
  cv.width = 600; cv.height = 760;
  const g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 760); bg.addColorStop(0, '#dfe6f5'); bg.addColorStop(1, '#c9d3ea');
  g.fillStyle = bg; g.fillRect(0, 0, 600, 760);
  g.fillStyle = '#2f3d63'; g.beginPath(); g.ellipse(300, 760, 230, 130, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#b98563'; g.fillRect(255, 560, 90, 90);
  g.fillStyle = '#c99672'; g.beginPath(); g.ellipse(300, 400, 165, 205, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1d1a1a'; g.beginPath(); g.ellipse(300, 255, 180, 120, 0, Math.PI, 0); g.fill();
  g.beginPath(); g.ellipse(300, 248, 172, 70, 0, 0, Math.PI); g.fill();
  g.strokeStyle = '#2a211c'; g.lineWidth = 9; g.lineCap = 'round';
  for (const x of [230, 370]) {
    g.beginPath(); g.moveTo(x - 38, 322); g.quadraticCurveTo(x, 306, x + 38, 322); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 362, 30, 15, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3b2617'; g.beginPath(); g.arc(x, 362, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000'; g.beginPath(); g.arc(x, 362, 5, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = '#a8765a'; g.lineWidth = 5; g.beginPath(); g.moveTo(300, 380); g.lineTo(290, 460); g.lineTo(312, 466); g.stroke();
  g.strokeStyle = '#8c4a3c'; g.lineWidth = 7; g.beginPath(); g.moveTo(255, 515); g.quadraticCurveTo(300, 538, 345, 515); g.stroke();
  return [{ x: 230, y: 362 }, { x: 370, y: 362 }];
}

function frameThumb(shape) {
  const F = FRAMES[shape];
  const c = document.createElement('canvas'); c.width = 188; c.height = 80;
  const g = c.getContext('2d');
  const k = 160 / (2 * F.w + F.bridge + 4);
  g.translate(94, 40); g.scale(k, k);
  const cx = (F.w + F.bridge) / 2;
  for (const side of [-1, 1]) {
    g.save(); g.translate(side * cx, 0); g.scale(side, 1); lensPath(g, shape, F.w, F.h);
    g.lineWidth = Math.max(1.6, F.rim * 1.2); g.strokeStyle = shape === 'rimless' ? '#8a939b' : '#16181d'; g.stroke(); g.restore();
  }
  g.beginPath(); g.moveTo(-F.bridge / 2 - 1.5, -F.h * 0.2); g.quadraticCurveTo(0, -F.h * 0.34, F.bridge / 2 + 1.5, -F.h * 0.2); g.lineWidth = 1.8; g.strokeStyle = '#16181d'; g.stroke();
  return c.toDataURL('image/png');
}

const designOf = (title = '') => {
  const s = title.toLowerCase();
  if (s.includes('progressive')) return 'progressive';
  if (s.includes('office') || s.includes('near-variable') || s.includes('computer')) return 'office';
  if (s.includes('single vision') || s.includes('reading') || s.includes('distance')) return 'single';
  return null;
};
const DESIGN_LABEL = { progressive: 'progressive', office: 'office lens', single: 'single-vision' };

export async function tryOn(api, { back, recTitle = '' } = {}) {
  const pdMm = api.C?.measurements?.pd?.binocularMm || null;
  const design = designOf(recTitle);
  const st = { shape: 'rect', colour: 'black', lens: 'ar', outdoor: 0.6, zones: false, eyes: null, taps: [] };
  const chips = (obj, key, attr) => Object.entries(obj).map(([k, v]) => `<button class="chip ${st[key] === k ? 'on' : ''}" data-${attr}="${k}">${api.esc(typeof v === 'string' ? v : v.label)}</button>`).join('');
  const thumbs = Object.entries(FRAMES).map(([k, v]) => `<button class="fthumb ${st.shape === k ? 'on' : ''}" data-shape="${k}"><img alt="" src="${frameThumb(k)}"><span>${api.esc(v.label)}</span></button>`).join('');
  const pdLabel = `PD ${pdMm || 63}${pdMm ? '' : ' (average)'} mm`;
  api.setScreen(`<section class="card tryon">
      <h2>${api.t('tryOn')}</h2>
      <div class="tstage"><video id="tv" playsinline muted></video><canvas id="tc" hidden></canvas><div class="readout" id="th">…</div>
        <span class="tpill">${api.esc(pdLabel)}</span>
        <div class="tcards" id="tCards" hidden><div class="tcard"><small>${api.t('frames')}</small><b id="tFrameName"></b></div><div class="tcard"><small>${api.t('lensesLbl')}</small><b id="tLensName"></b></div></div></div>
      <div class="row gap wrap">
        <button class="btn primary" id="tShot">${ic('camera')} ${api.t('takePhoto')}</button>
        <button class="btn" id="tSample">${ic('user')} ${api.t('sampleFace')}</button>
        <button class="btn ghost" id="tRetake" hidden>${ic('refresh')} ${api.t('takePhoto')}</button>
      </div>
      <p class="small warn-text" id="tTap" hidden>${api.t('tapEyes')}</p>
      <div id="tCtl" class="tctl" hidden>
        <h3>${api.t('frames')}</h3><div class="frames" id="tShapes">${thumbs}</div>
        <div class="swatches" id="tColours">${Object.entries(COLOURS).map(([k, v]) => `<button class="swatch ${st.colour === k ? 'on' : ''}" data-colour="${k}" style="--sw:${swatchCss(v)}" aria-label="${api.esc(v.label)}" title="${api.esc(v.label)}"></button>`).join('')}</div>
        <p class="muted small" id="tColourName">${api.esc(COLOURS[st.colour].label)}</p>
        <h3>${api.t('lensesLbl')}</h3>
        ${[...new Set(Object.values(LENSES).map((v) => v.group))].map((grp) => `<div class="lgroup"><small>${api.esc(grp)}</small><div class="lensrow">${Object.entries(LENSES).filter(([, v]) => v.group === grp).map(([k, v]) => `<button class="chip ${st.lens === k ? 'on' : ''}" data-lens="${k}"><i class="ldot" style="--ld:${v.dot}"></i>${api.esc(v.label)}</button>`).join('')}</div></div>`).join('')}
        <label id="tOutWrap" hidden>${api.t('outdoor')} <input type="range" id="tOut" min="0" max="100" value="60"></label>
        ${design ? `<label class="check"><input type="checkbox" id="tZones"> Show where the suggested ${DESIGN_LABEL[design]} is sharp</label>
          <p class="muted small" id="tLegend" hidden><span class="key sharp"></span> sharp zone <span class="key soft"></span> soft edges you look past</p>` : ''}
      </div>
      <p class="muted small">Sizes use ${pdMm ? `the measured PD (${pdMm} mm)` : 'an average PD of 63 mm'}. The photo stays on this phone and is not saved.</p>
      <button class="btn ghost" id="tBack">${ic('left')} ${api.t('back')}</button>
    </section>`, 'tryon');

  const video = api.$('#tv'); const cv = api.$('#tc'); const hint = api.$('#th');
  const photo = document.createElement('canvas');
  let stream = null; let stopTrack = null; let last = null;
  const stopCam = () => { stopTrack?.(); stopTrack = null; stopCamera(stream); stream = null; };
  api.setCleanup(stopCam);

  const draw = () => {
    const g = cv.getContext('2d');
    cv.width = photo.width; cv.height = photo.height;
    g.drawImage(photo, 0, 0);
    if (!st.eyes) return;
    const [a, b] = [...st.eyes].sort((p, q) => p.x - q.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const k = Math.hypot(b.x - a.x, b.y - a.y) / (pdMm || 63); // px per mm
    const F = FRAMES[st.shape];
    const cx = (F.w + F.bridge) / 2;
    const finish = st.shape === 'rimless' ? 'crystal' : st.colour;
    const rimCol = solidOf(COLOURS[finish]);
    g.save(); g.translate(mid.x, mid.y); g.rotate(Math.atan2(b.y - a.y, b.x - a.x)); g.scale(k, k);
    for (const side of [-1, 1]) {
      g.save(); g.translate(side * cx, 3); g.scale(side, 1);
      lensPath(g, st.shape, F.w, F.h);
      g.save(); g.clip();
      fillLens(g, st.lens, st.outdoor, F.w, F.h);
      if (st.zones && design) zonesOverlay(g, design, F.w, F.h);
      g.restore();
      lensPath(g, st.shape, F.w, F.h);
      g.lineWidth = F.rim; g.strokeStyle = paintFor(g, finish, F); g.stroke();
      if (F.brow) { // browline: a heavy upper rim over a thin metal lower rim
        g.lineWidth = 3.6; g.lineCap = 'round'; g.strokeStyle = paintFor(g, st.colour === 'gold' || st.colour === 'silver' ? 'black' : st.colour, F);
        g.beginPath(); g.moveTo(-F.w / 2 + 1, -F.h * 0.2); g.quadraticCurveTo(-F.w * 0.1, -F.h * 0.62, F.w / 2 - 0.5, -F.h * 0.34); g.stroke();
      }
      if (st.shape === 'rimless') { g.fillStyle = '#9aa3ad'; for (const x of [-F.w / 2 + 2, F.w / 2 - 2]) { g.beginPath(); g.arc(x, -F.h * 0.22, 1, 0, Math.PI * 2); g.fill(); } }
      // end piece towards the temple
      g.lineWidth = Math.max(1.2, F.rim); g.strokeStyle = rimCol;
      g.beginPath(); g.moveTo(F.w / 2 - 1, -F.h * 0.3); g.lineTo(F.w / 2 + 7, -F.h * 0.34); g.stroke();
      g.restore();
    }
    g.lineWidth = Math.max(1.2, F.rim * 0.9); g.strokeStyle = rimCol;
    g.beginPath(); g.moveTo(-F.bridge / 2 - 1.5, -F.h * 0.2 + 3); g.quadraticCurveTo(0, -F.h * 0.34 + 3, F.bridge / 2 + 1.5, -F.h * 0.2 + 3); g.stroke();
    // face points and the PD as a measurement line
    const pdHalf = (pdMm || 63) / 2;
    const yDim = F.h / 2 + 13;
    g.fillStyle = 'rgba(255,255,255,.95)';
    for (const [px, py, r] of [[-pdHalf, 0, 1.3], [pdHalf, 0, 1.3], [0, 9, .9], [-cx, -F.h / 2 - 9, .9], [cx, -F.h / 2 - 9, .9], [-(cx + F.w / 2 + 9), 0, .9], [cx + F.w / 2 + 9, 0, .9], [-cx * .8, F.h / 2 + 6, .8], [cx * .8, F.h / 2 + 6, .8]]) {
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = .45; g.setLineDash([1.2, 1.2]);
    g.beginPath(); g.moveTo(-pdHalf, 1.5); g.lineTo(-pdHalf, yDim); g.moveTo(pdHalf, 1.5); g.lineTo(pdHalf, yDim); g.stroke();
    g.setLineDash([]); g.lineWidth = .6;
    g.beginPath(); g.moveTo(-pdHalf, yDim); g.lineTo(pdHalf, yDim); g.stroke();
    g.font = '600 4.2px "Instrument Sans", sans-serif'; g.textAlign = 'center';
    const lbl = `${pdMm || 63} mm`; const tw = g.measureText(lbl).width + 5;
    g.fillStyle = 'rgba(255,255,255,.88)'; g.beginPath(); g.roundRect?.(-tw / 2, yDim - 3.6, tw, 7.2, 3.6); g.fill();
    g.fillStyle = '#0b1433'; g.fillText(lbl, 0, yDim + 1.5);
    g.restore();
    api.$('#tFrameName').textContent = `${FRAMES[st.shape].label} · ${st.shape === 'rimless' ? 'rimless' : st.colour}`;
    api.$('#tLensName').textContent = ['photo', 'photob'].includes(st.lens) ? `${LENSES[st.lens].label} · ${Math.round(st.outdoor * 100)}% outdoors` : LENSES[st.lens].label;
    api.$('#tFrameName').textContent = `${FRAMES[st.shape].label} · ${st.shape === 'rimless' ? 'rimless' : COLOURS[st.colour].label.toLowerCase()}`;
  };

  const showPhoto = (eyes) => {
    stopCam();
    video.hidden = true; hint.hidden = true; cv.hidden = false;
    st.eyes = eyes; st.taps = [];
    api.$('#tTap').hidden = Boolean(eyes);
    api.$('#tCtl').hidden = false;
    api.$('#tCards').hidden = false;
    api.$('#tShot').hidden = true; api.$('#tRetake').hidden = false;
    draw();
  };

  const startCam = async () => {
    video.hidden = false; cv.hidden = true; hint.hidden = false; hint.textContent = '…';
    try {
      stream = await startCamera(video);
      hint.textContent = 'Look at the phone';
      loadLandmarker().then((lm) => { if (stream) stopTrack = track(video, lm, (f) => { last = f ? { ...f, at: performance.now() } : null; hint.textContent = f ? 'Face found: take the photo' : 'Looking for the face…'; }, (W) => W); })
        .catch(() => { hint.textContent = 'Face model unavailable: tap the eyes after the photo'; });
    } catch { hint.textContent = 'Camera unavailable: use the sample face'; }
  };

  api.$('#tShot').onclick = () => {
    if (!stream || !video.videoWidth) return;
    const W = video.videoWidth; const H = video.videoHeight;
    photo.width = W; photo.height = H;
    const g = photo.getContext('2d');
    g.translate(W, 0); g.scale(-1, 1); g.drawImage(video, 0, 0); // mirror, as the patient sees themself
    const fresh = last && performance.now() - last.at < 600;
    showPhoto(fresh ? [{ x: W - last.eyes.od.x, y: last.eyes.od.y }, { x: W - last.eyes.os.x, y: last.eyes.os.y }] : null);
  };
  api.$('#tSample').onclick = () => { const eyes = drawSampleFace(photo); showPhoto(eyes); };
  api.$('#tRetake').onclick = () => { api.$('#tShot').hidden = false; api.$('#tRetake').hidden = true; api.$('#tCtl').hidden = true; api.$('#tCards').hidden = true; startCam(); };
  cv.onclick = (e) => {
    if (st.eyes) return;
    const r = cv.getBoundingClientRect();
    st.taps.push({ x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height });
    if (st.taps.length === 2) { st.eyes = st.taps; api.$('#tTap').hidden = true; }
    draw();
  };
  const pick = (attr, key) => api.$$(`[data-${attr}]`).forEach((b) => {
    b.onclick = () => {
      st[key] = b.dataset[attr];
      api.$$(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
      if (key === 'lens') api.$('#tOutWrap').hidden = !['photo', 'photob'].includes(st.lens);
      if (key === 'colour') api.$('#tColourName').textContent = COLOURS[st.colour].label;
      draw();
    };
  });
  pick('shape', 'shape'); pick('colour', 'colour'); pick('lens', 'lens');
  api.$('#tOut').oninput = (e) => { st.outdoor = Number(e.target.value) / 100; draw(); };
  const z = api.$('#tZones');
  if (z) z.onchange = () => { st.zones = z.checked; api.$('#tLegend').hidden = !z.checked; draw(); };
  api.$('#tBack').onclick = () => { stopCam(); back(); };
  startCam();
}
