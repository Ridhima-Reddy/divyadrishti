// DivyaDrishti "My eyes": the patient-facing web app. Quick self-checks at
// home, a booking request to a nearby shop, and the patient's eye record, which
// fills itself from the shops and optometrists on the network. Patients sign in
// with their mobile number (or explore the demo patient). Hash routes keep the
// back button working.
import * as S from './patient/store.js';
import { $, $$, esc, icon, mark, asDate, fmtDate, toast } from './patient/ui.js';
import * as checks from './patient/checks.js';
import * as book from './patient/book.js';
import * as record from './patient/record.js';
import * as A from './patient/account.js';
import * as V from './patient/voice.js';
import * as P from './patient/plan.js';

const main = $('#main');
const bar = $('#tabbar');
let cleanup = null;
let firstRender = true;

const app = {
  render(html, screen) {
    if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
    main.innerHTML = html;
    main.dataset.screen = screen;
    if (!firstRender) {
      window.scrollTo(0, 0);
      main.querySelector('h1[tabindex="-1"], h2[tabindex="-1"]')?.focus({ preventScroll: true });
    }
    firstRender = false;
  },
  setCleanup(fn) { cleanup = fn; },
  go(hash) {
    if (location.hash === `#${hash}`) route();
    else location.hash = hash;
  },
};

// ---------------------------------------------------------------- navigation
const TABS = [['home', 'home', 'Home'], ['check', 'eye', 'Checkups'], ['book', 'calendar', 'Book'], ['record', 'record', 'Record']];
const TAB_OF = { home: 'home', plan: 'home', check: 'check', calibrate: 'check', book: 'book', requests: 'book', record: 'record' };

