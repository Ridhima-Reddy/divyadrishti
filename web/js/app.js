// DivyaDrishti field app: runs on the phone a store owner or camp volunteer
// already has. Flow: consent -> adaptive voice interview -> quick checks ->
// functional vision profile -> send to the remote optometrist -> Vision Passport.
import * as E from './engine/adaptive.js';
import { QUESTION_BY_ID, questionText } from './engine/questions.js';
import { buildProfile, RULES_VERSION, CHECK_GROUPS } from './engine/profile.js';
import { validateRx } from './engine/rx.js';
import { PERSONAS, PERSONA_BY_KEY } from './engine/personas.js';
import { tr, LANGS, P, pt } from './i18n.js';
import { PACK_BY_CODE } from './lang/index.js';
import * as V from './voice.js';
import * as store from './store.js';
import { ic } from './icons.js';
import * as remote from './remote.js';
import * as account from './account.js';
import { tryOn } from './tryon.js';
import { openCall, createCall } from './call.js';
import { setRuleOverrides, TIERS } from './engine/redflags.js';
import { barChart, donut, hbars, indiaMap, pinToState, lastDays } from './charts_ui.js';

// Referral-rule edits made by the hub optometrists (engine/redflags.js), cached
// so the phone applies them offline too.
try { setRuleOverrides(JSON.parse(localStorage.getItem('dd.ruleOverrides') || 'null')); } catch { /* none yet */ }
async function pullRules() {
  try {
    const r = await fetch(`${store.API}/rules`);
    if (!r.ok) return;
    const o = await r.json();
    setRuleOverrides(o);
    localStorage.setItem('dd.ruleOverrides', JSON.stringify(o));
  } catch { /* offline: keep the cached edits */ }
}
import { passportText, whatsappLink, smsLink, shortCode } from './passport.js';
import { landoltSvg } from './measure/contrast.js';
import * as T from './tests_ui.js';
import * as G from './measure/geometry.js';
import * as A from './measure/acuity.js';
import { profileHtml, rulesTableHtml } from './profile_view.js';

const APP_VERSION = '0.4.0';
const LOW_CONFIDENCE = 0.6; // below this, a spoken answer must be confirmed by tap
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;

const main = $('#main');
// The app language (for the operator) and the patient's language are separate:
// a Tamil-speaking store owner can interview a Hindi-speaking patient. Both
// start in the phone's own language if we have it, otherwise English.
const SETTINGS_VERSION = 2;
function deviceLang() {
  for (const l of navigator.languages || [navigator.language || 'en']) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (LANGS[c]) return c;
  }
  return 'en';
}
const settings = load('dd.settings', { site: 'Chennai Optics, Velachery', siteType: 'store', operator: '', voice: true, lang: deviceLang(), uiLang: deviceLang(), listen: 'normal', optotype: 'E' });
if (settings.v !== SETTINGS_VERSION) { // older installs were saved with Tamil as the default
  settings.lang = deviceLang(); settings.uiLang = deviceLang(); settings.v = SETTINGS_VERSION;
  save('dd.settings', settings);
}
// How long a pause ends an answer (older patients pause mid-sentence).
const LISTEN = { short: { silenceMs: 1500, label: '1.5 s' }, normal: { silenceMs: 2500, label: '2.5 s' }, long: { silenceMs: 4000, label: '4 s' } };
const calib = load('dd.calibration', { pxPerMm: null, focalNorm: null });
const pxPerMm = () => calib.pxPerMm || G.defaultPxPerMm(isPhone());
const focalPxFor = (W) => (calib.focalNorm ? calib.focalNorm * W : G.defaultFocalPx(W));

let C = null; // current case
let turn = 0; // cancels stale async voice turns
let cleanup = null; // stops cameras / loops when leaving a screen

function setScreen(html, name) {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  V.stopAll();
  turn++;
  main.innerHTML = html;
  main.dataset.screen = name;
  window.scrollTo(0, 0);
  updateHeader();
  updateTabs(name);
}

const PL = () => (C ? C.lang : settings.lang);
const t = (k, vars) => tr(k, settings.uiLang, vars); // operator-facing
const tp = (k, vars) => tr(k, PL(), vars); // patient-facing: shown and spoken
const sayP = (text) => { if (settings.voice && text) V.speak(text, C ? C.lang : settings.lang); };

function updateHeader() {
  const vb = $('#voiceToggle');
  if (vb) { vb.innerHTML = settings.voice ? `${ic('volume')}<span>${t('voiceOn')}</span>` : `${ic('volumeOff')}<span>${t('voiceOff')}</span>`; vb.setAttribute('aria-pressed', String(settings.voice)); }
  const sb = $('#syncBadge');
  store.pendingCount().then((pending) => {
    if (sb) { sb.innerHTML = pending ? `${ic('refresh', { size: 16 })}<span>${pending}</span>` : ic('check', { size: 16 }); sb.classList.toggle('pending', !!pending); sb.title = pending ? `${pending} waiting to sync` : 'All synced'; }
  }).catch(() => {});
  const lb = $('#lockBtn');
  if (lb) { lb.hidden = !store.isUnlocked(); lb.innerHTML = ic('lock'); lb.title = t('lock'); lb.setAttribute('aria-label', t('lock')); }
}

// Encrypted autosave of the case in progress: a crash, a reload or a call
// never loses a patient's answers.
function saveDraft() {
  if (!C || !store.isUnlocked()) return;
  const { still, ...state } = C;
  store.saveDraft(state).catch(() => {});
}

// ====================================================================== home
// The landing screen adapts to who is using it and what is waiting: greeting by
// name and time of day, a half-finished patient, new optometrist replies,
// unsent cases, today's emergencies, phone set-up still to do, today's numbers,
// and the patient languages this site uses most. Everything is computed on the
// phone from its own encrypted records; nothing is sent anywhere to decide it.
async function homeContext() {
  const all = (await store.allCases().catch(() => [])).filter((c) => !c.unreadable);
  const today = new Date().toDateString();
  const todays = all.filter((c) => c.createdAt && new Date(c.createdAt).toDateString() === today);
  const seen = load('dd.seenReplies', {});
  const lane = (c) => c.profile?.triage?.lane;
  sentIds = all.filter((c) => c.sync === 'sent' && Date.now() - new Date(c.createdAt).getTime() < 14 * 864e5).map((c) => c.id);
  sentNames = Object.fromEntries(all.map((c) => [c.id, c.patient?.name || shortCode(c.id)]));
  const usage = {};
  all.filter((c) => !c.demo).slice(0, 60).forEach((c) => { usage[c.lang] = (usage[c.lang] || 0) + 1; });
  const days = lastDays(7);
  const onDay = days.map((d) => all.filter((c) => c.createdAt && new Date(c.createdAt).toDateString() === d.key));
  const tierOf = (c) => c.profile?.triage?.urgency || 'none';
  return {
    week: { labels: days.map((d) => d.label), red: onDay.map((l) => l.filter((c) => lane(c) === 'red').length),
      amber: onDay.map((l) => l.filter((c) => lane(c) === 'amber').length), green: onDay.map((l) => l.filter((c) => lane(c) !== 'red' && lane(c) !== 'amber').length) },
    mix: { emergency: all.filter((c) => tierOf(c) === 'emergency').length, urgent: all.filter((c) => tierOf(c) === 'urgent').length,
      soon: all.filter((c) => tierOf(c) === 'soon').length, routine: all.filter((c) => !['emergency', 'urgent', 'soon'].includes(tierOf(c))).length },
    any: all.length > 0,
    realCount: all.filter((c) => !c.demo).length,
    today: todays.length,
    referred: todays.filter((c) => lane(c) === 'red' || lane(c) === 'amber').length,
    emergencies: todays.filter((c) => lane(c) === 'red' && !c.review).length,
    waiting: all.filter((c) => c.sync === 'sent' && !c.review).length,
    unsent: all.filter((c) => c.sync !== 'sent').length,
    replies: all.filter((c) => c.review).length,
    newReplies: all.filter((c) => c.review && !seen[c.id]).length,
    online: navigator.onLine !== false,
    usage,
  };
}

async function home() {
  C = null;
  const [draft, x] = await Promise.all([store.loadDraft().catch(() => null), homeContext()]);
  const flags = load('dd.flags', { demoTried: false });
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? 'gMorning' : hour < 17 ? 'gAfternoon' : 'gEvening');
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const langOrder = Object.keys(LANGS).sort((a, b) => (x.usage[b] || 0) - (x.usage[a] || 0));
  const chips = (cur, attr, order = Object.keys(LANGS)) => order.map((k) => `<button class="chip lang ${cur === k ? 'on' : ''}" data-${attr}="${k}" lang="${k}" aria-pressed="${cur === k}">${LANGS[k]}</button>`).join('');
  const demos = PERSONAS.map((p) => `<button class="demo" data-demo="${p.key}"><em class="av" aria-hidden="true">${esc(p.name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase())}</em><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span><i>${LANGS[p.lang]}</i></button>`).join('');

  // What needs the operator first, most important on top.
  const next = [];
  if (x.emergencies) next.push(`<button class="nx red" data-go="inbox">${ic('alert')}<span>${t('hEmergency', { n: x.emergencies })}</span>${ic('right')}</button>`);
  if (draft) next.push(`<div class="nx accent">${ic('refresh')}<span><b>${t('resume')}</b><small>${esc(draft.patient?.name || shortCode(draft.id))} · ${LANGS[draft.lang] || ''} · ${draft.session?.trace?.filter((q) => q.qid && !q.event).length || 0} answers</small></span>
      <span class="row gap"><button class="btn primary small" id="resumeBtn">${t('resume')}</button><button class="btn ghost small" id="discardBtn" aria-label="discard">${ic('x')}</button></span></div>`);
  if (x.newReplies) next.push(`<button class="nx t2" data-go="inbox">${ic('inbox')}<span>${t('hReplies', { n: x.newReplies })}</span>${ic('right')}</button>`);
  if (x.unsent) next.push(x.online
    ? `<div class="nx t3">${ic('send')}<span>${t('hUnsent', { n: x.unsent })}</span><button class="btn small" id="sendNow">${t('hSendNow')}</button></div>`
    : `<div class="nx t3">${ic('send')}<span>${t('hUnsent', { n: x.unsent })}<small>${t('hOffline')}</small></span></div>`);

  const stats = x.any ? `<section class="stats">
      <div class="stat"><span>${t('hToday')}</span><b>${x.today}</b></div>
      <div class="stat"><span>${t('hReferred')}</span><b>${x.referred}</b></div>
      <div class="stat"><span>${t('hWaiting')}</span><b>${x.waiting}</b></div>
      <div class="stat"><span>${t('hReplied')}</span><b>${x.replies}</b></div>
    </section>` : '';

  const steps = [
    { done: Boolean(calib.pxPerMm), label: t('hSetupScreen'), go: 'cal' },
    { done: Boolean(calib.focalNorm), label: t('hSetupCamera'), go: 'cal' },
    { done: Boolean(flags.demoTried), label: t('hSetupDemo'), go: 'demo' },
  ];
  const left = steps.filter((st) => !st.done).length;
  const setup = left && x.realCount < 5 ? `<section class="card setup">
      <div class="row between"><h2>${t('hSetup')}</h2><span class="muted small mono">${steps.length - left}/${steps.length}</span></div>
      <div class="progress"><i style="width:${Math.round(((steps.length - left) / steps.length) * 100)}%"></i></div>
      <ul class="steps">${steps.map((st) => `<li class="${st.done ? 'done' : ''}"><button data-go="${st.go}">${ic(st.done ? 'check' : 'plus', { size: 16 })}<span>${st.label}</span></button></li>`).join('')}</ul>
    </section>` : '';

  const demoBody = `<p class="muted small">Plays the interview with a scripted patient so you can see the adaptive questions, the tests and the profile without a microphone.</p><div class="demos">${demos}</div>`;
  const demoCard = x.realCount >= 3
    ? `<details class="card"><summary>${t('hPractice')}</summary>${demoBody}</details>`
    : `<section class="card"><h2>${t('demo')}</h2>${demoBody}</section>`;

  setScreen(`
    <section class="band hero">
      <p class="eyebrow">${esc(settings.site)} · ${esc(dateStr)}</p>
      <h1>${esc(settings.operator ? `${greet}, ${settings.operator}` : greet)}</h1>
      <p class="lede">${t('appTagline')}</p>
      ${stats}
      ${x.any ? `<div class="bandcharts">
        <div><h3>Patients, last 7 days</h3>${barChart({ labels: x.week.labels, title: 'Patients per day', series: [
          { name: 'Routine', color: 'var(--c2)', values: x.week.green }, { name: 'Referral', color: 'var(--lane-amber)', values: x.week.amber },
          { name: 'Emergency', color: 'var(--lane-red)', values: x.week.red }] })}</div>
        <div><h3>Urgency, all patients</h3>${donut({ title: 'Patients by urgency', center: String(x.mix.emergency + x.mix.urgent + x.mix.soon + x.mix.routine), sub: 'patients', segments: [
          { label: 'Emergency', value: x.mix.emergency, color: 'var(--lane-red)' }, { label: 'Urgent', value: x.mix.urgent, color: 'var(--c4)' },
          { label: 'Soon', value: x.mix.soon, color: 'var(--lane-amber)' }, { label: 'Routine', value: x.mix.routine, color: 'var(--c2)' }] })}</div>
      </div>` : ''}
    </section>
    ${next.length ? `<section class="next">${next.join('')}</section>` : ''}
    <div class="homegrid one">
      <div class="col">
        <section class="card start">
          <h2>${t('language')}</h2>
          <div class="seg">${chips(settings.lang, 'plang', langOrder)}</div>
          <button class="btn primary big" id="newBtn">${ic('plus')} ${t('newScreening')}</button>
        </section>
      </div>
      
    </div>`, 'home');
  if (draft) {
    $('#resumeBtn').onclick = () => resumeDraft(draft);
    $('#discardBtn').onclick = async () => { await store.clearDraft(); home(); };
  }
  const startDemo = (p) => { flags.demoTried = true; save('dd.flags', flags); startCase(p.lang, p); };
  $$('[data-go]', main).forEach((b) => b.onclick = () => ({ inbox, cal: calibration, demo: () => startDemo(PERSONAS[0]) }[b.dataset.go])());
  const sendNow = $('#sendNow');
  if (sendNow) sendNow.onclick = async () => { sendNow.disabled = true; await store.syncPending().catch(() => {}); home(); };
  $$('[data-plang]', main).forEach((b) => b.onclick = () => { settings.lang = b.dataset.plang; save('dd.settings', settings); home(); });
  $('#newBtn').onclick = () => setupGate(() => startCase(settings.lang));
  { const my = turn; syncNow().then((n) => { if (n && my === turn) home(); }); }
  // Fetch optometrist replies in the background; redraw only if something new arrived.
  if (store.isUnlocked() && x.online && x.waiting) {
    const my = turn;
    store.pullReviews().then(homeContext).then((y) => { if (my === turn && y.replies !== x.replies) home(); }).catch(() => {});
  }
}

