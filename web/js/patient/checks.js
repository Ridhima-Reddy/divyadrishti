// Self-checks at home, modelled on online vision screenings: one instruction
// per screen, one eye at a time where it matters, and a plain-language result
// per eye. Stimuli and sizing reuse the optical store app's measure/ modules. Results
// stay on the phone; only {test, outcome, ageBand} is counted on the server.
import * as A from '../measure/acuity.js';
import { ID_CARD_MM, optotypeMm, defaultPxPerMm } from '../measure/geometry.js';
import { landoltSvg, createContrastTest, nextRing, respondRing } from '../measure/contrast.js';
import { SERIES, generatePlate, plateSvg, scorePlates } from '../measure/plates.js';
import { dialSvg, N_SIZES, nSizePx } from '../measure/charts.js';
import * as S from './store.js';
import { $, $$, esc, icon, OUTCOMES, worstOf, tierChip, fmtDate, api, toast } from './ui.js';
import * as V from './voice.js';

const CARD_SHORT_MM = 53.98; // ISO/IEC 7810 ID-1, the short side
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
export const pxPerMm = () => S.prefs().pxPerMm || defaultPxPerMm(isPhone());

export const TESTS = {
  acuity: { name: 'Distance sharpness', short: 'Distance', icon: 'eye', sized: true },
  near: { name: 'Reading up close', short: 'Near reading', icon: 'text', sized: true },
  amsler: { name: 'Amsler grid', short: 'Amsler grid', icon: 'grid', sized: true },
  contrast: { name: 'Faint rings', short: 'Contrast', icon: 'contrast', sized: true },
  colour: { name: 'Colour numbers', short: 'Colour plates', icon: 'palette', sized: false },
  astigmatism: { name: 'Line dial', short: 'Astigmatism dial', icon: 'dial', sized: false },
};
export const ORDER = ['acuity', 'near', 'amsler', 'contrast', 'colour', 'astigmatism'];
export const GROUPS = [
  { name: 'Sharpness', about: 'How clearly you see far away and up close.', icon: 'eye', tests: ['acuity', 'near'] },
  { name: 'Eye health', about: 'Wavy lines or faint shapes can show a change inside the eye.', icon: 'grid', tests: ['amsler', 'contrast'] },
  { name: 'Colour', about: 'Numbers hidden in coloured dots.', icon: 'palette', tests: ['colour'] },
  { name: 'Comfort', about: 'Uneven focus that can tire the eyes.', icon: 'dial', tests: ['astigmatism'] },
];
const AGES = [['<18', 'Under 18'], ['18-39', '18 to 39'], ['40-59', '40 to 59'], ['60+', '60 or over'], ['unknown', 'Prefer not to say']];
export const ageLabel = (v) => (AGES.find(([k]) => k === v) || [null, 'Not set'])[1];

const eyeName = (eye) => ({ R: 'Right eye', L: 'Left eye', both: 'Both eyes' }[eye] || '');
const coverTitle = (eye) => (eye === 'R' ? 'Cover your left eye' : 'Cover your right eye');

// latest self-check entry per test
export function latestResults() {
  const out = {};
  for (const e of S.sortedEntries()) if (e.type === 'selfcheck' && TESTS[e.test] && !out[e.test]) out[e.test] = e;
  return out;
}

// One line for the shop, built from the latest result of each check (max 300 characters).
export function selfTestSummary() {
  const latest = latestResults();
  const parts = ORDER.filter((k) => latest[k]).map((k) => {
    const e = latest[k];
    const eyes = (e.eyes || []).filter((x) => x.eye !== 'both' && x.outcome !== 'looks_good').map((x) => `${eyeName(x.eye).toLowerCase()}: ${OUTCOMES[x.outcome].label}`);
    return `${TESTS[k].name} ${fmtDate(e.date, { day: 'numeric', month: 'short' })}: ${OUTCOMES[e.outcome].label}${eyes.length && e.outcome !== 'looks_good' ? ` (${eyes.join(', ')})` : ''}`;
  });
  if (!parts.length) return '';
  const s = `Self-checks at home: ${parts.join('; ')}.`;
  return s.length <= 300 ? s : `${s.slice(0, 297)}...`;
}

