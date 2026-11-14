// Viewer for encrypted share links (share.html#<id>.<key>). Standalone: it
// needs neither the PIN vault nor the rest of the field app. The key is read
// from the URL fragment, removed from the address bar at once, and kept only
// in memory. The document is decrypted here and shown as text (never as HTML).
import { parseShareFragment, fetchShare, decryptShare, ShareError } from './share.js';

const $ = (id) => document.getElementById(id);
const API = '/api';

const link = parseShareFragment(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
// Another link pasted into this tab changes only the fragment (no page load): start afresh.
window.addEventListener('hashchange', () => location.reload());

let record = null;

// ---------------------------------------------------------------- screens
function show(which) {
  for (const id of ['loading', 'pinCard', 'errorCard', 'status', 'doc', 'actions', 'keepNote']) $(id).hidden = !which.includes(id);
}

const ERRORS = {
  bad_link: ['This link is incomplete',
    'Part of the link is missing. Open the full link from the message you were sent: it is long and has a # in the middle. '
    + 'For your safety, the secret part is removed from the address bar once the page opens, so reloading the page does not work.'],
  not_found: ['Link not found', 'This link does not exist or has already been deleted. Ask the eye-care centre to send you a new one.'],
  expired: ['This link has expired', 'Links stop working after a few days to protect your privacy. Ask the eye-care centre to send you a new one.'],
  revoked: ['This link was cancelled', 'The person who shared it cancelled it. Ask them to send you a new one.'],
  used: ['This link has been used up', 'It has been opened as many times as allowed. Ask the eye-care centre to send you a new one.'],
  damaged: ['This link is damaged', 'The link may have been cut short when it was copied. Open the full link from the original message.'],
  network: ['Could not connect', 'Check the internet connection and try again.'],
};

function fail(kind) {
  const [title, text] = ERRORS[kind] || ERRORS.network;
  $('errTitle').textContent = title;
  $('errText').textContent = text;
  $('retryBtn').hidden = kind !== 'network';
  show(['errorCard']);
  $('errTitle').focus();
}

function errorKind(e) {
  if (!(e instanceof ShareError)) return 'network';
  if (e.code === 'gone') return e.reason === 'revoked' ? 'revoked' : e.reason === 'expired' ? 'expired' : 'used';
  if (['bad_link', 'not_found', 'damaged'].includes(e.code)) return e.code;
  return 'network';
}

// ---------------------------------------------------------------- flow
async function load() {
  if (!link) return fail('bad_link');
  show(['loading']);
  try {
    record = await fetchShare(link.id, { api: API });
  } catch (e) {
    return fail(errorKind(e));
  }
  if (record.pin) {
    show(['pinCard']);
    $('pin').focus();
    return;
  }
  await open();
}

async function open(pin) {
  try {
    const doc = await decryptShare(record, link.key, { id: link.id, pin });
    render(doc, record.kind);
    status(record);
    record = null; // the ciphertext is no longer needed
    show(['status', 'doc', 'actions', 'keepNote']);
    $('doc').focus({ preventScroll: true });
  } catch (e) {
    if (e instanceof ShareError && (e.code === 'wrong_pin' || e.code === 'bad_pin')) throw e;
    fail(errorKind(e));
  }
}

$('pinForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pin = $('pin').value.trim();
  const err = $('pinErr');
  if (!/^\d{4,6}$/.test(pin)) { err.textContent = 'The PIN is 4 to 6 digits.'; $('pin').focus(); return; }
  err.textContent = '';
  $('pinBtn').disabled = true;
  $('pinBtn').textContent = 'Checking…';
  try {
    await open(pin); // a wrong PIN is checked here, on this phone: it does not use up a view
    $('pin').value = '';
  } catch {
    err.textContent = 'That PIN did not work. Check the PIN you were told and try again.';
    $('pin').select();
  } finally {
    $('pinBtn').disabled = false;
    $('pinBtn').textContent = 'Open';
  }
});

$('retryBtn').addEventListener('click', load);
$('printBtn').addEventListener('click', () => window.print());

// ---------------------------------------------------------------- status line
function status(r) {
  const when = new Date(r.expiresAt);
  const date = Number.isNaN(when.getTime()) ? 'soon'
    : when.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const n = Number(r.viewsLeft) || 0;
  const views = n === 0 ? 'this was the last view: print it now if you need it' : `${n} view${n === 1 ? '' : 's'} left`;
  const el = $('status');
  el.textContent = `🔒 Encrypted end-to-end · expires ${date} · ${views}`;
  el.classList.toggle('last', n === 0);
}

// ---------------------------------------------------------------- document rendering (text only)
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

