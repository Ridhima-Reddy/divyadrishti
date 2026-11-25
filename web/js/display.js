// The shop's test screen: a laptop or TV shows the test charts full size. It is
// signed in as the shop (its account, or a demo shop), so the shop's own
// computer or phone (js/remote.js) finds it and drives it with no code. A small
// shop can open it as a second window on the same computer.
// For each patient it shows a QR code: the patient scans it with their own
// phone and answers there (answer.html). The code changes with every patient
// and stops working when that patient's tests end.
// Receives only chart instructions from the hub, never patient data.
import { qrSvg } from './qr.js';
import { landoltSvg } from './measure/contrast.js';
import { dialSvg, duochromeSvg, N_SIZES, nSizePx } from './measure/charts.js';
import { SERIES, generatePlate, plateSvg } from './measure/plates.js';
import { PACK_BY_CODE } from './lang/index.js';
import { optotypeMm, ID_CARD_MM } from './measure/geometry.js';
import { snellen } from './measure/acuity.js';
import * as account from './account.js';

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
let answerToken = null;

// the patient's answer code: large on the waiting screen, small in a corner during the tests
function showAnswer(tok, joined) {
  if (tok !== answerToken) {
    answerToken = tok;
    const url = tok ? new URL(`answer.html#${encodeURIComponent(tok)}`, location.href).href : '';
    $('#answerQr').innerHTML = tok ? (qrSvg(url, { cellSize: 5, label: 'answer on your phone' }) || '') : '';
    $('#stageQrCode').innerHTML = tok ? (qrSvg(url, { cellSize: 3, label: 'answer on your phone' }) || '') : '';
  }
  $('#answerBox').hidden = !tok;
  $('#stageQr').hidden = !tok;
  $('#answerState').textContent = joined ? 'Patient’s phone connected' : 'Waiting for the patient to scan';
  $('#answerState').className = `pill ${joined ? 'listening' : ''}`;
}

function show(view) {
  for (const v of ['pairView', 'idleView', 'calView']) $(`#${v}`).hidden = v !== view;
}

// Which shop this screen belongs to: the shop account signed in on this browser,
// or a demo shop (?shop=DDS-..., or the demo button).
const params = new URL(location.href).searchParams;
let shopMode = (() => { try { return JSON.parse(sessionStorage.getItem('dd.displayShop') || 'null'); } catch { return null; } })();
if (/^DDS-[A-Z0-9]{5}$/.test(params.get('shop') || '')) shopMode = { demo: params.get('shop') };
if (!shopMode && account.signedIn()) shopMode = { account: true };
const keepShop = () => { try { if (shopMode) sessionStorage.setItem('dd.displayShop', JSON.stringify(shopMode)); else sessionStorage.removeItem('dd.displayShop'); } catch { /* private mode */ } };
const shopHeaders = () => (shopMode?.account ? account.headers() : shopMode?.demo ? { 'X-Shop-Code': shopMode.demo } : {});
let shop = null;

async function create() {
  const r = await fetch(`${API}/display`, { method: 'POST', headers: shopHeaders() });
  if (r.status === 401) { shopMode = null; keepShop(); token = null; signedOut('Sign in again: the shop session ended.'); return false; }
  const j = await r.json();
  token = j.token;
  store.set('dd.displayToken', token);
  seq = 0;
  return true;
}

function signedOut(msg = '') {
  paired = false; shop = null;
  $('#stage').hidden = true;
  $('#dstate').textContent = 'Not signed in';
  $('#dstate').className = 'pill';
  $('#endBtn').hidden = true;
  $('#shopErr').textContent = msg;
  show('pairView');
}

function setPaired(p, s, phone) {
  const was = paired;
  paired = p;
  shop = s || shop;
  $('#dstate').textContent = shop ? shop.name : 'Signed in';
  $('#dstate').className = 'pill listening';
  $('#endBtn').hidden = false;
  $('#shopTitle').textContent = shop ? `${shop.name}: test screen` : 'Test screen';
  $('#phoneState').textContent = phone ? 'Shop device connected' : 'Waiting for the shop';
  $('#phoneState').className = `pill ${phone ? 'listening' : ''}`;
  if (p && !was) {
    navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {});
    if (lastCmd.chart === 'idle') idle();
  }
}

function idle() {
  $('#stage').hidden = true;
  $('#calState').innerHTML = calib.pxPerMm
    ? `Screen size set (${calib.pxPerMm.toFixed(2)} px per mm), so letters show at their true size.`
    : '<b>Screen size not set yet.</b> Until it is, letters can be 10 to 30% off their true size. Use <i>Screen size</i> at the top, once.';
  if ($('#calView').hidden) show(shopMode ? 'idleView' : 'pairView');
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
  if (shopMode) {
    try {
      if (!token && !(await create())) { setTimeout(poll, 450); return; }
      const r = await fetch(`${API}/display/state?since=${seq}`, { headers: { 'X-Display-Token': token } });
      if (r.status === 404) { token = null; store.set('dd.displayToken', null); }
      else if (r.ok) {
        const j = await r.json();
        if (!j.shop) { token = null; store.set('dd.displayToken', null); } // an old, unlinked screen: start again
        else {
          setPaired(true, j.shop, j.phoneConnected);
          showAnswer(j.answerToken, j.answerJoined);
          $('#noPatient').hidden = Boolean(j.answerToken);
          $('#demoBox').hidden = !shopMode?.demo || Boolean(j.answerToken) || Boolean(demo);
          if (j.cmd) { seq = j.seq; render(j.cmd); }
        }
      }
    } catch { $('#dstate').textContent = 'Offline: retrying'; }
  }
  setTimeout(poll, 450);
}