// ====================================================================== hub
export function hub(app) {
  const latest = latestResults();
  const p = S.prefs();
  const screenState = p.pxPerMm ? (p.screenSet === 'typical' ? 'Typical size, approximate' : 'Matched to a card') : 'Not set yet';
  const done = ORDER.filter((k) => latest[k]);
  app.render(`
    <header class="p-head">
      <h1 tabindex="-1">Check my eyes</h1>
      <p class="lede">Short checks, one screen at a time. Wear your usual glasses. This is a screening, not a diagnosis.</p>
    </header>
    <div class="p-groups">${GROUPS.map((g) => `
      <section class="card p-group">
        <div class="p-ghead"><span class="p-gicon">${icon(g.icon, { size: 20 })}</span><div><h2>${esc(g.name)}</h2><p class="meta">${esc(g.about)}</p></div></div>
        <div class="p-chips">${g.tests.map((k) => `<a class="chip p-testchip${latest[k] ? ' done' : ''}" href="#check/${k}">${esc(TESTS[k].short)}${latest[k] ? `${icon('check', { size: 15 })}<span class="sr"> (done)</span>` : icon('right', { size: 15 })}</a>`).join('')}</div>
      </section>`).join('')}
    </div>
    <div class="p-hubgrid">
      <section class="card">
        <h2>${icon('record')} Your latest results</h2>
        ${done.length ? `<ul class="p-results">${done.map((k) => `<li><a href="#check/${k}"><span><b>${esc(TESTS[k].name)}</b><small>${esc(fmtDate(latest[k].date))}</small></span>${tierChip(latest[k].outcome)}</a></li>`).join('')}</ul>
          <p class="muted small">Tap a check to do it again. All results are in <a href="#record">My eye record</a>.</p>`
    : '<p class="muted">No checks yet. Start with distance sharpness if you are not sure where to begin.</p><a class="btn primary" href="#check/acuity">Start with distance sharpness</a>'}
      </section>
      <section class="card">
        <h2>${icon('sliders')} Before you start</h2>
        <div class="kv"><span>Screen size</span><b>${esc(screenState)}</b></div>
        <a class="btn small p-kvbtn" href="#calibrate">${icon('ruler')} ${p.pxPerMm ? 'Match again' : 'Match my screen'}</a>
        <label class="p-agesel">Age group<select id="ageSel"><option value="">Not set</option>${AGES.map(([v, l]) => `<option value="${esc(v)}" ${p.ageBand === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <p class="muted small">Each result is counted without your name: only the check, the result and your age group leave this phone.</p>
      </section>
    </div>
    <p class="p-safetyline">${icon('alert')} <span><b>Sudden change?</b> Sudden loss of sight, a dark curtain, new flashes or floaters, a painful red eye, or an injury: go to an eye hospital today. Do not use these checks.</span></p>`, 'checks');
  $('#ageSel').onchange = (e) => { S.setPrefs({ ageBand: e.target.value || null }); toast('Age group saved'); };
}

// ====================================================================== running a check
export function runTest(app, key) {
  if (!TESTS[key]) { app.go('check'); return; }
  const p = S.prefs();
  if (!p.ageBand) { askAge(app, () => runTest(app, key)); return; }
  if (TESTS[key].sized && !p.pxPerMm) { calibration(app, { then: () => runTest(app, key) }); return; }
  RUN[key](app);
}

function frame(app, key, { title, say = '', body = '', actions = '', progress = null, eye = '', counter = '', screen = '' }) {
  app.render(`<section class="card qcard p-test">
      ${progress === null ? '' : `<div class="qprog" aria-hidden="true"><i id="prog" style="width:${Math.round(progress * 100)}%"></i></div>`}
      <div class="row between p-testtop"><span class="tag">${esc(TESTS[key]?.name || 'Before you start')}${eye ? ` · ${esc(eyeName(eye))}` : ''}</span>
        <span class="row gap">${counter ? `<span class="muted small" id="counter">${esc(counter)}</span>` : ''}${V.supported ? `<button class="chip p-voice${V.isOn() ? ' on' : ''}" type="button" id="voiceBtn" aria-pressed="${V.isOn()}">${icon('mic', { size: 15 })} Voice ${V.isOn() ? 'on' : 'off'}</button>` : ''}</span></div>
      <h1 class="question" tabindex="-1">${esc(title)}</h1>
      ${say ? `<p class="say">${esc(say)}</p>` : ''}
      ${V.isOn() && V.canListen ? '<p class="small muted p-heard" id="heard" aria-live="polite">Listening: say your answer, or tap.</p>' : ''}
      ${body}
      ${actions ? `<div class="p-actions">${actions}</div>` : ''}
    </section>
    <a class="btn ghost p-quit" href="#check">${icon('left')} All checks</a>`, screen || `check-${key || 'setup'}`);
  const vb = $('#voiceBtn');
  if (vb) vb.onclick = () => { V.setOn(!V.isOn()); frame(app, key, { title, say, body, actions, progress, eye, counter, screen }); };
  V.say([title, say].filter(Boolean).join('. '));
  V.listen(document.querySelector('#main'), (t, miss) => { const h = $('#heard'); if (h) h.textContent = miss ? `Heard “${t}”. Say up, down, left, right, yes, no or not sure.` : `Heard “${t}”.`; });
}

// an instruction screen: one title, one sentence, one button
function step(app, key, { title, say, progress, eye = '', button = 'Next', then, art = '' }) {
  frame(app, key, { title, say, progress, eye, body: art, actions: `<button class="btn primary big" type="button" id="go">${esc(button)} ${icon('right')}</button>` });
  $('#go').onclick = then;
}

const setProgress = (v) => { const el = $('#prog'); if (el) el.style.width = `${Math.round(Math.min(1, v) * 100)}%`; };
const setCounter = (t) => { const el = $('#counter'); if (el) el.textContent = t; };
const coverArt = (eye) => `<div class="p-coverart" aria-hidden="true">${['R', 'L'].map((e) => `<span class="${e === eye ? 'open' : 'shut'}">${e === eye ? icon('eye', { size: 30 }) : ''}</span>`).join('')}</div>`;

function arrowsHtml(extra = '') {
  return `<div class="arrows" role="group" aria-label="Direction">
      <button class="btn" type="button" data-d="up" aria-label="Up">${icon('up', { size: 26 })}</button>
      <div class="row gap"><button class="btn" type="button" data-d="left" aria-label="Left">${icon('left', { size: 26 })}</button><button class="btn" type="button" data-d="right" aria-label="Right">${icon('right', { size: 26 })}</button></div>
      <button class="btn" type="button" data-d="down" aria-label="Down">${icon('down', { size: 26 })}</button>
    </div>${extra}`;
}
function wireArrows(app, stage, answer) {
  $$('[data-d]').forEach((b) => { b.onclick = () => answer(b.dataset.d); });
  let x0 = null; let y0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) answer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    x0 = null;
  });
  const key = (e) => { const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]; if (m) { e.preventDefault(); answer(m); } };
  document.addEventListener('keydown', key);
  app.setCleanup(() => document.removeEventListener('keydown', key));
}

// ---------------------------------------------------------------- age band (asked once)
function askAge(app, then) {
  frame(app, null, {
    title: 'How old are you?',
    say: 'Asked once. Each result is counted by age group only, never with your name.',
    body: `<div class="p-choices">${AGES.map(([v, l]) => `<button class="btn" type="button" data-age="${esc(v)}">${esc(l)}</button>`).join('')}</div>`,
  });
  $$('[data-age]').forEach((b) => { b.onclick = () => { S.setPrefs({ ageBand: b.dataset.age }); then(); }; });
}

// ---------------------------------------------------------------- screen calibration (once)
export function calibration(app, { then = null } = {}) {
  const p = S.prefs();
  const upright = window.innerWidth < 640; // a card is wider than a phone held upright
  const start = Math.round((p.pxPerMm || defaultPxPerMm(isPhone())) * ID_CARD_MM);
  frame(app, null, {
    screen: 'calibration',
    title: 'Match your screen to a card',
    say: upright ? 'Hold a bank card upright on the screen, over the outline. Slide until they are the same size.'
      : 'Hold a bank card flat on the screen, over the outline. Slide until they are the same size.',
    body: `<div class="p-slider">
        <button class="btn" type="button" id="calMinus" aria-label="Smaller">${icon('left', { size: 20 })}</button>
        <label class="sr" for="calRange">Outline size</label>
        <input type="range" id="calRange" min="180" max="${upright ? 760 : 900}" step="1" value="${start}">
        <button class="btn" type="button" id="calPlus" aria-label="Larger">${icon('right', { size: 20 })}</button>
      </div>
      <div class="p-cardstage"><div class="p-card${upright ? ' up' : ''}" id="calCard"><span>Bank card</span></div></div>
      <p class="muted small">Any card the size of a bank card works, such as a debit card or a PVC Aadhaar card. You do this once, so letters and grids show at their true size.</p>`,
    actions: `<button class="btn primary big" type="button" id="calSave">${icon('check')} Save screen size</button>
      <button class="btn ghost" type="button" id="calSkip">Skip and use a typical size</button>`,
  });
  const range = $('#calRange'); const card = $('#calCard');
  const draw = () => {
    const v = Number(range.value);
    const short = (v * CARD_SHORT_MM) / ID_CARD_MM;
    card.style.width = `${upright ? short : v}px`;
    card.style.height = `${upright ? v : short}px`;
    card.style.borderRadius = `${(3.18 * v) / ID_CARD_MM}px`;
  };
  range.oninput = draw;
  $('#calMinus').onclick = () => { range.value = Number(range.value) - 1; draw(); };
  $('#calPlus').onclick = () => { range.value = Number(range.value) + 1; draw(); };
  draw();
  const done = (msg) => { toast(msg); if (then) then(); else app.go('check'); };
  $('#calSave').onclick = () => { S.setPrefs({ pxPerMm: Number(range.value) / ID_CARD_MM, screenSet: 'card' }); done('Screen size saved'); };
  $('#calSkip').onclick = () => { S.setPrefs({ pxPerMm: defaultPxPerMm(isPhone()), screenSet: 'typical' }); done('Using a typical screen size'); };
}

// ---------------------------------------------------------------- results
const RESULT_HEADLINE = { amsler: { see_soon: 'See an optometrist soon, within a few days.' } };

function showResult(app, key, eyes, detail = {}) {
  const outcome = worstOf(eyes.map((e) => e.outcome));
  S.addEntry({ type: 'selfcheck', test: key, outcome, eyes, detail, date: S.today() });
  // de-identified count only: no name, no answers, no device id
  api('/selftests', { method: 'POST', body: { test: key, outcome, ageBand: S.prefs().ageBand || 'unknown' } }).catch(() => {});
  const headline = RESULT_HEADLINE[key]?.[outcome] || OUTCOMES[outcome].label;
  const next = ORDER[ORDER.indexOf(key) + 1];
  app.render(`<section class="card qcard p-test p-result">
      <div class="qprog" aria-hidden="true"><i style="width:100%"></i></div>
      <div class="row between p-testtop"><span class="tag">${esc(TESTS[key].name)}</span></div>
      <h1 class="question" tabindex="-1">Your result</h1>
      <div class="lane ${OUTCOMES[outcome].lane}" role="status">${esc(headline)}</div>
      <ul class="p-eyes">${eyes.map((e) => `<li><div class="p-eyehead"><b>${esc(eyeName(e.eye))}</b>${tierChip(e.outcome)}</div><p>${esc(e.why)}</p></li>`).join('')}</ul>
      ${key === 'amsler' && outcome === 'see_soon' ? '<p class="p-safetyline small">If the change came on suddenly, go to an eye hospital today.</p>' : ''}
      <p class="muted small">Saved in your eye record on this phone. This is a screening, not a diagnosis.</p>
      <div class="p-actions">
        ${outcome !== 'looks_good' ? `<a class="btn primary" href="#book">${icon('calendar')} Book an eye check</a>` : ''}
        ${detail.retry ? '<button class="btn" type="button" id="retry">Try again</button>' : ''}
        ${next ? `<a class="btn${outcome === 'looks_good' ? ' primary' : ''}" href="#check/${next}">Next: ${esc(TESTS[next].name)} ${icon('right')}</a>` : ''}
        <a class="btn ghost" href="#check">All checks</a>
      </div>
    </section>`, `check-${key}`);
  const retry = $('#retry');
  if (retry) retry.onclick = () => RUN[key](app);
}

// ---------------------------------------------------------------- 1. distance sharpness: tumbling E at 2 m
const ROT = { right: 0, down: 90, left: 180, up: 270 };
const eSvg = (dir, sizePx) => `<svg class="optotype" width="${sizePx}" height="${sizePx}" viewBox="0 0 5 5" style="transform:rotate(${ROT[dir]}deg)" role="img" aria-label="Letter E"><path d="M0 0H5V1H1V2H5V3H1V4H5V5H0Z" fill="currentColor"/></svg>`;
const ACUITY_MM = 2000;

function rateAcuity(lm) {
  if (lm === null || lm === undefined) return { outcome: 'see_soon', why: 'Even the largest letters were hard to see. An optometrist should check this eye.' };
  if (lm <= 0.2) return { outcome: 'looks_good', why: 'You saw small letters clearly with this eye.' };
  if (lm <= 0.4) return { outcome: 'follow_up', why: 'You needed letters a little larger than usual. New or updated glasses may help.' };
  return { outcome: 'see_soon', why: 'You needed large letters to see clearly. An optometrist should check this eye.' };
}

function acuity(app) {
  const res = {};
  const cover = (eye) => step(app, 'acuity', {
    title: coverTitle(eye), eye, progress: eye === 'R' ? 0.04 : 0.5, art: coverArt(eye),
    say: 'Use your palm, without pressing. Keep your distance glasses on, if you have them.', button: 'I am ready', then: () => trial(eye),
  });
  const trial = (eye) => {
    const st = A.createStaircase({ start: 0.6 });
    const base = eye === 'R' ? 0.06 : 0.54;
    frame(app, 'acuity', {
      title: 'Which way does the E point?', eye, progress: base, counter: 'Letter 1',
      say: 'Point the way its three arms point. Your helper taps the same way.',
      body: `<div class="estage" id="stage" aria-live="polite"></div>${arrowsHtml('<div class="p-unsure"><button class="btn ghost" type="button" id="unsure">Not sure</button></div>')}`,
    });
    let n = 0;
    const show = () => {
      const o = A.nextOptotype(st);
      n += 1;
      const px = Math.max(6, optotypeMm(o.level, ACUITY_MM) * pxPerMm());
      $('#stage').innerHTML = eSvg(o.dir, Math.round(px));
      setCounter(`Letter ${n}`);
      setProgress(base + Math.min(0.42, n * 0.045));
    };
    const answer = (d) => {
      if (st.done) return;
      A.respond(st, d);
      if (!st.done) { show(); return; }
      res[eye] = st.best;
      if (eye === 'R') cover('L'); else finish();
    };
    wireArrows(app, $('#stage'), answer);
    $('#unsure').onclick = () => answer('none');
    show();
  };
  const finish = () => {
    const eyes = ['R', 'L'].map((eye) => ({ eye, ...rateAcuity(res[eye]) }));
    // a clear difference between the two eyes is worth a check even when both are fine
    const [r, l] = [res.R ?? 1.1, res.L ?? 1.1];
    if (Math.abs(r - l) >= 0.2) {
      const worse = eyes[r > l ? 0 : 1];
      if (worse.outcome === 'looks_good') Object.assign(worse, { outcome: 'follow_up', why: 'This eye saw less sharply than your other eye. Worth checking why.' });
    }
    showResult(app, 'acuity', eyes, { logmar: res, distanceM: ACUITY_MM / 1000 });
  };
  step(app, 'acuity', {
    title: 'Ask someone to help', progress: 0, button: 'Next',
    say: 'They hold this phone 2 metres from you, at your eye level, and tap the way you point.',
    art: '<div class="p-distance" aria-hidden="true"><span>You</span><i></i><b>2 metres</b><i></i><span>Phone</span></div>',
    then: () => cover('R'),
  });
}

// ---------------------------------------------------------------- 2. reading up close (N sizes at 40 cm)
const NEAR_LINES = ['the bus', 'call me soon', 'take two tablets', 'thread the needle today', 'the shop opens at nine each day',
  'my son reads the paper every morning before work', 'the farmer sold his rice at the market for a good price',
  'please sign here and bring this card with you next time'];

function rateNear(n) {
  if (n && n <= 6) return { outcome: 'looks_good', why: 'You read small print comfortably.' };
  if (n && n <= 10) return { outcome: 'follow_up', why: 'Small print was hard to read. Reading glasses or an updated prescription may help.' };
  return { outcome: 'see_soon', why: 'Only large print was readable. An optometrist should check your near vision.' };
}

function near(app) {
  const chart = () => {
    const ppm = pxPerMm();
    frame(app, 'near', {
      title: 'Tap the smallest line you can read', eye: 'both', progress: 0.5,
      say: 'Read it at 40 cm, without bringing the phone closer.',
      body: `<ol class="nchart p-nchart">${N_SIZES.map((n, i) => `<li><button class="nline" type="button" data-n="${n}" style="font-size:${nSizePx(n, ppm).toFixed(1)}px">${esc(NEAR_LINES[i % NEAR_LINES.length])}</button></li>`).join('')}</ol>`,
      actions: '<button class="btn" type="button" id="cant">I cannot read any of them</button>',
    });
    const rec = (n) => showResult(app, 'near', [{ eye: 'both', ...rateNear(n) }], { N: n, distanceCm: 40 });
    $$('[data-n]').forEach((b) => { b.onclick = () => rec(Number(b.dataset.n)); });
    $('#cant').onclick = () => rec(null);
  };
  step(app, 'near', {
    title: 'Hold the phone 40 cm away', eye: 'both', progress: 0,
    say: 'About the distance from your elbow to your fingertips. Wear reading glasses if you use them.', then: chart,
  });
}

// ---------------------------------------------------------------- 3. Amsler grid, each eye at 30 cm
function amsler(app) {
  const res = {};
  const cover = (eye) => step(app, 'amsler', {
    title: coverTitle(eye), eye, progress: eye === 'R' ? 0.1 : 0.55, art: coverArt(eye), button: 'I am ready',
    say: 'Keep your reading glasses on. Then look only at the dot in the middle of the grid.', then: () => grid(eye),
  });
  const grid = (eye) => {
    frame(app, 'amsler', {
      title: 'Do any lines look wavy, broken or missing?', eye, progress: eye === 'R' ? 0.3 : 0.75,
      say: 'Keep looking at the dot in the middle.',
      body: '<div class="p-gridwrap" id="gridwrap"></div>',
      actions: '<button class="btn big" type="button" id="aNo">No, they look straight</button><button class="btn big" type="button" id="aYes">Yes, some do</button>',
    });
    const cell = 5 * pxPerMm(); // 5 mm squares, as on the printed chart
    const room = Math.max(200, $('#gridwrap').clientWidth - 4);
    const n = Math.max(8, Math.min(20, Math.floor(room / cell)));
    $('#gridwrap').innerHTML = `<div class="amsler" style="--cell:${cell.toFixed(2)}px;--n:${n}" role="img" aria-label="Amsler grid with a dot in the middle"><i></i></div>`;
    const rec = (wavy) => {
      res[eye] = wavy;
      if (eye === 'R') { cover('L'); return; }
      showResult(app, 'amsler', ['R', 'L'].map((e) => (res[e]
        ? { eye: e, outcome: 'see_soon', why: 'Wavy, broken or missing lines need a check of the back of the eye within a few days.' }
        : { eye: e, outcome: 'looks_good', why: 'The lines looked straight and complete.' })), { wavy: res });
    };
    $('#aNo').onclick = () => rec(false);
    $('#aYes').onclick = () => rec(true);
  };
  step(app, 'amsler', {
    title: 'Hold the phone 30 cm away', progress: 0,
    say: 'About the length of a school ruler. Wear reading glasses if you use them.', then: () => cover('R'),
  });
}

// ---------------------------------------------------------------- 4. contrast: fading Landolt C rings
function rateContrast(logCS) {
  if (logCS >= 1.5) return { outcome: 'looks_good', why: 'You saw faint rings well.' };
  if (logCS >= 1.2) return { outcome: 'follow_up', why: 'Faint rings were harder to see than expected. An eye check can find out why.' };
  return { outcome: 'see_soon', why: 'Only strong rings were visible. An optometrist should check this eye.' };
}

function contrast(app) {
  const res = {};
  const cover = (eye) => step(app, 'contrast', {
    title: coverTitle(eye), eye, progress: eye === 'R' ? 0.04 : 0.5, art: coverArt(eye), button: 'I am ready',
    say: 'Use your palm, without pressing. Keep the phone at arm\'s length.', then: () => rings(eye),
  });
  const rings = (eye) => {
    const st = createContrastTest();
    const base = eye === 'R' ? 0.06 : 0.54;
    frame(app, 'contrast', {
      title: 'Where is the gap in the ring?', eye, progress: base, counter: 'Ring 1',
      say: 'Tap the way the gap points. The rings get fainter.',
      body: `<div class="estage" id="stage"></div>${arrowsHtml('<div class="p-unsure"><button class="btn ghost" type="button" id="cant">I cannot see a ring</button></div>')}`,
    });
    const size = Math.round(Math.min(240, 25 * pxPerMm(), $('#stage').clientWidth - 40)); // about 25 mm
    const show = () => {
      const r = nextRing(st);
      $('#stage').innerHTML = landoltSvg(r.dir, size, r.grey);
      setCounter(`Ring ${st.trials.length + 1}`);
      setProgress(base + Math.min(0.42, st.trials.length * 0.035));
    };
    const answer = (d) => {
      if (st.done) return;
      respondRing(st, d);
      if (!st.done) { show(); return; }
      res[eye] = st.result.logCS;
      if (eye === 'R') cover('L'); else showResult(app, 'contrast', ['R', 'L'].map((e) => ({ eye: e, ...rateContrast(res[e]) })), { logCS: res });
    };
    wireArrows(app, $('#stage'), answer);
    $('#cant').onclick = () => answer('none');
    show();
  };
  step(app, 'contrast', {
    title: 'Hold the phone at arm\'s length', progress: 0,
    say: 'Turn the screen brightness up and wear your usual glasses.', then: () => cover('R'),
  });
}

// ---------------------------------------------------------------- 5. colour plates: type the number
function colour(app) {
  const answers = [];
  const plate = (i) => {
    const size = Math.round(Math.min(320, window.innerWidth - 96));
    frame(app, 'colour', {
      title: 'What number do you see?', eye: 'both', progress: i / SERIES.length, counter: `Plate ${i + 1} of ${SERIES.length}`,
      say: i === 0 ? 'Type it in. This first plate is for practice.' : 'Type it in. If there is no number, say so.',
      body: `<div class="pstage">${plateSvg(generatePlate(SERIES[i]), size)}</div>
        <form class="row gap numrow p-numrow" id="plateForm" novalidate>
          <label class="sr" for="plateIn">The number you see</label>
          <input id="plateIn" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" placeholder="--">
          <button class="btn primary" type="submit" id="plateNext" disabled>Next ${icon('right')}</button>
        </form>`,
      actions: '<button class="btn" type="button" id="noNum">I do not see a number</button>',
    });
    const input = $('#plateIn');
    input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 2); $('#plateNext').disabled = !input.value; };
    if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
    const go = (val) => {
      answers.push(val);
      if (i + 1 < SERIES.length) { plate(i + 1); return; }
      const s = scorePlates(answers);
      const r = s.result === 'normal' ? { outcome: 'looks_good', why: 'You read the numbers in the coloured dots.' }
        : s.result === 'possible_rg' ? { outcome: 'follow_up', why: 'Some numbers were hard to read. This can be a red-green colour difference, which an optometrist can confirm.' }
          : { outcome: 'follow_up', why: 'The practice plate was not read, so this check could not tell. Try again in good light.' };
      showResult(app, 'colour', [{ eye: 'both', ...r }], { result: s.result, correct: s.correct, plates: s.plates, retry: s.result === 'inconclusive' });
    };
    $('#plateForm').onsubmit = (e) => { e.preventDefault(); if (input.value) go(input.value); };
    $('#noNum').onclick = () => go('');
  };
  step(app, 'colour', {
    title: 'Find good light', eye: 'both', progress: 0,
    say: 'Daylight or a bright room works best. Keep both eyes open and wear your usual glasses.', then: () => plate(0),
  });
}

// ---------------------------------------------------------------- 6. astigmatism dial
function astigmatism(app) {
  const res = {};
  const cover = (eye) => step(app, 'astigmatism', {
    title: coverTitle(eye), eye, progress: eye === 'R' ? 0.1 : 0.55, art: coverArt(eye), button: 'I am ready',
    say: 'Use your palm, without pressing. Keep the phone at arm\'s length.', then: () => dial(eye),
  });
  const dial = (eye) => {
    const size = Math.round(Math.min(340, window.innerWidth - 96));
    frame(app, 'astigmatism', {
      title: 'Do some lines look darker?', eye, progress: eye === 'R' ? 0.3 : 0.75,
      say: 'Look at the dot in the middle. Notice if some lines look darker or sharper than others.',
      body: `<div class="pstage p-dial">${dialSvg(size)}</div>`,
      actions: '<button class="btn big" type="button" id="dSame">No, they all look the same</button><button class="btn big" type="button" id="dDark">Yes, some look darker</button>',
    });
    const rec = (darker) => {
      res[eye] = darker;
      if (eye === 'R') { cover('L'); return; }
      showResult(app, 'astigmatism', ['R', 'L'].map((e) => (res[e]
        ? { eye: e, outcome: 'follow_up', why: 'Some lines looked darker, so this eye may focus unevenly. Glasses can usually correct this.' }
        : { eye: e, outcome: 'looks_good', why: 'All the lines looked equally dark.' })), { darker: res });
    };
    $('#dSame').onclick = () => rec(false);
    $('#dDark').onclick = () => rec(true);
  };
  step(app, 'astigmatism', {
    title: 'Hold the phone at arm\'s length', progress: 0,
    say: 'Wear your usual glasses, if you have them.', then: () => cover('R'),
  });
}

const RUN = { acuity, near, amsler, contrast, colour, astigmatism };
