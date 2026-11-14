// Remote Optometrist Bridge: review queue, case detail, decision, reply.
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

const API = new URLSearchParams(location.search).get('api') || '/api';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const me = load('dd.reviewer', { name: 'Optom. A. Meenakshi', regNo: 'TN-OPT-0000 (demo)' });
// Deployed servers require a portal token. Open portal.html#token=XXXX once:
// the fragment never reaches the server or its logs, and is removed at once.
const frag = new URLSearchParams(location.hash.slice(1));
if (frag.get('token')) { save('dd.portalToken', frag.get('token')); history.replaceState(null, '', location.pathname + location.search); }
const token = load('dd.portalToken', null);
let laneFilter = '';
let selected = new URLSearchParams(location.search).get('case');
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

const headers = (extra = {}) => ({ 'X-Actor': `portal:${me.name}`, ...(token ? { 'X-Portal-Token': token } : {}), ...extra });

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

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
function slaText(r) {
  if (r.status === 'reviewed') return { cls: 'done', txt: esc(r.review?.decisionLabel || 'reviewed') };
  const m = Math.round((new Date(r.slaDueAt).getTime() - Date.now()) / 60000);
  const fmt = (x) => (Math.abs(x) < 60 ? `${Math.abs(x)} min` : `${Math.floor(Math.abs(x) / 60)} h ${Math.abs(x) % 60} min`);
  return m < 0 ? { cls: 'over', txt: `overdue ${fmt(m)}` } : { cls: '', txt: `due in ${fmt(m)}` };
}

let pfilter = 'all';
const tierOfRow = (r) => r.urgency || ({ red: 'emergency', amber: 'urgent' }[r.lane] || 'routine');
const groupOf = (r) => (r.status === 'reviewed' ? 'reviewed' : ['emergency', 'urgent', 'soon'].includes(tierOfRow(r)) ? tierOfRow(r) : 'routine');
const initialsOf = (n) => String(n).replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase() || '#';
async function refreshList() {
  try {
    rows = await (await fetch(`${API}/cases`, { headers: headers() })).json();
  } catch { $('#listMeta').textContent = 'Server unreachable: retrying…'; return; }
  const ids = await Promise.all(rows.map((r) => identityOf(r.id, r.patient || {})));
  rows.forEach((r, i) => { if (ids[i].name) names[r.id] = ids[i].name; });
  const openN = rows.filter((r) => r.status !== 'reviewed').length;
  $('#navOpen').hidden = !openN; $('#navOpen').textContent = openN;
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
      <td class="num due ${sl.cls}">${sl.txt}<small>${ago(r.receivedAt)}</small></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">No patients match.</td></tr>';
  const open = rows.filter((r) => r.status !== 'reviewed');
  $('#listMeta').textContent = `${open.length} open · ${open.filter((r) => r.lane === 'red').length} emergency · ${rows.filter((r) => r.overdue).length} overdue · review targets: emergency 2 h, urgent 24 h, soon and routine 72 h`;
  $$('.crow').forEach((tr) => tr.onclick = () => openCase(tr.dataset.id));
  if (!$('#dashTab').hidden) overview();
}