// What scores as a red flag and what does not: the same table the engine runs.
function rulesScreen(back = home) {
  setScreen(`<section class="card wide"><h2>${t('rulesTitle')}</h2>${rulesTableHtml()}</section>
    <button class="btn ghost" id="rulesBack">${ic('left')} ${t('back')}</button>`, 'rules');
  $('#rulesBack').onclick = () => back();
}

function startCase(lang, persona = null) {
  C = {
    id: store.uuid(), lang, createdAt: new Date().toISOString(), demo: persona,
    patient: persona ? { name: persona.name, phone: persona.phone, village: persona.village } : { name: '', phone: '', village: '' },
    site: { name: persona ? persona.site : settings.site, type: persona ? persona.siteType : settings.siteType },
    operator: persona ? (persona.siteType === 'camp' ? 'Camp volunteer (demo)' : 'Store owner (demo)') : settings.operator, consent: null, session: E.createSession({ lang }), measurements: {},
  };
  C.session.id = C.id;
  register();
}

function resumeDraft(draft) {
  C = draft;
  if (!C.consent) { register(); return; }
  if (E.nextQuestion(C.session)) interview(); else checks();
}

// ====================================================================== register + consent
function register() {
  const p = C.patient;
  setScreen(`
    <section class="card">
      <p class="eyebrow">${LANGS[C.lang]}${C.demo ? ' · demo' : ''}</p>
      <label>${t('patientName')}<input id="pName" value="${esc(p.name)}" autocomplete="off"></label>
      <label>${t('phone')}<input id="pPhone" value="${esc(p.phone)}" inputmode="tel" autocomplete="off"></label>
      <label>${t('village')}<input id="pVillage" value="${esc(p.village)}" autocomplete="off"></label>
    </section>
    <section class="card consent">
      <h2>${t('consentTitle')}</h2>
      <p class="say" lang="${C.lang}">${tp('consentText')}</p>
      <div class="row gap wrap">
        <button class="btn" id="playConsent">${ic('volume')} ${t('play')}</button>
      </div>
      <div class="row gap">
        <button class="btn primary big" id="agree">${ic('check')} ${t('agree')}</button>
        <button class="btn ghost" id="disagree">${t('disagree')}</button>
      </div>
      <p class="muted small">Recorded with time and language (Digital Personal Data Protection Act, 2023). Images from the camera checks never leave the phone; only measurements are sent.</p>
    </section>`, 'register');
  sayP(tp('consentText'));
  $('#playConsent').onclick = () => V.speak(tp('consentText'), C.lang);
  $('#agree').onclick = () => {
    C.patient = { name: $('#pName').value.trim(), phone: $('#pPhone').value.trim(), village: $('#pVillage').value.trim() };
    C.consent = { given: true, at: new Date().toISOString(), lang: C.lang, textVersion: 'consent-v1', method: 'verbal, recorded by operator' };
    saveDraft();
    interview();
  };
  $('#disagree').onclick = home;
}

// ====================================================================== interview
const MODULE_LABEL = { core: 'About you', redflag: 'Safety check', child: 'Child', medical: 'Health', glasses: 'Current glasses', lifestyle: 'Daily vision', preference: 'Preference' };

function optionLabel(q, v) {
  const o = q.options?.find((x) => x.v === v);
  return o ? o.label[C.lang] || o.label.en : String(v);
}
function valueLabel(q, v) {
  if (v === null || v === undefined) return '';
  switch (q.type) {
    case 'yesno': return v ? tp('yes') : tp('no');
    case 'single': return optionLabel(q, v);
    case 'multi': return v.map((x) => optionLabel(q, x)).join(', ');
    case 'number': return `${v} ${q.unit ? q.unit[C.lang] || q.unit.en : ''}`;
    case 'hours': return `${v} h`;
    case 'rx': return v.skipped ? t('skip') : v.text;
    default: return String(v);
  }
}

// a small line in the operator's language under each answer, when it differs
const sub = (k) => (settings.uiLang !== C.lang ? `<small>${esc(t(k))}</small>` : '');
const optSub = (o) => (settings.uiLang !== C.lang ? `<small>${esc(o.label[settings.uiLang] || o.label.en)}</small>` : '');

function answerControls(q) {
  switch (q.type) {
    case 'yesno':
      return `<div class="row gap"><button class="btn answer big yes" data-v="true">${tp('yes')}${sub('yes')}</button><button class="btn answer big no" data-v="false">${tp('no')}${sub('no')}</button></div>`;
    case 'single':
      return `<div class="opts">${q.options.map((o) => `<button class="btn answer" data-v="${o.v}">${esc(o.label[C.lang] || o.label.en)}${optSub(o)}</button>`).join('')}</div>`;
    case 'multi':
      return `<div class="opts">${q.options.map((o) => `<button class="btn toggle" data-v="${o.v}" ${o.exclusive ? 'data-exclusive="1"' : ''}>${esc(o.label[C.lang] || o.label.en)}${optSub(o)}</button>`).join('')}</div>
        <button class="btn primary" id="multiNext" disabled>${t('next')} ${ic('right')}</button>`;
    case 'number':
    case 'hours': {
      const quick = (q.quick || []).map((n) => `<button class="chip quick" data-v="${n}">${n}${q.type === 'hours' ? ' h' : ''}</button>`).join('');
      return `<div class="row wrap gap">${quick}</div>
        <div class="row gap numrow"><input id="numIn" type="number" inputmode="decimal" step="${q.type === 'hours' ? '0.5' : '1'}" min="${q.min ?? 0}" max="${q.max ?? 16}" placeholder="${q.type === 'hours' ? 'hours' : esc(q.unit?.en || '')}">
        <button class="btn primary" id="numNext">${t('next')} ${ic('right')}</button></div>`;
    }
    case 'rx': {
      const sel = (id, from, to, step, def) => {
        let o = '';
        for (let v = from; v <= to + 1e-9; v += step) {
          const r = Math.round(v * 100) / 100;
          o += `<option value="${r}" ${r === def ? 'selected' : ''}>${step < 1 ? (r > 0 ? '+' : '') + r.toFixed(2) : r}</option>`;
        }
        return `<select id="${id}">${o}</select>`;
      };
      const eyeRow = (e) => `<tr><th>${e}</th><td>${sel(`${e}sph`, -12, 8, 0.25, 0)}</td><td>${sel(`${e}cyl`, -6, 0, 0.25, 0)}</td><td>${sel(`${e}ax`, 0, 180, 5, 0)}</td></tr>`;
      return `<details class="rxgrid"><summary>${t('enterManually')}</summary>
        <table><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th></tr>${eyeRow('R')}${eyeRow('L')}</table>
        <button class="btn" id="rxSave">${t('next')} ${ic('right')}</button></details>
        <div class="row gap"><button class="btn ghost" id="rxSkip">${t('skip')}</button></div>
        <p id="rxErr" class="err"></p>`;
    }
    default: return '';
  }
}

async function interview() {
  const q = E.nextQuestion(C.session);
  if (!q) { C.session.finishedAt = C.session.finishedAt || new Date().toISOString(); checks(); return; }
  const s = E.stateOf(C.session);
  const text = questionText(q, s, C.lang);
  const textOp = questionText(q, s, settings.uiLang);
  const asked = C.session.trace.filter((x) => x.qid && !x.event).length;
  const more = Math.max(0, E.remainingEstimate(C.session) - 1);
  const recent = C.session.trace.filter((x) => x.qid && !x.event).slice(-8).reverse()
    .map((x) => { const qq = QUESTION_BY_ID[x.qid]; return `<li><span>${esc(questionText(qq, s, settings.uiLang).split(/[?:]/)[0])}</span><b>${esc(valueLabel(qq, x.value))}</b></li>`; }).join('');
  setScreen(`
    ${s.d.urgent ? `<div class="banner red">${ic('alert')} ${t('urgentBanner')}</div>` : ''}
    <div class="ivgrid">
    <section class="card qcard">
      <div class="row between"><span class="tag">${MODULE_LABEL[q.module] || q.module}</span><span class="muted small">Q${asked + 1}${s.d.age !== null ? ` · ${t('aboutMore', { n: more })}` : ''}</span></div>
      <p class="question" lang="${C.lang}">${esc(text)}</p>
      ${settings.uiLang !== C.lang ? `<p class="muted small en" lang="${settings.uiLang}">${esc(textOp)}</p>` : ''}
      <div class="voicebar"><span id="vstate" class="pill">…</span><span id="transcript" class="transcript"></span>
        <button class="btn small primary" id="doneSpk" hidden>${ic('check')} ${t('doneSpeaking')}</button>
        <button class="chip small ${settings.listen === 'long' ? 'on' : ''}" id="moreTime" aria-pressed="${settings.listen === 'long'}">${ic('clock')} ${t('moreTime')}</button>
      </div>
      <div id="heard" class="heard" hidden></div>
      <div class="controls">${answerControls(q)}</div>
    </section>
    <aside class="card side">
      <p class="why"><b>${t('why')}:</b> ${esc(q.reason(s))}</p>
      ${recent ? `<h3>Answers so far</h3><ul class="sofar">${recent}</ul>` : ''}
      <button class="btn ghost small" id="rulesLink">${ic('rules')} ${t('rules')}</button>
    </aside>
    </div>
    <div class="row between navrow">
      <button class="btn ghost" id="backBtn" ${asked ? '' : 'disabled'}>${ic('left')} ${t('back')}</button>
      <button class="btn ghost" id="againBtn">${ic('refresh')} ${t('speakAgain')}</button>
      <button class="btn ghost" id="skipBtn">${t('skip')} ${ic('right')}</button>
    </div>`, 'interview');

  const my = turn;
  const commit = (value, raw = null, mode = 'tap', extra = {}) => {
    if (my !== turn) return;
    E.submitAnswer(C.session, q.id, value, { raw, mode, ...extra });
    saveDraft();
    interview();
  };
  wireControls(q, commit);
  $('#backBtn').onclick = () => { E.undoLast(C.session); interview(); };
  $('#skipBtn').onclick = () => { E.skipQuestion(C.session, q.id); interview(); };
  $('#againBtn').onclick = () => voiceTurn(q, text, my, commit, true);
  $('#rulesLink').onclick = () => rulesScreen(interview);
  $('#moreTime').onclick = (e) => {
    settings.listen = settings.listen === 'long' ? 'normal' : 'long';
    save('dd.settings', settings);
    e.currentTarget.classList.toggle('on', settings.listen === 'long');
    e.currentTarget.setAttribute('aria-pressed', String(settings.listen === 'long'));
  };
  voiceTurn(q, text, my, commit, false);
}

