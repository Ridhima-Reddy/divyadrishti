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
}

const PL = () => (C ? C.lang : settings.lang);
const t = (k, vars) => tr(k, settings.uiLang, vars); // operator-facing
const tp = (k, vars) => tr(k, PL(), vars); // patient-facing: shown and spoken
const sayP = (text) => { if (settings.voice && text) V.speak(text, C ? C.lang : settings.lang); };

function updateHeader() {
  const vb = $('#voiceToggle');
  if (vb) { vb.textContent = settings.voice ? `🔊 ${t('voiceOn')}` : `🔇 ${t('voiceOff')}`; vb.setAttribute('aria-pressed', String(settings.voice)); }
  const sb = $('#syncBadge');
  store.pendingCount().then((pending) => {
    if (sb) { sb.textContent = pending ? `⟳ ${pending}` : '✓'; sb.title = pending ? `${pending} waiting to sync` : 'All synced'; }
  }).catch(() => {});
  const lb = $('#lockBtn');
  if (lb) { lb.hidden = !store.isUnlocked(); lb.textContent = '🔒'; lb.title = t('lock'); lb.setAttribute('aria-label', t('lock')); }
}

// Encrypted autosave of the case in progress: a crash, a reload or a call
// never loses a patient's answers.
function saveDraft() {
  if (!C || !store.isUnlocked()) return;
  const { still, ...state } = C;
  store.saveDraft(state).catch(() => {});
}

