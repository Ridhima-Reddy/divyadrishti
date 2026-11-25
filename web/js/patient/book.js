// Book an eye check near me: PIN code -> nearby shops -> request form ->
// "My requests" with the shop's progress. The request id and its secret stay
// on this phone; the server deletes the name and phone after 30 days.
import * as S from './store.js';
import { $, $$, esc, icon, api, toast, fmtDate, fmtWhen, fmtTime } from './ui.js';
import { selfTestSummary } from './checks.js';

const KIND = { routine: 'Routine checkup', with_optometrist: 'With an optometrist present' };
const KIND_HELP = {
  routine: 'A regular checkup at the store: your sight, your glasses and the health of your eyes.',
  with_optometrist: 'The store arranges an optometrist for you, at the store or by video, and confirms the time.',
};
const SHOP_KIND = { store: 'Optical store', camp: 'Eye camp', vision_centre: 'Vision centre' };
const TIMES = ['This week, mornings', 'This week, evenings', 'This weekend', 'Any time'];

let shopCache = (() => { try { return JSON.parse(sessionStorage.getItem('dd.patient.shops') || '[]'); } catch { return []; } })();
const remember = (list) => { shopCache = list; try { sessionStorage.setItem('dd.patient.shops', JSON.stringify(list)); } catch { /* private mode */ } };

const subnav = (on, n) => `<nav class="seg p-subnav" aria-label="Booking">
    <a class="chip${on === 'find' ? ' on' : ''}" href="#book"${on === 'find' ? ' aria-current="page"' : ''}>${icon('pin', { size: 16 })} Find a store</a>
    <a class="chip${on === 'requests' ? ' on' : ''}" href="#requests"${on === 'requests' ? ' aria-current="page"' : ''}>${icon('clock', { size: 16 })} My requests${n ? ` <span class="p-count">${n}</span>` : ''}</a>
  </nav>`;

const placeLine = (s) => `${esc([s.area, s.city].filter(Boolean).join(', '))}${s.pin ? ` ${esc(s.pin)}` : ''} · ${esc(SHOP_KIND[s.kind] || 'Optical store')}`;
const badges = (s) => {
  const b = [s.optometrist ? '<span class="badge rec">Optometrist</span>' : '', s.ophthalmologist ? '<span class="badge rec">Ophthalmologist</span>' : ''].join('');
  return b ? `<span class="p-badges">${b}</span>` : '';
};

// ====================================================================== find a shop
export function find(app) {
  const p = S.prefs();
  app.render(`
    <header class="p-head">
      <h1 tabindex="-1">Book an appointment</h1>
      <p class="lede">Find the nearest optical store or eye camp. The store confirms the booking.</p>
    </header>
    ${subnav('find', S.requests().length)}
    <form class="card p-pinform" id="pinForm" novalidate>
      <label for="pinIn">Your PIN code</label>
      <div class="p-pinrow">
        <input id="pinIn" name="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="postal-code" placeholder="6 digits, like 600040" value="${esc(p.pin)}">
        <button class="btn primary" type="submit" id="pinGo">${icon('pin')} Find stores</button>
      </div>
      <p class="err" id="pinErr" role="alert"></p>
    </form>
    <div id="shopOut" aria-live="polite"></div>`, 'book');
  const input = $('#pinIn');
  input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); };
  $('#pinForm').onsubmit = (e) => { e.preventDefault(); search(input.value); };
  if (/^\d{6}$/.test(p.pin)) search(p.pin, { quiet: true });
}

