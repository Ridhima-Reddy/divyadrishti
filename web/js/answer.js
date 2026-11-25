// The patient's own phone as the answer pad for the shop's chart screen.
// Opened by scanning the QR on the screen (answer.html#<code>). It shows the
// answer buttons for whatever chart is on the screen right now and sends only
// the answer (a direction, a number, a choice). The code belongs to this
// patient's test session and stops working when the shop finishes the tests.
import { tr } from './i18n.js';
import { dialSvg, N_SIZES } from './measure/charts.js';
import { ic } from './icons.js';

const API = new URL(location.href).searchParams.get('api') || (() => { try { return localStorage.getItem('dd.api'); } catch { return null; } })() || '/api';
const token = decodeURIComponent(location.hash.slice(1));
const pad = document.getElementById('pad');
const conn = document.getElementById('conn');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ARROW = { up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M18 13l-6 6-6-6', left: 'M19 12H5M11 18l-6-6 6-6', right: 'M5 12h14M13 6l6 6-6 6' };
const arrow = (d) => `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ARROW[d]}"/></svg>`;

let lang = 'en';
let shownKey = '';
let typed = '';
let ended = false;
const t = (k) => tr(k, lang);
const eyeLine = (eye) => (eye === 'R' ? 'Right eye: cover your left eye with your palm.' : eye === 'L' ? 'Left eye: cover your right eye with your palm.' : '');

function view(chart, s) {
  const eye = eyeLine(s.eye);
  switch (chart) {
    case 'acuity':
    case 'contrast': {
      const ring = chart === 'contrast' || s.optotype === 'C';
      return `<h1>${ring ? 'Where is the gap in the ring?' : 'Which way do the fingers of the E point?'}</h1>
        ${eye ? `<p class="eye">${esc(eye)}</p>` : ''}
        <div class="cross">
          <button class="abtn" data-a="up" aria-label="up">${arrow('up')}</button>
          <button class="abtn" data-a="left" aria-label="left">${arrow('left')}</button>
          <button class="abtn" data-a="right" aria-label="right">${arrow('right')}</button>
          <button class="abtn" data-a="down" aria-label="down">${arrow('down')}</button>
        </div>
        <button class="btn big" data-a="cant">${esc(t('cantSee'))}</button>`;
    }
    case 'plate':
      return `<h1>Which number do you see in the dots?</h1>
        <output class="typed" id="typed" aria-live="polite">–</output>
        <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="kbtn" data-k="${n}">${n}</button>`).join('')}
          <button class="kbtn ghost" data-k="del" aria-label="delete">${ic('backspace', { size: 26 })}</button><button class="kbtn" data-k="0">0</button>
          <button class="kbtn ok" data-k="ok" id="okNum" disabled>${esc(t('done'))}</button></div>
        <button class="btn big" data-a="none">${esc(t('noNumber'))}</button>`;
    case 'duochrome':
      return `<h1>Are the black rings sharper on the red side, the green side, or the same?</h1>
        ${eye ? `<p class="eye">${esc(eye)}</p>` : ''}
        <div class="three"><button class="cbtn red" data-a="red">Red</button><button class="cbtn" data-a="equal">Same</button><button class="cbtn green" data-a="green">Green</button></div>`;
    case 'astigmatism':
      return `<h1>Do some lines look darker than the others? Tap the darkest line.</h1>
        ${eye ? `<p class="eye">${esc(eye)}</p>` : ''}
        <div class="dialwrap" id="dial">${dialSvg(Math.min(320, innerWidth - 48))}</div>
        <button class="btn big" data-a="even">${esc(t('allSame'))}</button>`;
    case 'amsler':
      return `<h1>Look at the centre dot. Are any lines wavy, broken or missing?</h1>
        ${eye ? `<p class="eye">${esc(eye)}</p>` : ''}
        <div class="two"><button class="cbtn" data-a="no">${esc(t('no'))}</button><button class="cbtn warn" data-a="yes">${esc(t('yes'))}</button></div>`;
    case 'near':
      return `<h1>What is the smallest line you can read on the screen?</h1>
        <p class="eye">Each line has its size at the start, for example N8.</p>
        <div class="nsizes">${N_SIZES.map((n) => `<button class="kbtn" data-a="N${n}">N${n}</button>`).join('')}</div>`;
    case 'lenso':
      return '<section class="wait"><h1>Nothing to answer for this one</h1><p>The shop is measuring your glasses. Keep this page open.</p></section>';
    default:
      return `<section class="wait"><span class="iris" aria-hidden="true"></span><h1>You are connected</h1>
        <p>Look at the screen. When a test starts, its answer buttons appear here.</p></section>`;
  }
}

async function send(value, btn) {
  if (ended) return;
  btn?.classList.add('sent');
  navigator.vibrate?.(12);
  try {
    const r = await fetch(`${API}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Answer-Token': token }, body: JSON.stringify({ value }) });
    if (r.status === 410) { end(); return; }
  } catch { conn.textContent = 'Offline: retrying'; }
  setTimeout(() => btn?.classList.remove('sent'), 450);
}

function wire() {
  pad.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => send(b.dataset.a, b); });
  pad.querySelectorAll('#dial [data-line]').forEach((g) => {
    g.style.cursor = 'pointer';
    g.onclick = () => { g.classList.add('picked'); send(`line${g.dataset.line}`, null); };
  });
  const out = pad.querySelector('#typed');
  const ok = pad.querySelector('#okNum');
  pad.querySelectorAll('[data-k]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      if (k === 'ok') { if (typed) { send(typed, b); typed = ''; } }
      else if (k === 'del') typed = typed.slice(0, -1);
      else if (typed.length < 2) typed += k;
      if (out) out.textContent = typed || '–';
      if (ok) ok.disabled = !typed;
    };
  });
}

function end() {
  ended = true;
  conn.textContent = 'Session ended';
  conn.className = 'pill';
  pad.innerHTML = `<section class="wait"><h1>Your tests are done</h1>
    <p>Thank you. This answer pad has stopped working; the shop has your results and will talk you through them.</p></section>`;
}

async function poll() {
  if (ended) return;
  try {
    const r = await fetch(`${API}/answer/state`, { headers: { 'X-Answer-Token': token } });
    if (r.status === 410 || r.status === 404) { end(); return; }
    if (r.ok) {
      const s = await r.json();
      if (!s.active) { end(); return; }
      conn.textContent = 'Connected'; conn.className = 'pill listening';
      if (s.lang && s.lang !== lang) { lang = s.lang; document.documentElement.lang = lang; shownKey = ''; }
      const key = `${s.chart}|${s.eye || ''}|${s.optotype || ''}|${s.index ?? ''}|${s.n ?? ''}`;
      if (key !== shownKey) {
        shownKey = key;
        typed = '';
        pad.innerHTML = view(s.chart, s);
        pad.dataset.chart = s.chart;
        wire();
      }
    }
  } catch { conn.textContent = 'Offline: retrying'; conn.className = 'pill'; }
  setTimeout(poll, 700);
}

if (!token) {
  pad.innerHTML = '<section class="wait"><h1>Scan the code on the shop’s screen</h1><p>The code appears on the shop’s test screen when your eye test starts.</p></section>';
  conn.hidden = true;
} else {
  history.replaceState(null, '', location.pathname); // keep the code out of the address bar and history
  poll();
}