function wireControls(q, commit) {
  $$('.answer', main).forEach((b) => b.onclick = () => {
    const v = q.type === 'yesno' ? b.dataset.v === 'true' : b.dataset.v;
    commit(v);
  });
  if (q.type === 'multi') {
    const toggles = $$('.toggle', main);
    const next = $('#multiNext');
    toggles.forEach((b) => b.onclick = () => {
      b.classList.toggle('on');
      if (b.classList.contains('on')) {
        if (b.dataset.exclusive) toggles.forEach((o) => { if (o !== b) o.classList.remove('on'); });
        else toggles.forEach((o) => { if (o.dataset.exclusive) o.classList.remove('on'); });
      }
      next.disabled = !toggles.some((o) => o.classList.contains('on'));
    });
    next.onclick = () => commit(toggles.filter((o) => o.classList.contains('on')).map((o) => o.dataset.v));
  }
  if (q.type === 'number' || q.type === 'hours') {
    $$('.quick', main).forEach((b) => b.onclick = () => commit(Number(b.dataset.v)));
    const go = () => {
      const v = Number($('#numIn').value);
      if ($('#numIn').value !== '' && Number.isFinite(v) && v >= (q.min ?? 0) && v <= (q.max ?? 16)) commit(q.id === 'age' ? Math.floor(v) : v, null, 'typed');
    };
    $('#numNext').onclick = go;
    $('#numIn').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
  if (q.type === 'rx') {
    $('#rxSkip').onclick = () => commit({ skipped: true });
    $('#rxSave').onclick = () => {
      const eye = (e) => {
        const cyl = Number($(`#${e}cyl`).value);
        return { sph: Number($(`#${e}sph`).value), cyl, axis: cyl ? Number($(`#${e}ax`).value) : undefined };
      };
      const r = validateRx({ R: eye('R'), L: eye('L') });
      if (!r.ok) { $('#rxErr').textContent = r.errors.join('; '); return; }
      commit({ R: r.R, L: r.L, text: r.text, warnings: r.warnings }, null, 'typed');
    };
  }
}

function setVState(state) {
  const el = $('#vstate');
  if (!el) return;
  el.className = `pill ${state}`;
  el.textContent = state === 'speaking' ? t('speaking') : state === 'listening' || state === 'hearing' ? `${t('listening')}${state === 'hearing' ? ' …' : ''}` : state === 'demo' ? 'Demo patient' : state === 'off' ? t('voiceOff') : '…';
  const done = $('#doneSpk');
  if (done) done.hidden = !(state === 'listening' || state === 'hearing');
}

async function voiceTurn(q, text, my, commit, again) {
  const spoke = settings.voice ? await (setVState('speaking'), V.speak(text, C.lang)) : false;
  if (my !== turn) return;
  if (settings.voice && !spoke && !again && !V.hasVoice(C.lang)) $('#transcript').textContent = t('noVoice');
  if (C.still) { stillAnswer(q); return; }
  if (C.demo) { await demoAnswer(q, my, commit); return; }
  if (!settings.voice) { setVState('off'); return; }
  if (!V.sttSupported()) { setVState('off'); $('#transcript').textContent = t('noMic'); return; }
  const done = $('#doneSpk');
  if (done) done.onclick = () => V.finishListening();
  for (let attempt = 0; attempt < 2; attempt++) {
    setVState('listening');
    $('#transcript').textContent = tp('listenHint');
    const opts = LISTEN[settings.listen] || LISTEN.normal;
    const res = await V.listen(q.asr || C.lang, {
      silenceMs: opts.silenceMs, waitMs: 10000, maxMs: 30000,
      onInterim: (x) => { if (my === turn) $('#transcript').textContent = x; },
      onState: (st) => { if (my === turn && st === 'hearing') setVState('hearing'); },
    });
    if (my !== turn) return;
    setVState('idle');
    if (res) {
      $('#transcript').textContent = `“${res.transcript}”`;
      const idx = res.alternatives.findIndex((alt) => E.interpret(q, alt.text, q.asr || C.lang).ok);
      if (idx !== -1) {
        const alt = res.alternatives[idx];
        const r = E.interpret(q, alt.text, q.asr || C.lang);
        // second-guess or low engine confidence: the operator confirms by tap
        const lowConfidence = idx > 0 || (alt.confidence > 0 && alt.confidence < LOW_CONFIDENCE);
        await confirmHeard(q, r, alt.text, my, commit, 'voice', { confidence: alt.confidence, lowConfidence });
        return;
      }
    }
    if (attempt === 0) { setVState('speaking'); await V.speak(tp('notUnderstood'), C.lang); if (my !== turn) return; }
  }
  setVState('idle');
}

function stillAnswer(q) {
  setVState('listening');
  const raw = C.still[q.id];
  if (!raw) return;
  $('#transcript').textContent = `“${raw}”`;
  const r = E.interpret(q, raw, q.asr || C.lang);
  if (r.ok) { reflectHeard(q, r.value); const box = $('#heard'); box.hidden = false; box.innerHTML = `<span>${t('heard')}: <b>${esc(valueLabel(q, r.value))}</b></span>`; }
}

async function demoAnswer(q, my, commit) {
  setVState('demo');
  const raw = C.demo.say[q.id];
  if (raw === undefined) return; // unscripted: operator taps
  const el = $('#transcript');
  for (let i = 1; i <= raw.length; i += Math.max(1, Math.round(raw.length / 14))) {
    if (my !== turn) return;
    el.textContent = `“${raw.slice(0, i)}”`;
    await sleep(45);
  }
  el.textContent = `“${raw}”`;
  const r = E.interpret(q, raw, q.asr || C.lang);
  if (r.ok) await confirmHeard(q, r, raw, my, commit, 'voice');
}

// keep the tap controls in sync with what was heard
function reflectHeard(q, value) {
  if (q.type !== 'multi') return;
  $$('.toggle', main).forEach((b) => b.classList.toggle('on', value.includes(b.dataset.v)));
  const next = $('#multiNext'); if (next) next.disabled = !value.length;
}

async function confirmHeard(q, r, raw, my, commit, mode, extra = {}) {
  reflectHeard(q, r.value);
  const box = $('#heard');
  const critical = (q.module === 'redflag' || q.id === 'child_white') && r.value === true;
  const needsTap = critical || r.ambiguous || extra.lowConfidence || (q.type === 'rx' && r.value.warnings?.length);
  box.hidden = false;
  const delay = C.demo ? 650 : 2500; // time to tap Change before it is accepted
  box.innerHTML = `<span>${t('heard')}: <b>${esc(valueLabel(q, r.value))}</b></span>
    ${needsTap ? `<button class="btn primary" id="okHeard">${ic('check')} ${t('next')}</button>` : `<span class="countdown" aria-hidden="true"><i style="animation-duration:${delay}ms"></i></span>`}<button class="btn ghost" id="chgHeard">${t('change')}</button>
    ${extra.lowConfidence ? `<p class="small warn-text">${t('confirmLow')}</p>` : ''}`;
  if (q.type === 'rx' && r.value.warnings?.length) box.insertAdjacentHTML('beforeend', `<p class="muted small">${esc(r.value.warnings.join('; '))}</p>`);
  let cancelled = false;
  $('#chgHeard').onclick = () => { cancelled = true; box.hidden = true; setVState('idle'); };
  if (needsTap) { $('#okHeard').onclick = () => commit(r.value, raw, mode, extra); return; }
  await sleep(delay);
  if (!cancelled && my === turn) commit(r.value, raw, mode, extra);
}

// ====================================================================== tests hub
// Every test is always on the list (the five ZEISS online screening checks,
// duochrome, near vision, camera measurements and lensometry). The engine marks
// the ones that matter for this patient, with the reason.
const MKEY = {
  reading_distance: 'readingDistanceCm', near_point: 'nearPointCm', acuity: 'acuity', amsler: 'amsler', pd: 'pd', contrast: 'contrast',
  colour: 'colour', astigmatism: 'astigmatism', duochrome: 'duochrome', near_acuity: 'nearAcuity', npc: 'npc', lensometry: 'lensometry',
};
// Where each test is reliable. 'screen': needs a laptop or TV screen; on a
// phone it runs only as the remote of a paired chart screen. 'either': phone at
// 2 m, or the chart screen at 3 or 6 m as in a store. 'phone': the phone itself
// (held at reading distance, or its front camera). 'both': the phone's rear
// camera reads a pattern shown on the screen (or printed).
const DEVICE = {
  acuity: 'screen', contrast: 'screen', colour: 'screen', astigmatism: 'screen', amsler: 'screen', duochrome: 'screen', near_acuity: 'screen',
  reading_distance: 'phone', near_point: 'phone', npc: 'phone', pd: 'phone', lensometry: 'both',
};
const DEVICE_KEY = { either: 'devEither', screen: 'devScreen', phone: 'devPhone', both: 'devBoth' };
const SCREEN_WHY = {
  acuity: 'Letters show on the laptop or TV at 3 or 6 m, as in an optical store. The patient reads across the room; the phone only records which way they point.',
  contrast: 'Faint rings need a large, bright, steady screen at 1 m. A hand-held phone changes angle, glare and brightness from ring to ring.',
  colour: 'The plates show large on the screen; the phone records the number the patient reads.',
  near_acuity: 'The N chart shows at true print size on the screen at 40 cm; the phone records the smallest line read.',
  amsler: 'The Amsler grid has to cover the central 20 degrees: a 10 cm grid at 30 cm. A phone screen is about 7 cm wide, so it covers only about 12 degrees and can miss distortion just outside the centre.',
  astigmatism: 'The dial is read from 3 m or more with focus relaxed for distance. On a phone the dial is small and close, so focusing effort and thin lines make the answer unreliable.',
  duochrome: 'The red-green test checks focus for distance and is read at 3 to 6 m, as in a store. Closer than that, the eye’s own focusing shifts the answer by about half a dioptre.',
};
const onScreen = (k) => remote.paired() && DEVICE[k] !== 'phone';
const screenNote = (extra = '') => `<div class="onscreen">${ic('monitor', { size: 22 })}<div><b>${t('onScreen')}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</div></div>`;
function runCheck(k) {
  if (DEVICE[k] === 'screen' && isPhone() && !remote.paired()) { needsScreen(k); return; }
  CHECK_RUN[k]();
}
function needsScreen(k) {
  setScreen(`<section class="card">
      <h2>${t(`chk_${k}`)}</h2>
      <div class="banner amber">${ic('monitor')}<span>${t('needsScreen')}</span></div>
      <p class="small">${esc(SCREEN_WHY[k] || '')}</p>
      <p class="small muted">Open the chart screen on a laptop or TV and pair it: the chart shows there and this phone becomes the remote.</p>
      <button class="btn primary big" id="pairNow">${ic('monitor')} ${t('pairScreen')}</button>
      ${demoBtn(k)}
      <button class="btn ghost" id="backChecks">${ic('left')} ${t('back')}</button></section>`, `check-${k}`);
  $('#pairNow').onclick = () => pairScreen(() => CHECK_RUN[k]());
  $('#backChecks').onclick = checks;
  wireDemo();
}
function pairScreen(then = home, code = '') {
  const url = new URL('display.html', location.href).href;
  setScreen(`<section class="card">
      <h2>${ic('monitor')} ${t('screenTitle')}</h2>
      <p>On the laptop or TV, open <b class="mono">${esc(url)}</b>. It shows a 6-digit code.</p>
      <label>Code<input id="pairCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" value="${esc(code)}"></label>
      <button class="btn primary big" id="pairGo">${t('pairGo')}</button>
      <p class="err" id="pairErr"></p>
      <button class="btn ghost" id="pairBack">${ic('left')} ${t('back')}</button></section>`, 'pair');
  const go = async () => {
    const v = $('#pairCode').value.replace(/\D/g, '');
    if (v.length !== 6) { $('#pairErr').textContent = t('pairBad'); return; }
    $('#pairGo').disabled = true;
    const ok = await remote.pair(v).catch(() => false);
    if (!ok) { $('#pairGo').disabled = false; $('#pairErr').textContent = t('pairBad'); return; }
    then();
  };
  $('#pairGo').onclick = go;
  $('#pairBack').onclick = () => then();
  if (code.length === 6) go();
}
function screenCard() {
  const o = remote.options();
  if (!remote.paired()) {
    return `<section class="card screencard"><div class="sc-head">${ic('monitor')}<div><b>${t('screenTitle')}</b><small>${t('screenNone')}</small></div></div>
      <button class="btn small" id="pairBtn">${t('pairScreen')}</button></section>`;
  }
  return `<section class="card screencard on"><div class="sc-head">${ic('monitor')}<div><b>${t('screenTitle')}</b><small>${t('screenPaired')}</small></div></div>
    <div class="row gap wrap"><select id="chartDist" aria-label="Chart distance">
      <option value="3" ${o.distanceM === 3 && !o.mirror ? 'selected' : ''}>3 m</option>
      <option value="6" ${o.distanceM === 6 && !o.mirror ? 'selected' : ''}>6 m</option>
      <option value="6m" ${o.mirror ? 'selected' : ''}>6 m with a mirror (3 m room)</option></select>
      <button class="btn small ghost" id="unpairBtn">${t('unpair')}</button></div></section>`;
}
function wireScreenCard(back = checks) {
  const here = main.dataset.screen;
  const pb = $('#pairBtn'); if (pb) pb.onclick = () => pairScreen(back);
  const ub = $('#unpairBtn'); if (ub) ub.onclick = async () => { await remote.unpair(); back(); };
  const cd = $('#chartDist'); if (cd) cd.onchange = () => remote.setOptions({ distanceM: cd.value === '3' ? 3 : 6, mirror: cd.value === '6m' });
  if (remote.paired()) {
    remote.send({ chart: 'idle' });
    remote.check().then((ok) => { if (!ok && main.dataset.screen === here) back(); });
  }
}

const CHECK_RUN = {
  reading_distance: checkReading, near_point: checkNear, acuity: () => checkAcuity('R'), amsler: () => checkAmsler('R'), pd: checkPd,
  contrast: () => T.contrast(api), colour: () => T.colour(api), astigmatism: () => T.astigmatism(api), duochrome: () => T.duochrome(api),
  near_acuity: () => T.nearAcuity(api), npc: () => T.npc(api), lensometry: () => T.lensometry(api),
};
const checkDone = (k) => {
  const m = C.measurements;
  return ({
    reading_distance: m.readingDistanceCm, near_point: m.nearPointCm, acuity: m.acuity?.L, amsler: m.amsler?.L, pd: m.pd,
    contrast: m.contrast?.L, colour: m.colour?.result, astigmatism: m.astigmatism?.L, duochrome: m.duochrome?.L,
    near_acuity: m.nearAcuity?.N, npc: m.npc, lensometry: m.lensometry?.R || m.lensometry?.L,
  })[k];
};
const rxTxt = (r) => (r ? `${r.sph > 0 ? '+' : ''}${Number(r.sph).toFixed(2)}${r.cyl ? `/${Number(r.cyl).toFixed(2)}×${r.axis}` : ''}` : '–');
function checkSummary(k) {
  const m = C.measurements;
  switch (k) {
    case 'reading_distance': return m.readingDistanceCm ? `${Math.round(m.readingDistanceCm)} cm` : '';
    case 'near_point': return m.nearPointCm ? `${Math.round(m.nearPointCm)} cm (${(100 / m.nearPointCm).toFixed(1)} D)` : '';
    case 'acuity': return m.acuity?.L ? `R ${A.snellen(m.acuity.R.logmar)} · L ${A.snellen(m.acuity.L.logmar)}` : '';
    case 'amsler': return m.amsler?.L ? `R ${m.amsler.R} · L ${m.amsler.L}${m.amsler.onset ? ` · ${m.amsler.onset}` : ''}` : '';
    case 'pd': return m.pd ? `PD ${m.pd.binocularMm} mm` : '';
    case 'contrast': return m.contrast?.L ? `R ${m.contrast.R?.logCS?.toFixed(2)} · L ${m.contrast.L.logCS.toFixed(2)} log CS` : '';
    case 'colour': return m.colour?.result ? `${m.colour.correct}/${m.colour.plates} · ${m.colour.result.replace('_', ' ')}` : '';
    case 'astigmatism': return m.astigmatism?.L ? ['R', 'L'].map((e) => `${e} ${m.astigmatism[e]?.even ? 'even' : `${m.astigmatism[e]?.line} (axis ~${m.astigmatism[e]?.axis})`}`).join(' · ') : '';
    case 'duochrome': return m.duochrome?.L ? `R ${m.duochrome.R} · L ${m.duochrome.L}${m.duochrome.withGlasses ? ' (glasses)' : ''}` : '';
    case 'near_acuity': return m.nearAcuity?.N ? `N${m.nearAcuity.N} at ${m.nearAcuity.distanceCm} cm` : '';
    case 'npc': return m.npc ? (m.npc.cm != null ? `${m.npc.cm} cm` : m.npc.bound) : '';
    case 'lensometry': return m.lensometry ? `R ${rxTxt(m.lensometry.R)} · L ${rxTxt(m.lensometry.L)}` : '';
    default: return '';
  }
}

function checks() {
  // record how trustworthy the phone's measurements are, for the reviewer
  C.measurements.calibration = { screen: Boolean(calib.pxPerMm), camera: Boolean(calib.focalNorm) };
  saveDraft();
  const prof = buildProfile(C.session.answers, C.measurements);
  const plan = Object.fromEntries(prof.checkPlan.map((c) => [c.key, c]));
  const row = (k) => {
    const p = plan[k] || {};
    const done = checkDone(k);
    return `<li class="check ${done ? 'ok' : ''} ${p.recommended ? 'rec' : ''}">
      <div><b>${t(`chk_${k}`)}</b> <span class="tags"><span class="badge ${p.recommended ? 'rec' : 'opt'}">${p.recommended ? t('recommended') : t('optional')}</span><span class="dev ${DEVICE[k]}">${t(DEVICE_KEY[DEVICE[k]])}</span></span>
        ${p.reason ? `<span class="muted small">${esc(p.reason)}</span>` : ''}
        ${done ? `<span class="result small">${ic('check', { size: 14 })}${esc(checkSummary(k))}</span>` : ''}</div>
      <button class="btn ${done ? 'ghost' : p.recommended ? 'primary' : ''}" data-chk="${k}">${done ? ic('refresh', { label: t('run') }) : t('run')}</button></li>`;
  };
  const groups = CHECK_GROUPS.map((g) => `<section class="card"><h3>${t(`grp_${g.key}`)}</h3><ul class="checks">${g.checks.map(row).join('')}</ul></section>`).join('');
  const tri = prof.triage;
  setScreen(`
    ${prof.derived.urgent ? `<div class="banner red">${ic('alert')} ${t('urgentBanner')} ${t('emergencyNow')}</div>` : tri.urgency === 'urgent' ? `<div class="banner amber">${ic('clock')} ${t('urgentNote', { within: tri.within })}</div>` : ''}
    <section class="card">
      <h2>${t('checksTitle')}</h2>
      <p class="muted small">${t('checksHint')}</p>
      <div class="row gap wrap"><span class="muted small">${t('optotype')}:</span>
        <button class="chip ${settings.optotype !== 'C' ? 'on' : ''}" data-opt="E">${t('optE')}</button>
        <button class="chip ${settings.optotype === 'C' ? 'on' : ''}" data-opt="C">${t('optC')}</button></div>
    </section>
    ${screenCard()}
    <div class="checkgrid">${groups}</div>
    <button class="btn primary big" id="toSummary">${t('finishChecks')} ${ic('right')}</button>`, 'checks');
  $$('[data-chk]', main).forEach((b) => b.onclick = () => runCheck(b.dataset.chk));
  wireScreenCard();
  $$('[data-opt]', main).forEach((b) => b.onclick = () => { settings.optotype = b.dataset.opt; save('dd.settings', settings); checks(); });
  $('#toSummary').onclick = summary;
}

function demoFill(key) {
  const m = C.demo?.measure;
  const f = MKEY[key];
  if (!m || !f || m[f] === undefined) return false;
  C.measurements[f] = structuredClone(m[f]);
  C.measurements.simulated = [...new Set([...(C.measurements.simulated || []), key])];
  return true;
}
const demoBtn = (key) => (C.demo?.measure?.[MKEY[key]] !== undefined ? `<button class="btn ghost" id="demoFill" data-k="${key}">${ic('play', { size: 14 })} Use demo patient’s value</button>` : '');
function wireDemo() { const b = $('#demoFill'); if (b) b.onclick = () => { demoFill(b.dataset.k); checks(); }; }

// Screen helpers handed to the extra test screens (tests_ui.js).
const api = {
  setScreen, $: (sel) => $(sel, main), $$: (sel) => $$(sel, main), esc, t, tp,
  say: (text) => sayP(text), get C() { return C; }, back: () => checks(), pxPerMm, calibrated: () => Boolean(calib.pxPerMm),
  demoBtn, wireDemo, setCleanup: (fn) => { cleanup = fn; }, median: G.median,
  cameraScreen: (o) => cameraScreen(o),
  onScreen, screenNote, remote, isPhone,
};

// ---------------------------------------------------------------- camera checks
async function cameraScreen({ key, title, instruction, extraHtml = '', onFrame, actions }) {
  setScreen(`
    <section class="card">
      <h2>${title}</h2>
      <p class="say" lang="${C.lang}">${instruction}</p>
      <div class="cam"><video id="vid" playsinline muted></video><div id="readout" class="readout">${t('noFace')}</div></div>
      ${extraHtml}
      <p class="muted small">${calib.focalNorm ? 'Phone calibrated.' : 'Phone not calibrated: distances ±15%. Calibrate once per phone for ±5%.'}</p>
      <div class="row gap wrap">${actions}</div>
      <details class="small"><summary>${t('enterManually')}</summary>
        <div class="row gap"><input id="manualIn" type="number" inputmode="decimal" placeholder="cm"><button class="btn" id="manualSave">${t('done')}</button></div></details>
      ${demoBtn(key)}
      <button class="btn ghost" id="backChecks">${ic('left')} ${t('back')}</button>
    </section>`, `check-${key}`);
  $('#backChecks').onclick = checks;
  wireDemo();
  sayP(instruction.replace(/<[^>]+>/g, ''));
  // the operator may leave before the model loads: never start a camera for a screen that is gone
  let stream = null; let stop = null; let face = null; let cancelled = false;
  const vid = $('#vid');
  cleanup = () => { cancelled = true; stop?.(); face?.stopCamera(stream); };
  try {
    face = await import('./measure/face.js');
    const [lm, s] = await Promise.all([face.loadLandmarker(), face.startCamera(vid)]);
    stream = s;
    if (cancelled) { face.stopCamera(stream); return; }
    stop = face.track(vid, lm, onFrame, focalPxFor);
  } catch (e) {
    if (cancelled) return;
    const ro = $('#readout');
    if (ro) ro.textContent = t('cameraFail');
  }
}

function checkReading() {
  const samples = [];
  cameraScreen({
    key: 'reading_distance', title: t('chk_reading_distance'), instruction: tp('holdLikeReading'),
    actions: `<button class="btn primary" id="useBtn" disabled>${t('useThis')}</button>`,
    onFrame: (f) => {
      const ro = $('#readout'); if (!ro) return;
      if (!f || !f.distanceMm) { ro.textContent = t('noFace'); return; }
      samples.push(f.distanceMm / 10);
      if (samples.length > 60) samples.shift();
      const stable = G.isStable(samples, 25, 0.05);
      ro.innerHTML = `<b>${Math.round(G.median(samples.slice(-10)))} cm</b>${stable ? ` ${ic('check')}` : ''}`;
      $('#useBtn').disabled = !stable;
    },
  });
  setTimeout(() => {
    const use = $('#useBtn'); if (!use) return;
    use.onclick = () => { C.measurements.readingDistanceCm = Math.round(G.median(samples.slice(-25))); checks(); };
    $('#manualSave').onclick = () => { const v = Number($('#manualIn').value); if (v >= 10 && v <= 100) { C.measurements.readingDistanceCm = v; checks(); } };
  }, 0);
}

function checkNear() {
  const samples = [];
  const words = PACK_BY_CODE[C.lang]?.nearWords || 'the quick brown fox reads small print';

  const size = Math.max(7, 1.0 * pxPerMm()); // ~N5-N6 print
  cameraScreen({
    key: 'near_point', title: t('chk_near_point'), instruction: tp('bringCloser'),
    extraHtml: `<p class="tiny" style="font-size:${size}px">${esc(words)}</p>`,
    actions: `<button class="btn primary big" id="blurBtn">${t('blurredNow')}</button>`,
    onFrame: (f) => {
      const ro = $('#readout'); if (!ro) return;
      if (!f || !f.distanceMm) { ro.textContent = t('noFace'); samples.push(null); return; }
      samples.push(f.distanceMm / 10); if (samples.length > 60) samples.shift();
      ro.innerHTML = `<b>${Math.round(f.distanceMm / 10)} cm</b>`;
    },
  });
  setTimeout(() => {
    const b = $('#blurBtn'); if (!b) return;
    b.onclick = () => {
      const recent = samples.slice(-10).filter((x) => x);
      // face lost because the phone is very close: focusing range is excellent
      C.measurements.nearPointCm = recent.length ? Math.round(G.median(recent)) : 12;
      checks();
    };
    $('#manualSave').onclick = () => { const v = Number($('#manualIn').value); if (v >= 8 && v <= 150) { C.measurements.nearPointCm = v; checks(); } };
  }, 0);
}

// ---------------------------------------------------------------- acuity (tumbling E)
const ROT = { right: 0, down: 90, left: 180, up: 270 };
const eSvg = (dir, sizePx) => `<svg class="optotype" width="${sizePx}" height="${sizePx}" viewBox="0 0 5 5" style="transform:rotate(${ROT[dir]}deg)" aria-label="E"><path d="M0 0H5V1H1V2H5V3H1V4H5V5H0Z" fill="currentColor"/></svg>`;

function checkAcuity(eye = 'R', pinhole = false) {
  const scr = onScreen('acuity');
  const ro = remote.options();
  const distanceMm = scr ? ro.distanceM * 1000 : 2000;
  // on the chart screen the "stand 2 m away" sentence and the "(2 m)" in the title do not apply
  const setup = tp('acuitySetup', { eye: eye === 'R' ? tp('leftEye') : tp('rightEye') });
  const setupText = scr ? (setup.split(/(?<=[.।!?])\s+/).slice(1).join(' ') || setup) : setup;
  const title = scr ? t('chk_acuity').replace(/\s*\([^)]*\)\s*$/, '') : t('chk_acuity');
  const st = A.createStaircase({ start: pinhole ? 0.5 : 0.6 });
  const cover = eye === 'R' ? tp('leftEye') : tp('rightEye');
  const optotype = settings.optotype === 'C' ? 'C' : 'E';
  setScreen(`
    <section class="card acuity">
      <h2>${title} · ${eye === 'R' ? 'Right eye' : 'Left eye'}${pinhole ? ' · pinhole' : ''}</h2>
      <p class="say" lang="${C.lang}">${setupText}</p>
      ${scr ? screenNote(`Patient ${ro.mirror ? '3 m from the mirror (6 m optical path)' : `${ro.distanceM} m from the screen`}`) : '<div class="estage" id="stage"></div>'}
      <div class="arrows">
        <button class="btn" data-d="up" aria-label="up">${ic('up', { size: 26 })}</button>
        <div class="row gap"><button class="btn" data-d="left" aria-label="left">${ic('left', { size: 26 })}</button><button class="btn" data-d="right" aria-label="right">${ic('right', { size: 26 })}</button></div>
        <button class="btn" data-d="down" aria-label="down">${ic('down', { size: 26 })}</button>
      </div>
      <p class="muted small" id="lvl"></p>
      ${demoBtn('acuity')}
      <button class="btn ghost" id="backChecks">${ic('left')} ${t('back')}</button>
    </section>`, 'check-acuity');
  $('#backChecks').onclick = checks;
  wireDemo();
  sayP(setupText);
  const show = () => {
    const o = A.nextOptotype(st);
    if (scr) {
      remote.send({ chart: 'acuity', optotype, level: o.level, dir: o.dir, distanceM: ro.distanceM, eye });
      $('#lvl').textContent = `Line ${A.snellen(o.level)} · on the chart screen`;
      return;
    }
    const px = Math.max(6, G.optotypeMm(o.level, distanceMm) * pxPerMm());
    $('#stage').innerHTML = optotype === 'C' ? landoltSvg(o.dir, Math.round(px)) : eSvg(o.dir, Math.round(px));
    $('#lvl').textContent = `Line ${A.snellen(o.level)} · ${Math.round(px)} px`;
  };
  const answer = (d) => {
    A.respond(st, d);
    if (!st.done) { show(); return; }
    C.measurements.acuity = C.measurements.acuity || { distanceM: distanceMm / 1000, ...(scr ? { method: 'chart screen' } : {}) };
    C.measurements.acuity.optotype = optotype;
    const rec = C.measurements.acuity[eye] || {};
    const lm = st.best === null ? 1.1 : st.best;
    if (pinhole) { rec.pinholeLogmar = lm; rec.pinholeImproved = lm <= rec.logmar - 0.2; }
    else rec.logmar = lm;
    C.measurements.acuity[eye] = rec;
    if (!pinhole && lm >= 0.5) { pinholeOffer(eye); return; }
    if (eye === 'R') checkAcuity('L'); else checks();
  };
  $$('[data-d]', main).forEach((b) => b.onclick = () => answer(b.dataset.d));
  let x0 = null; let y0 = null;
  const stage = $('#stage') || document.createElement('div'); // no phone chart when the chart screen shows it
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) answer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    x0 = null;
  });
  const key = (e) => { const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]; if (m) { e.preventDefault(); answer(m); } };
  document.addEventListener('keydown', key);
  cleanup = () => document.removeEventListener('keydown', key);
  show();
}

