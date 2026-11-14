// Phone side of the chart screen. A laptop or TV opens display.html and shows
// a 6-digit code; the phone pairs with it and from then on drives the charts
// like the remote of a store's chart projector, while it records the answers.
// Only chart instructions travel (which chart, size, direction), never patient
// data. The pairing is remembered on this phone until it is removed.
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
export async function send(cmd) {
  if (!paired()) return false;
  const n = ++counter;
  document.body.dataset.remoteN = String(n);
  try {
    const r = await fetch(`${API}/display/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Display-Controller': state.controller },
      body: JSON.stringify({ ...cmd, n, mirror: options().mirror }),
    });
    if (r.status === 404) { drop(); return false; }
    return r.ok;
  } catch { return false; }
}

export async function unpair() {
  if (state?.controller) {
    try { await fetch(`${API}/display`, { method: 'DELETE', headers: { 'X-Display-Controller': state.controller } }); } catch { /* offline */ }
  }
  drop();
}