// Landing view for the reviewer: what is waiting, what is late, and the one
// case to open first (the server sorts open cases by lane, then deadline).
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
  $('#dashBody').innerHTML = `<div class="overview">
    <section class="band">
    <p class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    <h1>${greet}${me.name ? `, ${esc(me.name)}` : ''}</h1>
    <p class="lede">${open.length ? `${open.length} case${open.length === 1 ? '' : 's'} waiting for review${overdue ? `, ${overdue} past the review target` : ''}.` : 'Nothing waiting. New cases appear here as soon as a phone sends them.'}</p>
    <div class="tiles">
      ${tile(open.length, 'open cases')}${tile(count('emergency'), 'emergency, review in 2 h')}${tile(count('urgent', 'soon'), 'urgent or soon')}
      ${tile(count('routine', 'info', 'none'), 'routine sign-off')}${tile(overdue, 'past review target')}${tile(rows.length - open.length, 'reviewed')}
    </div></section>
    ${first ? `<button class="nx ${first.lane === 'red' ? 'red' : 'accent'}" id="startFirst">${ic(first.lane === 'red' ? 'alert' : 'right')}<span><b>Start with the most urgent case</b><small>${esc(shortCode(first.id))} · ${esc(TIERS[tierOf(first)]?.label || first.lane)}${first.within ? ` · ${esc(first.within)}` : ''} · ${esc(slaText(first).txt)}</small></span>${ic('right')}</button>` : ''}
  </div>`;
  if (first) $('#startFirst').onclick = () => openCase(first.id);
  $('#dashBody .overview').insertAdjacentHTML('beforeend', `<div class="dash">
    <section class="card"><h2>Cases received, last 7 days</h2>${barChart({ labels: days.map((d) => d.label), title: 'Cases per day by lane', series: [
      { name: 'Routine', color: 'var(--c2)', values: onDay('green') }, { name: 'Referral', color: 'var(--lane-amber)', values: onDay('amber') },
      { name: 'Emergency', color: 'var(--lane-red)', values: onDay('red') }] })}</section>
    <section class="card"><h2>Open cases by urgency</h2>${donut({ title: 'Open cases by urgency', center: String(open.length), sub: 'open', segments: [
      { label: 'Emergency', value: count('emergency'), color: 'var(--lane-red)' }, { label: 'Urgent', value: count('urgent'), color: 'var(--c4)' },
      { label: 'Soon', value: count('soon'), color: 'var(--lane-amber)' }, { label: 'Routine', value: count('routine', 'info', 'none'), color: 'var(--c2)' }] })}</section>
  </div>`);
  const colOf = (r) => (r.status === 'reviewed' ? 'reviewed' : ['routine', 'info', 'none'].includes(tierOf(r)) ? 'routine' : tierOf(r));
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
function showTab(tab) {
  $$('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  for (const [k, el] of [['dash', '#dashTab'], ['queue', '#queueTab'], ['planning', '#planningTab'], ['rules', '#rulesTab']]) $(el).hidden = k !== tab;
  if (tab === 'dash') overview();
  if (tab === 'planning') planning();
  if (tab === 'rules') rulesTab();
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
    <div class="row gap"><button class="btn primary" type="submit">Sign and send</button><span class="muted small">Signed as ${esc(me.name)} (${esc(me.regNo || '')})</span></div>
    <p class="err" id="rvErr"></p>
  </form>`;
}

function fillMessage(c) {
  const form = $('#rvForm'); if (!form) return;
  const d = form.decision.value;
  const tpl = REPLY[d][c.lang] || REPLY[d].en;
  form.messageToPatient.value = tpl.replace('{site}', c.site?.name || 'the store').replace('{place}', (PLACES[d] || PLACES.in_person)[c.lang] || PLACES.in_person.en);
}

async function showCase(id) {
  const det = $('#detail');
  let c;
  try { c = await (await fetch(`${API}/cases/${id}`, { headers: headers() })).json(); } catch { det.innerHTML = '<p class="err">Could not load the case.</p>'; return; }
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
      <div><p class="eyebrow">${esc(shortCode(c.id))} · ${esc(c.site?.name || '')} (${esc(c.site?.type || '')}) · ${LANGS[c.lang]} · ${ago(c.server.receivedAt)}${c.demo ? ' · synthetic demo case' : ''}</p>
        <h1>${esc(who.name || `Patient ${shortCode(c.id)}`)} · ${esc(p.age ?? '?')} ${esc(p.sex || '')}</h1>
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
          <p class="muted small">${esc(rv.reviewer?.name)} · ${esc((rv.reviewedAt || '').slice(0, 16).replace('T', ' '))}</p></section>` : reviewForm(c)}
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
        reviewer: me, decision: fd.get('decision'), lensCategory: fd.get('lensCategory'), designEmphasis: fd.get('designEmphasis'),
        addD: fd.get('addD') === '' ? null : Number(fd.get('addD')), nextStep: fd.get('nextStep'), notes: fd.get('notes'), messageToPatient: fd.get('messageToPatient'),
        decisionText: fd.get('decisionText') || '', comments: fd.get('comments') || '', findingNotes: findingNotesOf(form),
      };
      const r = await fetch(`${API}/cases/${c.id}/review`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      if (!r.ok) { $('#rvErr').textContent = `Could not save (${r.status})`; return; }
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
  return {
    title: urgent ? 'Emergency referral' : 'Referral letter',
    to: urgent ? 'Eye casualty / partner eye hospital' : 'Ophthalmologist / vision centre',
    from: `${me.name}${me.regNo ? ` (${me.regNo})` : ''}, DivyaDrishti optometrist hub`,
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
    const made = await createShareLink(doc, { pin, kind, expiresDays: 7, maxViews: 20, caseRef: c.id, actor: me.name, api: API });
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

async function planning() {
  const el = $('#planningTab');
  let s;
  try { s = await (await fetch(`${API}/stats`, { headers: headers() })).json(); } catch { el.innerHTML = '<p class="err">Server unreachable.</p>'; return; }
  const maxFlag = Math.max(1, ...s.topFlags.map((f) => f[1]));
  const places = Object.entries(s.byPlace).sort((a, b) => (b[1].amber + b[1].red) - (a[1].amber + a[1].red));
  const maxPlace = Math.max(1, ...places.map(([, v]) => v.cases));
  const LABEL = { ...LENS };
  const ub = s.byUrgency || {};
  el.innerHTML = `
    <section class="band">
      <p class="eyebrow">All stores and camps on the bridge</p>
      <h1>Camp planning</h1>
      <p class="lede">Pooled, de-identified counts: where referrals cluster, which specialist camp to run next, what lens mix to stock.</p>
      <div class="tiles">
        <div class="tile"><div class="n">${s.cases}</div><div class="l">cases</div></div>
        <div class="tile"><div class="n">${s.byLane.red}</div><div class="l">emergency (same day)</div></div>
        <div class="tile"><div class="n">${(ub.urgent ?? 0)} / ${(ub.soon ?? 0)}</div><div class="l">urgent / soon referral</div></div>
        <div class="tile"><div class="n">${s.byLane.green}</div><div class="l">routine sign-off</div></div>
        <div class="tile"><div class="n">${s.medianQuestionsAsked ?? '–'}</div><div class="l">median questions asked</div></div>
        <div class="tile"><div class="n">${s.medianReviewMinutes ?? '–'}</div><div class="l">median minutes to review</div></div>
      </div>
    </section>
    <div class="dash">
      <section class="card"><h2>Why patients are referred</h2>${s.topFlags.length ? hbars(s.topFlags.map(([k, n]) => ({ label: k, value: n })), { max: maxFlag }) : '<p class="muted">No referral findings yet.</p>'}</section>
      <section class="card"><h2>Urgency mix</h2>${donut({ title: 'Cases by urgency', center: String(s.cases), sub: 'cases', segments: [
        { label: 'Emergency', value: ub.emergency ?? s.byLane.red, color: 'var(--lane-red)' }, { label: 'Urgent', value: ub.urgent ?? 0, color: 'var(--c4)' },
        { label: 'Soon', value: ub.soon ?? 0, color: 'var(--lane-amber)' }, { label: 'Routine', value: (ub.routine ?? 0) + (ub.info ?? 0) + (ub.none ?? 0), color: 'var(--c2)' }] })}</section>
      <section class="card"><h2>Referrals by area (PIN code)</h2>${hbars(places.map(([k, v]) => ({ label: k, note: `${v.amber} amber, ${v.red} red`, value: v.cases })), { max: maxPlace })}</section>
      <section class="card"><h2>Referrals on the map</h2>${indiaMap(byStateOf(places), { unit: 'cases' })}</section>
      <section class="card"><h2>Suggested lens mix</h2>${barChart({ title: 'Suggested lens categories', stacked: false,
        labels: Object.keys(s.recommendations).map((k) => (LABEL[k] || k).split(' ')[0]),
        series: [{ name: 'Patients', color: 'var(--c2)', values: Object.values(s.recommendations) }] })}</section>
      <section class="card"><h2>Vision profiles</h2>${donut({ title: 'Vision profiles', center: String(s.cases), sub: 'profiles',
        segments: Object.entries(s.dominance).map(([k, n], i) => ({ label: k, value: n, color: ['var(--c5)', 'var(--c6)', 'var(--c3)', 'var(--c7)'][i % 4] })) })}</section>
    </div>`;
}

$('#openOnly').onchange = refreshList;
$('#psearch').oninput = refreshList;
$$('[data-tab]').forEach((b) => b.onclick = () => { if (b.dataset.tab === 'queue') selected = null; showTab(b.dataset.tab); });
$('#me').innerHTML = `${ic('user', { size: 16 })}<span>${esc(me.name)}</span>`;
$('#me').onclick = () => {
  const n = prompt('Reviewer name', me.name); if (!n) return;
  const reg = prompt('Registration number', me.regNo || '') || '';
  me.name = n; me.regNo = reg; save('dd.reviewer', me); $('#me').innerHTML = `${ic('user', { size: 16 })}<span>${esc(me.name)}</span>`;
};

$$('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', ic(el.dataset.icon)));
try { setRuleOverrides(await (await fetch(`${API}/rules`)).json()); } catch { /* defaults */ }
navRulesBadge();
await loadHub();
await refreshList();
if (selected) openCase(selected); else showTab('dash');
setInterval(refreshList, 8000);
const startTab = new URLSearchParams(location.search).get('tab');
if (startTab === 'planning' || startTab === 'rules') $(`[data-tab=${startTab}]`).click();

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
  $('#rulesTab').innerHTML = `<div class="dhead"><div><p class="eyebrow">Hub settings</p><h1>Referral rules</h1>
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
    <div class="row gap wrap"><button class="btn primary" type="submit">Save for all phones</button>${eff.edited ? '<button class="btn ghost" type="button" id="reReset">Reset to default</button>' : ''}</div>
    <p class="err" id="reErr"></p></form>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const form = $('#ruleForm');
  form.tier.onchange = () => {
    $('#reWarn').textContent = TIERS[form.tier.value].rank < TIERS[base.tier].rank ? `Lower than the default (${TIERS[base.tier].label}): patients with this finding will wait longer.` : '';
  };
  $('#reClose').onclick = () => { box.innerHTML = ''; };
  const send = async (url, method, body) => {
    const r = await fetch(url, { method, headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (!r.ok) { $('#reErr').textContent = r.status === 422 ? 'Give a reason of at least 5 characters.' : `Could not save (${r.status}).`; return; }
    setRuleOverrides(await r.json());
    rulesTab();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = { reason: form.reason.value, by: me };
    if (form.tier.value !== base.tier) body.tier = form.tier.value;
    if (form.within.value.trim() && form.within.value.trim() !== base.within) body.within = form.within.value.trim();
    if (form.action.value.trim() && form.action.value.trim() !== base.action) body.action = form.action.value.trim();
    if (form.off?.checked) body.off = true;
    if (!body.tier && !body.within && !body.action && !body.off) {
      if (eff.edited) send(`${API}/rules/${code}/reset`, 'POST', { reason: body.reason, by: me });
      else $('#reErr').textContent = 'Nothing changed.';
      return;
    }
    send(`${API}/rules/${code}`, 'PUT', body);
  };
  const rr = $('#reReset');
  if (rr) rr.onclick = () => (form.reason.value.trim().length < 5 ? ($('#reErr').textContent = 'Give a reason first.') : send(`${API}/rules/${code}/reset`, 'POST', { reason: form.reason.value, by: me }));
}

function byStateOf(places) {
  const out = {};
  for (const [k, v] of places) { const st = pinToState(k); if (st) out[st] = (out[st] || 0) + v.cases; }
  return out;
}
