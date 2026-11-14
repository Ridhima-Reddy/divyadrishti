// Chart screen: a laptop or TV in the store shows the test charts full size;
// the shop phone (js/remote.js) drives it like a chart projector's remote.
// Receives only chart instructions from the hub, never patient data.
import { qrSvg } from './qr.js';
import { landoltSvg } from './measure/contrast.js';
import { dialSvg, duochromeSvg, N_SIZES, nSizePx } from './measure/charts.js';
import { SERIES, generatePlate, plateSvg } from './measure/plates.js';
import { PACK_BY_CODE } from './lang/index.js';
import { optotypeMm, ID_CARD_MM } from './measure/geometry.js';
import { snellen } from './measure/acuity.js';

const API = new URL(location.href).searchParams.get('api') || localStorage.getItem('dd.api') || '/api';
const $ = (s) => document.querySelector(s);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const calib = (() => { try { return JSON.parse(store.get('dd.displayCalib') || '{}'); } catch { return {}; } })();
const pxPerMm = () => calib.pxPerMm || 96 / 25.4;
const ROT = { right: 0, down: 90, left: 180, up: 270 };
const eSvg = (dir, s) => `<svg class="optotype" width="${s}" height="${s}" viewBox="0 0 5 5" style="transform:rotate(${ROT[dir] || 0}deg)" aria-label="E"><path d="M0 0H5V1H1V2H5V3H1V4H5V5H0Z" fill="#000"/></svg>`;

let token = store.get('dd.displayToken');
let seq = 0;
let paired = false;
let lastCmd = { chart: 'idle' };
let wake = null;

function show(view) {
  for (const v of ['pairView', 'idleView', 'calView']) $(`#${v}`).hidden = v !== view;
}

async function create() {
  const r = await fetch(`${API}/display`, { method: 'POST' });
  const j = await r.json();
  token = j.token;
  store.set('dd.displayToken', token);
  seq = 0;
  showCode(j.code, j.expiresInSec);
}

function showCode(code, secs) {
  $('#pairCode').textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  const link = new URL(`./?pair=${code}`, location.href).href;
  $('#pairQr').innerHTML = qrSvg(link, { cellSize: 4, label: 'pair this screen' }) || '';
  if (secs) $('#pairExp').textContent = `The code works for ${Math.round(secs / 60)} minutes; a new one appears after that.`;
}

function setPaired(p, code) {
  const was = paired;
  paired = p;
  $('#dstate').textContent = p ? 'Paired' : 'Not paired';
  $('#dstate').className = `pill ${p ? 'listening' : ''}`;
  $('#endBtn').hidden = !p;
  if (!p && code && $('#pairCode').textContent.replace(' ', '') !== code) showCode(code);
  if (p && !was) {
    navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {});
    if (lastCmd.chart === 'idle') idle();
  }
  if (!p && was) { $('#stage').hidden = true; show('pairView'); }
  if (!p && !was && $('#calView').hidden) show('pairView');
}

function idle() {
  $('#stage').hidden = true;
  $('#calState').innerHTML = calib.pxPerMm
    ? `Screen size set (${calib.pxPerMm.toFixed(2)} px per mm). Letters are shown at their true size.`
    : '<b>Screen size not set.</b> Letter sizes may be off by 10 to 30%. Use <i>Screen size</i> above once.';
  if ($('#calView').hidden) show(paired ? 'idleView' : 'pairView');
}

function stage(html, label, { mirrorable = true } = {}) {
  $('#chart').innerHTML = html;
  $('#chart').className = `chart ${mirrorable ? 'mirrorable' : ''}`;
  $('#stageLbl').textContent = label;
  $('#stage').hidden = false;
}

const EN_LINES = ['the farmer sold rice at the market', 'my son reads the paper each morning', 'take two tablets after food', 'the bus leaves at nine', 'please sign here', 'rain is good for crops', 'thread the needle', 'call me tomorrow'];
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function nearChart(lang = 'en') {
  const lines = lang === 'en' ? EN_LINES : (PACK_BY_CODE[lang]?.nearText || EN_LINES);
  return `<ol class="nchart" lang="${escHtml(lang)}">${N_SIZES.map((n, i) => `<li><div class="nline" style="font-size:${nSizePx(n, pxPerMm()).toFixed(1)}px"><span class="nlabel">N${n}</span>${escHtml(lines[i % lines.length])}</div></li>`).join('')}</ol>`;
}