function setTabs(base, inTest) {
  const tab = TAB_OF[base] || 'home';
  bar.hidden = inTest; // a running check gets the whole screen
  document.body.classList.toggle('has-tabs', !inTest);
  bar.innerHTML = TABS.map(([k, ic, label]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-current="${k === tab ? 'page' : 'false'}">${icon(ic, { size: 20 })}<span>${label}</span></button>`).join('');
  $$('[data-tab]', bar).forEach((b) => { b.onclick = () => app.go(b.dataset.tab); });
}

function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [base = '', arg = ''] = h.split('/');
  if (!(base === 'check' && arg)) V.stop();
  acctChip();
  if (!A.signedIn()) { bar.hidden = true; document.body.classList.remove('has-tabs'); return gate(); }
  setTabs(base || 'home', base === 'check' && Boolean(arg));
  switch (base) {
    case 'check': return arg ? checks.runTest(app, arg) : checks.hub(app);
    case 'calibrate': return checks.calibration(app);
    case 'book': return arg ? book.form(app, arg) : book.find(app);
    case 'requests': return book.list(app);
    case 'record': return record.view(app);
    case 'plan': return planForm();
    default: return home();
  }
}

// ---------------------------------------------------------------- sign in
function acctChip() {
  const el = $('#acctBtn');
  if (!el) return;
  const s = A.session();
  el.hidden = !s;
  if (!s) return;
  el.innerHTML = `${icon('user', { size: 16 })}<span>${s.demo ? 'Demo patient' : esc(s.phone)}</span>`;
  el.onclick = async () => {
    if (!confirm(`Signed in as ${s.demo ? `the demo patient (${s.name})` : s.phone}. Sign out?`)) return;
    await A.logout();
    location.hash = 'signin'; route();
  };
}

function gate() {
  app.render(`
    <section class="band p-hero p-gate">
      <div class="p-herocopy">
        ${mark(44, 'mark p-heromark')}
        <h1 tabindex="-1">My eyes</h1>
        <p class="lede">Quick eye checkups at home, a booking with an optical store near you, and every visit, prescription and glasses order from stores on the DivyaDrishti network, in one place.</p>
      </div>
      <div class="card p-gatecard">
        <button class="btn primary big" type="button" id="demoGo">${icon('play')} Explore the demo (no sign-in)</button>
        <p class="muted small">Opens as a demo patient with a year of visits, a prescription and a glasses order.</p>
        <div class="gatesep"><span>or sign in with your mobile number</span></div>
        <form id="phoneForm" novalidate>
          <label>Mobile number<input id="phoneIn" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="10-digit mobile number"></label>
          <button class="btn big" type="submit" id="codeGo">${icon('send')} Send me a code</button>
        </form>
        <form id="codeForm" novalidate hidden>
          <label>The 6-digit code<input id="codeIn" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
          <p class="note small" id="demoCode"></p>
          <button class="btn primary big" type="submit" id="loginGo">${icon('check')} Sign in</button>
          <button class="btn ghost small" type="button" id="backPhone">Use another number</button>
        </form>
        <p class="err" id="gateErr" role="alert"></p>
        <p class="muted small">Use the number you give at the optical store: your visits there appear here by themselves.</p>
      </div>
    </section>`, 'signin');
  const err = $('#gateErr');
  let phone = '';
  $('#demoGo').onclick = async () => {
    $('#demoGo').disabled = true;
    try { await A.demo(); location.hash = 'home'; route(); } catch (e) { err.textContent = e.message; $('#demoGo').disabled = false; }
  };
  $('#phoneForm').onsubmit = async (e) => {
    e.preventDefault();
    phone = $('#phoneIn').value.trim();
    if (phone.replace(/\D/g, '').length < 10) { err.textContent = 'Enter your 10-digit mobile number.'; return; }
    err.textContent = '';
    try {
      const r = await A.sendCode(phone);
      $('#phoneForm').hidden = true; $('#codeForm').hidden = false;
      $('#demoCode').textContent = r.demoCode ? `This demo has no SMS service, so here is your code: ${r.demoCode}. It works for ${r.expiresInMinutes} minutes.` : 'We sent a code by SMS.';
      $('#codeIn').focus();
    } catch (x) { err.textContent = x.message; }
  };
  $('#codeForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await A.login(phone, $('#codeIn').value.trim()); location.hash = 'home'; route(); } catch (x) { err.textContent = x.message; }
  };
  $('#backPhone').onclick = () => { $('#codeForm').hidden = true; $('#phoneForm').hidden = false; err.textContent = ''; };
}

// ---------------------------------------------------------------- reminder: next eye check
// How often comes from a few questions (patient/plan.js); when, from the last
// visit on the network record.
function addMonths(d, n) {
  const out = new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), 12);
  if (out.getDate() !== d.getDate()) out.setDate(0); // 31 Jan + 1 month -> 28/29 Feb
  return out;
}
const monthsUntil = (due) => Math.ceil((due.getTime() - Date.now()) / (30.44 * 864e5));
const every = (m) => (m % 12 === 0 ? (m === 12 ? 'every year' : `every ${m / 12} years`) : `every ${m} months`);

function reminder() {
  const answers = S.prefs().plan;
  const last = A.cached().find((r) => r.kind === 'visit') || S.lastVisit();
  if (!P.complete(answers)) return { due: null, html: `
    <h2>${icon('calendar')} When is your next routine checkup due?</h2>
    <p class="muted">Answer ${P.QUESTIONS.length} quick questions about age, eye history, health and daily life. The app works out how often you need a check, and why.</p>
    ${last ? `<p class="meta">Last visit ${esc(fmtDate(last.date))}${last.place ? ` · ${esc(last.place)}` : ''}</p>` : ''}
    <div class="p-actions"><a class="btn primary" href="#plan">${icon('right')} Answer the questions</a></div>` };
  const r = P.plan(answers);
  const due = last ? addMonths(asDate(last.date), r.months) : null;
  const n = due ? monthsUntil(due) : 0;
  const now = r.dueNow || !due || n <= 0;
  const title = r.urgent ? 'Sudden change in sight: get checked today'
    : now ? 'Your next routine checkup is due now' : `Next routine checkup due in ${n} month${n === 1 ? '' : 's'}`;
  const meta = last ? `Last visit ${esc(fmtDate(last.date))}${last.place ? ` · ${esc(last.place)}` : ''}${!now ? ` · due ${esc(fmtDate(S.isoDate(due), { month: 'long', year: 'numeric' }))}` : ''}`
    : 'No routine checkup on record yet.';
  return {
    due: now ? null : due,
    html: `
    <h2>${icon('calendar')} ${title}</h2>
    <p class="meta">${meta}</p>
    ${r.urgent ? '<p class="p-urgent"><span class="tier emergency">Emergency</span> Sudden loss or change of sight needs an eye hospital today. Do not wait for an appointment.</p>' : ''}
    <div class="p-plan">
      <p><b>A routine checkup ${every(r.months)}</b>, because:</p>
      <ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${r.dueNow && !r.urgent ? '<p class="small">Your sight has changed, so book a check now rather than waiting.</p>' : ''}
      ${r.advice.length ? `<details class="small"><summary>Tips for daily life (${r.advice.length})</summary><ul>${r.advice.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    </div>
    <div class="p-actions">
      ${now ? `<a class="btn primary" href="#book">${icon('pin')} Book an appointment</a>` : `<button class="btn primary" type="button" id="icsBtn">${icon('download')} Add to calendar</button>`}
      <a class="btn ghost" href="#plan">Change my answers</a>
    </div>
    <p class="muted small">A guide from common eye-care advice, not a diagnosis. Your optometrist may suggest a different interval.</p>`,
  };
}

function planForm() {
  const a = { ...(S.prefs().plan || {}) };
  app.render(`
    <header class="p-head">
      <h1 tabindex="-1">How often do you need a routine checkup?</h1>
      <p class="lede">${P.QUESTIONS.length} quick questions. Your answers stay on this phone.</p>
    </header>
    <form class="card p-planform" id="planForm" novalidate>
      ${P.QUESTIONS.map((q, i) => `<fieldset class="p-fs" data-q="${q.id}">
        <legend><span class="mono p-qn">${i + 1}</span> ${esc(q.q)}${q.type === 'many' ? ' <span class="muted small">Choose all that apply.</span>' : ''}</legend>
        <div class="p-choicechips">${q.opts.map(([v, l]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="false">${esc(l)}</button>`).join('')}</div>
      </fieldset>`).join('')}
      <p class="err" id="planErr" role="alert"></p>
      <div class="p-actions"><button class="btn primary big" type="submit">${icon('check')} See my plan</button><a class="btn ghost" href="#home">Cancel</a></div>
    </form>`, 'plan');
  const paint = () => P.QUESTIONS.forEach((q) => {
    $$(`[data-q="${q.id}"] [data-v]`).forEach((b) => {
      const on = q.type === 'many' ? (a[q.id] || []).includes(b.dataset.v) : a[q.id] === b.dataset.v;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  });
  P.QUESTIONS.forEach((q) => {
    $$(`[data-q="${q.id}"] [data-v]`).forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.v;
        if (q.type === 'one') a[q.id] = v;
        else {
          let cur = (a[q.id] || []).filter((x) => x !== 'none');
          if (v === 'none') cur = ['none'];
          else cur = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
          a[q.id] = cur;
        }
        paint();
        $('#planErr').textContent = '';
      };
    });
  });
  paint();
  $('#planForm').onsubmit = (e) => {
    e.preventDefault();
    const missing = P.QUESTIONS.findIndex((q) => (q.type === 'many' ? !(a[q.id] || []).length : !a[q.id]));
    if (missing >= 0) {
      $('#planErr').textContent = `Answer question ${missing + 1} too.`;
      $(`[data-q="${P.QUESTIONS[missing].id}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    S.setPrefs({ plan: a });
    toast('Your checkup plan is ready.');
    app.go('home');
  };
}

const icsDate = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const icsEscape = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

function downloadIcs(due) {
  const day = due || new Date(Date.now() + 7 * 864e5); // due now: put it a week ahead
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const url = new URL('patient.html#book', location.href).href;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DivyaDrishti//My eyes//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${S.uid()}@divyadrishti`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(day)}`, `DTEND;VALUE=DATE:${icsDate(next)}`,
    'SUMMARY:Routine checkup due', `DESCRIPTION:${icsEscape(`Time for your routine checkup. Book one near you: ${url}`)}`, 'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', 'DESCRIPTION:Routine checkup due in a week', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  const href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = href; a.download = 'eye-check-reminder.ics';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
  toast('Reminder downloaded. Open it to add it to your calendar.');
}

function wireReminder() {
  const box = $('#remind');
  const r = reminder();
  box.innerHTML = r.html;
  const ics = $('#icsBtn', box);
  if (ics) ics.onclick = () => downloadIcs(r.due);
}

// ---------------------------------------------------------------- home
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function home() {
  const reqs = S.requests();
  app.render(`
    <section class="band p-hero">
      <div class="p-herocopy">
        ${mark(44, 'mark p-heromark')}
        <h1 tabindex="-1">${greeting()}</h1>
        <p class="lede">Quick eye checkups at home, a few minutes each. They are a screening, not a diagnosis: they tell you when it is time to see an optometrist.</p>
        <div class="p-actions"><a class="btn primary" href="#check">${icon('eye')} Start a quick checkup</a></div>
      </div>
      <aside class="card p-safety" aria-labelledby="safetyH">
        <span class="tier emergency">Emergency</span>
        <h2 id="safetyH">When not to use these checks</h2>
        <p>Sudden loss of sight, a dark curtain, new flashes or floaters, a painful red eye, or an injury: <b>go to an eye hospital today.</b> Do not use these checks.</p>
      </aside>
    </section>
    <nav class="p-start" aria-label="Start">
      <a href="#check"><span class="p-sicon t1">${icon('eye', { size: 22 })}</span><span class="p-stext"><b>Quick checkups</b><small>Six short checkups: sharpness, eye health, colour and comfort.</small></span>${icon('right', { cls: 'p-chev' })}</a>
      <a href="#book"><span class="p-sicon t4">${icon('calendar', { size: 22 })}</span><span class="p-stext"><b>Book an appointment</b><small>Find the nearest optical store or eye camp by PIN code.</small></span>${icon('right', { cls: 'p-chev' })}</a>
      <a href="#record"><span class="p-sicon t5">${icon('record', { size: 22 })}</span><span class="p-stext"><b>My eye record</b><small>Visits, prescriptions and glasses orders from network shops.</small></span>${icon('right', { cls: 'p-chev' })}</a>
    </nav>
    <div class="p-homegrid">
      <section class="card p-remind" id="remind" aria-live="polite"></section>
      <div class="p-homeside">
        ${reqs.length ? `<section class="card p-myreqs">
          <h2>${icon('clock')} My requests</h2>
          <ul class="p-reqmini">${reqs.slice(0, 3).map((r) => `<li><a href="#requests"><span><b>${esc(r.shopName)}</b><small>Sent ${esc(fmtDate(r.createdAt))}</small></span><span class="status open" data-req="${esc(r.id)}">Checking…</span></a></li>`).join('')}</ul>
        </section>` : ''}
      </div>
    </div>`, 'home');
  wireReminder();
  A.records().then(() => { if ($('#remind')) wireReminder(); }).catch(() => {});
  for (const r of reqs.slice(0, 3)) {
    book.fetchStatus(r).then((s) => {
      const el = main.querySelector(`[data-req="${CSS.escape(r.id)}"]`);
      if (!el) return;
      el.textContent = book.statusLabel(s);
      el.className = `status ${s.status === 'booked' || s.status === 'done' ? 'reviewed' : s.status === 'accepted' ? 'sent' : 'open'}`;
    }).catch(() => {
      const el = main.querySelector(`[data-req="${CSS.escape(r.id)}"]`);
      if (el) el.textContent = 'See updates';
    });
  }
}

window.addEventListener('hashchange', route);
route();