function pinholeOffer(eye) {
  setScreen(`<section class="card"><h2>${t('chk_acuity')}</h2>
    <p class="say" lang="${C.lang}">${tp('pinholePrompt')}</p>
    <div class="row gap"><button class="btn primary" id="ph">${t('pinholeTest')}</button><button class="btn ghost" id="noph">${t('skip')}</button></div></section>`, 'pinhole');
  sayP(tp('pinholePrompt'));
  $('#ph').onclick = () => checkAcuity(eye, true);
  $('#noph').onclick = () => (eye === 'R' ? checkAcuity('L') : checks());
}

// ---------------------------------------------------------------- Amsler grid
function checkAmsler(eye = 'R') {
  const scr = onScreen('amsler');
  const cell = 5 * pxPerMm(); // 5 mm squares
  // the full chart is 20 squares (10 cm: the central 20 degrees at 30 cm); a phone fits fewer
  const n = isPhone() ? Math.max(8, Math.min(14, Math.floor((Math.min(window.innerWidth, 520) - 48) / cell))) : 20;
  const cover = eye === 'R' ? tp('leftEye') : tp('rightEye');
  setScreen(`<section class="card">
      <h2>${t('chk_amsler')} · ${eye === 'R' ? 'Right eye' : 'Left eye'}</h2>
      <p class="say" lang="${C.lang}">${tp('amslerAsk', { eye: cover })}</p>
      ${scr ? screenNote('10 cm grid · patient 30 cm from the screen, reading glasses on') : `<div class="amsler" style="--cell:${cell}px;--n:${n}"><i></i></div>`}
      <div class="row gap"><button class="btn big" id="aNo">${tp('no')}${sub('no')}</button><button class="btn big warn" id="aYes">${tp('yes')}${sub('yes')}</button></div>
      ${demoBtn('amsler')}
      <button class="btn ghost" id="backChecks">${ic('left')} ${t('back')}</button></section>`, 'check-amsler');
  $('#backChecks').onclick = checks;
  wireDemo();
  sayP(tp('amslerAsk', { eye: cover }));
  if (scr) remote.send({ chart: 'amsler', eye });
  const rec = (v) => {
    C.measurements.amsler = { ...(C.measurements.amsler || {}), [eye]: v };
    if (eye === 'R') { checkAmsler('L'); return; }
    // new distortion is urgent (macula within 1 working day); long-standing is not
    if (C.measurements.amsler.R === 'abnormal' || C.measurements.amsler.L === 'abnormal') T.amslerOnset(api); else checks();
  };
  $('#aNo').onclick = () => rec('normal');
  $('#aYes').onclick = () => rec('abnormal');
}