const isPrim = (v) => ['string', 'number', 'boolean'].includes(typeof v);
const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const asText = (v) => {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (isPrim(v)) return String(v);
  if (Array.isArray(v)) return v.filter(isPrim).map(asText).join(', ');
  if (v && typeof v === 'object') return Object.values(v).filter((x) => isPrim(x) && x !== '').map(asText).join(' · ');
  return '';
};
const humanize = (k) => {
  if (/\s/.test(k)) return String(k); // already a label, e.g. 'PD (mm)'
  const s = String(k).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const linesOf = (doc) => (typeof doc === 'string' ? doc.split(/\r?\n/)
  : Array.isArray(doc.lines) ? doc.lines.map(asText)
    : String(doc.text).split(/\r?\n/));

function layoutOf(doc, kind) {
  if (typeof doc === 'string') return 'passport';
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'fields';
  if (kind === 'passport' && (typeof doc.text === 'string' || Array.isArray(doc.lines))) return 'passport';
  if (kind === 'referral' && Array.isArray(doc.sections)) return 'referral';
  return 'fields';
}

function render(doc, kind) {
  const art = $('doc');
  art.replaceChildren();
  art.tabIndex = -1;
  art.removeAttribute('lang');
  if (doc && typeof doc.lang === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(doc.lang)) art.lang = doc.lang;
  const layout = layoutOf(doc, kind);
  if (layout === 'passport') renderPassport(art, doc);
  else if (layout === 'referral') renderReferral(art, doc);
  else renderFields(art, doc, kind);
}

function renderPassport(art, doc) {
  const lines = linesOf(doc);
  let title = typeof doc === 'object' && doc.title ? asText(doc.title) : '';
  if (!title) title = (lines.shift() || 'Vision Passport').trim();
  art.append(h('h1', { text: title }));
  for (const line of lines) art.append(line.trim() ? h('p', { class: 'line', text: line.trim() }) : h('div', { class: 'gap' }));
}

function renderReferral(art, doc) {
  art.append(h('p', { class: 'eyebrow', text: 'Referral letter' }), h('h1', { text: asText(doc.title) || 'Referral letter' }));
  const meta = [['To', doc.to], ['From', doc.from], ['Date', doc.date], ['Patient', doc.patient], ['Re', doc.re ?? doc.subject]]
    .filter(([, v]) => !blank(v) && asText(v));
  if (meta.length) art.append(h('dl', { class: 'meta' }, meta.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: asText(v) })])));
  for (const s of doc.sections) {
    if (!s || typeof s !== 'object') { if (isPrim(s)) art.append(h('p', { class: 'para', text: asText(s) })); continue; }
    const sec = h('section', {}, s.heading ? h('h2', { text: asText(s.heading) }) : null);
    if (typeof s.text === 'string') for (const para of s.text.split(/\n\s*\n/)) sec.append(h('p', { class: 'para', text: para.trim() }));
    if (Array.isArray(s.lines)) for (const l of s.lines) sec.append(h('p', { class: 'para', text: asText(l) }));
    if (Array.isArray(s.items)) sec.append(h('ul', {}, s.items.map((i) => h('li', { text: asText(i) }))));
    if (s.fields && typeof s.fields === 'object') sec.append(fieldList(s.fields, 1));
    art.append(sec);
  }
  const sign = doc.footer ?? doc.signature;
  if (!blank(sign)) art.append(h('p', { class: 'sign', text: asText(sign) }));
}

const KIND_TITLE = { passport: 'Vision Passport', referral: 'Referral letter', case: 'Shared case summary' };

function renderFields(art, doc, kind) {
  const title = (doc && typeof doc === 'object' && !Array.isArray(doc) && asText(doc.title)) || KIND_TITLE[kind] || 'Shared document';
  art.append(h('p', { class: 'eyebrow', text: 'Shared document' }), h('h1', { text: title }));
  if (doc && typeof doc === 'object') art.append(fieldList(doc, 0, ['title', 'lang']));
  else art.append(h('p', { class: 'line', text: asText(doc) }));
}

function fieldList(obj, depth, skip = []) {
  const dl = h('dl');
  const entries = Array.isArray(obj) ? obj.map((v, i) => [`${i + 1}`, v]) : Object.entries(obj);
  for (const [k, v] of entries) {
    if (skip.includes(k) || blank(v)) continue;
    let dd;
    if (isPrim(v)) dd = h('dd', { text: asText(v) });
    else if (Array.isArray(v) && v.every(isPrim)) dd = h('dd', {}, h('ul', {}, v.map((x) => h('li', { text: asText(x) }))));
    else if (typeof v === 'object' && depth < 4) dd = h('dd', {}, fieldList(v, depth + 1));
    else dd = h('dd', { text: asText(v) });
    dl.append(h('dt', { text: humanize(k) }), dd);
  }
  return dl;
}

load();
