// Encrypted, expiring share links for a patient's file (Vision Passport,
// referral letter, case summary), using only the browser's WebCrypto API
// (also in Node 20+, so it is unit-tested in tests/engine/share.test.mjs).
//
// The sender's browser encrypts the document with a fresh random 256-bit key
// (AES-256-GCM). Only ciphertext reaches the server. The key travels in the
// URL fragment, which browsers never send to a server:
//
//     https://<host>/share.html#<id>.<key>
//     id  = 16 random bytes, base64url (22 chars)
//     key = 32 random bytes, base64url (43 chars)
//
// Anyone holding the full link can read the document until it expires, runs
// out of views or is revoked; the server alone cannot.
//
// Optional PIN (4 to 6 digits), for links sent by SMS/WhatsApp with the PIN
// told in person: the content key is
//     HKDF-SHA-256(fragment key || PBKDF2-SHA-256(PIN, salt, iterations))
// so a wrong PIN fails AES-GCM authentication. The iteration count travels in
// the record so it can change later. The share id is the additional
// authenticated data: a ciphertext cannot be moved under another id.
//
// Document shapes the viewer (share.html) lays out well:
//   passport  { title?, text: 'line\nline' } or { title?, lines: [...] }
//   referral  { title?, to?, from?, date?, patient?, re?, sections: [
//               { heading, text? | lines? | items? | fields? } ], footer? }
//   case      any JSON object, shown as labelled fields
// Any of them may carry lang ('ta', 'hi', ...) so the page is tagged correctly.
import { b64, unb64, b64url, unb64url, PBKDF2_ITERATIONS } from './crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const SHARE_KINDS = ['passport', 'referral', 'case'];
export const MAX_SHARE_BYTES = 65536; // ciphertext limit, matches the server
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const PIN_RE = /^\d{4,6}$/;
const INFO = 'divyadrishti-share-v1';

export class ShareError extends Error {
  // code: bad_pin | pin_required | wrong_pin | damaged | bad_link | too_large | bad_kind
  //       | network | not_found | gone | forbidden | invalid | conflict | http
  // reason (code 'gone'): 'expired' | 'revoked' | 'no views left', as the server says
  constructor(code, message, { status, reason, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ShareError';
    this.code = code;
    if (status) this.status = status;
    if (reason) this.reason = reason;
  }
}

const hasPin = (pin) => pin !== undefined && pin !== null && pin !== '';

async function contentKey(rawKey, { pin, salt, iterations } = {}, usage) {
  let ikm = rawKey;
  if (hasPin(pin)) {
    const base = await subtle().importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const stretched = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
    ikm = new Uint8Array(rawKey.length + stretched.length);
    ikm.set(rawKey);
    ikm.set(stretched, rawKey.length);
  }
  const hk = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(hasPin(pin) ? `${INFO}+pin` : INFO) },
    hk, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

// Pure crypto, no network. Returns the id, the fragment key and the record the
// server stores ({ id, ciphertext, iv, salt, iterations }; salt and iterations
// are null without a PIN). `iterations` is overridable for tests only.
export async function encryptShare(doc, { pin, iterations = PBKDF2_ITERATIONS } = {}) {
  if (doc === undefined) throw new ShareError('invalid', 'nothing to share');
  if (hasPin(pin) && !PIN_RE.test(String(pin))) throw new ShareError('bad_pin', 'PIN must be 4 to 6 digits');
  const pt = enc.encode(JSON.stringify(doc));
  if (pt.length + 16 > MAX_SHARE_BYTES) throw new ShareError('too_large', 'document too large to share (64 KB limit)');
  const id = b64url(rand(16));
  const raw = rand(32);
  const salt = hasPin(pin) ? rand(16) : null;
  const key = await contentKey(raw, hasPin(pin) ? { pin: String(pin), salt, iterations } : {}, 'encrypt');
  const iv = rand(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, key, pt);
  return {
    id,
    key: b64url(raw),
    record: { id, ciphertext: b64(ct), iv: b64(iv), salt: salt ? b64(salt) : null, iterations: salt ? iterations : null },
  };
}

// Throws ShareError: pin_required, wrong_pin (PIN share), damaged (tampered,
// wrong key, or moved under another id), bad_link.
export async function decryptShare(record, key, { id = record?.id, pin } = {}) {
  if (!record || typeof record.ciphertext !== 'string' || typeof record.iv !== 'string') throw new ShareError('damaged', 'no document in this record');
  if (typeof id !== 'string' || !ID_RE.test(id) || typeof key !== 'string' || !KEY_RE.test(key)) throw new ShareError('bad_link', 'the link is incomplete');
  const pinned = Boolean(record.salt);
  if (pinned && !hasPin(pin)) throw new ShareError('pin_required', 'this document needs a PIN');
  if (pinned && !PIN_RE.test(String(pin))) throw new ShareError('bad_pin', 'PIN must be 4 to 6 digits');
  const its = record.iterations;
  if (pinned && !(Number.isInteger(its) && its >= 1000 && its <= 10_000_000)) throw new ShareError('damaged', 'unexpected key-derivation settings');
  let pt;
  try {
    const k = await contentKey(unb64url(key), pinned ? { pin: String(pin), salt: unb64(record.salt), iterations: its } : {}, 'decrypt');
    pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(record.iv), additionalData: enc.encode(id) }, k, unb64(record.ciphertext));
  } catch (e) {
    throw pinned
      ? new ShareError('wrong_pin', 'wrong PIN, or the link was changed', { cause: e })
      : new ShareError('damaged', 'the link is damaged or the document was changed', { cause: e });
  }
  return JSON.parse(dec.decode(pt));
}

