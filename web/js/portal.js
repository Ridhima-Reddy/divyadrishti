// Remote Optometrist Bridge: sign-in, review queue, case detail, decision, reply,
// calendar, linked shops, camp planning and referral rules.
// Patient identity arrives sealed to this hub's key and is opened only here,
// in the optometrist's browser; the server never sees names or phone numbers.
import { profileHtml, esc, rulesTableHtml, urgencyLine, TEST_NAME } from './profile_view.js';
import { TIERS, TIER_ORDER, RULE_BY_CODE, effectiveRule, setRuleOverrides, ruleOverrides } from './engine/redflags.js';
import { openCall, createCall } from './call.js';
import { barChart, donut, hbars, lastDays, indiaMap, pinToState } from './charts_ui.js';
import { ic } from './icons.js';
import { snellen } from './measure/acuity.js';
import { LANGS } from './i18n.js';
import { passportText, shortCode, whatsappLink, smsLink } from './passport.js';
import { QUESTION_BY_ID } from './engine/questions.js';
import { PACKS } from './lang/index.js';
import { generateHubKeyPair, exportJwk, importHubPrivateKey, openFromHub, jwkThumbprint } from './crypto.js';

const PARAMS = new URLSearchParams(location.search);
const API = PARAMS.get('api') || '/api';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const sget = (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
const sset = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const sdel = (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Deployed servers require a portal token. Open portal.html#token=XXXX once:
// the fragment never reaches the server or its logs, and is removed at once.
const frag = new URLSearchParams(location.hash.slice(1));
if (frag.get('token')) { save('dd.portalToken', frag.get('token')); history.replaceState(null, '', location.pathname + location.search); }
const portalToken = load('dd.portalToken', null);

// ---------------------------------------------------------------- clinician session
// The clinician signs in (or opens the demo) for this browser tab only:
// sessionStorage 'dd.clin' = { token, demo }. Reviews and rule edits are signed
// as that clinician; the server refuses sign-off until the registration is verified.
let session = sget('dd.clin');
if (!session?.token) session = null;
let clin = null; // the signed-in clinician, as the server returns it to them
let links = []; // shop links from /clin/me
let scope = { scope: 'all', shops: [] };
const me = { name: '', regNo: '' }; // reviewer on cases, letters and rule edits
let timers = [];
let entered = false;

const ROLE = { optometrist: 'Optometrist', ophthalmologist: 'Ophthalmologist' };
const KIND = { store: 'Optical shop', camp: 'Eye camp', vision_centre: 'Vision centre' };
const KIND_ICON = { store: 'glasses', camp: 'users', vision_centre: 'eye' };
const STATUS = { verified: 'Verified', pending: 'Being verified by the network admin', rejected: 'Not verified' };
const COUNCILS = {
  optometrist: ['Indian Optometric Association (IOA)', 'Optometry Council of India (OCI)', 'State allied health council'],
  ophthalmologist: ['National Medical Commission (NMC)', 'State Medical Council'],
};
const QUALS = {
  optometrist: ['B.Optom', 'M.Optom', 'Diploma in Optometry', 'PhD (Optometry)'],
  ophthalmologist: ['MS (Ophthalmology)', 'MD (Ophthalmology)', 'DNB (Ophthalmology)', 'DO'],
};

// Header values must be Latin-1: keep the actor readable but safe.
const latin1 = (s) => String(s || '').replace(/[^\x20-\x7e -ÿ]/g, '').replace(/\s+/g, ' ').trim();
const actorName = () => `${latin1(me.name) || 'clinician'}${clin ? ` (${clin.code})` : ''}`;
const headers = (extra = {}) => ({
  'X-Actor': `portal:${actorName()}`,
  ...(portalToken ? { 'X-Portal-Token': portalToken } : {}),
  ...(session?.token ? { 'X-Clin-Token': session.token } : {}),
  ...extra,
});
const activeLinks = () => links.filter((l) => l.status === 'active');
const shopName = (code) => links.find((l) => l.shopCode === code)?.shopName || code;

async function errOf(r) {
  let d = null;
  try { d = (await r.json()).detail; } catch { /* not JSON */ }
  const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : '';
  return Object.assign(new Error(msg || `HTTP ${r.status}`), { status: r.status, detail: msg });
}
// Calls that need the clinician session. A 401 means the session ended.
async function capi(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(`${API}${path}`, { method, headers: headers(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch { throw Object.assign(new Error('offline'), { status: 0 }); }
  if (r.status === 401 && session) { sessionEnded(); throw Object.assign(new Error('expired'), { status: 401 }); }
  if (!r.ok) throw await errOf(r);
  return r.json();
}

let laneFilter = '';
let selected = PARAMS.get('case');
let rows = [];
const names = {}; // case id -> name opened in this browser (for the overview board)

const LENS = {
  readers: 'Reading glasses', office: 'Office / near-variable lens', progressive: 'Progressive', bifocal: 'Bifocal',
  sv_distance: 'Single vision, distance', separate_pairs: 'Separate distance + reading pairs', child_refraction: 'Child: cycloplegic refraction',
  no_change: 'No change', urgent_referral: 'No glasses: urgent referral',
};
const DECISION = { approve: 'Approve', modify: 'Approve with changes', in_person: 'In-person examination', urgent: 'Urgent referral', other: 'Other: write your own' };
const REPLY = {
  approve: { en: 'Your glasses are approved. Please collect them at {site}.' },
  modify: { en: 'Your glasses are approved with a small change. Please visit {site}.' },
  in_person: { en: 'Please come for a full eye examination at {place}.' },
  urgent: { en: 'Please go to {place} today. This cannot wait.' },
  other: { en: 'The optometrist has looked at your eye check. Please ask at {site} for the details.' },
};
const PLACES = {
  in_person: { en: 'the next eye camp or the vision centre' },
  urgent: { en: 'the partner eye hospital' },
};
for (const p of PACKS) {
  for (const k of Object.keys(REPLY)) REPLY[k][p.code] = p.reply[k];
  for (const k of Object.keys(PLACES)) PLACES[k][p.code] = p.places[k];
}

// ---------------------------------------------------------------- hub keys
// The hub's private key lives only in this browser (IndexedDB, non-extractable).
// A recovery file is downloaded once at setup, to restore it on another device.
const HUB_DB = 'divyadrishti-hub';
function hubDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HUB_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function hubGet() {
  const d = await hubDb();
  return new Promise((resolve) => { const r = d.transaction('keys').objectStore('keys').get('hub'); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
}
async function hubPut(v) {
  const d = await hubDb();
  return new Promise((resolve, reject) => { const t = d.transaction('keys', 'readwrite'); t.objectStore('keys').put(v, 'hub'); t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}
let hub = null; // { kid, key: CryptoKey (private, non-extractable) }
let serverKid = null;
const identities = new Map();

async function loadHub() {
  hub = await hubGet();
  try { const r = await fetch(`${API}/hub/key`, { headers: headers() }); serverKid = r.ok ? (await r.json()).kid : null; } catch { serverKid = null; }
  renderHubBanner();
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function setupHub() {
  const pair = await generateHubKeyPair();
  const pub = await exportJwk(pair.publicKey);
  const priv = await exportJwk(pair.privateKey);
  const kid = await jwkThumbprint(pub);
  const r = await fetch(`${API}/hub/key${serverKid ? '?replace=true' : ''}`, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ jwk: pub }) });
  if (!r.ok) { alert(`Could not register the hub key (${r.status})`); return; }
  download(`divyadrishti-hub-recovery-${kid.slice(0, 8)}.json`, JSON.stringify({ kid, jwk: priv, note: 'DivyaDrishti hub private key. Keep offline; anyone with this file can read patient identities.' }));
  await hubPut({ kid, key: await importHubPrivateKey(priv) });
  identities.clear();
  await loadHub(); await refreshList(); if (selected) showCase(selected);
}

async function importRecovery(file) {
  try {
    const { kid, jwk } = JSON.parse(await file.text());
    await hubPut({ kid, key: await importHubPrivateKey(jwk) });
    identities.clear();
    await loadHub(); await refreshList(); if (selected) showCase(selected);
  } catch { alert('That is not a valid hub recovery file.'); }
}

function renderHubBanner() {
  const el = $('#hubBanner'); if (!el) return;
  if (hub && serverKid === hub.kid) { el.innerHTML = `${ic('shield', { size: 16 })} Identity encryption on · hub key ${esc(hub.kid.slice(0, 10))}…`; el.className = 'hubok'; return; }
  el.className = 'hubwarn';
  el.innerHTML = `${!serverKid ? 'No hub key yet: field phones keep names and phones to themselves.' : 'This browser cannot open sealed identities.'}
    <button class="btn" id="hubSetup">${serverKid ? 'Replace hub key' : 'Set up identity encryption'}</button>
    <label class="btn ghost">Import recovery file<input type="file" id="hubImport" accept="application/json" hidden></label>`;
  $('#hubSetup').onclick = setupHub;
  $('#hubImport').onchange = (e) => e.target.files[0] && importRecovery(e.target.files[0]);
}

// Who is this patient? Demo cases carry synthetic names; real ones are sealed.
async function identityOf(id, p = {}) {
  if (p.name) return { name: p.name, phone: p.phone, village: p.village, how: 'demo (synthetic, unencrypted)' };
  if (!p.sealed) return { name: null, how: 'kept on the field phone' };
  if (identities.has(id)) return identities.get(id);
  let out = { name: null, how: 'sealed: this browser has no matching hub key' };
  if (hub && p.sealed.kid === hub.kid) {
    try { out = { ...(await openFromHub(p.sealed, hub.key, id)), how: 'sealed to this hub, opened here' }; } catch { out = { name: null, how: 'sealed: could not be opened' }; }
  }
  identities.set(id, out);
  return out;
}

// ---------------------------------------------------------------- durations
// 24 hours or more reads in days: "due in 2 d 22 h", "received 3 days ago".
function span(mins) {
  const m = Math.abs(Math.round(mins));
  if (m < 60) return `${m} min`;
  if (m < 1440) { const h = Math.floor(m / 60); const r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}
function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${plural(Math.floor(m / 1440), 'day')} ago`;
}
function slaText(r) {
  if (r.status === 'reviewed') return { cls: 'done', txt: esc(r.review?.decisionLabel || 'reviewed') };
  const m = Math.round((new Date(r.slaDueAt).getTime() - Date.now()) / 60000);
  return m < 0 ? { cls: 'over', txt: `overdue ${span(m)}` } : { cls: '', txt: `due in ${span(m)}` };
}

// ---------------------------------------------------------------- review queue
let pfilter = 'all';
const LANE_ORDER = { red: 0, amber: 1, green: 2 };
const tierOfRow = (r) => r.urgency || ({ red: 'emergency', amber: 'urgent' }[r.lane] || 'routine');
const groupOf = (r) => (r.status === 'reviewed' ? 'reviewed' : ['emergency', 'urgent', 'soon'].includes(tierOfRow(r)) ? tierOfRow(r) : 'routine');
const initialsOf = (n) => String(n).replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase() || '#';
// open cases first, by lane then by deadline; reviewed cases last (as the server sorts /cases)
const sortCases = (list) => list.sort((a, b) => (a.status === 'reviewed') - (b.status === 'reviewed')
  || (LANE_ORDER[a.lane] ?? 9) - (LANE_ORDER[b.lane] ?? 9) || String(a.slaDueAt).localeCompare(String(b.slaDueAt)));

// A demo session sees every case (and live video calls); a clinician sees cases from linked shops.
async function fetchCases() {
  if (session?.demo) {
    const r = await fetch(`${API}/cases`, { headers: headers() });
    if (!r.ok) throw await errOf(r);
    scope = { scope: 'all', shops: [] };
    return r.json();
  }
  const d = await capi('/clin/cases');
  scope = { scope: d.scope, shops: d.shops || [] };
  return sortCases(d.cases || []);
}
function scopeText() {
  if (!session) return '';
  if (session.demo || scope.scope === 'all') return 'Demo session: every case on the network';
  const n = scope.shops.length || activeLinks().length;
  return n ? `Cases from your ${plural(n, 'linked shop')}` : 'No linked shops yet: cases appear here once a shop or camp links with you';
}

async function refreshList() {
  if (!session) return;
  let got;
  try { got = await fetchCases(); } catch (e) { if (e.status !== 401) $('#listMeta').textContent = 'Server unreachable: retrying…'; return; }
  if (!session) return;
  rows = got;
  const ids = await Promise.all(rows.map((r) => identityOf(r.id, r.patient || {})));
  rows.forEach((r, i) => { if (ids[i].name) names[r.id] = ids[i].name; });
  const openN = rows.filter((r) => r.status !== 'reviewed').length;
  $('#navOpen').hidden = !openN; $('#navOpen').textContent = openN;
  $('#scopeNote').textContent = scopeText();
  const openOnly = $('#openOnly').checked && pfilter !== 'reviewed';
  const base = rows.filter((r) => !openOnly || r.status !== 'reviewed');
  const counts = { all: base.length };
  for (const r of rows) counts[groupOf(r)] = (counts[groupOf(r)] || 0) + 1;
  const F = [['all', 'All'], ['emergency', 'Emergency'], ['urgent', 'Urgent'], ['soon', 'Soon'], ['routine', 'Routine'], ['reviewed', 'Reviewed']];
  $('#pfilters').innerHTML = F.map(([k, l]) => `<button class="chip ${pfilter === k ? 'on' : ''}" data-pf="${k}">${l}<b>${counts[k] || 0}</b></button>`).join('');
  $$('[data-pf]').forEach((btn) => btn.onclick = () => { pfilter = btn.dataset.pf; refreshList(); });
  const q = ($('#psearch').value || '').trim().toLowerCase();
  const shown = base.filter((r) => (pfilter === 'all' || groupOf(r) === pfilter)
    && (!q || `${names[r.id] || ''} ${shortCode(r.id)} ${r.site?.name || ''} ${r.patient?.pin || ''} ${(r.flags || []).join(' ')}`.toLowerCase().includes(q)));
  $('#cases').innerHTML = shown.map((r) => {
    const sl = slaText(r);
    const pt = r.patient || {};
    const nm = names[r.id];
    const tier = r.urgency && r.urgency !== 'none' ? `<span class="tier ${esc(r.urgency)}">${esc(TIERS[r.urgency]?.label || r.urgency)}</span>` : '<span class="muted small">Routine</span>';
    const st = r.call ? ['call', r.call.by === 'store' ? 'Video call waiting' : 'Calling the store'] : r.status === 'reviewed' ? ['reviewed', r.review?.decisionLabel || 'Reviewed'] : ['open', 'Waiting for review'];
    return `<tr class="crow" data-id="${esc(r.id)}">
      <td><div class="pcell"><em class="av ${esc(r.lane)}">${esc(initialsOf(nm || shortCode(r.id)))}</em><div><b>${esc(nm || shortCode(r.id))}${!nm && pt.sealed ? ` ${ic('lock', { size: 12, label: 'sealed' })}` : ''}</b><small>${esc(shortCode(r.id))}${r.demo ? ' · demo' : ''}</small></div></div></td>
      <td class="num">${esc(pt.age ?? '?')} · ${esc((pt.sex || '–').slice(0, 1).toUpperCase())}</td>
      <td>${LANGS[r.lang] || ''}</td>
      <td>${esc(r.site?.name || '')}<small>${esc(pt.pin ? `PIN ${pt.pin}` : pt.village || '')}</small></td>
      <td>${tier}<small>${esc(r.within || '')}</small></td>
      <td><span class="status ${st[0]}">${esc(st[1])}</span></td>
      <td class="num due ${sl.cls}">${sl.txt}<small>received ${ago(r.receivedAt)}</small></td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">${rows.length ? 'No patients match.' : session.demo || scope.shops.length ? 'No cases yet.' : 'No cases yet: link with a shop or camp from My shops.'}</td></tr>`;
  const open = rows.filter((r) => r.status !== 'reviewed');
  $('#listMeta').textContent = `${open.length} open · ${open.filter((r) => r.lane === 'red').length} emergency · ${rows.filter((r) => r.overdue).length} overdue · review targets: emergency 2 h, urgent 1 day, soon and routine 3 days`;
  $$('.crow').forEach((tr) => tr.onclick = () => openCase(tr.dataset.id));
  if (!$('#dashTab').hidden) overview();
}

// Landing view for the reviewer: what is waiting, what is late, and the one
// case to open first (open cases sort by lane, then deadline).
function overview() {
  const open = rows.filter((r) => r.status !== 'reviewed');
  const tierOf = (r) => r.urgency || ({ red: 'emergency', amber: 'urgent' }[r.lane] || 'routine');
  const count = (...ts) => open.filter((r) => ts.includes(tierOf(r))).length;
  const overdue = open.filter((r) => r.overdue).length;
  const first = open[0];
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const tile = (n, l) => `<div class="tile"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const days = lastDays(7);
  const onDay = (l) => days.map((d) => rows.filter((r) => r.lane === l && new Date(r.receivedAt).toDateString() === d.key).length);
  const nLinks = activeLinks().length;
  const where = session?.demo ? 'demo session, every case' : nLinks ? plural(nLinks, 'linked shop') : 'no linked shops yet';
  const unlinked = !session?.demo && !nLinks;
  const nb = nextBooking();
  $('#dashBody').innerHTML = `<div class="overview">
    <section class="band">
    <h1>${greet}${me.name ? `, ${esc(me.name)}` : ''}</h1>
    <p class="meta">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(where)}</p>
    <p class="lede">${open.length ? `${plural(open.length, 'case')} waiting for review${overdue ? `, ${overdue} past the review target` : ''}.` : unlinked ? 'No cases yet. Cases appear here once a shop or camp links with you.' : 'Nothing waiting. New cases appear here as soon as a phone sends them.'}</p>
    <div class="tiles">
      ${tile(open.length, 'open cases')}${tile(count('emergency'), 'emergency, review in 2 h')}${tile(count('urgent', 'soon'), 'urgent or soon')}
      ${tile(count('routine', 'info', 'none'), 'routine sign-off')}${tile(overdue, 'past review target')}${tile(rows.length - open.length, 'reviewed')}
    </div></section>
    <div class="nxrow">
    ${first ? `<button class="nx ${first.lane === 'red' ? 'red' : 'accent'}" id="startFirst">${ic(first.lane === 'red' ? 'alert' : 'right')}<span><b>Start with the most urgent case</b><small>${esc(shortCode(first.id))} · ${esc(TIERS[tierOf(first)]?.label || first.lane)}${first.within ? ` · ${esc(first.within)}` : ''} · ${esc(slaText(first).txt)}</small></span>${ic('right')}</button>` : ''}
    ${nb ? `<button class="nx t2" id="nextBk">${ic('clock')}<span><b>Next booking ${dayKey(nb.start) === todayKey() ? 'today' : dayKey(nb.start) === addDays(todayKey(), 1) ? 'tomorrow' : `on ${esc(fmtDay(dayKey(nb.start), { weekday: 'long' }))}`} at ${hhmm(nb.start)}</b><small>${esc(nb.booking.patientRef)} · ${esc(placeText(nb))}${nb.booking.reason ? ` · ${esc(nb.booking.reason)}` : ''}</small></span>${ic('right')}</button>` : ''}
    ${unlinked ? `<button class="nx t2" id="toShops">${ic('users')}<span><b>Share your clinician code with shops</b><small>${esc(clin?.code || '')} · a shop sends a link request, you accept it</small></span>${ic('right')}</button>` : ''}
    </div>
  </div>`;
  if (first) $('#startFirst').onclick = () => openCase(first.id);
  if (nb) $('#nextBk').onclick = () => { calWeek = mondayOf(dayKey(nb.start)); showTab('calendar'); };
  if (unlinked) $('#toShops').onclick = () => showTab('shops');
  $('#dashBody .overview').insertAdjacentHTML('beforeend', `<div class="dash">
    <section class="card"><h2>Cases received, last 7 days</h2>${barChart({ labels: days.map((d) => d.label), title: 'Cases per day by lane', series: [
      { name: 'Routine', color: 'var(--c2)', values: onDay('green') }, { name: 'Referral', color: 'var(--lane-amber)', values: onDay('amber') },
      { name: 'Emergency', color: 'var(--lane-red)', values: onDay('red') }] })}</section>
    <section class="card"><h2>Open cases by urgency</h2>${donut({ title: 'Open cases by urgency', center: String(open.length), sub: 'open', segments: [
      { label: 'Emergency', value: count('emergency'), color: 'var(--lane-red)' }, { label: 'Urgent', value: count('urgent'), color: 'var(--c4)' },
      { label: 'Soon', value: count('soon'), color: 'var(--lane-amber)' }, { label: 'Routine', value: count('routine', 'info', 'none'), color: 'var(--c2)' }] })}</section>
  </div>`);
  const initials = (n) => n.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase() || '#';
  const card = (r) => {
    const n = names[r.id] || shortCode(r.id);
    const sla = slaText(r);
    return `<button class="bcard" data-open="${esc(r.id)}"><em class="av">${esc(initials(n))}</em><span><b>${esc(n)}</b><small>${esc((r.flags || [])[0] || r.summary || '')}</small></span><small class="due ${sla.cls}">${sla.txt}</small></button>`;
  };
  const nextUp = rows.filter((r) => r.status !== 'reviewed').slice(0, 6);
  $('#dashBody .overview').insertAdjacentHTML('beforeend', `<section class="card"><div class="row between wrap gap"><h2>Next to review</h2><button class="btn small" id="allPts">All patients ${ic('right')}</button></div>
    <div class="nextgrid">${nextUp.map(card).join('') || '<p class="muted small">Nothing waiting.</p>'}</div></section>`);
  $$('[data-open]', $('#dashBody')).forEach((b) => b.onclick = () => openCase(b.dataset.open));
  $('#allPts').onclick = () => showTab('queue');
}

const TABS = { dash: '#dashTab', queue: '#queueTab', calendar: '#calendarTab', shops: '#shopsTab', planning: '#planningTab', rules: '#rulesTab' };
function showTab(tab) {
  // leaving the case view: a reload should not reopen it
  if (tab !== 'queue' && selected) { selected = null; history.replaceState(null, '', location.pathname); }
  $$('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  for (const [k, el] of Object.entries(TABS)) $(el).hidden = k !== tab;
  if (tab === 'dash') overview();
  if (tab === 'planning') planning();
  if (tab === 'rules') rulesTab();
  if (tab === 'calendar') calendarTab();
  if (tab === 'shops') shopsTab();
  if (tab === 'queue' && !selected) { $('#detail').hidden = true; $('#plistView').hidden = false; }
}
function openCase(id) {
  selected = id;
  history.replaceState(null, '', `?case=${id}`);
  showTab('queue');
  $('#plistView').hidden = true;
  $('#detail').hidden = false;
  showCase(id);
}
function closeCase() {
  selected = null;
  history.replaceState(null, '', location.pathname);
  $('#detail').hidden = true;
  $('#plistView').hidden = false;
  refreshList();
}

function traceHtml(c) {
  const rowsHtml = (c.interview?.trace || []).map((t) => {
    if (t.event === 'urgent_mode') return `<tr class="urgent"><td colspan="3"><b>Urgent mode:</b> ${esc(t.reason)}</td></tr>`;
    if (t.event === 'skipped') return `<tr><td colspan="3" class="muted">${esc(t.qid)}: skipped by operator</td></tr>`;
    const q = QUESTION_BY_ID[t.qid];
    let val = t.value;
    if (q?.type === 'yesno') val = t.value ? 'Yes' : 'No';
    else if (q?.type === 'single') val = q.options.find((o) => o.v === t.value)?.label.en ?? t.value;
    else if (q?.type === 'multi') val = (t.value || []).map((v) => q.options.find((o) => o.v === v)?.label.en ?? v).join(', ');
    else if (q?.type === 'rx') val = t.value?.skipped ? 'skipped' : t.value?.text;
    else if (q?.type === 'hours') val = `${t.value} h/day`;
    return `<tr><td class="q">${esc(t.questionEn)}<span class="why">${esc(t.reason)}</span></td>
      <td>${t.raw ? `<span class="raw" lang="${esc(t.lang)}">“${esc(t.raw)}”</span>` : '<span class="muted">tap</span>'}</td>
      <td><b>${esc(val)}</b><br><span class="muted">${esc(t.mode)}</span></td></tr>`;
  }).join('');
  const notAsked = (c.interview?.notAsked || []).map((id) => {
    const q = QUESTION_BY_ID[id];
    return q && typeof q.text === 'object' ? q.text.en : id;
  });
  return `<table class="trace"><tr><th>Question (why it was asked)</th><th>Patient said</th><th>Recorded</th></tr>${rowsHtml}</table>
    <details class="small"><summary>${c.interview?.asked} of ${c.interview?.bank} questions asked · ${notAsked.length} skipped as not relevant for this patient</summary>
      <ul>${notAsked.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
}

function signedAs() {
  if (!clin) return '';
  const tail = session?.demo ? ' · demo session' : clin.status !== 'verified' ? ' · signing off unlocks once you are verified' : '';
  return `Signed as ${esc(me.name)} (${esc(me.regNo || clin.code)})${tail}`;
}

function reviewForm(c) {
  const rec = c.profile.recommendation;
  const lane = c.profile.triage.lane;
  const u = c.profile.triage.urgency;
  const def = lane === 'red' ? 'urgent' : u === 'urgent' || u === 'soon' || (!u && lane === 'amber') ? 'in_person' : 'approve';
  const lensOpts = Object.entries(LENS).map(([k, v]) => `<option value="${k}" ${k === rec.category ? 'selected' : ''}>${v}</option>`).join('');
  const emph = ['Balanced', 'Intermediate', 'Near'].map((k) => `<option ${k === c.profile.vision.designEmphasis ? 'selected' : ''}>${k}</option>`).join('');
  const add = c.profile.presbyopia?.addD || '';
  return `<form class="card form" id="rvForm">
    <h2>Your decision</h2>
    <div class="decisions">${Object.entries(DECISION).map(([k, v]) => `<label><input type="radio" name="decision" value="${k}" ${k === def ? 'checked' : ''}> ${v}</label>`).join('')}</div>
    <label id="otherWrap" hidden>Your decision, in your words<input name="decisionText" maxlength="120" placeholder="e.g. Glasses now; dilated retina check at the next camp"></label>
    ${c.profile.triage.flags.length ? `<details class="fnotes"><summary>Comment on a referral finding (optional)</summary>
      ${c.profile.triage.flags.map((f) => `<label><span class="tier ${esc(f.tier)}">${esc(TIERS[f.tier]?.label || f.tier)}</span> ${esc(f.title)}<input name="fn_${esc(f.code)}" maxlength="500" placeholder="Agree, disagree, or add detail"></label>`).join('')}</details>` : ''}
    <div class="row gap"><label style="flex:2">Lens category<select name="lensCategory">${lensOpts}</select></label>
      <label style="flex:1">Design emphasis<select name="designEmphasis">${emph}</select></label>
      <label style="flex:1">Add (D)<input name="addD" type="number" step="0.25" min="0" max="4" value="${add}"></label></div>
    <label>Next step (shown to the store / camp)<input name="nextStep" value="${esc(c.profile.triage.flags[0]?.action || 'Dispense as suggested; recheck in 12 months.')}"></label>
    <label>Comments and suggestions for the store / camp<textarea name="comments" id="rvComments" maxlength="2000" placeholder="Anything else they should know or do: extra tests, frame or lens advice, follow-up, what to tell the family"></textarea><small class="muted">Shown on the store phone and in the referral letter.</small></label>
    <label>Private clinical notes<textarea name="notes" maxlength="2000"></textarea><small class="muted">Stay on the hub.</small></label>
    <label>Message to the patient (${LANGS[c.lang]})<textarea name="messageToPatient" lang="${c.lang}" id="msg"></textarea></label>
    <div class="signlock" id="rvLock" hidden></div>
    <div class="row gap wrap"><button class="btn primary" type="submit">Sign and send</button><span class="muted small" id="rvSigned">${signedAs()}</span></div>
    <p class="err" id="rvErr"></p>
  </form>`;
}

function fillMessage(c) {
  const form = $('#rvForm'); if (!form) return;
  const d = form.decision.value;
  const tpl = REPLY[d][c.lang] || REPLY[d].en;
  form.messageToPatient.value = tpl.replace('{site}', c.site?.name || 'the store').replace('{place}', (PLACES[d] || PLACES.in_person)[c.lang] || PLACES.in_person.en);
}

function showSignLock() {
  const box = $('#rvLock'); if (!box) return;
  const rejected = clin?.status === 'rejected';
  box.innerHTML = `${ic('lock')}<div><b>Not signed: ${rejected ? 'your registration was not verified' : 'your registration is still being verified'}</b>
    <span>${rejected ? `The network admin did not verify ${esc(clin?.regNo || 'your registration')}${clin?.note ? ` (${esc(clin.note)})` : ''}. Contact the network admin to correct it.`
    : `The network admin is checking ${esc(clin?.regNo || 'your registration')} with your council. Signing off unlocks once you are verified; your decision and notes stay on this page until you leave it.`}</span></div>`;
  box.hidden = false;
}

async function showCase(id) {
  const det = $('#detail');
  let c;
  try {
    const r = await fetch(`${API}/cases/${id}`, { headers: headers() });
    if (!r.ok) { const e = await errOf(r); det.innerHTML = `<p class="err">${esc(e.status === 403 ? 'This case is from a shop you are not linked to.' : e.status === 404 ? 'This case no longer exists.' : 'Could not load the case.')}</p>`; return; }
    c = await r.json();
  } catch { det.innerHTML = '<p class="err">Could not load the case.</p>'; return; }
  if (!c || !c.profile) { det.innerHTML = '<p class="err">Case not found.</p>'; return; }
  const p = c.patient || {};
  const who = await identityOf(c.id, p);
  const rv = c.review;
  const passport = passportText({ id: c.id, patient: { name: who.name || '' }, profile: c.profile, answers: c.interview?.answers, review: rv }, c.lang);
  let audit = [];
  try { audit = await (await fetch(`${API}/audit?case_id=${encodeURIComponent(c.id)}`, { headers: headers() })).json(); } catch { audit = []; }
  det.innerHTML = `
    <button class="btn ghost small backlist" id="backList">${ic('left')} All patients</button>
    <div class="dhead">
      <div><h1>${esc(who.name || `Patient ${shortCode(c.id)}`)} · ${esc(p.age ?? '?')} ${esc(p.sex || '')}</h1>
        <p class="eyebrow">${esc(shortCode(c.id))} · ${esc(c.site?.name || '')} (${esc(c.site?.type || '')}) · ${LANGS[c.lang]} · received ${ago(c.server.receivedAt)}${c.demo ? ' · synthetic demo case' : ''}</p>
        <p class="muted">${esc(who.village || (p.pin ? `PIN ${p.pin}` : ''))} · identity: ${esc(who.how)} · consent ${c.consent?.given ? `recorded ${esc(c.consent.lang)} ${esc((c.consent.at || '').slice(0, 16).replace('T', ' '))}` : 'MISSING'} · operator: ${esc(c.operator || 'unknown')}${c.rulesVersion || c.profile.rulesVersion ? ` · rules ${esc(c.rulesVersion || c.profile.rulesVersion)}` : ''}</p></div>
      <div class="row gap wrap"><button class="btn primary" id="callBtn">${ic('video')} ${rows.find((r) => r.id === c.id)?.call?.by === 'store' ? 'Join video call' : 'Video consult'}</button>
        <a class="btn" href="${API}/cases/${esc(c.id)}/fhir" target="_blank" rel="noopener">FHIR R4 bundle</a>
        <button class="btn ghost" id="eraseBtn" title="Patient asked for their data to be deleted">Erase</button></div>
    </div>
    <div class="dgrid">
      <div>
        <section class="card">${profileHtml(c.profile, c.measurements || {}, c.interview?.answers || {})}</section>
      </div>
      <div>
        ${rv ? `<section class="card reviewed"><h2>${ic('check')} ${esc(rv.decisionLabel)}</h2><p>${esc(rv.nextStep)}</p>${rv.comments ? `<p class="comment">${esc(rv.comments)}</p>` : ''}
          ${Object.keys(rv.findingNotes || {}).length ? `<ul class="small fnlist">${Object.entries(rv.findingNotes).map(([k, v]) => `<li><b>${esc(c.profile.triage.flags.find((f) => f.code === k)?.title || k)}</b>: ${esc(v)}</li>`).join('')}</ul>` : ''}
          ${rv.notes ? `<p class="small muted">Private note: ${esc(rv.notes)}</p>` : ''}
          <p class="muted small">${esc(rv.reviewer?.name)}${rv.reviewer?.regNo ? ` (${esc(rv.reviewer.regNo)})` : ''}${rv.reviewer?.demo ? ' · demo session' : ''} · ${esc((rv.reviewedAt || '').slice(0, 16).replace('T', ' '))}</p></section>` : reviewForm(c)}
        <section class="card"><h2>Vision Passport (${LANGS[c.lang]})</h2><pre class="pp" lang="${c.lang}">${esc(passport)}</pre>
          <div class="sharebox" id="ppShare">
            <p class="small">Send as an encrypted link (key in the link, optional PIN said on the phone). Plain WhatsApp/SMS text is not used for patient files.</p>
            <div class="row gap wrap"><button class="btn primary" id="shareLetter">Referral letter (PIN)</button><button class="btn" id="sharePassport">Passport link</button></div>
            <div id="shareResult"></div>
          </div>
          ${who.phone ? '' : '<p class="muted small">The patient’s phone number is not on the server: the field phone can also share the passport from its inbox.</p>'}</section>
      </div>
    </div>
    <details class="card"><summary>Adaptive interview: every question, why it was asked, the patient's own words</summary>${traceHtml(c)}</details>
    <details class="card"><summary>Access log</summary><p class="muted small">Every view, review, export and erasure of this case, append-only. No personal data is logged.</p>
      <table class="trace"><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Detail</th></tr>
      ${audit.map((a) => `<tr><td>${esc((a.at || '').replace('T', ' ').slice(0, 19))}</td><td>${esc(a.actor)}</td><td>${esc(a.action.replace(/_/g, ' '))}</td><td>${esc(a.detail || '')}</td></tr>`).join('')}</table></details>`;
  $('#shareLetter').onclick = () => makeShare(c, who, 'referral');
  $('#callBtn').onclick = () => startHubCall(c, who);
  $('#backList').onclick = closeCase;
  $('#sharePassport').onclick = () => makeShare(c, who, 'passport', passport);
  const form = $('#rvForm');
  if (form) {
    fillMessage(c);
    $$('input[name=decision]', form).forEach((r) => r.onchange = () => { fillMessage(c); $('#otherWrap').hidden = form.decision.value !== 'other'; });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        reviewer: { name: me.name, regNo: me.regNo || null }, decision: fd.get('decision'), lensCategory: fd.get('lensCategory'), designEmphasis: fd.get('designEmphasis'),
        addD: fd.get('addD') === '' ? null : Number(fd.get('addD')), nextStep: fd.get('nextStep'), notes: fd.get('notes'), messageToPatient: fd.get('messageToPatient'),
        decisionText: fd.get('decisionText') || '', comments: fd.get('comments') || '', findingNotes: findingNotesOf(form),
      };
      const btn = $('button[type=submit]', form);
      btn.disabled = true; $('#rvErr').textContent = ''; $('#rvLock').hidden = true;
      let r;
      try { r = await fetch(`${API}/cases/${c.id}/review`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }); }
      catch { btn.disabled = false; $('#rvErr').textContent = 'Could not reach the server. Your decision is still here: try again.'; return; }
      btn.disabled = false;
      if (r.status === 403) { await recheckMe(); showSignLock(); $('#rvSigned').innerHTML = signedAs(); return; }
      if (!r.ok) {
        const err = await errOf(r);
        if (r.status === 401 && !/portal token/i.test(err.detail)) { sessionEnded(); return; }
        $('#rvErr').textContent = r.status === 401 ? 'This server needs the portal token: open portal.html#token=… once in this browser.' : `Could not save (${r.status}${err.detail ? `: ${err.detail}` : ''}).`;
        return;
      }
      await refreshList(); showCase(c.id);
    };
  }
  $('#eraseBtn').onclick = async () => {
    if (!confirm('Erase this case permanently? Use only when the patient asks for deletion.')) return;
    const r = await fetch(`${API}/cases/${c.id}`, { method: 'DELETE', headers: headers() });
    if (r.ok) { selected = null; det.innerHTML = '<p class="muted">Case erased.</p>'; refreshList(); }
  };
}

// ---------------------------------------------------------------- referral letter + secure share
// A referral letter for the receiving eye hospital or vision centre, built from
// the case. It leaves this browser only as ciphertext: AES-256 key in the link's
// fragment, a PIN said on the phone, 7-day expiry, view limit, revocable.
function referralDoc(c, who) {
  const tri = c.profile.triage;
  const m = c.measurements || {};
  const a = c.interview?.answers || {};
  const p = c.patient || {};
  const urgent = tri.lane === 'red';
  const redflagLines = (c.interview?.trace || []).filter((t) => t.module === 'redflag' && t.qid)
    .map((t) => `${t.questionEn} — ${typeof t.value === 'boolean' ? (t.value ? 'Yes' : 'No') : Array.isArray(t.value) ? t.value.join(', ') : t.value}`);
  const rv = c.review || {};
  const comments = rv.comments || $('#rvForm [name=comments]')?.value || '';
  const fnotes = Object.keys(rv.findingNotes || {}).length ? rv.findingNotes : ($('#rvForm') ? findingNotesOf($('#rvForm')) : {});
  const findings = [];
  if (m.acuity?.R) findings.push(`Distance vision (${m.acuity.method === 'chart screen' ? `chart screen, ${m.acuity.distanceM} m` : 'phone, 2 m'}): R ${snellen(m.acuity.R.logmar)} · L ${snellen(m.acuity.L?.logmar ?? null)}${['R', 'L'].filter((e) => m.acuity[e]?.pinholeLogmar !== undefined).map((e) => ` · ${e} pinhole ${snellen(m.acuity[e].pinholeLogmar)}`).join('')}`);
  if (m.amsler?.R) findings.push(`Amsler: R ${m.amsler.R} · L ${m.amsler.L}${m.amsler.onset ? ` (noticed: ${m.amsler.onset})` : ''}`);
  for (const f of c.profile.findings || []) findings.push(`${TEST_NAME[f.test] || f.test}: ${f.result} — ${f.meaning}`);
  const reg = me.regNo ? `${me.regNo}${session?.demo ? ', demo session' : ''}` : '';
  return {
    title: urgent ? 'Emergency referral' : 'Referral letter',
    to: urgent ? 'Eye casualty / partner eye hospital' : 'Ophthalmologist / vision centre',
    from: `${me.name}${reg ? ` (${reg})` : ''}, DivyaDrishti optometrist hub`,
    date: new Date().toLocaleDateString('en-IN'),
    patient: `${who.name || `Patient ${shortCode(c.id)}`} · ${p.age ?? '?'} ${p.sex || ''} · ref ${shortCode(c.id)}`,
    re: urgencyLine(tri),
    lang: 'en',
    sections: [
      { heading: 'Reason for referral', items: tri.flags.length ? tri.flags.map((f) => `${f.title} (${f.within}): ${f.detail}${fnotes[f.code] ? `. Optometrist: ${fnotes[f.code]}` : ''}`) : ['Routine review'] },
      ...(comments.trim() ? [{ heading: 'Optometrist’s comments', text: comments.trim() }] : []),
      { heading: 'Red-flag screen (patient’s answers)', items: redflagLines.length ? redflagLines : ['not recorded'] },
      { heading: 'Phone-based findings (screening, not diagnostic)', items: findings.length ? findings : ['no tests recorded'] },
      { heading: 'Requested', text: tri.flags[0]?.action || 'Full eye examination.' },
      ...(a.conditions?.length ? [{ heading: 'Medical history', text: a.conditions.join(', ') + (a.diabetes_years != null ? ` (diabetes ${a.diabetes_years} years)` : '') }] : []),
    ],
    footer: `Screened with DivyaDrishti (rules ${c.rulesVersion || c.profile.rulesVersion || '?'}), reviewed by ${me.name}. Phone measurements are estimates.`,
  };
}

async function makeShare(c, who, kind, passport) {
  const out = $('#shareResult');
  out.innerHTML = '<p class="muted small">Encrypting…</p>';
  try {
    const { createShareLink } = await import('./share.js');
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    const doc = kind === 'referral' ? referralDoc(c, who) : { text: passport, lang: c.lang };
    const made = await createShareLink(doc, { pin, kind, expiresDays: 7, maxViews: 20, caseRef: c.id, actor: actorName(), api: API });
    const msg = `DivyaDrishti ${kind === 'referral' ? 'referral letter' : 'Vision Passport'} ${shortCode(c.id)} (encrypted): ${made.url}`;
    out.innerHTML = `<div class="shareOut">
      <p class="pinshow">PIN ${pin}</p><p class="muted small">Say the PIN on the phone; never write it in the same message. Expires ${esc((made.expiresAt || '').slice(0, 10))}, up to ${made.maxViews} views.</p>
      <label>Mobile number to send it to<input id="ppPhone" type="tel" inputmode="tel" maxlength="16" value="${esc(who.phone || '')}" placeholder="10-digit mobile number"></label>
      <div class="row gap wrap"><a class="btn primary" id="ppSms">Send SMS</a><a class="btn" id="ppWa" target="_blank" rel="noopener">WhatsApp</a><button class="btn" id="cpLink">Copy link</button>
      <button class="btn ghost" id="rvLink">Revoke</button></div></div>`;
    const setLinks = () => {
      const n = $('#ppPhone').value.replace(/\D/g, '').slice(-10);
      $('#ppSms').href = n.length === 10 ? smsLink(n, msg) : '#';
      $('#ppWa').href = n.length === 10 ? whatsappLink(n, msg) : '#';
      $('#ppSms').toggleAttribute('aria-disabled', n.length !== 10);
    };
    $('#ppPhone').oninput = setLinks; setLinks();
    $('#cpLink').onclick = () => navigator.clipboard?.writeText(made.url).catch(() => {});
    $('#rvLink').onclick = async () => {
      const { revokeShare } = await import('./share.js');
      await revokeShare(made.id, made.deleteToken, { api: API });
      out.innerHTML = '<p class="small">Link revoked.</p>';
    };
  } catch (e) { out.innerHTML = `<p class="err">Could not create the link: ${esc(e.code || e.message || e)}</p>`; }
}

// ---------------------------------------------------------------- camp planning
// Per linked shop or camp: cases, referrals, PIN codes, findings; the pooled,
// de-identified network counts stay underneath.
const shopKeyOf = (r, byName) => (r.site?.code ? String(r.site.code).toUpperCase() : byName[String(r.site?.name || '').trim().toLowerCase()]) || 'unregistered';
const topOf = (counts, n = 2) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

// The shop, or the PIN cluster (same first three digits: one postal sorting
// district), with the most referrals still waiting for review.
function suggestCamp(plan) {
  const shops = plan?.shops || [];
  const byName = Object.fromEntries(shops.map((p) => [String(p.name || '').trim().toLowerCase(), p.code]));
  const shopAgg = {}; const pinAgg = {};
  for (const r of rows) {
    if (r.status === 'reviewed' || (r.lane !== 'red' && r.lane !== 'amber')) continue;
    const sc = shopKeyOf(r, byName);
    const pin = /^\d{6}$/.test(r.patient?.pin || '') ? r.patient.pin : null;
    const a = (shopAgg[sc] ||= { n: 0, red: 0, pins: new Set(), shops: new Set([sc]), flags: {} });
    const groups = [a];
    if (pin) groups.push(pinAgg[pin.slice(0, 3)] ||= { n: 0, red: 0, pins: new Set(), shops: new Set(), flags: {} });
    for (const g of groups) {
      g.n++; if (r.lane === 'red') g.red++;
      if (pin) g.pins.add(pin);
      g.shops.add(sc);
      for (const f of r.flags || []) g.flags[f] = (g.flags[f] || 0) + 1;
    }
  }
  const best = (o) => Object.entries(o).sort((x, y) => y[1].n - x[1].n || y[1].red - x[1].red)[0];
  const s = best(shopAgg); const c = best(pinAgg);
  if (!s) return null;
  const venue = (code) => shops.find((p) => p.code === code);
  // a cluster wins only when it gathers more waiting referrals than any one shop
  if (c && c[1].n > s[1].n && c[1].shops.size > 1) {
    const host = [...c[1].shops].map(venue).filter(Boolean).sort((x, y) => (y.pin || '').startsWith(c[0]) - (x.pin || '').startsWith(c[0]))[0];
    return { kind: 'cluster', key: c[0], host, ...c[1] };
  }
  return { kind: 'shop', key: s[0], host: venue(s[0]), ...s[1] };
}

function suggestHtml(plan) {
  const sg = suggestCamp(plan);
  if (!sg) {
    const allTime = (plan?.shops || []).filter((p) => p.red + p.amber).sort((a, b) => (b.red + b.amber) - (a.red + a.amber))[0];
    return `<section class="card suggest"><div class="sg-head"><em class="sg-ic">${ic('check')}</em><div><h2>No referrals waiting</h2>
      <p class="meta">${allTime ? `Over all cases so far, ${esc(allTime.name)} has sent the most referrals (${allTime.red + allTime.amber}).` : 'Referral cases from your shops and camps will show here.'}</p></div></div></section>`;
  }
  const h = sg.host;
  const pins = [...sg.pins].sort();
  const title = sg.kind === 'shop' ? (h?.name || 'Unregistered site') : `PIN codes ${sg.key}xxx${h ? `, near ${h.name}` : ''}`;
  const where = h ? [KIND[h.kind] || h.kind, [h.area, h.city].filter(Boolean).join(', '), h.pin ? `PIN ${h.pin}` : ''].filter(Boolean).join(' · ') : '';
  const flags = topOf(sg.flags, 2);
  const reason = `${plural(sg.n, 'referral')} waiting for review${sg.red ? `, ${sg.red} of them emergency` : ''}, from ${plural(pins.length || 0, 'PIN code')}${sg.kind === 'cluster' ? ` sent by ${plural(sg.shops.size, 'shop')}` : ''}.${flags.length ? ` Most common: ${flags.join('; ')}.` : ''}`;
  return `<section class="card suggest">
    <div class="sg-head"><em class="sg-ic">${ic(h ? KIND_ICON[h.kind] || 'users' : 'users')}</em><div><h2>Suggested next camp: ${esc(title)}</h2>${where ? `<p class="meta">${esc(where)}</p>` : ''}</div></div>
    <p class="sg-why">${esc(reason)}</p>
    ${pins.length ? `<div class="sg-pins">${pins.map((p) => `<span class="pinchip">${esc(p)}</span>`).join('')}</div>` : ''}
    <div class="row gap wrap">${h ? `<button class="btn small" id="sgCases" data-q="${esc(h.name)}">See the waiting patients ${ic('right', { size: 16 })}</button>` : ''}
      ${h && activeLinks().some((l) => l.shopCode === h.code) ? `<button class="btn small ghost" id="sgSlots" data-shop="${esc(h.code)}" data-kind="${esc(h.kind)}">${ic('plus', { size: 16 })} Add slots there</button>` : ''}</div>
  </section>`;
}

function planShopHtml(p) {
  const maxPin = Math.max(1, ...p.pins.map((x) => x.cases));
  const where = [KIND[p.kind] || p.kind, [p.area, p.city].filter(Boolean).join(', '), p.pin ? `PIN ${p.pin}` : ''].filter(Boolean).join(' · ');
  return `<article class="card pshop">
    <h2>${esc(p.name)}</h2>${where ? `<p class="meta">${esc(where)}</p>` : ''}
    <dl class="pnums"><div><dt>Cases</dt><dd>${p.cases}</dd></div><div><dt>Open</dt><dd>${p.open}</dd></div><div><dt>Emergency</dt><dd>${p.red}</dd></div><div><dt>Referral</dt><dd>${p.amber}</dd></div></dl>
    <h3>Patients by PIN code</h3>${hbars(p.pins.slice(0, 6).map((x) => ({ label: x.pin, note: x.referred ? `${x.referred} referred` : '', value: x.cases })), { max: maxPin })}
    ${p.pins.length > 6 ? `<p class="small muted">and ${plural(p.pins.length - 6, 'more PIN code')}</p>` : ''}
    <h3>Top findings</h3>${p.topFlags.length ? `<ul class="pflags">${p.topFlags.map(([t, n]) => `<li><span>${esc(t)}</span><b>${n}</b></li>`).join('')}</ul>` : '<p class="small muted">No referral findings.</p>'}
  </article>`;
}

async function planning() {
  const el = $('#planningTab');
  const [s, plan] = await Promise.all([
    fetch(`${API}/stats`, { headers: headers() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    capi('/network/planning').catch(() => null),
  ]);
  if (!session) return;
  if (!s) { el.innerHTML = '<p class="err">Server unreachable.</p>'; return; }
  const maxFlag = Math.max(1, ...s.topFlags.map((f) => f[1]));
  const places = Object.entries(s.byPlace).sort((a, b) => (b[1].amber + b[1].red) - (a[1].amber + a[1].red));
  const maxPlace = Math.max(1, ...places.map(([, v]) => v.cases));
  const LABEL = { ...LENS };
  const ub = s.byUrgency || {};
  const pshops = plan?.shops || [];
  const byState = {};
  for (const p of pshops) for (const x of p.pins) { const st = pinToState(x.pin); if (st) byState[st] = (byState[st] || 0) + x.cases; }
  const mine = plan?.scope === 'linked';
  el.innerHTML = `
    <section class="band">
      <h1>Camp planning</h1>
      <p class="meta">Pooled across every shop and camp on the network</p>
      <p class="lede">De-identified counts: where referrals cluster, which specialist camp to run next, what lens mix to stock.</p>
      <div class="tiles">
        <div class="tile"><div class="n">${s.cases}</div><div class="l">cases</div></div>
        <div class="tile"><div class="n">${s.byLane.red}</div><div class="l">emergency (same day)</div></div>
        <div class="tile"><div class="n">${(ub.urgent ?? 0)} / ${(ub.soon ?? 0)}</div><div class="l">urgent / soon referral</div></div>
        <div class="tile"><div class="n">${s.byLane.green}</div><div class="l">routine sign-off</div></div>
        <div class="tile"><div class="n">${s.medianQuestionsAsked ?? '–'}</div><div class="l">median questions asked</div></div>
        <div class="tile"><div class="n">${s.medianReviewMinutes ?? '–'}</div><div class="l">median minutes to review</div></div>
      </div>
    </section>
    ${plan ? suggestHtml(plan) : '<p class="err">Could not load your shops and camps.</p>'}
    ${plan ? `<div class="sechead"><h2>${mine ? 'Your shops and camps' : 'Shops and camps'}</h2><p class="meta">${mine ? plural(pshops.length, 'linked site') : 'Demo session: every site on the network'} · sorted by referrals</p></div>
    ${pshops.length ? `<div class="pshops">${pshops.map(planShopHtml).join('')}</div>` : '<p class="muted">No cases from your linked shops yet.</p>'}` : ''}
    <div class="dash">
      <section class="card"><h2>${mine ? 'Your patients' : 'Patients'} by state</h2>${indiaMap(plan ? byState : byStateOf(places), { unit: 'patients' })}
        <p class="small muted">From patients’ PIN codes; approximate near state borders.</p></section>
      <section class="card"><h2>Why patients are referred</h2>${s.topFlags.length ? hbars(s.topFlags.map(([k, n]) => ({ label: k, value: n })), { max: maxFlag }) : '<p class="muted">No referral findings yet.</p>'}</section>
    </div>
    <div class="sechead"><h2>Across the network</h2><p class="meta">Pooled, de-identified</p></div>
    <div class="dash">
      <section class="card"><h2>Urgency mix</h2>${donut({ title: 'Cases by urgency', center: String(s.cases), sub: 'cases', segments: [
        { label: 'Emergency', value: ub.emergency ?? s.byLane.red, color: 'var(--lane-red)' }, { label: 'Urgent', value: ub.urgent ?? 0, color: 'var(--c4)' },
        { label: 'Soon', value: ub.soon ?? 0, color: 'var(--lane-amber)' }, { label: 'Routine', value: (ub.routine ?? 0) + (ub.info ?? 0) + (ub.none ?? 0), color: 'var(--c2)' }] })}</section>
      <section class="card"><h2>Referrals by area (PIN code)</h2>${hbars(places.map(([k, v]) => ({ label: k, note: `${v.amber} amber, ${v.red} red`, value: v.cases })), { max: maxPlace })}</section>
      <section class="card"><h2>Suggested lens mix</h2>${barChart({ title: 'Suggested lens categories', stacked: false,
        labels: Object.keys(s.recommendations).map((k) => (LABEL[k] || k).split(' ')[0]),
        series: [{ name: 'Patients', color: 'var(--c2)', values: Object.values(s.recommendations) }] })}</section>
      <section class="card"><h2>Vision profiles</h2>${donut({ title: 'Vision profiles', center: String(s.cases), sub: 'profiles',
        segments: Object.entries(s.dominance).map(([k, n], i) => ({ label: k, value: n, color: ['var(--c5)', 'var(--c6)', 'var(--c3)', 'var(--c7)'][i % 4] })) })}</section>
    </div>`;
  const sc = $('#sgCases');
  if (sc) sc.onclick = () => { $('#psearch').value = sc.dataset.q; selected = null; showTab('queue'); refreshList(); };
  const ss = $('#sgSlots');
  if (ss) ss.onclick = () => { slotPreset = { mode: ss.dataset.kind === 'camp' ? 'camp' : 'in_person', place: ss.dataset.shop }; showTab('calendar'); };
}

// ---------------------------------------------------------------- calendar
// Slot times are India time (+05:30) on the server; the calendar shows them in
// IST whatever the browser's own time zone is.
const IST_MS = 330 * 60000;
const istDate = (t) => new Date(new Date(t).getTime() + IST_MS); // read with the UTC getters
const dayKey = (t) => istDate(t).toISOString().slice(0, 10);
const hhmm = (t) => istDate(t).toISOString().slice(11, 16);
const keyDate = (k) => new Date(`${k}T00:00:00Z`);
const addDays = (k, n) => { const d = keyDate(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (k) => addDays(k, -((keyDate(k).getUTCDay() + 6) % 7));
const todayKey = () => dayKey(Date.now());
const fmtDay = (k, o) => keyDate(k).toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
const istIso = (k) => `${k}T00:00:00+05:30`;
const minsOf = (s) => Math.round((new Date(s.end) - new Date(s.start)) / 60000);
const MODE = { video: { label: 'Video', icon: 'video' }, in_person: { label: 'In person', icon: 'user' }, camp: { label: 'Camp', icon: 'users' } };
const BK = { booked: 'Booked', confirmed: 'Confirmed', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };
const placeText = (s) => (s.mode === 'video' ? 'Video consult' : `${s.mode === 'camp' ? 'Camp' : 'In person'} at ${s.placeName || s.place}`);
let calWeek = null; // Monday of the week shown (IST date key)
let calSlots = [];
let bookings = []; // /bookings: your booked slots from yesterday on
let slotPreset = null; // from camp planning: { mode, place }

function nextBooking() {
  const now = Date.now();
  return bookings.filter((s) => s.booking && ['booked', 'confirmed'].includes(s.booking.status) && new Date(s.end).getTime() > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}
async function refreshBookings() {
  if (!session) return;
  try { bookings = await capi('/bookings'); } catch { return; }
  renderNavCounts();
  renderUpcoming();
}

function calendarShell() {
  const opt = [10, 15, 20, 30, 45, 60].map((m) => `<option value="${m}" ${m === 20 ? 'selected' : ''}>${m} min</option>`).join('');
  return `<div class="tabhead">
      <div><h1>Calendar</h1><p class="meta">Your slots for video consults, shop clinics and camps · times in IST</p></div>
      <div class="calnav">
        <button class="btn small ghost" type="button" id="calPrev" aria-label="Previous week">${ic('left')}</button>
        <button class="btn small" type="button" id="calToday">Today</button>
        <button class="btn small ghost" type="button" id="calNext" aria-label="Next week">${ic('right')}</button>
        <b class="calrange" id="calRange"></b>
      </div>
    </div>
    <div class="calgrid">
      <section class="card upcoming"><h2>Upcoming bookings</h2><div id="upList"><p class="muted small">Loading…</p></div></section>
      <section class="card weekcard">
        <div class="weekwrap"><div class="week" id="week"><p class="muted small">Loading…</p></div></div>
        <div class="calkey" aria-hidden="true"><span class="k video">Video</span><span class="k in_person">In person</span><span class="k camp">Camp</span><span class="k free">Free slot</span></div>
      </section>
      <form class="card form slotform" id="slotForm" novalidate>
        <h2>${ic('plus')} Add availability</h2>
        <p class="muted small">Back-to-back slots that your linked shops can book for a patient.</p>
        <div class="g2"><label>Date<input type="date" name="date" required></label>
          <label>Slot length<select name="minutes">${opt}</select></label></div>
        <div class="g2"><label>From<input type="time" name="start" value="10:00" step="300" required></label>
          <label>To<input type="time" name="end" value="12:00" step="300" required></label></div>
        <fieldset class="pickseg"><legend>Mode</legend><div class="seg" id="slotMode">
          <label class="chip on"><input type="radio" name="mode" value="video" checked> Video</label>
          <label class="chip"><input type="radio" name="mode" value="in_person"> In person</label>
          <label class="chip"><input type="radio" name="mode" value="camp"> Camp</label></div></fieldset>
        <label>Place<select name="place" id="slotPlace"></select></label>
        <label>Note for the shop (optional)<input name="note" maxlength="120" placeholder="e.g. Ask the patient to bring their old glasses"></label>
        <p class="small muted" id="slotPreview"></p>
        <button class="btn primary" type="submit" id="slotGo">Add slots</button>
        <p class="err" id="slotErr" role="alert"></p><p class="okmsg small" id="slotOk" role="status"></p>
      </form>
    </div>`;
}

async function calendarTab() {
  const el = $('#calendarTab');
  if (!calWeek) calWeek = mondayOf(todayKey());
  if (!el.dataset.ready) {
    el.innerHTML = calendarShell();
    el.dataset.ready = '1';
    $('#calPrev').onclick = () => { calWeek = addDays(calWeek, -7); loadWeek(); };
    $('#calNext').onclick = () => { calWeek = addDays(calWeek, 7); loadWeek(); };
    $('#calToday').onclick = () => { calWeek = mondayOf(todayKey()); loadWeek(); };
    const f = $('#slotForm');
    f.elements.namedItem('date').value = addDays(todayKey(), 1);
    $$('input[name=mode]', f).forEach((r) => r.onchange = () => { fillPlaces(); slotPreview(); });
    ['date', 'start', 'end', 'minutes', 'place'].forEach((n) => { f.elements.namedItem(n).addEventListener('input', slotPreview); f.elements.namedItem(n).addEventListener('change', slotPreview); });
    f.onsubmit = addSlots;
  }
  const f = $('#slotForm');
  f.elements.namedItem('date').min = todayKey();
  if (slotPreset) {
    $$('input[name=mode]', f).forEach((r) => { r.checked = r.value === slotPreset.mode; });
    fillPlaces(slotPreset.place);
    slotPreset = null;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else fillPlaces();
  slotPreview();
  await Promise.all([loadWeek(), refreshBookings()]);
}

function fillPlaces(want) {
  const f = $('#slotForm'); if (!f) return;
  const mode = f.elements.namedItem('mode').value;
  $$('#slotMode label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
  const sel = $('#slotPlace');
  const keep = want || sel.value;
  if (mode === 'video') {
    sel.innerHTML = '<option value="video">Video consult: any linked shop can book</option>';
    sel.disabled = true;
    return;
  }
  const shops = activeLinks().slice().sort((a, b) => (mode === 'camp' ? (b.shopKind === 'camp') - (a.shopKind === 'camp') : (a.shopKind === 'camp') - (b.shopKind === 'camp')) || a.shopName.localeCompare(b.shopName));
  sel.disabled = !shops.length;
  sel.innerHTML = shops.length ? shops.map((l) => `<option value="${esc(l.shopCode)}" ${l.shopCode === keep ? 'selected' : ''}>${esc(l.shopName)}${l.shopKind === 'camp' ? ' (camp)' : ''}</option>`).join('')
    : '<option value="">No linked shops yet</option>';
}

function slotPlan() {
  const f = $('#slotForm');
  const v = (n) => f.elements.namedItem(n).value;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const len = Number(v('minutes'));
  const n = v('start') && v('end') ? Math.min(48, Math.floor((toMin(v('end')) - toMin(v('start'))) / len)) : 0;
  return { date: v('date'), start: v('start'), end: v('end'), minutes: len, mode: v('mode'), place: v('mode') === 'video' ? 'video' : v('place'), note: v('note').trim(), n };
}
function slotPreview() {
  const p = slotPlan();
  $('#slotPreview').textContent = p.date && p.n > 0
    ? `Adds ${plural(p.n, 'slot')} of ${p.minutes} min on ${fmtDay(p.date, { weekday: 'short', day: 'numeric', month: 'short' })}, ${p.start} to ${p.end} IST.` : '';
}

async function addSlots(e) {
  e.preventDefault();
  const p = slotPlan();
  const err = $('#slotErr'); const ok = $('#slotOk');
  err.textContent = ''; ok.textContent = '';
  if (!p.date) { err.textContent = 'Pick a date.'; return; }
  if (!p.start || !p.end || p.end <= p.start) { err.textContent = 'The end time must be after the start.'; return; }
  if (p.n < 1) { err.textContent = `The time from ${p.start} to ${p.end} is shorter than one ${p.minutes}-minute slot.`; return; }
  if (new Date(`${p.date}T${p.start}:00+05:30`).getTime() < Date.now()) { err.textContent = 'Pick a time that is still ahead.'; return; }
  if (p.mode !== 'video' && !p.place) { err.textContent = 'In-person and camp slots need one of your linked shops: link with a shop first.'; return; }
  $('#slotGo').disabled = true;
  try {
    const r = await capi('/slots', { method: 'POST', body: { date: p.date, start: p.start, end: p.end, minutes: p.minutes, mode: p.mode, place: p.place, note: p.note } });
    ok.textContent = `Added ${plural(r.created, 'slot')} on ${fmtDay(p.date, { weekday: 'long', day: 'numeric', month: 'long' })}.`;
    calWeek = mondayOf(p.date);
    await loadWeek();
  } catch (x) {
    if (x.status !== 401) err.textContent = x.status === 0 ? 'Could not reach the server. Try again.' : `Could not add the slots${x.detail ? `: ${x.detail}` : '.'}`;
  } finally { $('#slotGo').disabled = false; }
}

async function loadWeek() {
  if (!$('#week')) return;
  const from = calWeek; const to = addDays(calWeek, 7);
  const last = addDays(from, 6);
  $('#calRange').textContent = from.slice(0, 7) === last.slice(0, 7)
    ? `${fmtDay(from, { day: 'numeric' })} to ${fmtDay(last, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${fmtDay(from, { day: 'numeric', month: 'short' })} to ${fmtDay(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  try { calSlots = await capi(`/slots?from=${encodeURIComponent(istIso(from))}&to=${encodeURIComponent(istIso(to))}`); } catch (x) {
    if (x.status !== 401) $('#week').innerHTML = '<p class="err">Could not load your slots.</p>';
    return;
  }
  if (calWeek !== from) return; // the week changed while loading
  renderWeek();
}

function slotBlock(s, now) {
  const b = s.booking;
  const past = new Date(s.end).getTime() < now;
  const cls = `slot ${esc(s.mode)} ${b ? `booked bk-${esc(b.status)}` : 'free'}${past ? ' past' : ''}`;
  const label = `${hhmm(s.start)} ${MODE[s.mode]?.label || s.mode}${b ? `, ${b.patientRef}, ${shopName(b.shopCode)}, ${BK[b.status] || b.status}` : ', free'}`;
  return `<button type="button" class="${cls}" data-slot="${esc(s.id)}" aria-label="${esc(label)}">
    <span class="s-t"><b>${hhmm(s.start)}</b><span>${MODE[s.mode]?.label || esc(s.mode)}</span></span>
    ${b ? `<span class="s-who">${esc(b.patientRef)}</span><span class="s-shop">${esc(shopName(b.shopCode))}</span>${b.reason ? `<span class="s-rsn">${esc(b.reason)}</span>` : ''}<span class="s-st">${BK[b.status] || esc(b.status)}</span>`
    : s.mode !== 'video' ? `<span class="s-shop">${esc(s.placeName || s.place)}</span>` : ''}
  </button>`;
}

function renderWeek() {
  const today = todayKey(); const now = Date.now();
  const days = [...Array(7)].map((_, i) => addDays(calWeek, i));
  $('#week').innerHTML = days.map((k) => {
    const list = calSlots.filter((s) => dayKey(s.start) === k);
    const nb = list.filter((s) => s.booked).length;
    return `<div class="wday${k === today ? ' today' : ''}${list.length ? '' : ' empty'}${k < today ? ' pastday' : ''}">
      <header><b>${esc(fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><small>${k === today ? 'Today · ' : ''}${list.length ? `${plural(list.length, 'slot')}${nb ? `, ${nb} booked` : ''}` : 'No slots'}</small></header>
      <div class="wslots">${list.map((s) => slotBlock(s, now)).join('')}</div></div>`;
  }).join('');
  $$('[data-slot]', $('#week')).forEach((b) => b.onclick = () => openSlot(b.dataset.slot));
}

function bookingActions(b) {
  const st = b.status;
  const btn = (to, label, cls = '') => `<button type="button" class="btn small ${cls}" data-bk="${esc(b.id)}" data-to="${to}">${label}</button>`;
  if (st === 'booked') return btn('confirmed', 'Confirm', 'primary') + btn('done', 'Done') + btn('no_show', 'No-show') + btn('cancelled', 'Cancel', 'ghost');
  if (st === 'confirmed') return btn('done', 'Done', 'primary') + btn('no_show', 'No-show') + btn('cancelled', 'Cancel', 'ghost');
  if (st === 'done' || st === 'no_show') return btn('confirmed', 'Undo', 'ghost');
  return '';
}
const bkPill = (st) => `<span class="bkpill ${esc(st)}">${BK[st] || esc(st)}</span>`;

function renderUpcoming() {
  const box = $('#upList'); if (!box) return;
  const t = todayKey(); const tm = addDays(t, 1);
  const groups = [[t, 'Today'], [tm, 'Tomorrow']].map(([k, label]) => [label, bookings.filter((s) => s.booking && dayKey(s.start) === k).sort((a, b) => a.start.localeCompare(b.start))]);
  if (!groups.some(([, l]) => l.length)) { box.innerHTML = '<p class="muted small">No bookings today or tomorrow. Linked shops book your free slots for their patients.</p>'; return; }
  box.innerHTML = groups.map(([label, list]) => `<h3>${label}${list.length ? ` · ${list.length}` : ''}</h3>${list.length ? `<ul class="uplist">${list.map((s) => `<li class="up">
      <button type="button" class="up-t" data-slot="${esc(s.id)}" aria-label="Details"><b>${hhmm(s.start)}</b><small>${minsOf(s)} min</small></button>
      <div class="up-m"><b>${esc(s.booking.patientRef)}</b>${s.booking.reason ? `<span>${esc(s.booking.reason)}</span>` : ''}<small>${esc(placeText(s))} · ${esc(shopName(s.booking.shopCode))}</small></div>
      ${bkPill(s.booking.status)}
      <div class="up-a">${bookingActions(s.booking)}</div></li>`).join('')}</ul>` : '<p class="muted small">None.</p>'}`).join('');
  $$('[data-slot]', box).forEach((b) => b.onclick = () => openSlot(b.dataset.slot));
  $$('[data-bk]', box).forEach((b) => b.onclick = () => setBooking(b.dataset.bk, b.dataset.to));
}

function openSlot(id) {
  const s = calSlots.find((x) => x.id === id) || bookings.find((x) => x.id === id);
  if (!s) return false;
  const dlg = $('#slotDlg');
  const b = s.booking;
  const past = new Date(s.end).getTime() < Date.now();
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  dlg.innerHTML = `<div class="dlgbody">
    <div class="dlghead"><h2 id="slotDlgTitle">${ic(MODE[s.mode]?.icon || 'clock')} ${esc(fmtDay(dayKey(s.start), { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
      <button type="button" class="btn ghost small" id="dlgX" aria-label="Close">${ic('x')}</button></div>
    <p class="meta">${hhmm(s.start)} to ${hhmm(s.end)} IST · ${minsOf(s)} min · ${esc(placeText(s))}</p>
    ${b ? `<div class="dlgkv">${kv('Patient', esc(b.patientRef))}${kv('Shop', esc(shopName(b.shopCode)))}${b.reason ? kv('Reason', esc(b.reason)) : ''}${b.caseRef ? kv('Case', esc(shortCode(b.caseRef))) : ''}${kv('Status', bkPill(b.status))}</div>`
    : `<p class="dlgfree">${past ? 'This slot passed without a booking.' : 'Free. Your linked shops can book it for a patient.'}</p>`}
    ${s.note ? `<p class="small muted">Note for the shop: ${esc(s.note)}</p>` : ''}
    <div class="row gap wrap dlgact">${b ? bookingActions(b) : past ? '' : '<button type="button" class="btn small warn" id="slotDel">Remove this slot</button>'}</div>
    <p class="err" id="dlgErr" role="alert"></p></div>`;
  $('#dlgX').onclick = () => dlg.close();
  $$('[data-bk]', dlg).forEach((x) => x.onclick = () => setBooking(x.dataset.bk, x.dataset.to, s.id));
  const del = $('#slotDel');
  if (del) del.onclick = () => removeSlot(s.id);
  if (!dlg.open) dlg.showModal();
  return true;
}

async function setBooking(bid, status, reopen) {
  if (status === 'cancelled' && !confirm('Cancel this booking? The shop sees it as cancelled and the slot opens for booking again.')) return;
  const dlg = $('#slotDlg');
  try { await capi(`/bookings/${encodeURIComponent(bid)}`, { method: 'PATCH', body: { status } }); } catch (x) {
    if (x.status === 401) return;
    const msg = `Could not update the booking${x.detail ? `: ${x.detail}` : '.'}`;
    if (dlg.open && $('#dlgErr')) $('#dlgErr').textContent = msg; else alert(msg);
    return;
  }
  await Promise.all([loadWeek(), refreshBookings()]);
  if (reopen && dlg.open && !openSlot(reopen)) dlg.close();
}

async function removeSlot(id) {
  try { await capi(`/slots/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (x) {
    if (x.status !== 401) $('#dlgErr').textContent = x.status === 409 ? 'This slot was just booked: it can no longer be removed.' : `Could not remove the slot${x.detail ? `: ${x.detail}` : '.'}`;
    return;
  }
  $('#slotDlg').close();
  await loadWeek();
}

// ---------------------------------------------------------------- my shops
function casesByShop() {
  const byName = Object.fromEntries(links.map((l) => [String(l.shopName || '').trim().toLowerCase(), l.shopCode]));
  const out = {};
  for (const r of rows) {
    const k = shopKeyOf(r, byName);
    const o = (out[k] ||= { n: 0, open: 0 });
    o.n++; if (r.status !== 'reviewed') o.open++;
  }
  return out;
}

async function shopsTab() {
  const el = $('#shopsTab');
  try { await loadMe(); } catch { /* keep the last copy */ }
  if (!clin) return;
  renderNavCounts();
  const act = activeLinks();
  const req = links.filter((l) => l.status === 'requested');
  const counts = casesByShop();
  const where = (l) => [[l.shopArea, l.shopCity].filter(Boolean).join(', '), l.shopPin ? `PIN ${l.shopPin}` : ''].filter(Boolean).join(' · ');
  el.innerHTML = `<div class="tabhead"><div><h1>My shops</h1>
      <p class="meta">A shop can work with several optometrists and ophthalmologists, and you with several shops.</p></div></div>
    <section class="card codecard">
      <div><h2>${ic('user')} Your clinician code</h2><p class="small muted">Give this code to a shop or camp. They send you a link request with it, and you accept it here.</p></div>
      <div class="codebox"><b class="mono" id="myCode">${esc(clin.code)}</b><button type="button" class="btn small" id="copyCode">Copy</button></div>
    </section>
    <section class="card">
      <h2>Link requests${req.length ? ` <span class="countpill">${req.length}</span>` : ''}</h2>
      ${req.length ? `<ul class="reqlist">${req.map((l) => `<li>
        <em class="lav">${ic(KIND_ICON[l.shopKind] || 'glasses')}</em>
        <div><b>${esc(l.shopName)}</b><small>${esc(KIND[l.shopKind] || l.shopKind || '')}${where(l) ? ` · ${esc(where(l))}` : ''}</small><small>Asks you to be their ${esc(l.roleLabel.toLowerCase())}${l.createdAt ? ` · ${ago(l.createdAt)}` : ''}</small></div>
        <div class="row gap"><button type="button" class="btn small primary" data-accept="${esc(l.shopCode)}">Accept</button><button type="button" class="btn small ghost" data-decline="${esc(l.shopCode)}">Decline</button></div></li>`).join('')}</ul>`
      : '<p class="muted small">No requests waiting. When a shop asks to work with you, the request appears here.</p>'}
      <p class="err" id="linkErr" role="alert"></p>
    </section>
    <div class="sechead"><h2>Linked shops and camps</h2><p class="meta">${act.length ? plural(act.length, 'active link') : 'None yet'}</p></div>
    ${act.length ? `<div class="linkgrid">${act.map((l) => {
      const c = counts[l.shopCode];
      return `<article class="card linkcard">
        <div class="lc-top"><em class="lav">${ic(KIND_ICON[l.shopKind] || 'glasses')}</em><div><h2>${esc(l.shopName)}</h2><p class="meta">${esc(KIND[l.shopKind] || l.shopKind || '')}${where(l) ? ` · ${esc(where(l))}` : ''}</p></div></div>
        <div class="lc-foot"><span class="rolepill">${esc(l.roleLabel)}</span><span class="small muted">${c ? `${plural(c.n, 'case')}, ${c.open} open` : 'No cases yet'}</span></div>
      </article>`;
    }).join('')}</div>` : '<p class="muted">No linked shops yet. Share your clinician code with the shops and camps you work with.</p>'}`;
  $('#copyCode').onclick = async () => {
    try { await navigator.clipboard.writeText(clin.code); $('#copyCode').textContent = 'Copied'; } catch { $('#copyCode').textContent = 'Select and copy'; }
    setTimeout(() => { if ($('#copyCode')) $('#copyCode').textContent = 'Copy'; }, 2000);
  };
  $$('[data-accept]', el).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { const d = await capi(`/links/${encodeURIComponent(b.dataset.accept)}/accept`, { method: 'POST' }); links = d.links || links; } catch (x) {
      b.disabled = false; if (x.status !== 401) $('#linkErr').textContent = `Could not accept the request${x.detail ? `: ${x.detail}` : '.'}`; return;
    }
    await refreshList(); shopsTab();
  });
  $$('[data-decline]', el).forEach((b) => b.onclick = async () => {
    const l = links.find((x) => x.shopCode === b.dataset.decline);
    if (!confirm(`Decline the request from ${l?.shopName || b.dataset.decline}?`)) return;
    try { await capi(`/links?shopCode=${encodeURIComponent(b.dataset.decline)}&clinicianCode=${encodeURIComponent(clin.code)}`, { method: 'DELETE' }); } catch (x) {
      if (x.status !== 401) $('#linkErr').textContent = `Could not decline the request${x.detail ? `: ${x.detail}` : '.'}`; return;
    }
    shopsTab();
  });
}

// ---------------------------------------------------------------- account: who is signed in
function renderMe() {
  if (!clin) return;
  $('#me').innerHTML = `${ic('user', { size: 16 })}<span class="mename"><b>${esc(clin.name)}</b><small>${esc(clin.code)}${session?.demo ? ' · demo' : ''}</small></span>`;
  $('#me').setAttribute('aria-label', `Signed in as ${clin.name}. Account menu`);
}
function renderClinBanner() {
  const el = $('#clinBanner');
  if (!clin || session?.demo || clin.status === 'verified') { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = clin.status === 'rejected'
    ? `${ic('alert', { size: 16 })}<span>Your registration <b>${esc(clin.regNo || '')}</b> was not verified by the network admin${clin.note ? `: ${esc(clin.note)}` : ''}. Signing off stays locked; contact the network admin.</span>`
    : `${ic('clock', { size: 16 })}<span>Your registration <b>${esc(clin.regNo || '')}</b> is being verified by the network admin. You can explore cases; signing off unlocks once you are verified.</span>`;
}
function renderNavCounts() {
  const req = links.filter((l) => l.status === 'requested').length;
  $('#navReq').hidden = !req; $('#navReq').textContent = req ? `${req} new` : '';
  const t = todayKey();
  const today = bookings.filter((s) => s.booking && dayKey(s.start) === t && ['booked', 'confirmed'].includes(s.booking.status)).length;
  $('#navToday').hidden = !today; $('#navToday').textContent = today ? `${today} today` : '';
}
function toggleMeMenu(open) {
  const menu = $('#meMenu');
  const show = open ?? menu.hidden;
  if (!show || !clin) { menu.hidden = true; $('#me').setAttribute('aria-expanded', 'false'); return; }
  const st = clin.status;
  menu.innerHTML = `<p class="mehead">Signed in as <b>${esc(clin.name)}</b></p>
    ${session?.demo ? '<p><span class="demotag">Demo session</span></p>' : ''}
    <dl class="medl">
      <div><dt>Role</dt><dd>${esc(ROLE[clin.role] || clin.role)}${clin.qualification ? `, ${esc(clin.qualification)}` : ''}</dd></div>
      <div><dt>Registration</dt><dd>${esc(clin.regNo || '–')}${clin.council ? `<small>${esc(clin.council)}</small>` : ''}</dd></div>
      <div><dt>Status</dt><dd><span class="vstat ${esc(st)}">${st === 'verified' ? ic('check', { size: 14 }) : ''}${esc(STATUS[st] || st)}</span></dd></div>
      <div><dt>Clinician code</dt><dd class="mono">${esc(clin.code)}</dd></div>
    </dl>
    <button type="button" class="btn small" id="signOut">Sign out</button>`;
  menu.hidden = false;
  $('#me').setAttribute('aria-expanded', 'true');
  $('#signOut').onclick = signOut;
}

async function loadMe() {
  const d = await capi('/clin/me');
  clin = d.clinician; links = d.links || [];
  session.demo = Boolean(d.demo);
  sset('dd.clin', session);
  me.name = clin.name; me.regNo = clin.regNo || '';
}
async function recheckMe() {
  if (!session) return;
  const was = clin?.status;
  try { await loadMe(); } catch { return; }
  if (clin.status !== was) { renderMe(); renderClinBanner(); if ($('#rvSigned')) $('#rvSigned').innerHTML = signedAs(); }
}

// ---------------------------------------------------------------- the gate
function showGate(msg = '') {
  $('.shell').hidden = true;
  $('#gate').hidden = false;
  $('#gateMsg').textContent = msg;
  $('#demoBtn').disabled = false;
  $('#demoBtn').textContent = 'Explore the demo (no sign-in)';
}
function hideGate() {
  $('#gate').hidden = true;
  $('.shell').hidden = false;
  $('#gateMsg').textContent = '';
  for (const f of [$('#loginForm'), $('#regForm')]) f.elements.namedItem('password').value = '';
}
function resetPortal() {
  timers.forEach(clearInterval); timers = [];
  session = null; clin = null; links = []; rows = []; bookings = []; calSlots = []; calWeek = null; selected = null;
  scope = { scope: 'all', shops: [] };
  for (const k of Object.keys(names)) delete names[k];
  identities.clear();
  sdel('dd.clin');
  me.name = ''; me.regNo = '';
  toggleMeMenu(false);
  if ($('#slotDlg').open) $('#slotDlg').close();
  if (location.search) history.replaceState(null, '', location.pathname);
  $('#dashBody').innerHTML = ''; $('#cases').innerHTML = ''; $('#detail').innerHTML = ''; $('#psearch').value = '';
  $('#detail').hidden = true; $('#plistView').hidden = false;
  for (const id of ['#calendarTab', '#shopsTab', '#planningTab', '#rulesTab']) { $(id).innerHTML = ''; delete $(id).dataset.ready; }
  $('#clinBanner').hidden = true;
}
function sessionEnded() {
  if (!session) return;
  resetPortal();
  showGate('Your session has ended. Sign in again, or open the demo.');
}
async function signOut() {
  const tok = session?.token;
  if (tok) { try { await fetch(`${API}/clin/logout`, { method: 'POST', headers: { 'X-Clin-Token': tok } }); } catch { /* offline: the session expires on its own */ } }
  resetPortal();
  setGateMode('in');
  showGate('You have signed out.');
}

async function startSession(data) {
  session = { token: data.token, demo: Boolean(data.demo) };
  sset('dd.clin', session);
  clin = data.clinician; me.name = clin.name; me.regNo = clin.regNo || '';
  try {
    await loadMe();
    await enterPortal();
  } catch (e) {
    if (session) resetPortal();
    showGate(e.status === 0 ? 'Could not reach the server. Check the connection and try again.' : 'Could not open the portal. Try again.');
  }
}

async function enterPortal() {
  hideGate();
  renderMe(); renderClinBanner(); renderNavCounts();
  try { setRuleOverrides(await (await fetch(`${API}/rules`)).json()); } catch { /* defaults */ }
  navRulesBadge();
  await loadHub();
  await refreshList();
  if (!session) return;
  await refreshBookings();
  const t = PARAMS.get('tab');
  if (selected) openCase(selected); else showTab(!entered && TABS[t] ? t : 'dash');
  entered = true;
  timers.push(setInterval(refreshList, 8000));
  timers.push(setInterval(refreshBookings, 60000));
  if (clin.status !== 'verified') timers.push(setInterval(recheckMe, 60000));
}

function setGateMode(m) {
  $$('[data-gmode]').forEach((b) => b.classList.toggle('on', b.dataset.gmode === m));
  $('#loginForm').hidden = m !== 'in';
  $('#regForm').hidden = m !== 'up';
  $('#gateMsg').textContent = '';
}
function setRole() {
  const f = $('#regForm');
  const role = f.elements.namedItem('role').value;
  $$('#regRole label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
  const keep = $('#regCouncil').value;
  $('#regCouncil').innerHTML = `<option value="">Choose your council</option>${COUNCILS[role].map((c) => `<option ${c === keep ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
  $('#qualList').innerHTML = QUALS[role].map((q) => `<option value="${esc(q)}"></option>`).join('');
  f.elements.namedItem('regNo').placeholder = role === 'optometrist' ? 'e.g. TN-OPT-1234' : 'e.g. TNMC-12345';
  f.elements.namedItem('qualification').placeholder = role === 'optometrist' ? 'e.g. B.Optom' : 'e.g. MS (Ophthalmology)';
}

const loginOk = (v) => /^\+?\d{10,13}$/.test(v.replace(/[\s()-]/g, '')) || /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$/i.test(v.trim());
function fieldErr(f, name, msg) {
  const wrap = $(`[data-f="${name}"]`, f);
  const ctl = f.elements.namedItem(name);
  const out = name === 'attest' ? $('[data-ferr="attest"]', f) : $('.ferr', wrap);
  if (out) out.textContent = msg || '';
  wrap?.classList.toggle('bad', Boolean(msg));
  if (ctl && ctl.setAttribute) { if (msg) ctl.setAttribute('aria-invalid', 'true'); else ctl.removeAttribute('aria-invalid'); }
}
function validateReg(f) {
  const v = (n) => String(f.elements.namedItem(n).value || '').trim();
  const e = {};
  if (v('name').length < 3) e.name = 'Enter your full name, as on your registration.';
  if (!v('council')) e.council = 'Choose the council you are registered with.';
  if (!/^[A-Za-z0-9/ .-]{4,24}$/.test(v('regNo'))) e.regNo = 'Use 4 to 24 letters, digits, spaces, / . or -, as on your certificate.';
  if (v('qualification').length < 2) e.qualification = 'Enter your qualification.';
  if (!/^\d{6}$/.test(v('practicePin'))) e.practicePin = 'A PIN code has 6 digits.';
  if (v('practiceArea').length < 2) e.practiceArea = 'Enter the area where you practise.';
  if (!loginOk(v('login'))) e.login = 'Enter a 10-digit mobile number or an email.';
  if (String(f.elements.namedItem('password').value).length < 8) e.password = 'Use at least 8 characters.';
  if (!f.elements.namedItem('attest').checked) e.attest = 'Confirm that these are your registration details.';
  for (const n of ['name', 'council', 'regNo', 'qualification', 'practicePin', 'practiceArea', 'login', 'password', 'attest']) fieldErr(f, n, e[n]);
  return e;
}

function wireGate() {
  $$('[data-gmode]').forEach((b) => b.onclick = () => setGateMode(b.dataset.gmode));
  setRole();
  $$('#regRole input').forEach((r) => r.onchange = setRole);
  $('#demoBtn').onclick = async () => {
    const b = $('#demoBtn');
    b.disabled = true; b.textContent = 'Opening the demo…'; $('#gateMsg').textContent = '';
    let r;
    try { r = await fetch(`${API}/clin/demo`, { method: 'POST' }); } catch { r = null; }
    if (!r || !r.ok) { b.disabled = false; b.textContent = 'Explore the demo (no sign-in)'; $('#gateMsg').textContent = r ? `The demo is not available on this server (${r.status}).` : 'Could not reach the server. Check the connection and try again.'; return; }
    await startSession({ ...(await r.json()), demo: true });
  };
  const lf = $('#loginForm');
  lf.onsubmit = async (e) => {
    e.preventDefault();
    const login = lf.elements.namedItem('login').value.trim();
    const password = lf.elements.namedItem('password').value;
    const err = $('#liErr');
    if (!loginOk(login)) { err.textContent = 'Enter the 10-digit mobile number or the email you registered with.'; lf.elements.namedItem('login').focus(); return; }
    if (!password) { err.textContent = 'Enter your password.'; lf.elements.namedItem('password').focus(); return; }
    $('#liGo').disabled = true; err.textContent = '';
    let r;
    try { r = await fetch(`${API}/clin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) }); } catch { r = null; }
    $('#liGo').disabled = false;
    if (!r) { err.textContent = 'Could not reach the server. Check the connection and try again.'; return; }
    if (!r.ok) {
      err.textContent = {
        401: 'Wrong phone, email or password.',
        403: 'The network admin did not verify this registration, so the account cannot sign in. Contact the network admin to correct your details.',
        429: 'Too many tries. Wait 15 minutes, then try again.',
        422: 'Enter the 10-digit mobile number or the email you registered with.',
      }[r.status] || `Could not sign in (${r.status}).`;
      if (r.status === 401) { lf.elements.namedItem('password').value = ''; lf.elements.namedItem('password').focus(); }
      return;
    }
    await startSession({ ...(await r.json()), demo: false });
  };
  const rf = $('#regForm');
  rf.addEventListener('input', (e) => { const n = e.target.name; if (n && $(`[data-f="${n}"]`, rf)?.classList.contains('bad')) fieldErr(rf, n, ''); });
  rf.addEventListener('change', (e) => { const n = e.target.name; if (n && $(`[data-f="${n}"]`, rf)?.classList.contains('bad')) fieldErr(rf, n, ''); });
  rf.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#regErr'); err.textContent = '';
    const bad = validateReg(rf);
    const first = Object.keys(bad)[0];
    if (first) { rf.elements.namedItem(first).focus(); err.textContent = Object.keys(bad).length > 1 ? `Check the ${Object.keys(bad).length} fields marked above.` : ''; return; }
    const v = (n) => String(rf.elements.namedItem(n).value || '').trim();
    const body = { name: v('name'), role: rf.elements.namedItem('role').value, council: v('council'), regNo: v('regNo'), qualification: v('qualification'),
      practiceArea: v('practiceArea'), practicePin: v('practicePin'), login: v('login'), password: rf.elements.namedItem('password').value, attest: true };
    $('#regGo').disabled = true;
    let r;
    try { r = await fetch(`${API}/clin/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch { r = null; }
    $('#regGo').disabled = false;
    if (!r) { err.textContent = 'Could not reach the server. Check the connection and try again.'; return; }
    if (!r.ok) {
      const x = await errOf(r);
      if (r.status === 409 && /phone or email/i.test(x.detail)) { fieldErr(rf, 'login', 'An account with this phone or email exists. Sign in instead.'); rf.elements.namedItem('login').focus(); return; }
      if (r.status === 409) { fieldErr(rf, 'regNo', 'This registration number is already registered with this council. If it is yours, contact the network admin.'); rf.elements.namedItem('regNo').focus(); return; }
      if (r.status === 422 && /phone number or an email/i.test(x.detail)) { fieldErr(rf, 'login', 'Enter a 10-digit mobile number or an email.'); return; }
      err.textContent = `Could not register (${r.status}${x.detail ? `: ${x.detail}` : ''}).`;
      return;
    }
    const data = await r.json();
    rf.reset(); setRole();
    await startSession({ ...data, demo: false });
  };
}

// ---------------------------------------------------------------- start
$('#openOnly').onchange = refreshList;
$('#psearch').oninput = refreshList;
$$('[data-tab]').forEach((b) => b.onclick = () => { if (b.dataset.tab === 'queue') selected = null; showTab(b.dataset.tab); });
$('#me').onclick = (e) => { e.stopPropagation(); toggleMeMenu(); };
document.addEventListener('click', (e) => { if (!$('#meMenu').hidden && !e.target.closest('.mewrap')) toggleMeMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#meMenu').hidden) { toggleMeMenu(false); $('#me').focus(); } });
$('#slotDlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$$('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', ic(el.dataset.icon)));
wireGate();

if (session) {
  try { await loadMe(); await enterPortal(); } catch (e) {
    if (session) { resetPortal(); }
    showGate(e.status === 401 || e.message === 'expired' ? 'Your session has ended. Sign in again, or open the demo.' : e.status === 0 ? 'Could not reach the server. Check the connection and try again.' : '');
  }
} else showGate();

// ---------------------------------------------------------------- helpers added in v0.5
function findingNotesOf(form) {
  return Object.fromEntries([...new FormData(form).entries()]
    .filter(([k, v]) => k.startsWith('fn_') && String(v).trim()).map(([k, v]) => [k.slice(3), String(v).trim()]));
}
function navRulesBadge() {
  const n = Object.keys(ruleOverrides().rules || {}).length;
  $('#navRules').hidden = !n; $('#navRules').textContent = n ? `${n} edited` : '';
}

// Video consult: the optometrist sees the patient through the store phone.
function startHubCall(c, who) {
  const live = rows.find((r) => r.id === c.id)?.call;
  const tri = c.profile.triage;
  const m = c.measurements || {};
  const kv = (k, v) => (v ? `<div class="sd"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '');
  const side = `<h3>Shared health data</h3>
    <div class="sdata">
      <div class="sd lane ${esc(tri.lane)}"><b>${esc(urgencyLine(tri))}</b></div>
      ${tri.flags.slice(0, 3).map((f) => `<div class="sd"><span class="tier ${esc(f.tier)}">${esc(TIERS[f.tier]?.label || f.tier)}</span><b>${esc(f.title)}</b></div>`).join('')}
      ${kv('Distance vision', m.acuity?.R ? `R ${snellen(m.acuity.R.logmar)} · L ${snellen(m.acuity.L?.logmar ?? null)}` : '')}
      ${kv('Amsler', m.amsler?.R ? `R ${m.amsler.R} · L ${m.amsler.L || '–'}` : '')}
      ${kv('Current glasses', m.lensometry?.R ? `R ${m.lensometry.R.se?.toFixed?.(2) ?? ''} D` : '')}
      ${kv('Suggested', c.profile.recommendation?.title)}
    </div>
    <h3>Call notes</h3><textarea id="callNotes" placeholder="Notes from the call. They are added to your comments when the call ends."></textarea>`;
  let notes = '';
  const onEnd = () => {
    const box = $('#rvForm [name=comments]');
    if (notes.trim() && box) box.value = `${box.value ? `${box.value}\n` : ''}Video consult: ${notes.trim()}`;
    refreshList();
  };
  const go = (callId, initiator) => {
    const { el } = openCall({ api: API, headers: headers(), callId, role: 'hub', initiator, title: `${who.name || shortCode(c.id)} · ${c.site?.name || ''}`, side, onEnd });
    el.querySelector('#callNotes').oninput = (e) => { notes = e.target.value; };
  };
  if (live && live.by === 'store' && live.status === 'ringing') { go(live.id, false); return; }
  createCall(API, c.id, 'hub', headers()).then((id) => go(id, true)).catch(() => { $('#rvErr') && ($('#rvErr').textContent = 'Could not start the call.'); });
}

// Referral rules: the hub optometrists change tier, time to care and action.
function describeEdit(a = {}) { return [a.tier && `tier: ${TIERS[a.tier]?.label || a.tier}`, a.within && `time: ${a.within}`, a.action && 'action reworded', a.off && 'switched off'].filter(Boolean).join('; '); }
async function rulesTab() {
  try { setRuleOverrides(await (await fetch(`${API}/rules`)).json()); } catch { /* keep */ }
  navRulesBadge();
  let hist = [];
  try { const r = await fetch(`${API}/rules/history`, { headers: headers() }); hist = r.ok ? await r.json() : []; } catch { hist = []; }
  $('#rulesTab').innerHTML = `<div class="dhead"><div><h1>Referral rules</h1>
      <p class="muted">Change a rule's tier, time to care or action for every phone. Each change needs a reason and is kept in the history below.</p></div></div>
    <div id="ruleEditor"></div>
    ${rulesTableHtml({ editable: true })}
    <section class="card"><h2>Change history</h2>${hist.length ? `<div class="tablewrap"><table class="trace"><tr><th>When (UTC)</th><th>Who</th><th>Rule</th><th>Change</th><th>Reason</th></tr>
      ${hist.map((h) => `<tr><td>${esc((h.at || '').replace('T', ' ').slice(0, 16))}</td><td>${esc(h.actor)}</td><td>${esc(RULE_BY_CODE[h.code]?.title || h.code)}</td><td>${esc(h.action === 'rule_reset' ? 'Reset to default' : describeEdit(h.after))}</td><td>${esc(h.after?.reason || h.reason || '')}</td></tr>`).join('')}</table></div>`
      : '<p class="muted small">No edits yet: every phone runs the built-in defaults.</p>'}</section>`;
  $$('[data-edit]', $('#rulesTab')).forEach((b) => b.onclick = () => ruleEditor(b.dataset.edit));
}
function ruleEditor(code) {
  const base = RULE_BY_CODE[code];
  if (!base) return;
  const eff = effectiveRule(base);
  const box = $('#ruleEditor');
  const locked = !session?.demo && clin && clin.status !== 'verified';
  box.innerHTML = `<form class="card form ruleform" id="ruleForm">
    <div class="row between"><h2>${ic('edit')} ${esc(base.title)}</h2><button class="btn ghost small" type="button" id="reClose" aria-label="Close">${ic('x')}</button></div>
    <p class="small muted">Fires when: ${esc(base.criteria)}. This test is fixed. Default: ${esc(TIERS[base.tier].label)}, ${esc(base.within)}.</p>
    <div class="row gap wrap">
      <label>Tier<select name="tier">${TIER_ORDER.map((t) => `<option value="${t}" ${t === eff.tier ? 'selected' : ''}>${TIERS[t].label}</option>`).join('')}</select></label>
      <label style="flex:1;min-width:220px">Time to care<input name="within" value="${esc(eff.within)}" maxlength="120"></label>
    </div>
    <label>Action<textarea name="action" maxlength="400">${esc(eff.action)}</textarea></label>
    ${base.tier === 'emergency' ? '<p class="small muted">Emergency rules cannot be switched off. You can change the tier, with a reason.</p>' : `<label class="check"><input type="checkbox" name="off" ${eff.off ? 'checked' : ''}> Switch this rule off</label>`}
    <label>Reason for the change<input name="reason" id="reReason" required minlength="5" maxlength="500" placeholder="e.g. Agreed at the hub meeting; the partner hospital sees these within 48 h"></label>
    <p class="warn-text small" id="reWarn"></p>
    ${locked ? `<div class="signlock">${ic('lock')}<div><b>Rule changes unlock once you are verified</b><span>Every phone follows these rules, so only verified clinicians can change them.</span></div></div>` : ''}
    <div class="row gap wrap"><button class="btn primary" type="submit" ${locked ? 'disabled' : ''}>Save for all phones</button>${eff.edited && !locked ? '<button class="btn ghost" type="button" id="reReset">Reset to default</button>' : ''}</div>
    <p class="err" id="reErr"></p></form>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const form = $('#ruleForm');
  form.tier.onchange = () => {
    $('#reWarn').textContent = TIERS[form.tier.value].rank < TIERS[base.tier].rank ? `Lower than the default (${TIERS[base.tier].label}): patients with this finding will wait longer.` : '';
  };
  $('#reClose').onclick = () => { box.innerHTML = ''; };
  const by = () => ({ name: me.name, regNo: me.regNo || null });
  const send = async (url, method, body) => {
    const r = await fetch(url, { method, headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (!r.ok) { $('#reErr').textContent = r.status === 422 ? 'Give a reason of at least 5 characters.' : `Could not save (${r.status}).`; return; }
    setRuleOverrides(await r.json());
    rulesTab();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    if (locked) return;
    const body = { reason: form.reason.value, by: by() };
    if (form.tier.value !== base.tier) body.tier = form.tier.value;
    if (form.within.value.trim() && form.within.value.trim() !== base.within) body.within = form.within.value.trim();
    if (form.action.value.trim() && form.action.value.trim() !== base.action) body.action = form.action.value.trim();
    if (form.off?.checked) body.off = true;
    if (!body.tier && !body.within && !body.action && !body.off) {
      if (eff.edited) send(`${API}/rules/${code}/reset`, 'POST', { reason: body.reason, by: by() });
      else $('#reErr').textContent = 'Nothing changed.';
      return;
    }
    send(`${API}/rules/${code}`, 'PUT', body);
  };
  const rr = $('#reReset');
  if (rr) rr.onclick = () => (form.reason.value.trim().length < 5 ? ($('#reErr').textContent = 'Give a reason first.') : send(`${API}/rules/${code}/reset`, 'POST', { reason: form.reason.value, by: by() }));
}

function byStateOf(places) {
  const out = {};
  for (const [k, v] of places) { const st = pinToState(k); if (st) out[st] = (out[st] || 0) + v.cases; }
  return out;
}
