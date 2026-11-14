// Shop account: sign in on any phone or computer and work with the shop's
// cases, replies and settings. The password never leaves this device: PBKDF2
// (310k) stretches it and HKDF splits it into an auth key (sent; the server
// hashes it again) and a wrap key that encrypts the shop's data key. Synced
// records are encrypted with the data key, so the hub cannot read them.
// On a shared or camp computer the data key lives only in memory and the
// session token only for this browser tab; signing out erases what this app
// stored there.
import { b64, unb64, encryptJson, decryptJson, PBKDF2_ITERATIONS } from './crypto.js';
import { API } from './store.js';

const KEY = 'dd.account';
const enc = new TextEncoder();
const JSON_H = { 'Content-Type': 'application/json' };
let acct = (() => { try { return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
let dataKey = null;

function persist() {
  try {
    localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
    if (acct) (acct.shared ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(acct));
  } catch { /* private mode */ }
}
const cursorKey = () => `dd.syncSince.${acct?.shop?.id || ''}`;
const box = () => (acct?.shared ? sessionStorage : localStorage);

export const signedIn = () => Boolean(acct?.token);
export const info = () => acct;
export const hasKey = () => Boolean(dataKey);
export const headers = () => (acct?.token ? { 'X-Shop-Token': acct.token } : {});

export function deviceName() {
  const ua = navigator.userAgent;
  const kind = /Android/.test(ua) ? 'Android phone' : /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Windows/.test(ua) ? 'Windows computer' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux computer' : 'Browser';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${kind}, ${br}` : kind;
}

async function derive(password, saltB64, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations }, base, 256);
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdf = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) });
  const authKey = b64(await crypto.subtle.deriveBits(hkdf('dd-auth-v1'), hk, 256));
  const wrapKey = await crypto.subtle.deriveKey(hkdf('dd-wrap-v1'), hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { authKey, wrapKey };
}
// extractable only so the operator's own phone can keep it inside the PIN vault
const importRaw = (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

export async function signup({ login, password, shopName, shared = false }) {
  const kdfSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const { authKey, wrapKey } = await derive(password, kdfSalt, PBKDF2_ITERATIONS);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrappedKey = await encryptJson(wrapKey, { k: b64(raw) }, 'dd-datakey');
  const r = await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: JSON_H,
    body: JSON.stringify({ login, shopName, kdfSalt, iterations: PBKDF2_ITERATIONS, authKey, wrappedKey, device: deviceName(), shared }),
  });
  if (r.status === 409) throw new Error('exists');
  if (r.status === 422) throw new Error('invalid');
  if (!r.ok) throw new Error(`signup ${r.status}`);
  const j = await r.json();
  acct = { token: j.token, shop: j.shop, shared, expiresAt: j.expiresAt };
  persist();
  dataKey = await importRaw(raw);
  return acct;
}

export async function signin({ login, password, shared = false }) {
  const pr = await fetch(`${API}/auth/prelogin?login=${encodeURIComponent(login)}`);
  if (pr.status === 422) throw new Error('invalid');
  const pre = await pr.json();
  const { authKey, wrapKey } = await derive(password, pre.kdfSalt, pre.iterations);
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ login, authKey, device: deviceName(), shared }) });
  if (r.status === 401) throw new Error('bad');
  if (r.status === 429) throw new Error('locked');
  if (!r.ok) throw new Error(`login ${r.status}`);
  const j = await r.json();
  const { k } = await decryptJson(wrapKey, j.wrappedKey, 'dd-datakey');
  dataKey = await importRaw(unb64(k));
  acct = { token: j.token, shop: j.shop, shared, expiresAt: j.expiresAt };
  persist();
  return acct;
}

export const exportKey = async () => b64(await crypto.subtle.exportKey('raw', dataKey));
export async function useKey(rawB64) { dataKey = await importRaw(unb64(rawB64)); }

export async function signout() {
  if (acct?.token) { try { await fetch(`${API}/auth/logout`, { method: 'POST', headers: headers() }); } catch { /* offline */ } }
  try { box().removeItem(cursorKey()); } catch { /* ignore */ }
  acct = null; dataKey = null;
  persist();
}

// Is the session still valid? (false also when it expired or was revoked elsewhere)
export async function check() {
  if (!signedIn()) return false;
  try {
    const r = await fetch(`${API}/auth/me`, { headers: headers() });
    if (r.status === 401) { acct = null; dataKey = null; persist(); return false; }
  } catch { /* offline: keep */ }
  return signedIn();
}

export async function devices() {
  const r = await fetch(`${API}/auth/sessions`, { headers: headers() });
  return r.ok ? r.json() : [];
}
export async function revoke(id) {
  const r = await fetch(`${API}/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() });
  return r.ok;
}

// ---------------------------------------------------------------- encrypted sync
export async function push(kind, rid, obj) {
  if (!signedIn() || !dataKey) return false;
  const b = await encryptJson(dataKey, obj, `${kind}:${rid}`);
  try {
    const r = await fetch(`${API}/sync/${kind}/${encodeURIComponent(rid)}`, {
      method: 'PUT', headers: { ...JSON_H, ...headers() }, body: JSON.stringify({ box: b, updatedAt: new Date().toISOString() }),
    });
    if (r.status === 401) { acct = null; dataKey = null; persist(); }
    return r.ok;
  } catch { return false; }
}

// Records changed on the shop's other devices since the last pull.
export async function pull() {
  if (!signedIn() || !dataKey) return [];
  const since = box().getItem(cursorKey()) || '';
  let j;
  try {
    const r = await fetch(`${API}/sync?since=${encodeURIComponent(since)}`, { headers: headers() });
    if (r.status === 401) { acct = null; dataKey = null; persist(); return []; }
    if (!r.ok) return [];
    j = await r.json();
  } catch { return []; }
  const out = [];
  for (const rec of j.records) {
    try { out.push({ kind: rec.kind, rid: rec.rid, obj: await decryptJson(dataKey, rec.box, `${rec.kind}:${rec.rid}`) }); } catch { /* another key */ }
  }
  const last = j.records.length ? j.records[j.records.length - 1].updatedAt : since;
  if (last) box().setItem(cursorKey(), last);
  return out;
}
