// Phone side of the chart screen. A laptop or TV opens display.html and shows
// a 6-digit code; the shop phone pairs with it and from then on drives the
// charts like the remote of a store's chart projector.
// The patient answers from their own phone: for each patient the shop phone
// opens an answer session, the screen shows its QR code, and the patient scans
// it (answer.html, no app). Their answers arrive here as if tapped on this
// phone. The session ends when the tests are done, so the code stops working.
// Only chart instructions and answers travel, never patient data.
import { API } from './store.js';

const KEY = 'dd.screen';
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
const save = () => { try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
const drop = () => { state = null; save(); };

export const paired = () => Boolean(state?.controller);
export const options = () => ({ distanceM: state?.distanceM || 3, mirror: Boolean(state?.mirror) });
export function setOptions(o) { if (state) { Object.assign(state, o); save(); } }

export async function pair(code) {
  const r = await fetch(`${API}/display/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: String(code).trim() }) });
  if (!r.ok) return false;
  const { controller } = await r.json();
  state = { controller, distanceM: 3, mirror: false, pairedAt: new Date().toISOString() };
  save();
  return true;
}

// The shop's own chart screen: a screen opened with this shop's sign-in (or the
// same demo shop) is found by the shop, so no code is typed.
export async function connect(shopHeaders) {
  try {
    const r = await fetch(`${API}/display/connect`, { method: 'POST', headers: shopHeaders });
    if (!r.ok) return null;
    const { found, controller, shop } = await r.json();
    if (!found) return null;
    state = { controller, shop, distanceM: state?.distanceM || 3, mirror: Boolean(state?.mirror), pairedAt: new Date().toISOString() };
    save();
    return shop;
  } catch { return null; }
}
export const shopScreen = () => state?.shop || null;

// Is the screen still there? (The hub forgets pairings when it restarts.)
export async function check() {
  if (!paired()) return false;
  try {
    const r = await fetch(`${API}/display/ping`, { headers: { 'X-Display-Controller': state.controller } });
    if (r.status === 404) { drop(); return false; }
  } catch { /* offline: keep the pairing */ }
  return paired();
}

let counter = 0;
let lang = 'en';
let lastChart = 'idle';
export const setLang = (l) => { lang = l || 'en'; };
export const currentChart = () => lastChart;
export async function send(cmd) {
  if (!paired()) return false;
  const n = ++counter;
  lastChart = cmd.chart;
  document.body.dataset.remoteN = String(n);
  try {
    const r = await fetch(`${API}/display/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Display-Controller': state.controller },
      body: JSON.stringify({ lang, ...cmd, n, mirror: options().mirror }),
    });
    if (r.status === 404) { drop(); return false; }
    return r.ok;
  } catch { return false; }
}

export async function unpair() {
  await endAnswers();
  if (state?.controller) {
    try { await fetch(`${API}/display`, { method: 'DELETE', headers: { 'X-Display-Controller': state.controller } }); } catch { /* offline */ }
  }
  drop();
}

// ---------------------------------------------------------------- the patient's phone as the answer pad
// The session survives a reload of this page: which patient it is for, and how
// far the answers have been read (so none is applied twice).
const AKEY = 'dd.answer';
const kept = (() => { try { return JSON.parse(sessionStorage.getItem(AKEY) || 'null'); } catch { return null; } })();
let answer = { caseId: kept?.caseId || null, since: kept?.since || 0, joined: false, timer: null, onAnswer: null, onJoin: null };
const keep = () => { try { if (answer.caseId) sessionStorage.setItem(AKEY, JSON.stringify({ caseId: answer.caseId, since: answer.since })); else sessionStorage.removeItem(AKEY); } catch { /* private mode */ } };
export const answering = () => Boolean(answer.caseId);
export const patientJoined = () => answer.joined;

// One session per patient: a new patient gets a new code and the old one stops working.
export async function startAnswers(caseId, { onAnswer, onJoin } = {}) {
  if (!paired()) return false;
  answer.onAnswer = onAnswer; answer.onJoin = onJoin;
  if (answer.caseId === caseId) { loop(); return true; }
  try {
    const r = await fetch(`${API}/display/answers/session`, { method: 'POST', headers: { 'X-Display-Controller': state.controller } });
    if (!r.ok) return false;
  } catch { return false; }
  answer.caseId = caseId; answer.since = 0; answer.joined = false;
  keep();
  loop();
  return true;
}

export async function endAnswers() {
  clearTimeout(answer.timer);
  const had = Boolean(answer.caseId);
  answer = { caseId: null, since: 0, joined: false, timer: null, onAnswer: null, onJoin: null };
  keep();
  if (!paired() || !had) return;
  try { await fetch(`${API}/display/answers/session`, { method: 'DELETE', headers: { 'X-Display-Controller': state.controller } }); } catch { /* offline: it expires */ }
}

function loop() {
  clearTimeout(answer.timer);
  const tick = async () => {
    if (!answer.caseId || !paired()) return;
    try {
      const r = await fetch(`${API}/display/answers?since=${answer.since}`, { headers: { 'X-Display-Controller': state.controller } });
      if (r.ok) {
        const j = await r.json();
        if (!j.active) { answer.caseId = null; keep(); answer.onJoin?.(); return; } // ended elsewhere or expired
        if (j.joined && !answer.joined) { answer.joined = true; answer.onJoin?.(); }
        for (const a of j.answers || []) { answer.since = Math.max(answer.since, a.seq); keep(); answer.onAnswer?.(a); }
      }
    } catch { /* offline: try again */ }
    answer.timer = setTimeout(tick, 600);
  };
  tick();
}