// ---------------------------------------------------------------- PD + fitting height
function checkPd() {
  let last = null;
  cameraScreen({
    key: 'pd', title: t('chk_pd'), instruction: tp('pdAsk'),
    extraHtml: '<canvas id="still" class="still" hidden></canvas><div id="pdOut" class="pdout"></div>',
    actions: `<button class="btn primary" id="capBtn">${t('capture')}</button>`,
    onFrame: (f) => {
      const ro = $('#readout'); if (!ro) return;
      last = f;
      if (!f) { ro.textContent = t('noFace'); return; }
      const q = G.faceQuality(f.eyes);
      ro.innerHTML = `<b>${Math.round(f.distanceMm / 10)} cm</b> ${q.ok ? ic('check') : `· ${t('holdStraight')}`}`;
    },
  });
  setTimeout(() => {
    $('#manualSave').onclick = () => { const v = Number($('#manualIn').value); if (v >= 45 && v <= 80) { C.measurements.pd = { binocularMm: v, method: 'manual (PD ruler)' }; checks(); } };
    const cap = $('#capBtn'); if (!cap) return;
    cap.onclick = () => {
      if (!last) return;
      // a tilted or turned head shortens the apparent PD: refuse the capture
      const quality = G.faceQuality(last.eyes);
      if (!quality.ok) { $('#pdOut').innerHTML = `<p class="warn-text">${t('holdStraight')} (tilt ${quality.rollDeg}°, turn ${quality.yawPct}%)</p>`; return; }
      const vid = $('#vid'); const cv = $('#still');
      cv.width = last.W; cv.height = last.H; cv.hidden = false;
      const snap = document.createElement('canvas');
      snap.width = last.W; snap.height = last.H; snap.getContext('2d').drawImage(vid, 0, 0);
      const g = cv.getContext('2d');
      const f = last; const eyes = f.eyes;
      let pd = { ...G.measurePd(eyes, { method: 'iris', eyeDistanceMm: f.distanceMm || 400 }), quality };
      const taps = []; let mode = null; let fh = {};
      const draw = () => {
        g.drawImage(snap, 0, 0);
        g.lineWidth = Math.max(2, f.W / 400);
        for (const p of [eyes.od, eyes.os]) { g.strokeStyle = '#ff7a1a'; g.beginPath(); g.arc(p.x, p.y, eyes.irisPx / 2, 0, 7); g.stroke(); }
        g.strokeStyle = '#1f9bb0'; g.beginPath(); g.moveTo(eyes.bridge.x, eyes.bridge.y - 40); g.lineTo(eyes.bridge.x, eyes.bridge.y + 40); g.stroke();
        for (const p of taps) { g.fillStyle = '#1f9bb0'; g.fillRect(p.x - 4, p.y - 4, 8, 8); }
      };
      const out = () => {
        $('#pdOut').innerHTML = `<p><b>PD ${pd.binocularMm} mm</b> (R ${pd.rightMm} · L ${pd.leftMm}) · near ${pd.nearMm} mm · ±${pd.uncertaintyMm} mm · ${pd.method} scale</p>
          ${fh.R ? `<p>Fitting height R ${fh.R} mm · L ${fh.L ?? '…'} mm</p>` : ''}
          <div class="row gap wrap"><button class="btn" id="cardBtn">Use ID-card scale</button><button class="btn" id="fhBtn">Fitting height</button><button class="btn primary" id="pdSave">${t('done')}</button></div>
          <p class="muted small" id="tapHint"></p>`;
        $('#cardBtn').onclick = () => { mode = 'card'; taps.length = 0; $('#tapHint').textContent = 'Card on the forehead: tap its left edge, then its right edge.'; };
        $('#fhBtn').onclick = () => { mode = 'fh'; taps.length = 0; $('#tapHint').textContent = 'Tap the bottom of the frame rim under the right pupil, then under the left.'; };
        $('#pdSave').onclick = () => { C.measurements.pd = { ...pd, fittingHeightMm: fh.R ? fh : undefined }; checks(); };
      };
      cv.onclick = (e) => {
        if (!mode) return;
        const r = cv.getBoundingClientRect();
        const p = { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
        taps.push(p); draw();
        if (mode === 'card' && taps.length === 2) {
          pd = { ...G.measurePd(eyes, { method: 'card', cardPx: Math.abs(taps[1].x - taps[0].x), eyeDistanceMm: f.distanceMm || 400 }), quality };
          mode = null; out();
        }
        if (mode === 'fh' && taps.length === 2) {
          const [rTap, lTap] = taps;
          fh = { R: G.fittingHeightMm(eyes.od.y, rTap.y, pd.mmPerPx), L: G.fittingHeightMm(eyes.os.y, lTap.y, pd.mmPerPx) };
          mode = null; out();
        }
      };
      draw(); out();
      cleanup?.(); // stop the camera: the still is enough
      cleanup = null;
      vid.hidden = true; cap.hidden = true;
    };
  }, 0);
}

// ====================================================================== summary
function buildCasePayload(prof) {
  const asked = C.session.trace.filter((x) => x.qid && !x.event).length;
  return {
    id: C.id, createdAt: C.createdAt, appVersion: APP_VERSION, lang: C.lang,
    site: C.site, operator: C.operator || settings.operator || null, demo: Boolean(C.demo),
    patient: { ...C.patient, age: C.session.answers.age ?? null, sex: C.session.answers.sex ?? null },
    consent: C.consent,
    interview: { answers: C.session.answers, trace: C.session.trace, skipped: C.session.skipped, startedAt: C.session.startedAt, finishedAt: C.session.finishedAt, asked, bank: E.bankSize(), notAsked: E.notAsked(C.session) },
    measurements: C.measurements,
    profile: prof,
    rulesVersion: RULES_VERSION,
    // the server's copy carries no name; the phone keeps the named copy for sharing
    passport: { lang: C.lang, text: passportText({ id: C.id, patient: {}, profile: prof, answers: C.session.answers }, C.lang) },
    passportLocal: passportText({ id: C.id, patient: C.patient, profile: prof, answers: C.session.answers }, C.lang),
  };
}

function summary() {
  const prof = buildProfile(C.session.answers, C.measurements, { trace: C.session.trace });
  const payload = buildCasePayload(prof);
  const mins = Math.max(1, Math.round((Date.now() - new Date(C.session.startedAt).getTime()) / 60000));
  setScreen(`
    <section class="card wide">
      <p class="eyebrow">${esc(C.patient.name || 'Patient')} · ${esc(shortCode(C.id))}${C.demo ? ' · demo' : ''}</p>
      ${profileHtml(prof, C.measurements, C.session.answers, { collapse: true })}
      <p class="muted small">Asked ${payload.interview.asked} of ${payload.interview.bank} questions (${payload.interview.bank - payload.interview.asked} not relevant for this patient) · about ${mins} min${C.measurements.simulated ? ` · simulated tests: ${C.measurements.simulated.join(', ')}` : ''}</p>
    </section>
    <button class="btn big" id="tryBtn">${ic('glasses')} ${t('tryOn')}</button>
    <button class="btn primary big" id="sendBtn">${ic('send')} ${t('sendToOptom')}</button>
    <p id="sendState" class="muted small center"></p>
    <button class="btn big" id="consultBtn" hidden>${ic('video')} Ask the optometrist for a video consult</button>
    <section class="card passport" id="passportCard" hidden>
      <h2>${t('passport')}</h2>
      <pre lang="${C.lang}">${esc(payload.passportLocal)}</pre>
      ${shareBoxHtml()}
    </section>
    <button class="btn ghost big" id="nextPt">${t('newPatient')} ${ic('right')}</button>`, 'summary');
  $('#sendBtn').onclick = async () => {
    $('#sendBtn').disabled = true;
    await store.putCase({ ...payload, sync: 'queued' });
    await store.clearDraft();
    $('#sendState').textContent = t('queued');
    const n = await store.syncPending();
    const hub = await store.getHubKey({ refresh: false });
    $('#sendState').textContent = `${n ? t('sent') : t('queued')} · ${hub ? 'name and phone sealed so only the optometrist can read them' : 'name and phone stay on this phone'}`;
    $('#passportCard').hidden = false;
    syncNow();
    if (n) { $('#consultBtn').hidden = false; sentIds = [...new Set([...sentIds, C.id])]; sentNames[C.id] = C.patient.name || shortCode(C.id); }
    updateHeader();
  };
  $('#tryBtn').onclick = () => tryOn(api, { back: summary, recTitle: prof.recommendation?.title || '' });
  $('#consultBtn').onclick = async () => {
    try {
      const id = await createCall(store.API, C.id, 'store');
      openCall({ api: store.API, callId: id, role: 'store', initiator: true, title: `Video consult · ${C.patient.name || shortCode(C.id)}`, side: storeSide(C.patient.name || shortCode(C.id)) });
    } catch { $('#sendState').textContent = 'Could not start the call. Check the internet and try again.'; }
  };
  wireShare($('#passportCard'), {
    doc: () => ({ text: payload.passportLocal, lang: C.lang }), // first line is the heading
    phone: C.patient.phone, caseRef: C.id, lang: C.lang, code: shortCode(C.id),
    text: () => shortSms(prof.triage, C.lang, shortCode(C.id)),
  });
  $('#nextPt').onclick = home;
}

// ---------------------------------------------------------------- secure share box
// The patient file leaves the phone only as ciphertext: a fresh AES-256 key in
// the link's #fragment (never sent to the server), optional PIN said in person,
// expiry and a view limit. The patient scans the QR on their own phone; the
// link may also go by SMS/WhatsApp because the message carries no health data.
function shareBoxHtml() {
  return `<div class="sharebox">
    <h3>Send to the patient by SMS</h3>
    <label>Patient's mobile number<input class="shPhone" type="tel" inputmode="tel" maxlength="16" autocomplete="off" placeholder="10-digit mobile number"></label>
    <div class="seg shKind" role="group" aria-label="Kind of message">
      <button type="button" class="chip on" data-k="link">Secure link (smartphone)</button>
      <button type="button" class="chip" data-k="text">Short text (any phone)</button></div>
    <label class="check usePinRow"><input type="checkbox" class="usePin" checked> ${t('sharePin')}</label>
    <p class="muted small shHint">An encrypted link to the full passport. The PIN is said aloud, never sent.</p>
    <button class="btn primary mkShare">${ic('send')} Send SMS</button>
    <div class="shareOut" hidden>
      <p class="pinshow" hidden></p>
      <p class="small shSent"></p>
      <div class="row gap wrap"><a class="btn primary smsLink">${ic('send')} Open SMS to send</a><a class="btn waLink" target="_blank" rel="noopener">WhatsApp</a>
        <button class="btn copyLink">${t('shareCopy')}</button><button class="btn ghost revokeLink">${t('shareRevoke')}</button></div>
      <p class="muted small shareNote"></p>
    </div>
    <p class="err shareErr"></p>
  </div>`;
}

// A short SMS any phone can read: no link, only the next step in the
// patient's language (or the optometrist's own message to them).
function shortSms(tri, lang, code, msg = '') {
  const key = ({ emergency: 'red', urgent: 'amber', soon: 'soon' })[tri?.urgency] || (tri?.urgency ? 'green' : (tri?.lane || 'green'));
  return `${pt(P.title, lang)} ${code}: ${msg || pt(P.lane[key], lang)}${settings.site ? ` (${settings.site})` : ''}`;
}

function wireShare(root, { doc, phone, caseRef, lang, code, text }) {
  const q = (c) => root.querySelector(c);
  let made = null;
  let kind = 'link';
  q('.shPhone').value = phone || '';
  root.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
    kind = b.dataset.k;
    root.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b));
    q('.usePinRow').hidden = kind !== 'link';
    q('.shHint').textContent = kind === 'link' ? 'An encrypted link to the full passport. The PIN is said aloud, never sent.'
      : 'Only the next step, in the patient’s language. No link and no test results, so it works on any phone.';
  });
  const number = () => q('.shPhone').value.replace(/\D/g, '').slice(-10);
  q('.mkShare').onclick = async () => {
    const num = number();
    if (num.length !== 10) { q('.shareErr').textContent = 'Enter the patient’s 10-digit mobile number.'; return; }
    q('.shareErr').textContent = '';
    if (kind === 'text') {
      const msg = text();
      q('.smsLink').href = smsLink(num, msg);
      q('.waLink').href = whatsappLink(num, msg);
      q('.shSent').textContent = `Message: “${msg}”`;
      q('.copyLink').hidden = true; q('.revokeLink').hidden = true; q('.pinshow').hidden = true; q('.shareNote').textContent = '';
      q('.shareOut').hidden = false;
      return;
    }
    q('.mkShare').disabled = true;
    try {
      const { createShareLink } = await import('./share.js');
      const pin = q('.usePin').checked ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0') : undefined;
      made = made || await createShareLink(doc(), { pin, kind: 'passport', expiresDays: 7, maxViews: 20, caseRef, actor: settings.operator || 'field', api: store.API });
      const msg = `${pt(P.title, lang)} · ${code}: ${made.url}`;
      q('.pinshow').hidden = !pin;
      q('.pinshow').textContent = pin ? `PIN ${pin}` : '';
      q('.smsLink').href = smsLink(num, msg);
      q('.waLink').href = whatsappLink(num, msg);
      q('.copyLink').hidden = false; q('.revokeLink').hidden = false;
      q('.copyLink').onclick = () => navigator.clipboard?.writeText(made.url).catch(() => {});
      q('.shSent').textContent = `Secure link ready for ${num}. Tap Open SMS to send it${pin ? ', then say the PIN to the patient' : ''}.`;
      q('.shareNote').textContent = t('shareNote', { days: 7, views: made.maxViews || 20 });
      q('.shareOut').hidden = false;
    } catch (e) {
      q('.shareErr').textContent = `${t('shareFailed')} (${e.code || e.message || e})`;
    }
    q('.mkShare').disabled = false;
  };
  q('.revokeLink').onclick = async () => {
    if (!made) return;
    try {
      const { revokeShare } = await import('./share.js');
      await revokeShare(made.id, made.deleteToken, { api: store.API });
      q('.shareOut').innerHTML = `<p class="small">${t('shareRevoked')}</p>`;
    } catch (e) { q('.shareErr').textContent = String(e.code || e.message || e); }
  };
}

// ====================================================================== inbox
async function inbox() {
  await store.syncPending();
  await store.pullReviews();
  await syncNow();
  const list = await store.allCases();
  const seenBefore = load('dd.seenReplies', {});
  save('dd.seenReplies', Object.fromEntries(list.filter((c) => c.review).map((c) => [c.id, 1])));
  const initials = (n) => n.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase() || '#';
  const rows = list.map((c) => {
    if (c.unreadable) return `<li class="muted small">${esc(shortCode(c.id))}: encrypted with an older PIN</li>`;
    const tri = c.profile?.triage || {};
    const rv = c.review;
    const name = c.patient?.name || shortCode(c.id);
    const age = c.patient?.age ?? c.interview?.answers?.age;
    const st = rv ? ['reviewed', rv.decisionLabel || 'Reviewed'] : c.sync === 'sent' ? ['sent', 'With the optometrist'] : ['queued', 'Not sent yet'];
    const tier = tri.urgency && tri.urgency !== 'none' ? `<span class="tier ${esc(tri.urgency)}">${esc(TIERS[tri.urgency]?.label || tri.urgency)}</span>` : '';
    const when = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    return `<li><details class="prow ${esc(tri.lane || 'green')}" ${rv && !seenBefore[c.id] ? 'open' : ''}>
      <summary><em class="av" aria-hidden="true">${esc(initials(name))}</em><span class="pname">${esc(name)}</span>
        <span class="pmeta">${[age != null ? `${age} y` : '', LANGS[c.lang], when].filter(Boolean).join(' · ')}</span>
        <span class="pstat">${tier}<span class="status ${st[0]}">${esc(st[1])}</span></span></summary>
      <div class="pbody"><p class="small muted">${esc(c.profile?.summary || '')}</p>
        ${rv ? `<p class="small"><b>${esc(rv.decisionLabel || rv.decision)}</b>: ${esc(rv.nextStep || '')}</p>` : ''}
        ${rv?.comments ? `<p class="small comment">${esc(rv.comments)}</p>` : ''}
        ${rv ? `<button class="btn small" data-share="${esc(c.id)}">${ic('shield')} ${t('shareSecure')}</button>` : ''}</div></details></li>`;
  }).join('') || '<li class="muted">No patients yet.</li>';
  const demos = PERSONAS.map((p) => `<button class="demo" data-demo="${p.key}"><em class="av" aria-hidden="true">${esc(p.name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase())}</em><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span><i>${LANGS[p.lang]}</i></button>`).join('');
  setScreen(`<section class="card wide"><div class="row between wrap"><h2>${t('tabPatients')}</h2><button class="btn small" id="refresh">${ic('refresh')} Refresh</button></div>
      <ul class="inbox plist">${rows}</ul></section>
    <section class="card passport" id="inboxShare" hidden></section>
    <section class="card"><h2>${t('demo')}</h2>
      <p class="muted small">Plays the interview with a scripted patient so you can see the adaptive questions, the tests and the profile without a microphone.</p>
      <div class="demos">${demos}</div></section>`, 'patients');
  $$('.demo', main).forEach((b) => b.onclick = () => {
    const f = load('dd.flags', { demoTried: false }); f.demoTried = true; save('dd.flags', f);
    const p = PERSONA_BY_KEY[b.dataset.demo]; startCase(p.lang, p);
  });
  $$('[data-share]', main).forEach((b) => b.onclick = () => {
    const c = list.find((x) => x.id === b.dataset.share);
    const text = passportText({ id: c.id, patient: c.patient, profile: c.profile, answers: c.interview?.answers, review: c.review }, c.lang);
    const box = $('#inboxShare');
    box.hidden = false;
    box.innerHTML = `<h2>${esc(c.patient?.name || shortCode(c.id))}</h2><pre lang="${c.lang}">${esc(text)}</pre>${shareBoxHtml()}`;
    wireShare(box, { doc: () => ({ text, lang: c.lang }), phone: c.patient?.phone, caseRef: c.id, lang: c.lang, code: shortCode(c.id),
      text: () => shortSms(c.profile?.triage, c.lang, shortCode(c.id), c.review?.messageToPatient) });
    box.scrollIntoView({ behavior: 'smooth' });
  });
  $('#refresh').onclick = inbox;
}