// ---------------------------------------------------------------- demo patient, run by this screen
// For a demo shop only: the screen takes its own remote and runs a short E-chart
// staircase. Answers come from a phone that scans the QR code, or the arrow keys.
let demo = null;
const DIRS = ['up', 'down', 'left', 'right'];
async function runDemo() {
  $('#demoRun').disabled = true;
  $('#demoOut').hidden = true;
  let ctl;
  try {
    const r = await fetch(`${API}/display/self`, { method: 'POST', headers: { 'X-Display-Token': token } });
    if (!r.ok) throw new Error(String(r.status));
    ctl = (await r.json()).controller;
  } catch { $('#demoRun').disabled = false; demoSay('Could not start the demo. Check the connection and try again.'); return; }
  const H = { 'Content-Type': 'application/json', 'X-Display-Controller': ctl };
  await fetch(`${API}/display/answers/session`, { method: 'POST', headers: H });
  demo = { level: 0.7, n: 0, trials: 0, since: 0, best: null, dir: 'right', timer: null };
  const show = () => {
    demo.dir = DIRS[Math.floor(Math.random() * 4)];
    demo.n += 1;
    return fetch(`${API}/display/cmd`, { method: 'POST', headers: H, body: JSON.stringify({ chart: 'acuity', optotype: 'E', level: demo.level, dir: demo.dir, distanceM: 3, eye: 'R', n: demo.n }) });
  };
  const finish = async () => {
    clearTimeout(demo.timer);
    removeEventListener('keydown', keys);
    const best = demo.best;
    demo = null;
    await fetch(`${API}/display/cmd`, { method: 'POST', headers: H, body: JSON.stringify({ chart: 'idle' }) }).catch(() => {});
    await fetch(`${API}/display/answers/session`, { method: 'DELETE', headers: H }).catch(() => {});
    $('#demoRun').disabled = false;
    demoSay(best == null ? 'Demo done. No line was read correctly; in a real test the shop would note this for the optometrist.'
      : `Demo done: the smallest line read correctly was ${snellen(best)} at 3 m. The QR code has stopped working. In a real test, the result goes to the shop and the optometrist.`);
  };
  const onAnswer = async (v) => {
    const right = v === demo.dir;
    if (right) demo.best = demo.best == null ? demo.level : Math.min(demo.best, demo.level);
    demo.level = Math.round(Math.min(1.3, Math.max(-0.3, demo.level + (right ? -0.1 : 0.1))) * 10) / 10;
    demo.trials += 1;
    if (demo.trials >= 10) { await finish(); return; }
    await show();
  };
  const poll = async () => {
    if (!demo) return;
    try {
      const r = await fetch(`${API}/display/answers?since=${demo.since}`, { headers: H });
      if (r.ok) {
        const j = await r.json();
        for (const a of j.answers || []) {
          demo.since = Math.max(demo.since, a.seq);
          if (demo) await onAnswer(a.value);
        }
      }
    } catch { /* offline: keep trying */ }
    if (demo) demo.timer = setTimeout(poll, 600);
  };
  // no phone at hand: the arrow keys answer as the patient would
  const keys = (e) => {
    const v = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (!v || !answerToken) return;
    e.preventDefault();
    fetch(`${API}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Answer-Token': answerToken }, body: JSON.stringify({ value: v }) }).catch(() => {});
  };
  addEventListener('keydown', keys);
  await show();
  poll();
}
function demoSay(msg) { $('#demoOut').textContent = msg; $('#demoOut').hidden = false; }
$('#demoRun').onclick = runDemo;

$('#demoShop').onclick = () => { shopMode = { demo: 'DDS-VEL01' }; keepShop(); token = null; store.set('dd.displayToken', null); idle(); };
$('#shopForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#shopErr').textContent = 'Signing in…';
  $('#shopGo').disabled = true;
  try {
    await account.signin({ login: $('#shopLogin').value.trim(), password: $('#shopPass').value, shared: true });
    shopMode = { account: true }; keepShop(); token = null; store.set('dd.displayToken', null);
    $('#shopErr').textContent = ''; idle();
  } catch (err) {
    $('#shopErr').textContent = err.message === 'bad' ? 'Wrong phone, email or password.' : err.message === 'locked' ? 'Too many wrong tries: wait 15 minutes.' : 'Could not sign in. Check the internet and try again.';
  }
  $('#shopGo').disabled = false;
};

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
$('#menuBtn').onclick = () => { $('#stage').hidden = true; show(shopMode ? 'idleView' : 'pairView'); };
$('#endBtn').onclick = async () => {
  try { await fetch(`${API}/display`, { method: 'DELETE', headers: { 'X-Display-Token': token } }); } catch { /* offline */ }
  token = null; store.set('dd.displayToken', null); lastCmd = { chart: 'idle' };
  if (shopMode?.account && account.info()?.shared) await account.signout().catch(() => {});
  shopMode = null; keepShop();
  signedOut();
};
addEventListener('resize', () => { if (!$('#stage').hidden && lastCmd.chart !== 'idle') render(lastCmd); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && paired && !wake) navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {}); });

idle();
poll();