async function search(pin, { quiet = false } = {}) {
  const err = $('#pinErr'); const out = $('#shopOut');
  if (!/^\d{6}$/.test(pin)) { err.textContent = 'Enter the 6-digit PIN code of your area.'; $('#pinIn').focus(); return; }
  err.textContent = '';
  S.setPrefs({ pin });
  out.innerHTML = '<p class="muted p-loading">Looking for stores near you…</p>';
  try {
    const list = await api(`/shops?pin=${pin}`);
    if (!out.isConnected) return;
    remember(list);
    out.innerHTML = shopsHtml(list);
    if (!quiet) out.querySelector('h2')?.focus({ preventScroll: true });
  } catch (e) {
    if (out.isConnected) out.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function shopsHtml(list) {
  if (!list.length) return '<section class="card"><h2>No linked stores in this area yet</h2><p class="muted">No optical store in this postal district is on the DivyaDrishti network yet. Any optical store or eye hospital can do your checkup. In the demo, try a Chennai PIN code such as 600036.</p></section>';
  return `<div class="p-listhead"><h2 tabindex="-1">Optical stores near you, nearest first</h2><p class="meta">Only stores in your postal district that are linked to the network are shown (demo stores in Chennai). The badges show the eye-care professionals who work with each store.</p></div>
    <ul class="p-shops">${list.map((s) => `
      <li class="card p-shop">
        <div class="p-shopmain">
          <b>${esc(s.name)}</b>
          <span class="meta">${placeLine(s)}</span>
          ${badges(s)}
        </div>
        <a class="btn" href="#book/${encodeURIComponent(s.code)}" aria-label="Choose ${esc(s.name)}">Choose ${icon('right')}</a>
      </li>`).join('')}</ul>`;
}

// ====================================================================== the request form
export async function form(app, code) {
  let shop = shopCache.find((s) => s.code === code);
  if (!shop) {
    app.render('<p class="muted p-loading">Opening the store…</p>', 'book');
    try {
      const pin = S.prefs().pin;
      const list = await api(`/shops?limit=100${/^\d{6}$/.test(pin) ? `&pin=${pin}` : ''}`);
      remember(list);
      shop = list.find((s) => s.code === code);
    } catch { /* fall through */ }
  }
  if (!shop) { toast('That store could not be found. Choose one from the list.'); app.go('book'); return; }
  const summary = selfTestSummary();
  let kind = 'routine';
  app.render(`
    <header class="p-head">
      <h1 tabindex="-1">Request an appointment</h1>
      <p class="lede">The store confirms the booking. Nothing is booked until they confirm.</p>
    </header>
    <div class="p-bookgrid">
      <section class="card p-shopcard">
        <span class="p-gicon">${icon('glasses', { size: 20 })}</span>
        <h2>${esc(shop.name)}</h2>
        <p class="meta">${placeLine(shop)}</p>
        ${badges(shop)}
        <a class="btn ghost small p-change" href="#book">${icon('left', { size: 16 })} Choose another store</a>
      </section>
      <form class="card p-reqform" id="reqForm" novalidate>
        <fieldset class="p-fs">
          <legend>What kind of check?</legend>
          <div class="seg p-kind" role="radiogroup" aria-label="What kind of check?">
            ${Object.entries(KIND).map(([k, l]) => `<button type="button" class="chip${k === kind ? ' on' : ''}" role="radio" aria-checked="${k === kind}" data-kind="${k}">${esc(l)}</button>`).join('')}
          </div>
          <p class="muted small p-help" id="kindHelp">${esc(KIND_HELP[kind])}</p>
        </fieldset>
        <fieldset class="p-fs">
          <legend>When suits you?</legend>
          <div class="p-timechips">${TIMES.map((t) => `<button type="button" class="chip" data-time="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>
          <label class="sr" for="prefIn">Preferred time</label>
          <input id="prefIn" maxlength="60" placeholder="Or type a time, like Saturday after 4 pm">
        </fieldset>
        <label>Note for the store <span class="muted">(optional)</span>
          <textarea id="noteIn" maxlength="300" rows="3" placeholder="For example: my glasses broke, or reading tires my eyes"></textarea></label>
        <div class="p-two">
          <label>Your name<input id="nameIn" autocomplete="name" maxlength="60" required></label>
          <label>Mobile number<input id="phoneIn" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="10-digit mobile number" required></label>
        </div>
        ${summary ? `<div class="p-attach">
          <label class="check"><input type="checkbox" id="attachIn"> <span>Attach my latest self-checkup results</span></label>
          <p class="note small" id="summaryText">${esc(summary)}</p>
        </div>` : ''}
        <label class="check p-consent"><input type="checkbox" id="consentIn"> <span>Share my name and phone with this store so they can reach me to confirm; deleted after 30 days</span></label>
        <p class="err" id="reqErr" role="alert"></p>
        <button class="btn primary big" type="submit" id="reqSend">${icon('send')} Send request</button>
        <p class="muted small p-after">The store sees your request with your name and phone. You can follow it under My requests.</p>
      </form>
    </div>`, 'book-form');

  $$('[data-kind]').forEach((b) => {
    b.onclick = () => {
      kind = b.dataset.kind;
      $$('[data-kind]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      $('#kindHelp').textContent = KIND_HELP[kind];
    };
  });
  const pref = $('#prefIn');
  $$('[data-time]').forEach((b) => {
    b.onclick = () => {
      const on = !b.classList.contains('on');
      $$('[data-time]').forEach((x) => { x.classList.toggle('on', on && x === b); x.setAttribute('aria-pressed', String(on && x === b)); });
      pref.value = on ? b.dataset.time : '';
    };
  });
  pref.oninput = () => $$('[data-time]').forEach((x) => { const on = x.dataset.time === pref.value; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });

  $('#reqForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#reqErr');
    const name = $('#nameIn').value.trim();
    const phone = $('#phoneIn').value.replace(/[^\d+ ]/g, '').replace(/\s+/g, ' ').trim();
    const digits = phone.replace(/\D/g, '');
    if (!name) { err.textContent = 'Enter your name so the store knows who to ask for.'; $('#nameIn').focus(); return; }
    if (digits.length < 10 || phone.length > 16) { err.textContent = 'Enter your 10-digit mobile number.'; $('#phoneIn').focus(); return; }
    if (!$('#consentIn').checked) { err.textContent = 'Tick the box to let the store contact you. Without it the request cannot be sent.'; $('#consentIn').focus(); return; }
    err.textContent = '';
    const btn = $('#reqSend');
    btn.disabled = true;
    try {
      const attach = $('#attachIn')?.checked;
      const body = { shopCode: shop.code, kind, preferred: pref.value.trim().slice(0, 60), note: $('#noteIn').value.trim().slice(0, 300), name, phone, consent: true, ...(attach && summary ? { selftest: summary } : {}) };
      const r = await api('/requests', { method: 'POST', body });
      S.addRequest({ id: r.id, secret: r.secret, shopName: shop.name, kind, createdAt: new Date().toISOString() });
      toast(`Request sent to ${shop.name}`);
      app.go('requests');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  };
}

// ====================================================================== my requests
export const fetchStatus = (r) => api(`/requests/${encodeURIComponent(r.id)}?s=${encodeURIComponent(r.secret)}`);

const STATUS = {
  new: ['open', 'Waiting for the store'], accepted: ['sent', 'Accepted'], booked: ['reviewed', 'Booked'],
  done: ['reviewed', 'Done'], declined: ['open', 'Not taken'],
};
export const statusLabel = (s) => (STATUS[s?.status] || STATUS.new)[1];

function reqBody(r, s, gone) {
  const st = s?.status || 'new';
  const accepted = ['accepted', 'booked', 'done'].includes(st);
  const declined = st === 'declined';
  const appt = s?.appointment;
  const booked = Boolean(appt) || st === 'booked' || st === 'done';
  const [cls, label] = gone ? ['open', 'Removed'] : (STATUS[st] || STATUS.new);
  const video = appt && (appt.mode === 'video' || /video/i.test(appt.placeName || ''));
  const role = (x) => (x === 'ophthalmologist' ? 'ophthalmologist (eye doctor)' : x === 'optometrist' ? 'optometrist' : '');
  return `
    <div class="p-reqhead">
      <div><h2>${esc(r.shopName || s?.shopName || 'Store')}</h2><p class="meta">${esc(KIND[r.kind] || '')} · sent ${esc(fmtDate(r.createdAt))}</p></div>
      ${s || gone ? `<span class="status ${cls}">${esc(label)}</span>` : ''}
    </div>
    ${gone ? '<p class="muted">This request is no longer on the server. Requests are deleted after 30 days.</p>' : `
    <ol class="p-steps">
      <li class="done"><b>Sent</b><small>${esc(fmtWhen(r.createdAt))}</small></li>
      <li class="${declined ? 'no' : accepted ? 'done' : 'now'}"><b>${declined ? 'The store could not take this request' : 'Accepted by the store'}</b>
        <small>${declined ? 'See their message below, or choose another store.' : accepted ? 'The store will confirm the booking.' : 'The store usually confirms during opening hours.'}</small></li>
      ${declined ? '' : `<li class="${booked ? 'done' : accepted ? 'now' : ''}"><b>Appointment booked</b>
        ${appt ? `<div class="p-appt">
            <div class="kv"><span>When</span><b>${esc(fmtWhen(appt.start))}${appt.end ? `–${esc(fmtTime(appt.end))}` : ''}</b></div>
            ${appt.clinicianName ? `<div class="kv"><span>With</span><b>${esc(appt.clinicianName)}${role(appt.clinicianRole) ? `, ${esc(role(appt.clinicianRole))}` : ''}</b></div>` : ''}
            <div class="kv"><span>Where</span><b>${video ? 'Video call: the store sends you the link' : esc(appt.placeName || r.shopName || '')}</b></div>
          </div>` : `<small>${booked ? 'The store has booked a time. They will tell you the details.' : 'The date, time and who you will see show here.'}</small>`}</li>`}
    </ol>
    ${s?.reply ? `<div class="comment"><b>Message from the store</b>\n${esc(s.reply)}</div>` : ''}`}
    <div class="p-reqfoot"><button class="btn ghost small" type="button" data-forget="${esc(r.id)}">${icon('trash', { size: 16 })} Remove from this phone</button></div>`;
}

export function list(app) {
  const reqs = S.requests();
  app.render(`
    <header class="p-head">
      <h1 tabindex="-1">My requests</h1>
      <p class="lede">The store confirms the booking. Its replies show here.</p>
    </header>
    ${subnav('requests', reqs.length)}
    ${reqs.length ? `<div class="p-reqs">${reqs.map((r) => `<section class="card p-req" id="req-${esc(r.id)}">${reqBody(r, null, false)}</section>`).join('')}</div>
      <p class="muted small p-checked"><span id="checked">Checking for updates…</span> <button class="btn ghost small" type="button" id="refresh">${icon('refresh', { size: 16 })} Check now</button></p>`
    : `<section class="card p-empty"><h2>No requests yet</h2><p class="muted">Find a store near you and ask for an appointment. The request and its updates stay on this phone.</p><a class="btn primary" href="#book">${icon('pin')} Find a store</a></section>`}`, 'requests');

  const wire = (root) => $$('[data-forget]', root).forEach((b) => {
    b.onclick = () => {
      S.removeRequest(b.dataset.forget);
      toast('Removed from this phone');
      list(app);
    };
  });
  wire(document);
  if (!reqs.length) return;
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    let offline = false;
    await Promise.all(reqs.map(async (r) => {
      const card = document.getElementById(`req-${r.id}`);
      try {
        const s = await fetchStatus(r);
        if (card?.isConnected) { card.innerHTML = reqBody(r, s, false); wire(card); }
      } catch (e) {
        if (e.status === 404 && card?.isConnected) { card.innerHTML = reqBody(r, null, true); wire(card); } else offline = true;
      }
    }));
    busy = false;
    const el = $('#checked');
    if (el) el.textContent = offline ? 'Could not reach the server. Showing what was last known.' : `Checked at ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Updates every 20 seconds.`;
  };
  $('#refresh').onclick = poll;
  poll();
  const timer = setInterval(() => { if (!document.hidden) poll(); }, 20000);
  app.setCleanup(() => clearInterval(timer));
}