// '#<id>.<key>', '<id>.<key>' or a full link -> { id, key } or null. Trailing
// punctuation that chat apps glue onto links ('.', ')', ...) is tolerated.
export function parseShareFragment(hash) {
  if (typeof hash !== 'string') return null;
  let s = hash.trim();
  const at = s.indexOf('#');
  if (at >= 0) s = s.slice(at + 1);
  try { s = decodeURIComponent(s); } catch { return null; }
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(s);
  return m ? { id: m[1], key: m[2] } : null;
}

export const shareUrl = (id, key, base) => `${String(base).split('#')[0]}#${id}.${key}`;

const defaultBase = () => new URL('../share.html', import.meta.url).href;
const defaultFetch = (...a) => globalThis.fetch(...a);
const STATUS_CODE = { 403: 'forbidden', 404: 'not_found', 409: 'conflict', 410: 'gone', 413: 'too_large', 422: 'invalid' };

async function call(fetchFn, url, init = {}) {
  let res;
  try {
    res = await fetchFn(url, { cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer', ...init });
  } catch (e) {
    throw new ShareError('network', 'could not reach the server', { cause: e });
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail; } catch { /* not JSON */ }
    detail = typeof detail === 'string' ? detail : '';
    throw new ShareError(STATUS_CODE[res.status] || 'http', detail || `HTTP ${res.status}`,
      { status: res.status, reason: res.status === 410 ? detail : undefined });
  }
  return res.json();
}

// Encrypts, uploads the ciphertext and returns the link. Keep deleteToken
// (with the id) if the sender may want to revoke the link later.
export async function createShareLink(doc, {
  pin, kind = 'case', expiresDays = 7, maxViews = 20, caseRef, actor, iterations,
  api = '/api', base = defaultBase(), fetch: fetchFn = defaultFetch,
} = {}) {
  if (!SHARE_KINDS.includes(kind)) throw new ShareError('bad_kind', `kind must be one of ${SHARE_KINDS.join(', ')}`);
  const { id, key, record } = await encryptShare(doc, { pin, iterations });
  const body = { ...record, kind, expiresDays, maxViews, ...(caseRef ? { caseRef } : {}) };
  const out = await call(fetchFn, `${api}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(actor ? { 'X-Actor': actor } : {}) },
    body: JSON.stringify(body),
  });
  return { url: shareUrl(id, key, base), id, expiresAt: out.expiresAt, maxViews: out.maxViews, deleteToken: out.deleteToken };
}

// One view is counted per successful fetch. Returns
// { ciphertext, iv, salt, iterations, kind, expiresAt, viewsLeft, pin }.
export async function fetchShare(id, { api = '/api', fetch: fetchFn = defaultFetch } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new ShareError('bad_link', 'the link is incomplete');
  return call(fetchFn, `${api}/shares/${id}`);
}

// Revokes the link and wipes its ciphertext on the server. Idempotent.
export async function revokeShare(id, deleteToken, { api = '/api', fetch: fetchFn = defaultFetch } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new ShareError('bad_link', 'not a share id');
  return call(fetchFn, `${api}/shares/${id}`, { method: 'DELETE', headers: { 'X-Delete-Token': String(deleteToken || '') } });
}