function render(cmd) {
  lastCmd = cmd;
  $('#chart').dataset.n = cmd.n ?? '';
  $('#stage').classList.toggle('mirror', Boolean(cmd.mirror));
  const eye = cmd.eye === 'L' ? 'Left eye' : cmd.eye === 'R' ? 'Right eye' : '';
  const dist = cmd.distanceM ? `${cmd.distanceM} m` : '';
  const fit = Math.round(Math.min(innerWidth * 0.8, innerHeight * 0.78));
  const lbl = (...xs) => xs.filter(Boolean).join(' · ');
  switch (cmd.chart) {
    case 'acuity': {
      const px = Math.max(6, Math.round(optotypeMm(cmd.level ?? 0.6, (cmd.distanceM || 3) * 1000) * pxPerMm()));
      stage(cmd.optotype === 'C' ? landoltSvg(cmd.dir || 'right', px) : eSvg(cmd.dir || 'right', px), lbl(snellen(cmd.level), dist, cmd.mirror && 'mirror', eye));
      break;
    }
    case 'contrast': stage(landoltSvg(cmd.dir || 'right', Math.round(50 * pxPerMm()), cmd.grey ?? 0), lbl('Contrast', '1 m', eye), { mirrorable: false }); break;
    case 'plate': stage(plateSvg(generatePlate(SERIES[cmd.index ?? 0]), Math.round(Math.min(fit, 120 * pxPerMm()))), cmd.index ? `Plate ${cmd.index} of ${SERIES.length - 1}` : 'Demonstration plate', { mirrorable: false }); break;
    case 'near': stage(nearChart(cmd.lang), 'Near chart · 40 cm', { mirrorable: false }); break;
    case 'duochrome': stage(duochromeSvg(fit), lbl('Duochrome', dist, cmd.mirror && 'mirror', eye)); break;
    case 'astigmatism': stage(dialSvg(fit), lbl('Astigmatism dial', dist, cmd.mirror && 'mirror', eye)); break;
    case 'amsler': {
      const cell = 5 * pxPerMm();
      stage(`<div class="amsler" style="--cell:${cell}px;--n:20"><i></i></div><p class="note">Sit 30 cm from the screen with reading glasses on. Cover one eye and look at the centre dot.</p>`,
        lbl('Amsler grid, 10 cm', eye), { mirrorable: false });
      break;
    }
    case 'lenso': {
      stage('<canvas id="board" aria-label="lens pattern"></canvas>', 'Lens pattern · 4 mm squares', { mirrorable: false });
      drawBoard();
      break;
    }
    default: idle();
  }
}

function drawBoard() {
  const c = $('#board'); if (!c) return;
  const dpr = devicePixelRatio || 1;
  c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr);
  const g = c.getContext('2d');
  const s = Math.max(2, Math.round(4 * pxPerMm() * dpr));
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
  for (let y = 0, row = 0; y < c.height; y += s, row++) for (let x = (row % 2) * s; x < c.width; x += 2 * s) g.fillRect(x, y, s, s);
}

async function poll() {
  try {
    if (!token) await create();
    const r = await fetch(`${API}/display/state?since=${seq}`, { headers: { 'X-Display-Token': token } });
    if (r.status === 404) { token = null; store.set('dd.displayToken', null); await create(); }
    else if (r.ok) {
      const j = await r.json();
      setPaired(j.paired, j.code);
      if (j.cmd) { seq = j.seq; render(j.cmd); }
    }
  } catch { $('#dstate').textContent = 'Offline: retrying'; }
  setTimeout(poll, 450);
}

// screen size calibration with an ID card (85.6 mm)
$('#calBtn').onclick = () => {
  $('#stage').hidden = true;
  const r = $('#cardRange');
  r.value = Math.round(pxPerMm() * ID_CARD_MM);
  const upd = () => { $('#cardBox').style.width = `${r.value}px`; };
  r.oninput = upd; upd();
  show('calView');
};
$('#calSave').onclick = () => {
  calib.pxPerMm = Number($('#cardRange').value) / ID_CARD_MM;
  store.set('dd.displayCalib', JSON.stringify(calib));
  $('#calView').hidden = true;
  if (lastCmd.chart !== 'idle') render(lastCmd); else idle();
};
$('#calCancel').onclick = () => { $('#calView').hidden = true; if (lastCmd.chart !== 'idle') render(lastCmd); else idle(); };
$('#fsBtn').onclick = () => document.documentElement.requestFullscreen?.().catch(() => {});
$('#menuBtn').onclick = () => { $('#stage').hidden = true; show(paired ? 'idleView' : 'pairView'); };
$('#endBtn').onclick = async () => {
  try { await fetch(`${API}/display`, { method: 'DELETE', headers: { 'X-Display-Token': token } }); } catch { /* offline */ }
  token = null; store.set('dd.displayToken', null); paired = false; lastCmd = { chart: 'idle' };
  setPaired(false); await create(); show('pairView');
};
addEventListener('resize', () => { if (!$('#stage').hidden && lastCmd.chart !== 'idle') render(lastCmd); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && paired && !wake) navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {}); });

idle();
poll();