// ====================================================================== home
async function home() {
  C = null;
  const draft = await store.loadDraft().catch(() => null);
  const chips = (cur, attr) => Object.entries(LANGS).map(([k, v]) => `<button class="chip lang ${cur === k ? 'on' : ''}" data-${attr}="${k}" lang="${k}" aria-pressed="${cur === k}">${v}</button>`).join('');
  const demos = PERSONAS.map((p) => `<button class="demo" data-demo="${p.key}"><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span><i>${LANGS[p.lang]}</i></button>`).join('');
  setScreen(`
    <section class="hero">
      <p class="eyebrow">${esc(settings.site)}</p>
      <h1>${t('appTagline')}</h1>
    </section>
    <div class="homegrid">
      <div class="col">
        ${draft ? `<section class="card resume"><b>${t('resume')}</b>
          <p class="muted small">${esc(draft.patient?.name || shortCode(draft.id))} · ${LANGS[draft.lang] || ''} · ${draft.session?.trace?.filter((x) => x.qid && !x.event).length || 0} answers</p>
          <div class="row gap"><button class="btn primary" id="resumeBtn">↻ ${t('resume')}</button><button class="btn ghost" id="discardBtn" aria-label="discard">✕</button></div></section>` : ''}
        <section class="card">
          <h2>${t('language')}</h2>
          <div class="row wrap">${chips(settings.lang, 'plang')}</div>
          <button class="btn primary big" id="newBtn">${t('newScreening')}</button>
          <h3 class="sub">${t('uiLanguage')}</h3>
          <div class="row wrap">${chips(settings.uiLang, 'ulang')}</div>
        </section>
        <section class="row wrap gap tools">
          <button class="btn" id="inboxBtn">📥 ${t('results')}</button>
          <button class="btn" id="rulesBtn">🚦 ${t('rules')}</button>
          <button class="btn" id="calBtn">📏 ${t('calibrate')}</button>
          <button class="btn" id="checkBtn">🩻 Phone check</button>
          <a class="btn" href="portal.html" target="_blank" rel="noopener">🩺 Optometrist portal</a>
        </section>
        <details class="card small">
          <summary>Store / camp settings</summary>
          <label>${t('site')}<input id="siteIn" value="${esc(settings.site)}"></label>
          <label>Type<select id="siteType"><option value="store" ${settings.siteType === 'store' ? 'selected' : ''}>Optical store</option><option value="camp" ${settings.siteType === 'camp' ? 'selected' : ''}>Eye camp</option></select></label>
          <label>${t('operator')}<input id="opIn" value="${esc(settings.operator)}"></label>
          <label>${t('listenPatience')}<select id="listenSel">${Object.entries(LISTEN).map(([k, v]) => `<option value="${k}" ${settings.listen === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
          <p class="muted small">App ${APP_VERSION} · rules ${RULES_VERSION} · data on this phone is encrypted (AES-256-GCM, PIN-protected)</p>
        </details>
      </div>
      <section class="card col">
        <h2>${t('demo')}</h2>
        <p class="muted small">Plays the interview with a scripted patient so you can see the adaptive questions, the tests and the profile without a microphone.</p>
        <div class="demos">${demos}</div>
      </section>
    </div>`, 'home');
  if (draft) {
    $('#resumeBtn').onclick = () => resumeDraft(draft);
    $('#discardBtn').onclick = async () => { await store.clearDraft(); home(); };
  }
  $('#checkBtn').onclick = phoneCheck;
  $$('[data-plang]', main).forEach((b) => b.onclick = () => { settings.lang = b.dataset.plang; save('dd.settings', settings); home(); });
  $$('[data-ulang]', main).forEach((b) => b.onclick = () => { settings.uiLang = b.dataset.ulang; save('dd.settings', settings); document.documentElement.lang = settings.uiLang; home(); });
  $('#newBtn').onclick = () => startCase(settings.lang);
  $$('.demo', main).forEach((b) => b.onclick = () => startCase(PERSONA_BY_KEY[b.dataset.demo].lang, PERSONA_BY_KEY[b.dataset.demo]));
  $('#inboxBtn').onclick = inbox;
  $('#rulesBtn').onclick = () => rulesScreen(home);
  $('#calBtn').onclick = calibration;
  $('#siteIn').onchange = (e) => { settings.site = e.target.value; save('dd.settings', settings); };
  $('#siteType').onchange = (e) => { settings.siteType = e.target.value; save('dd.settings', settings); };
  $('#opIn').onchange = (e) => { settings.operator = e.target.value; save('dd.settings', settings); };
  $('#listenSel').onchange = (e) => { settings.listen = e.target.value; save('dd.settings', settings); };
}

// What scores as a red flag and what does not: the same table the engine runs.
function rulesScreen(back = home) {
  setScreen(`<section class="card wide"><h2>🚦 ${t('rulesTitle')}</h2>${rulesTableHtml()}</section>
    <button class="btn ghost" id="rulesBack">← ${t('back')}</button>`, 'rules');
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
        <button class="btn" id="playConsent">🔊 ${t('play')}</button>
      </div>
      <div class="row gap">
        <button class="btn primary big" id="agree">✓ ${t('agree')}</button>
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
        <button class="btn primary" id="multiNext" disabled>${t('next')} →</button>`;
    case 'number':
    case 'hours': {
      const quick = (q.quick || []).map((n) => `<button class="chip quick" data-v="${n}">${n}${q.type === 'hours' ? ' h' : ''}</button>`).join('');
      return `<div class="row wrap gap">${quick}</div>
        <div class="row gap numrow"><input id="numIn" type="number" inputmode="decimal" step="${q.type === 'hours' ? '0.5' : '1'}" min="${q.min ?? 0}" max="${q.max ?? 16}" placeholder="${q.type === 'hours' ? 'hours' : esc(q.unit?.en || '')}">
        <button class="btn primary" id="numNext">${t('next')} →</button></div>`;
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
        <button class="btn" id="rxSave">${t('next')} →</button></details>
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
    ${s.d.urgent ? `<div class="banner red">⚠ ${t('urgentBanner')}</div>` : ''}
    <div class="ivgrid">
    <section class="card qcard">
      <div class="row between"><span class="tag">${MODULE_LABEL[q.module] || q.module}</span><span class="muted small">Q${asked + 1}${s.d.age !== null ? ` · ${t('aboutMore', { n: more })}` : ''}</span></div>
      <p class="question" lang="${C.lang}">${esc(text)}</p>
      ${settings.uiLang !== C.lang ? `<p class="muted small en" lang="${settings.uiLang}">${esc(textOp)}</p>` : ''}
      <div class="voicebar"><span id="vstate" class="pill">…</span><span id="transcript" class="transcript"></span>
        <button class="btn small primary" id="doneSpk" hidden>✓ ${t('doneSpeaking')}</button>
        <button class="chip small ${settings.listen === 'long' ? 'on' : ''}" id="moreTime" aria-pressed="${settings.listen === 'long'}">⏳ ${t('moreTime')}</button>
      </div>
      <div id="heard" class="heard" hidden></div>
      <div class="controls">${answerControls(q)}</div>
    </section>
    <aside class="card side">
      <p class="why"><b>${t('why')}:</b> ${esc(q.reason(s))}</p>
      ${recent ? `<h3>Answers so far</h3><ul class="sofar">${recent}</ul>` : ''}
      <button class="btn ghost small" id="rulesLink">🚦 ${t('rules')}</button>
    </aside>
    </div>
    <div class="row between navrow">
      <button class="btn ghost" id="backBtn" ${asked ? '' : 'disabled'}>← ${t('back')}</button>
      <button class="btn ghost" id="againBtn">↻ ${t('speakAgain')}</button>
      <button class="btn ghost" id="skipBtn">${t('skip')} →</button>
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
  el.textContent = state === 'speaking' ? `🔊 ${t('speaking')}` : state === 'listening' || state === 'hearing' ? `🎙 ${t('listening')}${state === 'hearing' ? ' …' : ''}` : state === 'demo' ? '🎭 demo patient' : state === 'off' ? t('voiceOff') : '…';
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
    ${needsTap ? `<button class="btn primary" id="okHeard">✓ ${t('next')}</button>` : `<span class="countdown" aria-hidden="true"><i style="animation-duration:${delay}ms"></i></span>`}<button class="btn ghost" id="chgHeard">${t('change')}</button>
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
      <div><b>${t(`chk_${k}`)}</b> <span class="badge ${p.recommended ? 'rec' : 'opt'}">${p.recommended ? t('recommended') : t('optional')}</span>
        ${p.reason ? `<span class="muted small">${esc(p.reason)}</span>` : ''}
        ${done ? `<span class="result small">✓ ${esc(checkSummary(k))}</span>` : ''}</div>
      <button class="btn ${done ? 'ghost' : p.recommended ? 'primary' : ''}" data-chk="${k}">${done ? '↻' : t('run')}</button></li>`;
  };
  const groups = CHECK_GROUPS.map((g) => `<section class="card"><h3>${t(`grp_${g.key}`)}</h3><ul class="checks">${g.checks.map(row).join('')}</ul></section>`).join('');
  const tri = prof.triage;
  setScreen(`
    ${prof.derived.urgent ? `<div class="banner red">⚠ ${t('urgentBanner')} ${t('emergencyNow')}</div>` : tri.urgency === 'urgent' ? `<div class="banner amber">⏱ ${t('urgentNote', { within: tri.within })}</div>` : ''}
    <section class="card">
      <h2>${t('checksTitle')}</h2>
      <p class="muted small">${t('checksHint')}</p>
      <div class="row gap wrap"><span class="muted small">${t('optotype')}:</span>
        <button class="chip ${settings.optotype !== 'C' ? 'on' : ''}" data-opt="E">${t('optE')}</button>
        <button class="chip ${settings.optotype === 'C' ? 'on' : ''}" data-opt="C">${t('optC')}</button></div>
    </section>
    <div class="checkgrid">${groups}</div>
    <button class="btn primary big" id="toSummary">${t('finishChecks')} →</button>`, 'checks');
  $$('[data-chk]', main).forEach((b) => b.onclick = () => CHECK_RUN[b.dataset.chk]());
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
const demoBtn = (key) => (C.demo?.measure?.[MKEY[key]] !== undefined ? `<button class="btn ghost" id="demoFill" data-k="${key}">🎭 Use demo patient’s value</button>` : '');
function wireDemo() { const b = $('#demoFill'); if (b) b.onclick = () => { demoFill(b.dataset.k); checks(); }; }

// Screen helpers handed to the extra test screens (tests_ui.js).
const api = {
  setScreen, $: (sel) => $(sel, main), $$: (sel) => $$(sel, main), esc, t, tp,
  say: (text) => sayP(text), get C() { return C; }, back: () => checks(), pxPerMm, calibrated: () => Boolean(calib.pxPerMm),
  demoBtn, wireDemo, setCleanup: (fn) => { cleanup = fn; }, median: G.median,
  cameraScreen: (o) => cameraScreen(o),
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
      <button class="btn ghost" id="backChecks">← ${t('back')}</button>
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
      ro.innerHTML = `<b>${Math.round(G.median(samples.slice(-10)))} cm</b>${stable ? ' ✓' : ''}`;
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
  const distanceMm = 2000;
  const st = A.createStaircase({ start: pinhole ? 0.5 : 0.6 });
  const cover = eye === 'R' ? tp('leftEye') : tp('rightEye');
  const optotype = settings.optotype === 'C' ? 'C' : 'E';
  setScreen(`
    <section class="card acuity">
      <h2>${t('chk_acuity')} · ${eye === 'R' ? 'Right eye' : 'Left eye'}${pinhole ? ' · pinhole' : ''}</h2>
      <p class="say" lang="${C.lang}">${tp('acuitySetup', { eye: cover })}</p>
      <div class="estage" id="stage"></div>
      <div class="arrows">
        <button class="btn" data-d="up">↑</button>
        <div class="row gap"><button class="btn" data-d="left">←</button><button class="btn" data-d="right">→</button></div>
        <button class="btn" data-d="down">↓</button>
      </div>
      <p class="muted small" id="lvl"></p>
      ${demoBtn('acuity')}
      <button class="btn ghost" id="backChecks">← ${t('back')}</button>
    </section>`, 'check-acuity');
  $('#backChecks').onclick = checks;
  wireDemo();
  sayP(tp('acuitySetup', { eye: cover }));
  const show = () => {
    const o = A.nextOptotype(st);
    const px = Math.max(6, G.optotypeMm(o.level, distanceMm) * pxPerMm());
    $('#stage').innerHTML = optotype === 'C' ? landoltSvg(o.dir, Math.round(px)) : eSvg(o.dir, Math.round(px));
    $('#lvl').textContent = `Line ${A.snellen(o.level)} · ${Math.round(px)} px`;
  };
  const answer = (d) => {
    A.respond(st, d);
    if (!st.done) { show(); return; }
    C.measurements.acuity = C.measurements.acuity || { distanceM: 2 };
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
  const stage = $('#stage');
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
  const cell = 5 * pxPerMm(); // 5 mm squares
  const n = Math.max(8, Math.min(14, Math.floor((Math.min(window.innerWidth, 520) - 48) / cell)));
  const cover = eye === 'R' ? tp('leftEye') : tp('rightEye');
  setScreen(`<section class="card">
      <h2>${t('chk_amsler')} · ${eye === 'R' ? 'Right eye' : 'Left eye'}</h2>
      <p class="say" lang="${C.lang}">${tp('amslerAsk', { eye: cover })}</p>
      <div class="amsler" style="--cell:${cell}px;--n:${n}"><i></i></div>
      <div class="row gap"><button class="btn big" id="aNo">${tp('no')}${sub('no')}</button><button class="btn big warn" id="aYes">${tp('yes')}${sub('yes')}</button></div>
      ${demoBtn('amsler')}
      <button class="btn ghost" id="backChecks">← ${t('back')}</button></section>`, 'check-amsler');
  $('#backChecks').onclick = checks;
  wireDemo();
  sayP(tp('amslerAsk', { eye: cover }));
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
      ro.innerHTML = `<b>${Math.round(f.distanceMm / 10)} cm</b> ${q.ok ? '✓' : `· ${t('holdStraight')}`}`;
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
      ${profileHtml(prof, C.measurements, C.session.answers)}
      <p class="muted small">Asked ${payload.interview.asked} of ${payload.interview.bank} questions (${payload.interview.bank - payload.interview.asked} not relevant for this patient) · about ${mins} min${C.measurements.simulated ? ` · simulated tests: ${C.measurements.simulated.join(', ')}` : ''}</p>
    </section>
    <button class="btn primary big" id="sendBtn">📤 ${t('sendToOptom')}</button>
    <p id="sendState" class="muted small center"></p>
    <section class="card passport" id="passportCard" hidden>
      <h2>${t('passport')}</h2>
      <pre lang="${C.lang}">${esc(payload.passportLocal)}</pre>
      ${shareBoxHtml()}
    </section>
    <button class="btn ghost big" id="nextPt">${t('newPatient')} →</button>`, 'summary');
  $('#sendBtn').onclick = async () => {
    $('#sendBtn').disabled = true;
    await store.putCase({ ...payload, sync: 'queued' });
    await store.clearDraft();
    $('#sendState').textContent = t('queued');
    const n = await store.syncPending();
    const hub = await store.getHubKey({ refresh: false });
    $('#sendState').textContent = `${n ? `✓ ${t('sent')}` : t('queued')} · 🔐 ${hub ? 'name and phone sealed so only the optometrist can read them' : 'name and phone stay on this phone'}`;
    $('#passportCard').hidden = false;
    updateHeader();
  };
  wireShare($('#passportCard'), {
    doc: () => ({ text: payload.passportLocal, lang: C.lang }), // first line is the heading
    phone: C.patient.phone, caseRef: C.id, lang: C.lang, code: shortCode(C.id),
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
    <h3>🔐 ${t('shareSecure')}</h3>
    <label class="check"><input type="checkbox" class="usePin" checked> ${t('sharePin')}</label>
    <button class="btn primary mkShare">${t('shareMake')}</button>
    <div class="shareOut" hidden>
      <div class="qr"></div>
      <p class="small">${t('shareScan')}</p>
      <p class="pinshow" hidden></p>
      <p class="muted small">${t('shareSend')}</p>
      <div class="row gap wrap">
        <a class="btn smsLink">SMS</a><a class="btn waLink" target="_blank" rel="noopener">WhatsApp</a>
        <button class="btn copyLink">${t('shareCopy')}</button><button class="btn ghost revokeLink">${t('shareRevoke')}</button>
      </div>
      <p class="muted small shareNote"></p>
    </div>
    <p class="err shareErr"></p>
  </div>`;
}

function wireShare(root, { doc, phone, caseRef, lang, code }) {
  const q = (c) => root.querySelector(c);
  let made = null;
  q('.mkShare').onclick = async () => {
    q('.mkShare').disabled = true; q('.shareErr').textContent = '';
    try {
      const [{ createShareLink }, { qrSvg }] = await Promise.all([import('./share.js'), import('./qr.js')]);
      const pin = q('.usePin').checked ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0') : undefined;
      made = await createShareLink(doc(), { pin, kind: 'passport', expiresDays: 7, maxViews: 20, caseRef, actor: settings.operator || 'field', api: store.API });
      const msg = `${pt(P.title, lang)} · ${code}: ${made.url}`;
      q('.qr').innerHTML = qrSvg(made.url, { cellSize: 4, label: 'secure link' }) || `<code>${esc(made.url)}</code>`;
      q('.pinshow').hidden = !pin;
      q('.pinshow').textContent = pin ? `PIN ${pin}` : '';
      q('.smsLink').href = smsLink(phone, msg);
      q('.waLink').href = whatsappLink(phone, msg);
      q('.copyLink').onclick = () => navigator.clipboard?.writeText(made.url);
      q('.shareNote').textContent = t('shareNote', { days: 7, views: made.maxViews || 20 });
      q('.shareOut').hidden = false;
      q('.mkShare').hidden = true;
    } catch (e) {
      q('.shareErr').textContent = `${t('shareFailed')} (${e.code || e.message || e})`;
      q('.mkShare').disabled = false;
    }
  };
  q('.revokeLink').onclick = async () => {
    if (!made) return;
    try {
      const { revokeShare } = await import('./share.js');
      await revokeShare(made.id, made.deleteToken, { api: store.API });
      q('.shareOut').innerHTML = `<p class="small">✓ ${t('shareRevoked')}</p>`;
    } catch (e) { q('.shareErr').textContent = String(e.code || e.message || e); }
  };
}

// ====================================================================== inbox
async function inbox() {
  await store.syncPending();
  await store.pullReviews();
  const list = await store.allCases();
  const rows = list.map((c) => {
    if (c.unreadable) return `<li class="inrow muted">${esc(shortCode(c.id))}: encrypted with an older PIN</li>`;
    const lane = c.profile?.triage?.lane || 'green';
    const rv = c.review;
    return `<li class="inrow"><span class="dot ${lane}"></span><div><b>${esc(c.patient?.name || shortCode(c.id))}</b>
      <span class="muted small">${esc(c.profile?.summary || '')}</span>
      <span class="small">${c.sync === 'sent' ? (rv ? `🩺 ${esc(rv.decisionLabel || rv.decision)}: ${esc(rv.nextStep || '')}` : 'Waiting for optometrist') : t('queued')}</span></div>
      ${rv ? `<button class="btn" data-share="${esc(c.id)}">🔐 ${t('shareSecure')}</button>` : ''}</li>`;
  }).join('') || '<li class="muted">No cases on this phone yet.</li>';
  setScreen(`<section class="card wide"><h2>${t('results')}</h2><ul class="inbox">${rows}</ul></section>
    <section class="card passport" id="inboxShare" hidden></section>
    <div class="row gap"><button class="btn" id="refresh">↻ Refresh</button><button class="btn ghost" id="home">← Home</button></div>`, 'inbox');
  $$('[data-share]', main).forEach((b) => b.onclick = () => {
    const c = list.find((x) => x.id === b.dataset.share);
    const text = passportText({ id: c.id, patient: c.patient, profile: c.profile, answers: c.interview?.answers, review: c.review }, c.lang);
    const box = $('#inboxShare');
    box.hidden = false;
    box.innerHTML = `<h2>${esc(c.patient?.name || shortCode(c.id))}</h2><pre lang="${c.lang}">${esc(text)}</pre>${shareBoxHtml()}`;
    wireShare(box, { doc: () => ({ text, lang: c.lang }), phone: c.patient?.phone, caseRef: c.id, lang: c.lang, code: shortCode(c.id) });
    box.scrollIntoView({ behavior: 'smooth' });
  });
  $('#refresh').onclick = inbox;
  $('#home').onclick = home;
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
    <button class="btn ghost" id="home">← Home</button>`, 'calibration');
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
    <h2>🔐 ${mode === 'set' ? t('pinSetTitle') : t('pinEnterTitle')}</h2>
    ${mode === 'set' ? `<p class="muted small">${t('pinSetHint')}</p>` : ''}
    <input id="pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="••••••" aria-label="PIN">
    ${mode === 'set' ? `<input id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="${esc(t('pinConfirm'))}" aria-label="${esc(t('pinConfirm'))}">` : ''}
    <button class="btn primary big" id="pinGo">${mode === 'set' ? '✓' : '🔓'} ${t('next')}</button>
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
  if (C && store.isUnlocked()) { const { still, ...s } = C; await store.saveDraft(s).catch(() => {}); }
  store.lock();
  C = null;
  pinScreen('enter', () => home());
}

// ====================================================================== phone check
// Pre-flight for a field session or a demo: everything that can silently fail.
async function phoneCheck() {
  const rows = [];
  const add = (label, ok, detail = '') => rows.push(`<li class="pc ${ok === null ? 'na' : ok ? 'ok' : 'bad'}"><b>${ok === null ? '–' : ok ? '✓' : '✗'} ${esc(label)}</b><span class="muted small">${esc(detail)}</span></li>`);
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
      <div class="row gap wrap">${Object.entries(LANGS).map(([k, v]) => `<button class="chip" data-say="${k}">🔊 ${v}</button>`).join('')}</div>
      <div class="row gap wrap"><button class="btn" id="micTest">🎙 Test microphone (${LANGS[settings.lang]})</button><button class="btn" id="camTest">📷 Test camera + face model</button></div>
      <div id="tryOut" class="muted"></div>
      <p class="muted small">App ${APP_VERSION} · rules ${RULES_VERSION}</p></section>
    <button class="btn ghost" id="home">← Home</button>`, 'phonecheck');
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
        ro.innerHTML = f ? `face ✓ <b>${Math.round(f.distanceMm / 10)} cm</b> · ready in ${ms} ms` : `looking for a face · ready in ${ms} ms`;
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
  if (!store.hasVault()) pinScreen('set', route);
  else if (!store.isUnlocked()) pinScreen('enter', route);
  else route();
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
  home();
  store.syncPending().then(updateHeader).catch(() => {});
}
boot();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
