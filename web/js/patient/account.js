// Signing in to My eyes: the patient's mobile number and a one-time code, or the
// demo patient. The record itself comes from the shops and optometrists on the
// network (server/patients.py); this phone keeps only the session token.
import { api } from './ui.js';

const KEY = 'dd.patient.session';
let cache = null; // { at, records }

// A demo session lasts for this tab only; a real sign-in stays on the phone.
// (An older build kept demo sessions for good: drop those.)
try { if (JSON.parse(localStorage.getItem(KEY) || 'null')?.demo) localStorage.removeItem(KEY); } catch { /* ignore */ }
function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export const session = () => read();
export const signedIn = () => Boolean(read()?.token);
const hdr = () => ({ 'X-Patient-Token': read()?.token || '' });

function keep(s) { (s.demo ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(s)); cache = null; }

export async function demo() {
  const r = await api('/patient/demo', { method: 'POST' });
  keep({ token: r.token, phone: r.phone, demo: true, name: r.name });
}
export const sendCode = (phone) => api('/patient/code', { method: 'POST', body: { phone } });
export async function login(phone, code) {
  const r = await api('/patient/login', { method: 'POST', body: { phone, code } });
  keep({ token: r.token, phone: r.phone, demo: false });
}
export async function logout() {
  const s = read();
  localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); cache = null;
  if (s?.token) { try { await api('/patient/logout', { method: 'POST', headers: { 'X-Patient-Token': s.token } }); } catch { /* offline */ } }
}

// The network record, cached for a minute so moving between tabs stays quick.
export async function records({ fresh = false } = {}) {
  if (!signedIn()) return [];
  if (!fresh && cache && Date.now() - cache.at < 60000) return cache.records;
  try {
    const r = await api('/patient/record', { headers: hdr() });
    cache = { at: Date.now(), records: r.records };
    return r.records;
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); cache = null; location.hash = 'signin'; }
    throw e;
  }
}
export const cached = () => cache?.records || [];
export async function remove(id) {
  await api(`/patient/record/${encodeURIComponent(id)}`, { method: 'DELETE', headers: hdr() });
  cache = null;
}