// ---------------------------------------------------------------- tools tab
function tools() {
  setScreen(`<section class="card wide"><h2>${t('tabTools')}</h2>
      ${setupCardHtml()}
      ${screenCard()}
      <section class="tools">
        <button class="tool" id="rulesBtn">${ic('rules')}<span>${t('rules')}</span></button>
        <button class="tool" id="calBtn">${ic('ruler')}<span>${t('calibrate')}</span></button>
        <button class="tool" id="checkBtn">${ic('phone')}<span>Phone check</span></button>
        <a class="tool" href="display.html" target="_blank" rel="noopener">${ic('monitor')}<span>${t('screenTitle')} (open on the laptop)</span></a>
        <a class="tool" href="portal.html" target="_blank" rel="noopener">${ic('external')}<span>Optometrist portal</span></a>
      </section></section>`, 'tools');
  $('#calBtn').onclick = calibration;
  $('#checkBtn').onclick = phoneCheck;
  $('#rulesBtn').onclick = () => rulesScreen(tools);
  wireSetup(tools);
  wireScreenCard(tools);
}

// Set-up depends on the device: a phone needs its camera distance and a chart
// screen; a computer that shows the charts itself needs its screen size.
function setupSteps() {
  const flags = load('dd.flags', { demoTried: false });
  return isPhone()
    ? [{ done: Boolean(calib.focalNorm), label: t('hSetupCamera'), go: 'cal' }, { done: remote.paired(), label: t('pairScreen'), go: 'pair' }, { done: Boolean(flags.demoTried), label: t('hSetupDemo'), go: 'demo' }]
    : [{ done: Boolean(calib.pxPerMm), label: t('hSetupScreen'), go: 'cal' }, { done: Boolean(flags.demoTried), label: t('hSetupDemo'), go: 'demo' }];
}
function setupCardHtml() {
  const st = setupSteps();
  const done = st.filter((x) => x.done).length;
  return `<section class="card setup"><div class="row between"><h2>${isPhone() ? t('hSetup') : 'Get this computer ready'}</h2><span class="muted small mono">${done}/${st.length}</span></div>
    <div class="progress"><i style="width:${Math.round((done / st.length) * 100)}%"></i></div>
    <ul class="steps">${st.map((x) => `<li class="${x.done ? 'done' : ''}"><button data-go="${x.go}">${ic(x.done ? 'check' : 'plus', { size: 16 })}<span>${x.label}</span></button></li>`).join('')}</ul></section>`;
}
function wireSetup(back) {
  $$('[data-go]', main).forEach((b) => b.onclick = () => ({ cal: calibration, pair: () => pairScreen(back), demo: () => inbox() }[b.dataset.go])());
}
// Before the first patient on a phone that is not set up yet: offer set-up, allow skipping.
function setupGate(go) {
  let skipped = false;
  try { skipped = Boolean(sessionStorage.getItem('dd.setupSkip')); } catch { /* ignore */ }
  if (!isPhone() || skipped || setupSteps().every((x) => x.done)) { go(); return; }
  setScreen(`${setupCardHtml()}
    <p class="small muted">Charts show on the chart screen and the camera measures distances, so both work better set up first. You can still start now.</p>
    <div class="row gap wrap"><button class="btn primary" id="gateTools">${ic('sliders')} Set up in Tools</button><button class="btn" id="gateGo">Start the patient anyway</button></div>`, 'setup-gate');
  wireSetup(home);
  $('#gateTools').onclick = tools;
  $('#gateGo').onclick = () => { try { sessionStorage.setItem('dd.setupSkip', '1'); } catch { /* ignore */ } go(); };
}

// ---------------------------------------------------------------- shop dashboard
// Stock, sales and patients for the shop. Kept encrypted on the device and in
// the shop account's sync (between devices the latest change wins).
const rupee = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
async function loadShop() { return (await store.getSecret('shopdata')) || { stock: [], sales: [], updatedAt: '' }; }
async function saveShop(d) { d.updatedAt = new Date().toISOString(); await store.putSecret('shopdata', d); account.push('shop', 'data', d); }
const SAMPLE_STOCK = [
  ['Rectangle acetate frame, black', 'frame', 14, 1200, 4], ['Round metal frame, gold', 'frame', 3, 1800, 4], ['Cat-eye acetate frame, tortoise', 'frame', 6, 1500, 3],
  ['Kids flexible frame, blue', 'frame', 0, 900, 3], ['Single-vision lens pair, 1.56', 'lens', 40, 600, 10], ['Single-vision lens pair, anti-reflective', 'lens', 22, 1100, 8],
  ['Progressive lens pair', 'lens', 5, 4200, 4], ['Office lens pair', 'lens', 2, 3200, 3], ['Photochromic lens pair', 'lens', 9, 2400, 4],
  ['Reading glasses +2.00', 'ready', 12, 350, 5], ['Lens cleaning kit', 'accessory', 30, 120, 10],
].map(([name, type, qty, price, reorder], i) => ({ id: `s${i + 1}`, name, type, qty, price, reorder }));
const TYPE_LABEL = { frame: 'Frame', lens: 'Lens', ready: 'Ready readers', accessory: 'Accessory' };
const stockStatus = (it) => (it.qty <= 0 ? ['out', 'Out of stock'] : it.qty <= Math.max(1, Math.floor(it.reorder / 2)) ? ['reorder', 'Reorder'] : it.qty <= it.reorder ? ['low', `${it.qty} left`] : ['ok', 'In stock']);

async function shopScreen(filter = 'all') {
  const [d, cases] = await Promise.all([loadShop(), store.allCases().catch(() => [])]);
  const real = cases.filter((c) => !c.unreadable);
  const now = new Date();
  const inMonth = (iso) => { const x = new Date(iso); return x.getMonth() === now.getMonth() && x.getFullYear() === now.getFullYear(); };
  const monthSales = d.sales.filter((x) => inMonth(x.at));
  const low = d.stock.filter((it) => stockStatus(it)[0] !== 'ok');
  const days = lastDays(14);
  const perDay = days.map((dd) => d.sales.filter((x) => new Date(x.at).toDateString() === dd.key).reduce((a, x) => a + x.amount, 0));
  const byState = {}; const byPin = {};
  for (const c of real) {
    const pin = c.patient?.pin; const st = pinToState(pin);
    if (st) byState[st] = (byState[st] || 0) + 1;
    if (pin) byPin[pin] = (byPin[pin] || 0) + 1;
  }
  const shown = d.stock.filter((it) => filter === 'all' || (filter === 'low' ? stockStatus(it)[0] !== 'ok' : it.type === filter));
  setScreen(`
    <section class="band">
      <p class="eyebrow">${esc(settings.site)} · ${esc(now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }))}</p>
      <h1>Shop</h1>
      <section class="stats">
        <div class="stat"><span>Patients this month</span><b>${real.filter((c) => c.createdAt && inMonth(c.createdAt)).length}</b></div>
        <div class="stat"><span>Glasses sold</span><b>${monthSales.length}</b></div>
        <div class="stat"><span>Sales this month</span><b>${rupee(monthSales.reduce((a, x) => a + x.amount, 0))}</b></div>
        <div class="stat"><span>Items to reorder</span><b>${low.length}</b></div>
      </section>
    </section>
    <div class="dash">
      <section class="card"><div class="row between wrap gap"><h2>Sales, last 14 days</h2><button class="btn small primary" id="saleBtn">${ic('plus')} Record a sale</button></div>
        ${barChart({ labels: days.map((x, i) => (i % 2 ? '' : x.label)), title: 'Sales per day in rupees', stacked: false, series: [{ name: 'Sales', color: 'var(--accent)', values: perDay }] })}</section>
      <section class="card"><h2>Patients by area</h2>${indiaMap(byState)}
        ${Object.keys(byPin).length ? `<h3>Top PIN codes</h3>${hbars(Object.entries(byPin).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: k, value: v })))}` : '<p class="muted small">PIN codes appear here as patients are registered with one.</p>'}</section>
    </div>
    <div id="shopForm"></div>
    <section class="card"><div class="row between wrap gap"><h2>Stock</h2><div class="row gap wrap">
        <button class="btn small" id="addItem">${ic('plus')} Add item</button>${d.stock.length ? '' : '<button class="btn small ghost" id="sampleStock">Load sample stock</button>'}</div></div>
      <div class="seg" id="stockFilter">${[['all', 'All', d.stock.length], ['frame', 'Frames'], ['lens', 'Lenses'], ['low', 'To reorder', low.length]].map(([k, l, n]) => `<button class="chip ${filter === k ? 'on' : ''}" data-sf="${k}">${l}${n !== undefined ? ` · ${n}` : ''}</button>`).join('')}</div>
      ${shown.length ? `<div class="dtable-wrap"><table class="dtable stock"><thead><tr><th>Item</th><th>Type</th><th>In stock</th><th>Price</th><th>Status</th></tr></thead><tbody>
        ${shown.map((it) => { const [cls, lbl] = stockStatus(it); return `<tr><td><b>${esc(it.name)}</b></td><td>${esc(TYPE_LABEL[it.type] || it.type)}</td>
          <td><span class="qty"><button data-dq="-1" data-id="${esc(it.id)}" aria-label="One less">−</button><b class="num">${it.qty}</b><button data-dq="1" data-id="${esc(it.id)}" aria-label="One more">+</button></span></td>
          <td class="num">${rupee(it.price)}</td><td><span class="status ${cls}">${esc(lbl)}</span></td></tr>`; }).join('')}</tbody></table></div>`
    : '<p class="muted small">No stock yet. Add items, or load the sample list to try it.</p>'}
    </section>
    <section class="card sales"><h2>Recent sales</h2>
      ${d.sales.length ? `<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Date</th><th>Patient</th><th>Items</th><th>Amount</th></tr></thead><tbody>
        ${d.sales.slice(-8).reverse().map((x) => `<tr><td class="num">${esc(new Date(x.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</td><td>${esc(x.patient || 'Walk-in')}</td><td>${esc(x.items.map((i) => i.name).join(', '))}</td><td class="num"><b>${rupee(x.amount)}</b></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted small">No sales recorded yet.</p>'}</section>`, 'shop');
  $$('[data-sf]', main).forEach((b) => b.onclick = () => shopScreen(b.dataset.sf));
  $$('[data-dq]', main).forEach((b) => b.onclick = async () => {
    const it = d.stock.find((x) => x.id === b.dataset.id); if (!it) return;
    it.qty = Math.max(0, it.qty + Number(b.dataset.dq)); await saveShop(d); shopScreen(filter);
  });
  const ss = $('#sampleStock'); if (ss) ss.onclick = async () => { d.stock = SAMPLE_STOCK.map((x) => ({ ...x })); await saveShop(d); shopScreen(); };
  const closeForm = () => { $('#shopForm').innerHTML = ''; };
  $('#addItem').onclick = () => {
    $('#shopForm').innerHTML = `<form class="card shopform" id="itemForm"><h2>Add a stock item</h2>
      <div class="row gap wrap"><label>Name<input id="iName" maxlength="80"></label><label>Type<select id="iType">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
      <div class="row gap wrap"><label>Quantity<input id="iQty" type="number" min="0" value="1"></label><label>Price (₹)<input id="iPrice" type="number" min="0" value="0"></label><label>Reorder when at<input id="iRe" type="number" min="0" value="3"></label></div>
      <div class="row gap"><button class="btn primary" type="submit">Save item</button><button class="btn ghost" type="button" id="formX">Cancel</button></div></form>`;
    $('#itemForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!$('#iName').value.trim()) return;
      d.stock.push({ id: `s${Date.now()}`, name: $('#iName').value.trim(), type: $('#iType').value, qty: Number($('#iQty').value) || 0, price: Number($('#iPrice').value) || 0, reorder: Number($('#iRe').value) || 0 });
      await saveShop(d); shopScreen(filter);
    };
    $('#formX').onclick = closeForm;
    $('#itemForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('#saleBtn').onclick = () => {
    const frames = d.stock.filter((x) => x.type === 'frame' && x.qty > 0);
    const lenses = d.stock.filter((x) => (x.type === 'lens' || x.type === 'ready') && x.qty > 0);
    const pats = real.slice(0, 30);
    const opt = (list, none) => `<option value="">${none}</option>${list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${rupee(x.price)} (${x.qty} left)</option>`).join('')}`;
    $('#shopForm').innerHTML = `<form class="card shopform" id="saleForm"><h2>Record a sale</h2>
      <label>Patient<select id="saleCase"><option value="">Walk-in customer</option>${pats.map((c) => `<option value="${esc(c.id)}">${esc(c.patient?.name || shortCode(c.id))} · ${esc(shortCode(c.id))}</option>`).join('')}</select></label>
      <div class="row gap wrap"><label>Frame<select id="saleFrame">${opt(frames, 'No frame')}</select></label><label>Lenses<select id="saleLens">${opt(lenses, 'No lenses')}</select></label></div>
      <label>Amount (₹)<input id="salePrice" type="number" min="0"></label>
      <div class="row gap"><button class="btn primary" type="submit" id="saleSave">Save sale</button><button class="btn ghost" type="button" id="formX">Cancel</button></div><p class="err" id="saleErr"></p></form>`;
    if (pats.length) $('#saleCase').value = pats[0].id;
    if (frames.length) $('#saleFrame').value = frames[0].id;
    if (lenses.length) $('#saleLens').value = lenses[0].id;
    const sum = () => { const f = d.stock.find((x) => x.id === $('#saleFrame').value); const l = d.stock.find((x) => x.id === $('#saleLens').value); $('#salePrice').value = (f?.price || 0) + (l?.price || 0); };
    $('#saleFrame').onchange = sum; $('#saleLens').onchange = sum; sum();
    $('#saleForm').onsubmit = async (e) => {
      e.preventDefault();
      const items = [$('#saleFrame').value, $('#saleLens').value].map((id) => d.stock.find((x) => x.id === id)).filter(Boolean);
      if (!items.length) { $('#saleErr').textContent = 'Choose a frame or lenses.'; return; }
      items.forEach((x) => { x.qty = Math.max(0, x.qty - 1); });
      const c = real.find((x) => x.id === $('#saleCase').value);
      d.sales.push({ id: `v${Date.now()}`, at: new Date().toISOString(), caseId: c?.id || null, patient: c ? (c.patient?.name || shortCode(c.id)) : '',
        items: items.map((x) => ({ id: x.id, name: x.name, price: x.price })), amount: Number($('#salePrice').value) || 0 });
      await saveShop(d); shopScreen(filter);
    };
    $('#formX').onclick = closeForm;
    $('#saleForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

// ---------------------------------------------------------------- navigation
// Top-level sections: tabs in the header on a laptop, a bottom bar on a phone.
// Hidden while a patient is being seen, so that screen stays focused.
const TAB_OF = { home: 'home', patients: 'patients', shop: 'shop', tools: 'tools', calibration: 'tools', phonecheck: 'tools', pair: 'tools', rules: 'tools', 'account-panel': 'account' };
const TABS = [['home', 'home', 'tabHome'], ['patients', 'users', 'tabPatients'], ['shop', 'chart', 'tabShop'], ['tools', 'sliders', 'tabTools'], ['account', 'user', 'tabAccount']];
const OPEN_TAB = { home: () => home(), patients: () => inbox(), shop: () => shopScreen(), tools: () => tools(), account: () => accountPanel() };
function updateTabs(name) {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  const tab = TAB_OF[name];
  bar.hidden = !tab || !store.isUnlocked();
  document.body.classList.toggle('has-tabs', !bar.hidden);
  if (bar.hidden) return;
  bar.innerHTML = TABS.map(([k, icon, label]) => `<button type="button" id="tab${k[0].toUpperCase()}${k.slice(1)}" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-current="${k === tab ? 'page' : 'false'}">${ic(icon, { size: 20 })}<span>${t(label)}</span></button>`).join('');
  bar.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => OPEN_TAB[b.dataset.tab]());
}

// ====================================================================== calibration
function calibration() {
  const startPx = (calib.pxPerMm || G.defaultPxPerMm(isPhone())) * G.ID_CARD_MM;
  setScreen(`<section class="card">
      <h2>1 · Screen size</h2>
      <p class="say">Hold any ID card (Aadhaar, bank card) against the screen. Move the slider until the box matches the card’s width.</p>
      <div class="cardbox" id="cardbox" style="width:${startPx}px"></div>
      <input type="range" id="cardRange" min="150" max="900" value="${Math.round(startPx)}">
      <button class="btn" id="saveScreen">Save screen size</button>
      <p class="muted small" id="scrOut">${calib.pxPerMm ? `Saved: ${calib.pxPerMm.toFixed(2)} px/mm` : 'Not calibrated yet'}</p>
    </section>
    <section class="card">
      <h2>2 · Camera distance</h2>
      <p class="say">Hold the phone exactly 40 cm from your eyes (use the 40 cm cord from the near-vision kit). Look at the screen and tap Save.</p>
      <div class="cam"><video id="vid" playsinline muted></video><div id="readout" class="readout">${t('noFace')}</div></div>
      <button class="btn" id="saveCam" disabled>Save camera at 40 cm</button>
      <p class="muted small" id="camOut">${calib.focalNorm ? 'Camera calibrated' : 'Camera not calibrated (assumes a 63° lens)'}</p>
    </section>
    <button class="btn ghost" id="home">${ic('left')} Home</button>`, 'calibration');
  $('#cardRange').oninput = (e) => { $('#cardbox').style.width = `${e.target.value}px`; };
  $('#saveScreen').onclick = () => { calib.pxPerMm = Number($('#cardRange').value) / G.ID_CARD_MM; save('dd.calibration', calib); $('#scrOut').textContent = `Saved: ${calib.pxPerMm.toFixed(2)} px/mm`; };
  $('#home').onclick = home;
  const irisSamples = [];
  let W = 0; let stream = null; let stop = null; let cancelled = false;
  const vid = $('#vid');
  cleanup = () => { cancelled = true; stop?.(); stream?.getTracks().forEach((x) => x.stop()); };
  import('./measure/face.js').then(async (face) => {
    const [lm, s] = await Promise.all([face.loadLandmarker(), face.startCamera(vid)]);
    stream = s;
    if (cancelled) { face.stopCamera(s); return; }
    stop = face.track(vid, lm, (f) => {
      const ro = $('#readout'); if (!ro) return;
      if (!f) { ro.textContent = t('noFace'); return; }
      W = f.W; irisSamples.push(f.eyes.irisPx); if (irisSamples.length > 40) irisSamples.shift();
      ro.innerHTML = `iris <b>${f.eyes.irisPx.toFixed(1)} px</b>`;
      $('#saveCam').disabled = irisSamples.length < 20;
    }, focalPxFor);
  }).catch(() => { const ro = $('#readout'); if (ro) ro.textContent = t('cameraFail'); });
  $('#saveCam').onclick = () => {
    const iris = G.median(irisSamples.slice(-20));
    calib.focalNorm = G.focalFromCalibration(iris, 400) / W;
    save('dd.calibration', calib);
    $('#camOut').textContent = 'Camera calibrated';
  };
}

// ====================================================================== PIN lock
// Patient data on the phone is encrypted; the PIN unlocks the key for this
// session. Five wrong PINs start an escalating wait.
const FAILS_KEY = 'dd.pinFails';
const fails = () => load(FAILS_KEY, { n: 0, until: 0 });
const lockoutRemaining = () => Math.max(0, fails().until - Date.now());
const resetAttempts = () => save(FAILS_KEY, { n: 0, until: 0 });
function recordFailure() {
  const f = fails(); f.n += 1;
  if (f.n >= 5) f.until = Date.now() + 30000 * 2 ** (f.n - 5);
  save(FAILS_KEY, f);
}

function pinScreen(mode, next) {
  setScreen(`<section class="card pin">
    <h2>${mode === 'set' ? t('pinSetTitle') : t('pinEnterTitle')}</h2>
    ${mode === 'set' ? `<p class="muted small">${t('pinSetHint')}</p>` : ''}
    <input id="pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="••••••" aria-label="PIN">
    ${mode === 'set' ? `<input id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="${esc(t('pinConfirm'))}" aria-label="${esc(t('pinConfirm'))}">` : ''}
    <button class="btn primary big" id="pinGo">${ic(mode === 'set' ? 'check' : 'unlock')} ${t('next')}</button>
    <p id="pinErr" class="err" role="alert"></p>
    ${mode === 'enter' ? `<button class="btn ghost small" id="pinReset">${t('forgotPin')}</button>` : ''}
  </section>`, `pin-${mode}`);
  const go = async () => {
    const err = $('#pinErr');
    const p1 = $('#pin1').value.trim();
    if (!/^\d{6}$/.test(p1)) { err.textContent = '6 digits'; return; }
    const wait = lockoutRemaining();
    if (mode === 'enter' && wait > 0) { err.textContent = `Too many attempts: wait ${Math.ceil(wait / 1000)} s`; return; }
    $('#pinGo').disabled = true;
    try {
      if (mode === 'set') {
        if (p1 !== $('#pin2').value.trim()) { err.textContent = t('pinMismatch'); $('#pinGo').disabled = false; return; }
        await store.setupPin(p1);
      } else {
        await store.unlock(p1);
      }
      resetAttempts();
      next();
    } catch {
      recordFailure();
      err.textContent = t('pinWrong');
      $('#pinGo').disabled = false;
      $('#pin1').value = '';
    }
  };
  $('#pinGo').onclick = go;
  $$('input', main).forEach((i) => { i.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
  $('#pin1').focus();
  const rb = $('#pinReset');
  if (rb) rb.onclick = async () => { if (confirm(`${t('forgotPin')}?`)) { await store.resetVault(); pinScreen('set', next); } };
}

async function lockNow() {
  if (store.isEphemeral()) { await signOutHere(); return; }
  if (C && store.isUnlocked()) { const { still, ...s } = C; await store.saveDraft(s).catch(() => {}); }
  store.lock();
  C = null;
  pinScreen('enter', () => home());
}

// ====================================================================== phone check
// Pre-flight for a field session or a demo: everything that can silently fail.
async function phoneCheck() {
  const rows = [];
  const add = (label, ok, detail = '') => rows.push(`<li class="pc ${ok === null ? 'na' : ok ? 'ok' : 'bad'}"><b>${ok === null ? '–' : ic(ok ? 'check' : 'x', { size: 16 })} ${esc(label)}</b><span class="muted small">${esc(detail)}</span></li>`);
  add('Secure connection (HTTPS)', window.isSecureContext, window.isSecureContext ? location.origin : 'Microphone and camera need HTTPS (or localhost).');
  add('Speech recognition', V.sttSupported(), V.sttSupported() ? 'Chrome speech recognition' : 'Not in this browser: tap mode only');
  for (const [k, v] of Object.entries(LANGS)) {
    const voice = V.voiceFor(k);
    add(`Voice: ${v}`, Boolean(voice), voice ? voice.name : 'Install it: Settings › Text-to-speech › Speech Services by Google › Install voice data');
  }
  add('Screen calibrated (eye-chart size)', Boolean(calib.pxPerMm), calib.pxPerMm ? `${calib.pxPerMm.toFixed(2)} px/mm` : 'Calibrate › Screen size');
  add('Camera calibrated (distances)', Boolean(calib.focalNorm), calib.focalNorm ? 'about ±5%' : 'Calibrate › Camera at 40 cm (otherwise ±15%)');
  let persisted = null;
  try { persisted = await navigator.storage?.persisted?.(); } catch { persisted = null; }
  add('Storage protected from clean-up', persisted ?? null, persisted ? 'Queued cases will not be evicted' : 'Not granted yet (Chrome grants it to installed or often-used sites)');
  add('Patient data encrypted on this phone', store.isUnlocked(), 'AES-256-GCM; key unlocked by your PIN; locks after 15 min idle');
  let health = null;
  try { const r = await fetch(`${store.API}/health`, { cache: 'no-store' }); health = r.ok ? await r.json() : null; } catch { health = null; }
  add('Bridge server reachable', Boolean(health), health ? `${health.cases} cases on the server` : 'Offline: cases queue and send later');
  const hub = await store.getHubKey();
  add('Optometrist hub key', Boolean(hub), hub ? `key ${hub.kid.slice(0, 10)}…: names and phones sealed to the hub` : 'No hub key yet: names and phones stay on this phone');
  let bat = null;
  try { bat = await navigator.getBattery?.(); } catch { bat = null; }
  if (bat) add('Battery', bat.level >= 0.3 || bat.charging, `${Math.round(bat.level * 100)}%${bat.charging ? ', charging' : ''}`);
  add('Cases waiting to send', true, String(await store.pendingCount()));
  setScreen(`<section class="card"><h2>Phone check</h2><ul class="pcheck">${rows.join('')}</ul>
      <h3>Try it</h3>
      <div class="row gap wrap">${Object.entries(LANGS).map(([k, v]) => `<button class="chip" data-say="${k}">${ic('volume', { size: 16 })} ${v}</button>`).join('')}</div>
      <div class="row gap wrap"><button class="btn" id="micTest">${ic('mic')} Test microphone (${LANGS[settings.lang]})</button><button class="btn" id="camTest">${ic('camera')} Test camera + face model</button></div>
      <div id="tryOut" class="muted"></div>
      <p class="muted small">App ${APP_VERSION} · rules ${RULES_VERSION}</p></section>
    <button class="btn ghost" id="home">${ic('left')} Home</button>`, 'phonecheck');
  const ageQ = QUESTION_BY_ID.age;
  $$('[data-say]', main).forEach((b) => { b.onclick = () => V.speak(questionText(ageQ, E.stateOf(E.createSession()), b.dataset.say), b.dataset.say); });
  $('#micTest').onclick = async () => {
    $('#tryOut').textContent = 'Listening… say an age, e.g. “fifty four”';
    const r = await V.listen(settings.lang);
    const v = r ? E.interpret(ageQ, r.transcript, settings.lang) : null;
    $('#tryOut').textContent = r ? `Heard “${r.transcript}” (confidence ${Math.round((r.confidence || 0) * 100)}%) → ${v?.ok ? v.value : 'not understood'}` : 'Nothing heard: check the microphone permission';
  };
  $('#camTest').onclick = async () => {
    const out = $('#tryOut');
    out.innerHTML = '<div class="cam"><video id="vid" playsinline muted></video><div id="readout" class="readout">Loading face model…</div></div>';
    let stream = null; let stop = null; let face = null; let cancelled = false;
    cleanup = () => { cancelled = true; stop?.(); face?.stopCamera(stream); };
    try {
      face = await import('./measure/face.js');
      const t0 = performance.now();
      const vid = $('#vid');
      const [lm, s] = await Promise.all([face.loadLandmarker(), face.startCamera(vid)]);
      stream = s;
      if (cancelled) { face.stopCamera(s); return; }
      const ms = Math.round(performance.now() - t0);
      stop = face.track(vid, lm, (f) => {
        const ro = $('#readout'); if (!ro) return;
        ro.innerHTML = f ? `face found · <b>${Math.round(f.distanceMm / 10)} cm</b> · ready in ${ms} ms` : `looking for a face · ready in ${ms} ms`;
      }, focalPxFor);
    } catch (e) { if (!cancelled) out.textContent = `Camera or face model failed: ${e.message || e}`; }
  };
  $('#home').onclick = home;
}

// ====================================================================== boot
$('#voiceToggle').onclick = () => { settings.voice = !settings.voice; save('dd.settings', settings); if (!settings.voice) V.stopAll(); updateHeader(); };
$('#homeLink').onclick = (e) => { e.preventDefault(); if (store.isUnlocked()) home(); };
$('#lockBtn').onclick = lockNow;
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, store.touch, { passive: true }));
setInterval(() => { if (store.idleTooLong()) lockNow(); }, 30000);

async function boot() {
  document.documentElement.lang = settings.uiLang;
  await Promise.race([pullRules(), new Promise((r) => setTimeout(r, 1500))]);
  // shared or camp computer: the account key lived only in the closed tab
  if (account.signedIn() && account.info().shared) { await signOutHere(); return; }
  if (!store.hasVault()) {
    if (account.signedIn()) await account.signout(); // its key was in the wiped vault: sign in again
    if (!localStorage.getItem('dd.localOnly')) { accountScreen(); return; }
    pinScreen('set', afterUnlock);
  } else if (!store.isUnlocked()) pinScreen('enter', afterUnlock);
  else afterUnlock();
}
async function afterUnlock() {
  if (account.signedIn() && !account.hasKey()) {
    const k = await store.getSecret('dataKey');
    if (k) await account.useKey(k);
  }
  route();
  syncNow().then((n) => { if (n && main.dataset.screen === 'home') home(); });
}

// ---------------------------------------------------------------- shop account
// Sign in on the shop's own phone (then a PIN for quick unlock) or on a shared
// or camp computer (nothing kept after sign-out). See account.js.
function accountScreen(after = null) {
  const canShare = !store.hasVault();
  let mode = 'in';
  setScreen(`<section class="card acct">
      <h2>${ic('user')} ${t('accTitle')}</h2>
      <div class="seg" id="accMode"><button class="chip on" data-mode="in" type="button">${t('accSignIn')}</button><button class="chip" data-mode="up" type="button">${t('accCreate')}</button></div>
      <form id="accForm" novalidate>
        <label id="shopWrap" hidden>${t('accShopName')}<input id="accShop" autocomplete="organization" maxlength="80"></label>
        <label>${t('accLogin')}<input id="accLogin" autocomplete="username" maxlength="254"></label>
        <label>${t('accPassword')}<input id="accPass" type="password" autocomplete="current-password" maxlength="200"></label>
        ${canShare ? `<label class="check"><input type="checkbox" id="accShared"> ${t('accShared')}</label>` : ''}
        <button class="btn primary big" type="submit" id="accGo">${t('accSignIn')}</button>
        <p class="err" id="accErr" role="alert"></p>
      </form>
      <p class="muted small">Your password never leaves this device. It unlocks your shop's encryption key, so the hub cannot read your shop's records. On a shared computer nothing stays after you sign out.</p>
      ${after ? `<button class="btn ghost" id="accBack">${ic('left')} ${t('back')}</button>` : `<button class="btn ghost" id="accLocalBtn">${t('accLocal')}</button>`}
    </section>`, 'account');
  const setMode = (m) => {
    mode = m;
    $$('[data-mode]', main).forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#shopWrap').hidden = m !== 'up';
    $('#accGo').textContent = m === 'up' ? t('accCreate') : t('accSignIn');
    $('#accPass').autocomplete = m === 'up' ? 'new-password' : 'current-password';
  };
  $$('[data-mode]', main).forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $('#accForm').onsubmit = async (e) => {
    e.preventDefault();
    const login = $('#accLogin').value.trim();
    const password = $('#accPass').value;
    const shared = Boolean($('#accShared')?.checked);
    if (password.length < 8) { $('#accErr').textContent = t('accWeak'); return; }
    if (mode === 'up' && $('#accShop').value.trim().length < 2) { $('#accErr').textContent = t('accShopName'); return; }
    $('#accGo').disabled = true;
    $('#accErr').textContent = t('accSigningIn');
    try {
      if (mode === 'up') await account.signup({ login, password, shopName: $('#accShop').value.trim(), shared });
      else await account.signin({ login, password, shared });
    } catch (err) {
      $('#accGo').disabled = false;
      const m = err.message;
      $('#accErr').textContent = m === 'exists' ? t('accExists') : m === 'bad' ? t('accBad') : m === 'locked' ? 'Too many wrong tries: wait 15 minutes.'
        : m === 'invalid' ? 'Enter a 10-digit phone number or an email.' : 'Could not reach the hub. Check the internet and try again.';
      return;
    }
    if (mode === 'up') { settings.site = account.info().shop.name; save('dd.settings', settings); }
    if (after) { await store.putSecret('dataKey', await account.exportKey()); await syncNow(); after(); return; }
    if (shared) { await store.ephemeral(); afterUnlock(); return; }
    pinScreen('set', async () => { await store.putSecret('dataKey', await account.exportKey()); afterUnlock(); });
  };
  const lb = $('#accLocalBtn'); if (lb) lb.onclick = () => { localStorage.setItem('dd.localOnly', '1'); pinScreen('set', afterUnlock); };
  const bb = $('#accBack'); if (bb) bb.onclick = () => after();
}

async function accountPanel() {
  const a = account.info();
  const langChips = Object.keys(LANGS).map((k) => `<button class="chip lang ${settings.uiLang === k ? 'on' : ''}" data-ulang="${k}" lang="${k}" aria-pressed="${settings.uiLang === k}">${LANGS[k]}</button>`).join('');
  setScreen(`${a ? `<section class="card">
      <h2>${ic('user')} ${esc(a.shop.name)}</h2>
      <p class="muted small">${esc(a.shop.login)} · ${a.shared ? 'shared computer: signed out when this tab closes' : 'this device stays signed in for 30 days'}</p>
      <h3>${t('accDevices')}</h3><ul class="pcheck" id="devList"><li class="muted small">…</li></ul>
      <div class="row gap wrap"><button class="btn" id="syncBtn">${ic('refresh')} Sync now</button><button class="btn warn" id="outBtn">${t('accSignOut')}</button></div>
      <p class="muted small" id="syncOut"></p></section>`
    : `<section class="card"><h2>${ic('user')} ${t('accTitle')}</h2>
      <p class="small">Sign in to keep this phone in step with the shop's other devices, or to work from a camp computer.</p>
      <button class="btn primary" id="signInBtn">${t('accSignIn')}</button></section>`}
    <details class="card"><summary>Settings: app language, shop, listening</summary>
      <h3 class="sub">${t('uiLanguage')}</h3><div class="seg">${langChips}</div>
      <label>${t('site')}<input id="siteIn" value="${esc(settings.site)}"></label>
      <label>Type<select id="siteType"><option value="store" ${settings.siteType === 'store' ? 'selected' : ''}>Optical store</option><option value="camp" ${settings.siteType === 'camp' ? 'selected' : ''}>Eye camp</option></select></label>
      <label>${t('operator')}<input id="opIn" value="${esc(settings.operator)}"></label>
      <label>${t('listenPatience')}<select id="listenSel">${Object.entries(LISTEN).map(([k, v]) => `<option value="${k}" ${settings.listen === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <p class="muted small">App ${APP_VERSION} · rules ${RULES_VERSION} · data on this device is encrypted (AES-256-GCM)</p></details>`, 'account-panel');
  const pushSettings = () => account.push('settings', 'shop', { site: settings.site, siteType: settings.siteType });
  $$('[data-ulang]', main).forEach((b) => b.onclick = () => { settings.uiLang = b.dataset.ulang; save('dd.settings', settings); document.documentElement.lang = settings.uiLang; accountPanel(); });
  $('#siteIn').onchange = (e) => { settings.site = e.target.value; save('dd.settings', settings); pushSettings(); };
  $('#siteType').onchange = (e) => { settings.siteType = e.target.value; save('dd.settings', settings); pushSettings(); };
  $('#opIn').onchange = (e) => { settings.operator = e.target.value; save('dd.settings', settings); };
  $('#listenSel').onchange = (e) => { settings.listen = e.target.value; save('dd.settings', settings); };
  if (!a) { $('#signInBtn').onclick = () => accountScreen(accountPanel); return; }
  $('#syncBtn').onclick = async () => { const n = await syncNow(); $('#syncOut').textContent = `${t('accSynced')} · ${n} new from other devices`; };
  $('#outBtn').onclick = signOutHere;
  const list = await account.devices().catch(() => []);
  const dl = $('#devList'); if (!dl) return;
  dl.innerHTML = list.map((d) => `<li class="pc"><b>${ic(/phone|iPhone/.test(d.device || '') ? 'phone' : 'monitor', { size: 16 })} ${esc(d.device || 'Device')}${d.current ? ' (this device)' : ''}${d.shared ? ' · shared computer' : ''}</b>
      <span class="muted small">last active ${esc((d.lastSeen || '').slice(0, 16).replace('T', ' '))} UTC ${d.current ? '' : `<button class="btn small ghost" data-revoke="${esc(d.id)}">Sign out that device</button>`}</span></li>`).join('') || '<li class="muted small">No devices</li>';
  $$('[data-revoke]', main).forEach((b) => b.onclick = async () => { await account.revoke(b.dataset.revoke); accountPanel(); });
}

async function signOutHere() {
  const shared = Boolean(account.info()?.shared) || store.isEphemeral();
  await account.signout();
  if (shared) {
    // shared or camp computer: erase everything this app stored here
    await store.resetVault();
    for (const k of Object.keys(localStorage)) if (k.startsWith('dd.') && !['dd.api', 'dd.stun'].includes(k)) localStorage.removeItem(k);
    try { sessionStorage.clear(); } catch { /* ignore */ }
    C = null;
    accountScreen();
    return;
  }
  store.dropSecret('dataKey');
  home();
}

// Encrypted sync with the shop account: take what the shop's other devices
// changed, send what changed here. Returns how many records came in.
let syncing = null;
const stampOf = (c) => `${c.sync === 'sent' ? 1 : 0}${c.review ? 1 : 0}|${c.review?.reviewedAt || ''}|${c.createdAt || ''}`;
function syncNow() {
  if (!account.signedIn() || !account.hasKey() || !store.isUnlocked()) return Promise.resolve(0);
  if (syncing) return syncing;
  syncing = (async () => {
    let got = 0;
    const pushed = load('dd.syncPushed', {});
    for (const r of await account.pull()) {
      if (r.kind === 'case') {
        const mine = await store.getCase(r.rid).catch(() => null);
        if (!mine || stampOf(r.obj) > stampOf(mine)) { await store.putCase(r.obj); got++; }
        pushed[r.rid] = stampOf(r.obj);
      } else if (r.kind === 'shop' && r.rid === 'data') {
        const mine = await store.getSecret('shopdata');
        if (!mine || (r.obj.updatedAt || '') > (mine.updatedAt || '')) { await store.putSecret('shopdata', r.obj); got++; }
      } else if (r.kind === 'settings' && r.rid === 'shop') {
        for (const k of ['site', 'siteType']) if (r.obj[k]) settings[k] = r.obj[k];
        save('dd.settings', settings);
      }
    }
    for (const c of await store.allCases()) {
      if (c.unreadable || pushed[c.id] === stampOf(c)) continue;
      if (await account.push('case', c.id, c)) pushed[c.id] = stampOf(c);
    }
    save('dd.syncPushed', pushed);
    return got;
  })().catch(() => 0).finally(() => { syncing = null; });
  return syncing;
}

// Deep links for demos and screenshots: ?demo=kumar[&screen=summary|checks]
async function route() {
  const q = new URLSearchParams(location.search);
  const demo = q.get('demo');
  if (demo && PERSONA_BY_KEY[demo]) {
    const p = PERSONA_BY_KEY[demo];
    startCase(p.lang, p);
    const target = q.get('screen');
    if (target === 'rules') { rulesScreen(home); return; }
    if (target === 'summary' || target === 'checks') {
      C.consent = { given: true, at: new Date().toISOString(), lang: p.lang, textVersion: 'consent-v1', method: 'demo' };
      for (let i = 0; i < 60; i++) {
        const qq = E.nextQuestion(C.session); if (!qq) break;
        const r = E.interpret(qq, p.say[qq.id], qq.asr || p.lang);
        if (!r.ok) break;
        E.submitAnswer(C.session, qq.id, r.value, { raw: p.say[qq.id], mode: 'voice' });
      }
      if (target === 'summary') for (const k of Object.keys(MKEY)) demoFill(k);
      (target === 'summary' ? summary : checks)();
    } else if (target === 'interview') {
      C.consent = { given: true, at: new Date().toISOString(), lang: p.lang, textVersion: 'consent-v1', method: 'demo' };
      const stopAt = Number(q.get('q') || 0);
      for (let i = 0; i < stopAt; i++) {
        const qq = E.nextQuestion(C.session); if (!qq) break;
        const r = E.interpret(qq, p.say[qq.id], qq.asr || p.lang);
        E.submitAnswer(C.session, qq.id, r.value, { raw: p.say[qq.id], mode: 'voice' });
      }
      if (q.get('still')) { C.still = p.say; C.demo = null; }
      interview();
    }
    return;
  }
  if (q.get('screen') === 'rules') { rulesScreen(home); return; }
  if (/^\d{6}$/.test(q.get('pair') || '')) { history.replaceState(null, '', location.pathname); pairScreen(home, q.get('pair')); return; }
  home();
  store.syncPending().then(updateHeader).catch(() => {});
}
// ---------------------------------------------------------------- video consult (phone side)
// The optometrist can call about any case this phone sent in the last 14 days.
let sentIds = [];
let sentNames = {};
let callBanner = null;
const declined = new Set();
const storeSide = (name) => `<h3>Shared with the optometrist</h3>
  <p class="small">The interview, the test results and the vision profile for <b>${esc(name)}</b> were sent with the case.</p>
  <p class="small muted">Switch to the rear camera to show the eye up close. Audio and video go directly between the two devices; nothing is recorded.</p>`;
function showCallBanner(c) {
  if (!c) { callBanner?.remove(); callBanner = null; return; }
  if (callBanner?.dataset.id === c.id) return;
  callBanner?.remove();
  const name = sentNames[c.caseId] || shortCode(c.caseId);
  callBanner = document.createElement('div');
  callBanner.className = 'callbanner';
  callBanner.dataset.id = c.id;
  callBanner.innerHTML = `${ic('video')}<span><b>Optometrist video call</b><small>${esc(name)}</small></span>
    <button class="btn small primary" id="cbJoin">Join</button><button class="btn small ghost" id="cbNo" aria-label="Decline">${ic('x')}</button>`;
  document.body.appendChild(callBanner);
  callBanner.querySelector('#cbJoin').onclick = () => {
    showCallBanner(null);
    openCall({ api: store.API, callId: c.id, role: 'store', initiator: false, title: `Video consult · ${name}`, side: storeSide(name) });
  };
  callBanner.querySelector('#cbNo').onclick = () => { declined.add(c.id); showCallBanner(null); };
}
async function pollCalls() {
  if (!store.isUnlocked() || !sentIds.length || document.querySelector('.call')) return;
  try {
    const r = await fetch(`${store.API}/calls?cases=${encodeURIComponent(sentIds.join(','))}`);
    const list = r.ok ? await r.json() : [];
    showCallBanner(list.find((x) => !declined.has(x.id)) || null);
  } catch { /* offline */ }
}
setInterval(pollCalls, 4000);

boot();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
