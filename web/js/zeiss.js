// DivyaDrishti Network: the ZEISS partner view of how the whole network
// performs. Everything here comes from de-identified aggregates
// (GET /api/zeiss/overview) plus the clinician register for verification
// (GET /api/zeiss/clinicians). No patient names, phone numbers or case
// details reach this page. Numbers are shown exactly as the API returns them;
// the few derived figures (shares, "above network") are computed from them.
import { barChart, donut, hbars, indiaMap, pinToState } from './charts_ui.js';
import { ic } from './icons.js';
import { RULE_BY_CODE, TIERS } from './engine/redflags.js';

const API = '/api';
const TOKEN = 'dd.zeiss.token';
const MODE = 'dd.zeiss.mode';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// sessionStorage can throw (private windows, blocked storage): keep a memory copy
const mem = new Map();
const store = {
  get: (k) => { try { return sessionStorage.getItem(k) ?? mem.get(k) ?? null; } catch { return mem.get(k) ?? null; } },
  set: (k, v) => { mem.set(k, v); try { sessionStorage.setItem(k, v); } catch { /* memory only */ } },
  del: (k) => { mem.delete(k); try { sessionStorage.removeItem(k); } catch { /* memory only */ } },
};

// ---------------------------------------------------------------- formatting
const NUM = new Intl.NumberFormat('en-IN');
const num = (v) => (v == null ? '–' : NUM.format(v));
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const pctVal = (r) => (r == null ? null : r > 0 && r < 0.1 ? (r * 100).toFixed(1) : String(Math.round(r * 100)));
const pct = (r) => (r == null ? '–' : `${pctVal(r)}%`);
const share = (n, total) => (total ? n / total : null);
const round1 = (v) => Math.round(v * 10) / 10;
// minutes as [value, unit]: minutes under 90, hours under two days, then days
const dur = (m) => (m == null ? null : m < 90 ? [String(Math.round(m)), 'min'] : m < 2880 ? [String(round1(m / 60)), 'h'] : [String(round1(m / 1440)), 'days']);
const durText = (m) => { const d = dur(m); return d ? `${d[0]} ${d[1]}` : '–'; };
const days = (v) => (v == null ? '–' : `${Number(v).toFixed(1)} days`);
const dayLabel = (d, o = { day: 'numeric', month: 'short' }) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', o);
const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const initials = (n) => String(n || '').replace(/^(Dr|Optom)\.?\s+/i, '').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase() || '#';
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (b || 0), 0);

// ---------------------------------------------------------------- reference labels
const TABS = {
  overview: 'Overview', field: 'Store network', clinical: 'Clinical quality', lenses: 'Lenses and orders',
  patients: 'Patient app', calendar: 'Calendar', verify: 'Verification', versions: 'Versions',
};
// review targets per lane: SLA_HOURS in server/app.py
const LANES = [
  { k: 'red', tier: 'emergency', name: 'Red lane', sub: 'emergency', target: 120, tgt: '2 h' },
  { k: 'amber', tier: 'soon', name: 'Amber lane', sub: 'urgent or soon', target: 1440, tgt: '24 h' },
  { k: 'green', tier: 'routine', name: 'Green lane', sub: 'routine', target: 4320, tgt: '72 h' },
];
const DECISIONS = { approve: 'Approved', modify: 'Approved with changes', in_person: 'In-person examination', urgent: 'Urgent referral', other: 'Other (see comments)' };
const TESTS = {
  acuity: 'Distance acuity', nearAcuity: 'Near acuity', readingDistanceCm: 'Reading distance', nearPointCm: 'Near point',
  npc: 'Near point of convergence', pd: 'Pupillary distance', amsler: 'Amsler grid', duochrome: 'Duochrome',
  contrast: 'Contrast sensitivity', colour: 'Colour vision', astigmatism: 'Astigmatism dial', lensometry: 'Lensometry (old glasses)',
};
const LANGS = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', kn: 'Kannada', bn: 'Bengali', ml: 'Malayalam', gu: 'Gujarati', '?': 'Not recorded' };
const SELF = { acuity: 'Distance', near: 'Near', amsler: 'Amsler', colour: 'Colour', contrast: 'Contrast', astigmatism: 'Astigmatism' };
const AGES = [['<18', 'Under 18'], ['18-39', '18–39'], ['40-59', '40–59'], ['60+', '60 and over'], ['unknown', 'Not given']];
const REQ_STATUS = [['new', 'New, not yet answered'], ['accepted', 'Accepted'], ['booked', 'Booked'], ['done', 'Done'], ['declined', 'Declined']];
const REQ_KIND = { routine: 'Routine eye check', with_optometrist: 'With an optometrist' };
const MODES = [['video', 'Video'], ['in_person', 'In person'], ['camp', 'Camp']];
const QUALITY = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const ROLE = { optometrist: 'Optometrist', ophthalmologist: 'Ophthalmologist' };
const STATE_CODE = {
  'jammu and kashmir': 'JK', ladakh: 'JK', punjab: 'PB', chandigarh: 'PB', 'himachal pradesh': 'HP', uttarakhand: 'UK', rajasthan: 'RJ',
  haryana: 'HR', delhi: 'DL', 'uttar pradesh': 'UP', bihar: 'BR', sikkim: 'SK', 'arunachal pradesh': 'AR', gujarat: 'GJ', 'madhya pradesh': 'MP',
  jharkhand: 'JH', 'west bengal': 'WB', assam: 'AS', nagaland: 'NL', maharashtra: 'MH', telangana: 'TG', chhattisgarh: 'CT', odisha: 'OD',
  meghalaya: 'ML', manipur: 'MN', goa: 'GA', karnataka: 'KA', 'andhra pradesh': 'AP', tripura: 'TR', mizoram: 'MZ', kerala: 'KL',
  'tamil nadu': 'TN', puducherry: 'TN',
};

// ---------------------------------------------------------------- state
const S = {
  ov: null, clins: [], demoShops: new Set(), loading: false, error: '', tab: 'overview',
  f: { q: '', kind: 'all', st: 'all', sort: null, dir: -1 }, flash: null, rejecting: null,
};

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const t = store.get(TOKEN);
  if (t) headers['X-Admin-Token'] = t;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { ...opts, headers });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).detail; } catch { /* not JSON */ }
    throw Object.assign(new Error(typeof detail === 'string' && detail ? detail : `the server answered ${r.status}`), { status: r.status });
  }
  return r.json();
}

// ---------------------------------------------------------------- small building blocks
const tile = (n, label, unit = '') => `<div class="tile${n === '–' ? ' none' : ''}"><div class="n">${esc(n)}${unit && n !== '–' ? `<small>${esc(unit)}</small>` : ''}</div><div class="l">${label}</div></div>`;
const pctTile = (r, label) => tile(r == null ? '–' : pctVal(r), label, '%');
const band = (title, meta, lede, tiles = '') => `<section class="band"><h1>${title}</h1><p class="meta">${meta}</p>${lede ? `<p class="lede">${lede}</p>` : ''}${tiles ? `<div class="tiles">${tiles}</div>` : ''}</section>`;
const card = (title, body, { meta = '', cls = '' } = {}) => `<section class="card ${cls}"><h2>${title}</h2>${meta ? `<p class="meta cmeta">${meta}</p>` : ''}${body}</section>`;
const empty = (text, icon = 'inbox') => `<p class="zempty">${ic(icon)}<span>${text}</span></p>`;
const stat = (n, label, unit = '') => `<div class="zstat"><b>${esc(n)}${unit && n !== '–' ? `<small>${esc(unit)}</small>` : ''}</b><span>${label}</span></div>`;
const demoNote = () => (S.demoShops.size ? ' · demo data' : '');

// a plain table behind a chart, for screen readers and exact values
const tableView = (summary, head, rows) => `<details class="sect ztv"><summary>${esc(summary)}</summary><div class="tablewrap"><table class="rules"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;

// Bars that print a formatted value (rates, days) and can mark the network
// average with a tick. One hue: colour never encodes rank.
function rateBars(items, { fmt = pct, avg = null, avgLabel = '', max = null } = {}) {
  const m = max ?? (Math.max(avg || 0, ...items.map((i) => i.value || 0)) * 1.08 || 1);
  const w = (v) => Math.max(0, Math.min(100, (v / m) * 100));
  return `<ul class="hbars zbars">${items.map((it) => `<li><span class="hl">${esc(it.label)}${it.note ? ` <small>${esc(it.note)}</small>` : ''}</span>
      <span class="ht">${it.value ? `<i style="width:${Math.max(1.5, w(it.value))}%;background:var(--c1)"></i>` : ''}${avg != null ? `<em class="avg" style="left:${w(avg)}%"></em>` : ''}</span><b>${it.value == null ? '–' : esc(fmt(it.value))}</b></li>`).join('')}</ul>
    ${avg != null ? `<p class="zkey"><i></i>${esc(avgLabel)}: ${esc(fmt(avg))}</p>` : ''}`;
}

// Daily columns for 30 days: stacked series, a label every seventh day ending
// today, a tooltip per day over the full column height.
const nice = (v) => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };
function daily({ dates, series, title, unit, height = 180 }) {
  const W = 360; const H = height; const padL = 28; const padB = 22; const padT = 10;
  const n = dates.length;
  const totals = dates.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const max = nice(Math.max(1, ...totals));
  const cw = (W - padL) / n; const bw = Math.max(3, Math.min(16, cw * 0.66));
  const y = (v) => H - padB - ((H - padB - padT) * v) / max;
  const grid = [0, 0.5, 1].map((f) => `<line x1="${padL}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="cg"/><text x="${padL - 6}" y="${y(max * f) + 3}" class="ct" text-anchor="end">${Math.round(max * f)}</text>`).join('');
  let cols = '';
  dates.forEach((d, i) => {
    const x0 = padL + cw * i; const cx = x0 + cw / 2;
    const tip = `${dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}: ${series.length > 1 ? `${totals[i]} ${unit} (${series.map((s) => `${s.name.toLowerCase()} ${s.values[i] || 0}`).join(', ')})` : `${totals[i]} ${unit}`}`;
    let acc = 0; let segs = '';
    const lastSeg = series.reduce((last, s, si) => ((s.values[i] || 0) ? si : last), -1);
    series.forEach((s, si) => {
      const v = s.values[i] || 0; if (!v) return;
      const top = y(acc + v); const h = y(acc) - top; acc += v;
      segs += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, h)}" rx="${si === lastSeg ? 2 : 0}" style="fill:${s.color}"/>`;
    });
    if (!totals[i]) segs = `<rect x="${cx - bw / 2}" y="${y(0) - 2}" width="${bw}" height="2" rx="1" class="cz"/>`;
    cols += `<g class="day"><title>${esc(tip)}</title><rect class="hit" x="${x0}" y="${padT}" width="${cw}" height="${H - padB - padT}"/>${segs}</g>`;
    if ((n - 1 - i) % 7 === 0) cols += `<text x="${cx}" y="${H - 6}" class="ct" text-anchor="middle">${esc(dayLabel(d))}</text>`;
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<figure class="chart zdaily"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${cols}</svg>${legend}</figure>`;
}

// ---------------------------------------------------------------- loading and error states
function loadingPage(tab) {
  const tiles = Array.from({ length: 5 }, () => '<div class="tile sk"><div class="n"></div><div class="l"></div></div>').join('');
  return `<div aria-busy="true">${band(esc(TABS[tab]), 'Loading the network aggregates…', '', tiles)}
    <div class="dash">${'<section class="card sk"><h2></h2><div class="skbody"></div></section>'.repeat(2)}</div></div>`;
}
function errorPage(tab) {
  return `<section class="band"><h1>${esc(TABS[tab])}</h1><p class="meta">Could not load the network aggregates</p>
    <p class="lede">${esc(S.error)} Check that the server is running, then try again.</p>
    <div class="zbtns"><button class="btn primary" type="button" data-retry>${ic('refresh')}Try again</button></div></section>`;
}

// ---------------------------------------------------------------- overview
function attention(o) {
  const out = [];
  const n = o.network; const sc = o.screening; const f = o.field;
  if (n.clinicians.pending) {
    out.push({ go: 'verify', icon: 'shield', cls: 't3', title: `${plural(n.clinicians.pending, 'clinician')} awaiting verification`,
      sub: 'Check the registration number with the council. Until then they cannot sign off reviews.' });
  }
  if (sc.overdueOpen) out.push({ go: 'clinical', icon: 'alert', cls: 'red', title: `${plural(sc.overdueOpen, 'review')} past target`, sub: 'Open cases whose review deadline has passed.' });
  LANES.forEach((l) => {
    const m = sc.medianReviewMinutesByLane?.[l.k];
    if (m != null && m > l.target) out.push({ go: 'clinical', icon: 'clock', title: `${l.name} reviews take longer than the ${l.tgt} target`, sub: `Median review time ${durText(m)}.` });
  });
  const hi = o.shops.filter((s) => s.remakeRate != null && f.remakeRate != null && s.remakeRate > f.remakeRate).sort((a, b) => b.remakeRate - a.remakeRate);
  if (hi.length) {
    out.push({ go: 'field', sort: 'remakeRate', icon: 'glasses', title: `${plural(hi.length, 'shop')} with a remake rate above the network's ${pct(f.remakeRate)}`,
      sub: hi.slice(0, 3).map((s) => `${s.name} ${pct(s.remakeRate)}`).join(' · ') + (hi.length > 3 ? ` and ${hi.length - 3} more` : '') });
  }
  if (n.links.requested) out.push({ go: 'field', icon: 'users', title: `${plural(n.links.requested, 'link request')} waiting`, sub: 'A shop asked a clinician to link with it; the clinician has not accepted yet.' });
  const unlinked = o.shops.filter((s) => !s.clinicians);
  if (unlinked.length) out.push({ go: 'field', sort: 'clinicians', icon: 'users', title: `${plural(unlinked.length, 'shop')} with no clinician linked`, sub: unlinked.slice(0, 3).map((s) => s.name).join(' · ') });
  const waiting = sc.cases - sc.reviewed;
  if (waiting > 0) out.push({ go: 'clinical', icon: 'inbox', title: `${num(waiting)} of ${plural(sc.cases, 'case')} not yet reviewed`, sub: `${pct(sc.reviewRate)} of cases have a clinician's sign-off so far.` });
  const fresh = o.patientApp.requests.byStatus?.new || 0;
  if (fresh) out.push({ go: 'patients', icon: 'phone', title: `${plural(fresh, 'appointment request')} not yet answered`, sub: 'Requests from the patient app that their shop has not accepted or declined.' });
  return out;
}

function renderOverview(o) {
  const n = o.network; const sc = o.screening; const f = o.field;
  const rev = dur(sc.medianReviewMinutes);
  const states = Object.keys(n.states || {}).length;
  const tiles = [
    tile(num(n.shops), `shops and camps · ${n.stores} stores, ${n.camps} camps`),
    tile(num(n.clinicians.verified), `verified clinicians · ${num(n.clinicians.pending)} pending`),
    tile(num(sc.cases), 'cases screened and sent for review'),
    pctTile(sc.referralRate, 'referral rate, red or amber lane'),
    pctTile(sc.withinTarget, `reviews within target · ${plural(sc.reviewed, 'review')}`),
    tile(rev ? rev[0] : '–', 'median review time', rev?.[1]),
    tile(num(f.orders30d), 'orders in the last 30 days'),
    pctTile(f.remakeRate, 'remake rate, last 30 days'),
    pctTile(f.zeissShare, 'ZEISS lens share of orders'),
    tile(num(o.patientApp.selfTests30d), 'patient self-checks, 30 days'),
  ].join('');
  const items = attention(o);
  const dates = sc.daily.map((d) => d.day);
  return `${band('Network overview', `${esc(dayLabel(dates[dates.length - 1], { weekday: 'long', day: 'numeric', month: 'long' }))}${demoNote()}`,
    `${plural(n.shops, 'shop and camp', 'shops and camps')} in ${plural(states, 'state')}. ${num(f.screened30d)} people screened at shop counters in the last 30 days; ${plural(sc.cases, 'case')} sent to clinicians for review.`, tiles)}
    <h2 class="zsec">What needs attention</h2>
    ${items.length ? `<div class="next">${items.map((it) => `<button class="nx ${it.cls || ''}" type="button" data-go="${it.go}"${it.sort ? ` data-sort-to="${it.sort}"` : ''}>${ic(it.icon)}<span><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>${ic('right')}</button>`).join('')}</div>`
    : empty('Nothing needs attention: no pending clinicians, overdue reviews or open link requests.', 'check')}
    <div class="dash">
      ${card('Cases screened per day', daily({ dates, unit: 'cases', title: 'Cases screened per day, last 30 days, routine and referred',
        series: [{ name: 'Routine (green lane)', color: 'var(--c2)', values: sc.daily.map((d) => d.cases - d.referred) },
          { name: 'Referred (red or amber lane)', color: 'var(--lane-amber)', values: sc.daily.map((d) => d.referred) }] })
        + tableView('Show as a table', ['Day', 'Cases', 'Referred'], sc.daily.slice().reverse().map((d) => [dayLabel(d.day), num(d.cases), num(d.referred)])),
      { meta: `Last 30 days · ${plural(sc.daily.reduce((a, d) => a + d.cases, 0), 'case')}` })}
      ${card('Orders per day', daily({ dates: f.ordersDaily.map((d) => d.day), unit: 'orders', title: 'Spectacle orders created per day, last 30 days',
        series: [{ name: 'Orders', color: 'var(--c1)', values: f.ordersDaily.map((d) => d.orders) }] })
        + tableView('Show as a table', ['Day', 'Orders'], f.ordersDaily.slice().reverse().map((d) => [dayLabel(d.day), num(d.orders)])),
      { meta: `Spectacle orders created at shops, from daily counters · ${plural(f.orders30d, 'order')} in 30 days` })}
    </div>`;
}

// ---------------------------------------------------------------- field network
const SORTS = {
  name: { label: 'Shop or camp', text: true }, kind: { label: 'Kind', text: true }, state: { label: 'City, state', text: true },
  clinicians: { label: 'Clinicians' }, cases: { label: 'Cases' }, referralRate: { label: 'Referral rate' },
  medianReviewMinutes: { label: 'Median review' }, orders30d: { label: 'Orders, 30 d' }, remakeRate: { label: 'Remake rate' },
  cancelRate: { label: 'Cancellation' }, zeissShare: { label: 'ZEISS share' }, turnaroundDays: { label: 'Turnaround' },
};
function filteredShops(o) {
  const q = S.f.q.trim().toLowerCase();
  let rows = o.shops.filter((s) => (S.f.kind === 'all' || s.kind === S.f.kind) && (S.f.st === 'all' || (s.state || 'Not set') === S.f.st)
    && (!q || [s.name, s.code, s.city, s.area, s.state, s.pin].some((v) => String(v || '').toLowerCase().includes(q))));
  const k = S.f.sort;
  if (k) {
    const text = SORTS[k]?.text;
    const val = (s) => (k === 'state' ? `${s.state || ''} ${s.city || ''}` : s[k]);
    rows = rows.slice().sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // no data always last
      if (vb == null) return -1;
      return (text ? String(va).localeCompare(String(vb)) : va - vb) * S.f.dir;
    });
  }
  return rows;
}
function shopTable(o) {
  const rows = filteredShops(o);
  const net = o.field;
  const th = (k, cls = '') => {
    const on = S.f.sort === k;
    return `<th class="${cls}"${on ? ` aria-sort="${S.f.dir > 0 ? 'ascending' : 'descending'}"` : ''}><button class="sorth" type="button" data-sort="${k}">${esc(SORTS[k].label)}${on ? ic(S.f.dir > 0 ? 'up' : 'down', { size: 12 }) : ''}</button></th>`;
  };
  const body = rows.length ? rows.map((s) => {
    const above = s.remakeRate != null && net.remakeRate != null && s.remakeRate > net.remakeRate;
    return `<tr>
      <td><div class="pcell"><em class="av ${s.kind === 'camp' ? 'camp' : ''}">${esc(initials(s.name))}</em><span><b>${esc(s.name)}</b><small><span class="mono">${esc(s.code)}</span>${S.demoShops.has(s.code) ? ' · demo' : ''}</small></span></div></td>
      <td><span class="kind">${s.kind === 'camp' ? 'Camp' : 'Store'}</span></td>
      <td>${esc(s.city || s.area || '–')}<small>${esc(s.state || 'State not set')}</small></td>
      <td class="num">${num(s.clinicians)}</td>
      <td class="num">${num(s.cases)}</td>
      <td class="num">${pct(s.referralRate)}</td>
      <td class="num">${s.medianReviewMinutes == null ? '<span class="muted">no reviews</span>' : esc(durText(s.medianReviewMinutes))}</td>
      <td class="num">${num(s.orders30d)}</td>
      <td class="num">${pct(s.remakeRate)}${above ? '<small class="above">above network</small>' : ''}</td>
      <td class="num">${pct(s.cancelRate)}</td>
      <td class="num">${pct(s.zeissShare)}</td>
      <td class="num">${esc(days(s.turnaroundDays))}</td></tr>`;
  }).join('') : `<tr><td colspan="12" class="zrow-empty">No shop or camp matches these filters. <button class="btn small ghost" type="button" data-clear>Clear filters</button></td></tr>`;
  return `<div class="dtable-wrap"><table class="dtable zshops"><thead><tr>${th('name')}${th('kind')}${th('state')}${th('clinicians', 'num')}${th('cases', 'num')}${th('referralRate', 'num')}${th('medianReviewMinutes', 'num')}${th('orders30d', 'num')}${th('remakeRate', 'num')}${th('cancelRate', 'num')}${th('zeissShare', 'num')}${th('turnaroundDays', 'num')}</tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="muted small zfoot">Showing ${num(rows.length)} of ${plural(o.shops.length, 'shop and camp', 'shops and camps')}. Cases, referral rate and review time come from cases sent for review; orders, remake, cancellation, ZEISS share and turnaround from the shops' daily counters over the last 30 days. Network remake rate ${pct(net.remakeRate)}.</p>`;
}
function renderField(o) {
  const n = o.network;
  const states = Object.entries(n.states || {}).sort((a, b) => b[1] - a[1]);
  const byCode = {};
  o.shops.forEach((s) => { const c = STATE_CODE[String(s.state || '').toLowerCase()] || pinToState(s.pin); if (c) byCode[c] = (byCode[c] || 0) + 1; });
  const unlinked = o.shops.filter((s) => !s.clinicians).length;
  const kinds = { all: o.shops.length, store: o.shops.filter((s) => s.kind === 'store').length, camp: o.shops.filter((s) => s.kind === 'camp').length };
  const tiles = [
    tile(num(n.shops), `shops and camps · ${n.stores} stores, ${n.camps} camps`),
    tile(num(states.length), 'states with a shop or camp'),
    tile(num(n.links.active), 'active shop–clinician links'),
    tile(num(n.links.requested), 'link requests waiting'),
    tile(n.cliniciansPerShop == null ? '–' : String(n.cliniciansPerShop), 'clinicians per shop, on average'),
    tile(num(o.field.screened30d), 'people screened at counters, 30 days'),
  ].join('');
  return `${band('Store network', `Optical shops and eye camps using the optical store app${demoNote()}`,
    'Each shop or camp screens at the counter and links with optometrists and ophthalmologists who review its cases. Per-shop figures below are de-identified counts.', tiles)}
    <div class="ptools ztools"><h2 class="zsec">Shops and camps</h2>
      <div class="row gap wrap">
        <div class="seg" role="group" aria-label="Kind">${[['all', 'All'], ['store', 'Stores'], ['camp', 'Camps']].map(([k, l]) => `<button class="chip${S.f.kind === k ? ' on' : ''}" type="button" data-kind="${k}" aria-pressed="${S.f.kind === k}">${l} <b>${kinds[k]}</b></button>`).join('')}</div>
        <select id="fState" aria-label="State"><option value="all">All states</option>${states.map(([s]) => `<option value="${esc(s)}"${S.f.st === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <input type="search" id="fSearch" placeholder="Search name, code, city" aria-label="Search shops and camps" value="${esc(S.f.q)}">
      </div></div>
    <div id="shopTable">${shopTable(o)}</div>
    <div class="dash">
      ${card('Shops by state', `<div class="zmap">${indiaMap(byCode, { unit: 'shops' })}
        ${hbars(states.map(([s, c]) => ({ label: s, value: c })))}</div>`, { cls: 'wide', meta: 'Shops and camps per state · the map places each state roughly where it is' })}
      ${card('Links between shops and clinicians', `
        <div class="kv"><span>Active links</span><b>${num(n.links.active)}</b></div>
        <div class="kv"><span>Link requests waiting for the clinician</span><b>${num(n.links.requested)}</b></div>
        <div class="kv"><span>Clinicians per shop, on average</span><b>${n.cliniciansPerShop ?? '–'}</b></div>
        <div class="kv"><span>Shops with no clinician linked</span><b>${num(unlinked)}</b></div>
        <div class="kv"><span>Verified optometrists</span><b>${num(n.clinicians.optometrists)}</b></div>
        <div class="kv"><span>Verified ophthalmologists</span><b>${num(n.clinicians.ophthalmologists)}</b></div>`,
      { meta: 'A shop can link with several clinicians, and a clinician with several shops' })}
      ${card('Clinicians linked per shop', hbars(o.shops.slice().sort((a, b) => b.clinicians - a.clinicians).map((s) => ({ label: s.name, note: s.kind === 'camp' ? 'camp' : 'store', value: s.clinicians }))),
      { meta: 'Active links only' })}
    </div>`;
}

// ---------------------------------------------------------------- clinical quality
function laneRows(sc) {
  return `<ul class="zlanes">${LANES.map((l) => {
    const m = sc.medianReviewMinutesByLane?.[l.k]; const cases = sc.byLane?.[l.k] ?? 0;
    const over = m != null && m > l.target;
    return `<li><div class="zl-head"><span class="tier ${l.tier}">${l.name}: ${l.sub}</span><span class="muted small">${plural(cases, 'case')} · target ${l.tgt}</span></div>
      <div class="zl-bar"><span class="ht">${m != null ? `<i style="width:${Math.max(1.5, Math.min(100, (m / l.target) * 100))}%"></i>` : ''}</span><b>${m == null ? '<span class="muted">No reviews yet</span>' : `${esc(durText(m))} median`}</b></div>
      ${m != null ? `<small class="${over ? 'warn-text' : 'muted'}">${over ? `Over target: the median is ${esc(durText(m))} against ${l.tgt}` : `Within target: ${pct(m / l.target)} of the ${l.tgt} allowed`}</small>` : ''}</li>`;
  }).join('')}</ul>`;
}
function renderClinical(o) {
  const sc = o.screening; const iv = o.interview; const t = o.tests;
  const u = sc.byUrgency || {};
  const rev = dur(sc.medianReviewMinutes);
  const tiles = [
    tile(num(sc.cases), 'cases screened and sent for review'),
    pctTile(sc.referralRate, 'referral rate, red or amber lane'),
    pctTile(sc.reviewRate, `reviewed by a clinician · ${plural(sc.reviewed, 'case')}`),
    pctTile(sc.withinTarget, 'reviews within target'),
    tile(rev ? rev[0] : '–', 'median review time', rev?.[1]),
    tile(num(sc.overdueOpen), 'open reviews past target'),
  ].join('');
  const rules = (sc.topRules || []).map(([code, c]) => { const r = RULE_BY_CODE[code]; return { label: r?.title || code, note: r ? `${TIERS[r.tier]?.label || r.tier}` : '', value: c }; });
  const decN = sum(sc.decisions);
  const decisions = Object.entries(sc.decisions || {}).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ label: DECISIONS[k] || k, note: `${pct(share(c, decN))} of reviews`, value: c }));
  const qN = sum(t.dataQuality);
  const testsDone = Object.entries(t.done || {}).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ label: TESTS[k] || k, note: `${pct(share(c, sc.cases))} of cases`, value: c }));
  const langN = sum(iv.languages);
  const modeN = sum(iv.answerModes);
  return `${band('Clinical quality', `Screening, triage and review across the network${demoNote()}`,
    'How cases are triaged into lanes, how fast clinicians review them against each lane\'s target, and how complete the tests and interviews are.', tiles)}
    <div class="dash">
      ${card('Urgency mix', donut({ title: 'Cases by urgency', center: num(sc.cases), sub: 'cases', segments: [
        { label: 'Emergency', value: u.emergency || 0, color: 'var(--lane-red)' }, { label: 'Urgent', value: u.urgent || 0, color: 'var(--c4)' },
        { label: 'Soon', value: u.soon || 0, color: 'var(--lane-amber)' }, { label: 'Routine or no finding', value: (u.routine || 0) + (u.info || 0) + (u.none || 0), color: 'var(--c2)' }] }),
      { meta: 'The most urgent finding on each case' })}
      ${card('Review time by lane, against target', laneRows(sc), { meta: 'Median minutes from a case arriving to a clinician signing it off. Each bar fills toward the lane\'s target.' })}
      ${card('Top referral rules', rules.length ? hbars(rules) : empty('No referral findings yet. Rules appear here when a case is flagged.'), { meta: 'Cases flagged by each rule · tier shown after the rule' })}
      ${card('Review decisions', decisions.length ? hbars(decisions) : empty('No reviews signed off yet.'), { meta: `${plural(decN, 'signed-off review')}` })}
      ${card('Tests done', testsDone.length ? hbars(testsDone) : empty('No test results recorded yet.'), { meta: 'Cases with each test result' })}
      ${card('Data quality', qN ? hbars(QUALITY.map(([k, l]) => ({ label: l, note: `${pct(share(t.dataQuality[k] || 0, qN))} of cases`, value: t.dataQuality[k] || 0 }))) : empty('No quality levels recorded yet.'),
      { meta: 'How complete and reliable the measurements were, as graded on each vision profile' })}
      ${card('Interview', `<div class="zstats">${stat(iv.medianAsked == null ? '–' : String(iv.medianAsked), 'questions asked, median per interview')}${stat(iv.medianMinutes == null ? '–' : String(iv.medianMinutes), 'interview length, median', 'min')}</div>
        <h3>Answers, by how they were given</h3>
        <p class="muted small">Each answer records whether the patient spoke it, the operator tapped a choice, or a number was typed. One interview often mixes all three.</p>
        ${modeN ? hbars([['voice', 'Spoken'], ['tap', 'Tapped'], ['typed', 'Typed']].map(([k, l]) => ({ label: l, note: `${pct(share(iv.answerModes[k] || 0, modeN))} of answers`, value: iv.answerModes[k] || 0 }))) : empty('No answers recorded yet.')}
        ${iv.interviewsByMode ? (() => { const n = sum(iv.interviewsByMode); return n ? `<h3>Interviews, by main mode</h3>
        <p class="muted small">An interview is led by a mode when 60% or more of its answers were given that way; otherwise it is mixed.</p>
        ${hbars([['voice', 'Mostly spoken'], ['tap', 'Mostly tapped'], ['typed', 'Mostly typed'], ['mixed', 'Mixed']].map(([k, l]) => ({ label: l, note: `${pct(share(iv.interviewsByMode[k] || 0, n))} of interviews`, value: iv.interviewsByMode[k] || 0 })))}` : ''; })() : ''}`,
      { meta: `${plural(modeN, 'answer')} across all interviews` })}
      ${card('Languages', langN ? hbars(Object.entries(iv.languages).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ label: LANGS[k] || k, note: `${pct(share(c, langN))} of cases`, value: c }))) : empty('No interviews yet.'),
      { meta: 'Language each interview was held in' })}
      ${card('How the tests were taken', rateBars([
        { label: 'Simulated results', note: 'demo or practice runs', value: t.simulatedShare },
        { label: 'Answered on the patient\'s own phone', note: 'chart screen answer pad', value: t.patientPhoneShare }], { max: 1 }),
      { meta: 'Share of cases' })}
    </div>`;
}

// ---------------------------------------------------------------- lenses and orders
function renderLenses(o) {
  const f = o.field;
  const fam = Object.entries(o.lenses?.zeissFamilies || {});
  const famN = sum(o.lenses?.zeissFamilies);
  const noLens = (k) => /^No lens/i.test(k);
  const famItems = fam.sort((a, b) => (noLens(a[0]) - noLens(b[0])) || b[1] - a[1]).map(([k, c]) => ({ label: k, note: `${pct(share(c, famN))} of profiles`, value: c }));
  const shopItems = (key) => o.shops.slice().sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1)).map((s) => ({ label: s.name, note: s.kind === 'camp' ? 'camp' : 'store', value: s[key] }));
  const tiles = [
    tile(num(f.orders30d), 'orders created, 30 days'),
    tile(num(f.delivered30d), 'orders delivered, 30 days'),
    pctTile(f.zeissShare, 'ZEISS lenses in orders'),
    pctTile(f.remakeRate, 'remake rate'),
    pctTile(f.cancelRate, 'cancellation rate'),
    tile(f.turnaroundDays == null ? '–' : String(f.turnaroundDays), 'average turnaround, order to delivery', 'days'),
    tile(num(f.walkInRx30d), 'walk-in prescriptions, 30 days'),
  ].join('');
  return `${band('Lenses and orders', `Spectacle orders from the shops' daily counters, last 30 days${demoNote()}`,
    'The ZEISS lens families the vision profiles point to, and what the shops then order, remake, cancel and deliver. Counts only: no names, no amounts.', tiles)}
    <div class="dash">
      ${card('ZEISS lens families recommended', famItems.length ? hbars(famItems) : empty('No vision profiles with a lens recommendation yet.'),
      { meta: 'From the lens recommendation on each screened case\'s vision profile. A recommendation, not an order.' })}
      ${card('ZEISS share of orders, by shop', rateBars(shopItems('zeissShare'), { avg: f.zeissShare, avgLabel: 'Network share', max: 1 }), { meta: 'Orders with a ZEISS lens, as a share of all orders' })}
      ${card('Remake rate, by shop', rateBars(shopItems('remakeRate'), { avg: f.remakeRate, avgLabel: 'Network rate' }), { meta: 'Remakes as a share of orders · the tick marks the network rate' })}
      ${card('Cancellation rate, by shop', rateBars(shopItems('cancelRate'), { avg: f.cancelRate, avgLabel: 'Network rate' }), { meta: 'Cancellations as a share of orders · the tick marks the network rate' })}
      ${card('Turnaround, by shop', rateBars(shopItems('turnaroundDays').sort((a, b) => (a.value ?? 1e9) - (b.value ?? 1e9)),{ fmt: days, avg: f.turnaroundDays, avgLabel: 'Network average' }),
      { meta: 'Average days from order to delivery, fastest first' })}
      ${card('Orders per day', daily({ dates: f.ordersDaily.map((d) => d.day), unit: 'orders', title: 'Spectacle orders created per day, last 30 days',
        series: [{ name: 'Orders', color: 'var(--c1)', values: f.ordersDaily.map((d) => d.orders) }] }),
      { meta: `${plural(f.orders30d, 'order')} · ${plural(f.walkInRx30d, 'walk-in prescription')} in 30 days` })}
    </div>`;
}

// ---------------------------------------------------------------- patient app
function renderPatients(o) {
  const pa = o.patientApp;
  const tests = Object.keys(SELF).filter((k) => pa.byTest?.[k]).concat(Object.keys(pa.byTest || {}).filter((k) => !SELF[k]));
  const outN = { looks_good: 0, follow_up: 0, see_soon: 0 };
  tests.forEach((k) => Object.keys(outN).forEach((x) => { outN[x] += pa.byTest[k][x] || 0; }));
  const stN = sum(outN);
  const reqN = sum(pa.requests?.byStatus);
  const ages = AGES.filter(([k]) => k !== 'unknown' || pa.ageBands?.unknown);
  const tiles = [
    tile(num(pa.selfTests30d), 'self-checks, last 30 days'),
    pctTile(share(outN.looks_good, stN), 'outcome: looks good'),
    pctTile(share(outN.follow_up, stN), 'outcome: follow up'),
    pctTile(share(outN.see_soon, stN), 'outcome: see someone soon'),
    tile(num(reqN), 'appointment requests'),
    pctTile(pa.requestToBooking, 'requests that became a booking'),
  ].join('');
  return `${band('Patient app', `Anonymous self-checks and appointment requests${demoNote()}`,
    'People check their own eyes on their phone and can ask a nearby shop for an appointment. Self-checks are counted by test, outcome and age band only.', tiles)}
    <div class="dash">
      ${card('Self-checks by test and outcome', stN ? barChart({ title: 'Self-checks by test and outcome', labels: tests.map((k) => SELF[k] || k), series: [
        { name: 'Looks good', color: 'var(--c2)', values: tests.map((k) => pa.byTest[k].looks_good || 0) },
        { name: 'Follow up', color: 'var(--lane-amber)', values: tests.map((k) => pa.byTest[k].follow_up || 0) },
        { name: 'See soon', color: 'var(--c4)', values: tests.map((k) => pa.byTest[k].see_soon || 0) }] })
        + tableView('Show as a table', ['Test', 'Looks good', 'Follow up', 'See soon'], tests.map((k) => [SELF[k] || k, num(pa.byTest[k].looks_good || 0), num(pa.byTest[k].follow_up || 0), num(pa.byTest[k].see_soon || 0)]))
        : empty('No self-checks in the last 30 days.'), { cls: 'wide', meta: `Last 30 days · ${plural(stN, 'self-check')}` })}
      ${card('Age bands', sum(pa.ageBands) ? barChart({ title: 'Self-checks by age band', stacked: false, labels: ages.map(([, l]) => l),
        series: [{ name: 'Self-checks', color: 'var(--c1)', values: ages.map(([k]) => pa.ageBands?.[k] || 0) }] }) : empty('No self-checks in the last 30 days.'),
      { meta: 'Self-checks per age band, as the person chose it' })}
      ${card('Appointment requests by status', reqN ? hbars(REQ_STATUS.map(([k, l]) => ({ label: l, value: pa.requests.byStatus[k] || 0 }))) : empty('No appointment requests yet.'),
      { meta: `${plural(reqN, 'request')} · names and phone numbers stay with the shop and are deleted after 30 days` })}
      ${card('Requests by kind', reqN ? hbars(Object.entries(pa.requests.byKind || {}).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ label: REQ_KIND[k] || k, note: `${pct(share(c, reqN))} of requests`, value: c }))) : empty('No appointment requests yet.'),
      { meta: 'What the person asked for' })}
      ${card('Request to booking', `<div class="zstats">${stat(pa.requestToBooking == null ? '–' : pctVal(pa.requestToBooking), 'of requests became a booking', '%')}${stat(num((pa.requests.byStatus.booked || 0) + (pa.requests.byStatus.done || 0)), `booked or done, of ${plural(reqN, 'request')}`)}</div>`,
      { meta: 'Requests the shop booked into a clinician\'s slot, or completed' })}
    </div>`;
}

// ---------------------------------------------------------------- calendar
function renderCalendar(o) {
  const c = o.calendar;
  const tiles = [
    tile(num(c.upcomingSlots), 'upcoming clinician slots'),
    tile(num(c.booked), 'slots booked'),
    pctTile(c.utilisation, 'utilisation, booked of upcoming'),
    tile(num(c.cancelledOrNoShow), 'bookings cancelled or no-show'),
  ].join('');
  const modes = MODES.filter(([k]) => c.byMode?.[k]).concat(Object.keys(c.byMode || {}).filter((k) => !MODES.some(([m]) => m === k)).map((k) => [k, k]));
  const colors = ['var(--c5)', 'var(--c6)', 'var(--c3)', 'var(--c7)'];
  return `${band('Calendar', `Clinician availability from today${demoNote()}`,
    'Video consultations, in-shop clinics and eye camps that clinicians open for their linked shops, and how many the shops have booked.', tiles)}
    <div class="dash">
      ${card('Utilisation by mode', modes.length ? rateBars(modes.map(([k, l]) => ({ label: l, note: `${num(c.byMode[k].booked)} of ${plural(c.byMode[k].slots, 'slot')} booked`, value: share(c.byMode[k].booked, c.byMode[k].slots) })), { max: 1 })
        : empty('No upcoming slots. Clinicians open slots from the review portal.'), { meta: 'Booked slots as a share of upcoming slots' })}
      ${card('Upcoming slots by mode', c.upcomingSlots ? donut({ title: 'Upcoming slots by mode', center: num(c.upcomingSlots), sub: 'slots',
        segments: modes.map(([k, l], i) => ({ label: l, value: c.byMode[k].slots, color: colors[i % colors.length] })) }) : empty('No upcoming slots.'),
      { meta: 'Where clinician time is offered' })}
      ${card('Cancellations and no-shows', `<div class="zstats">${stat(num(c.cancelledOrNoShow), 'bookings cancelled or marked no-show')}${stat(num(c.booked), 'upcoming slots booked')}</div>
        <p class="muted small">The network reports cancellations and no-shows together, across all bookings.</p>`, { meta: 'All bookings to date' })}
    </div>`;
}

// ---------------------------------------------------------------- verification
function clinFacts(c) {
  const f = [['Role', ROLE[c.role] || c.role], ['Qualification', c.qualification], ['Council', c.council], ['Registration number', c.regNo],
    ['Practice area', `${c.area || '–'}${c.pin ? `, PIN ${c.pin}` : ''}`], ['Registered on', dateText(c.createdAt)]];
  return `<dl class="zfacts">${f.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || '–')}</dd></div>`).join('')}</dl>`;
}
function renderVerify() {
  const cl = S.clins || [];
  const pending = cl.filter((c) => c.status === 'pending');
  const verified = cl.filter((c) => c.status === 'verified');
  const rejected = cl.filter((c) => c.status === 'rejected');
  const tiles = [
    tile(num(pending.length), 'registrations waiting'),
    tile(num(verified.length), 'verified clinicians'),
    tile(num(verified.filter((c) => c.role === 'optometrist').length), 'verified optometrists'),
    tile(num(verified.filter((c) => c.role === 'ophthalmologist').length), 'verified ophthalmologists'),
    tile(num(rejected.length), 'registrations rejected'),
  ].join('');
  const fl = S.flash;
  const flash = fl ? `<div class="zflash ${fl.decision === 'verified' ? '' : 'neutral'}" role="status">${ic(fl.decision === 'verified' ? 'check' : 'x')}<span>${fl.decision === 'verified'
    ? `<b>${esc(fl.name)} is verified.</b> They now appear in the clinician directory for shops and can sign off reviews.`
    : `<b>${esc(fl.name)}'s registration was rejected.</b> They cannot sign in or sign off reviews.`}</span></div>` : '';
  const pendingHtml = pending.length ? `<div class="zpend">${pending.map((c) => `<article class="card zclin" data-clin="${esc(c.code)}">
      <div class="zclin-head"><em class="av">${esc(initials(c.name))}</em><div><h2 class="zname">${esc(c.name)}</h2><p class="meta"><span class="mono">${esc(c.code)}</span> · registered ${esc(dateText(c.createdAt))}${c.demo ? ' · demo' : ''}</p></div></div>
      ${clinFacts(c)}
      <div class="zact"><label>Note, optional<input type="text" name="note" maxlength="200" placeholder="For example: checked on the council register"></label>
        <button class="btn primary" type="button" data-decide="verified">${ic('check')}Verify</button>
        <button class="btn warn" type="button" data-decide="rejected">${ic('x')}Reject</button></div>
      <p class="err" data-err role="alert"></p></article>`).join('')}</div>`
    : empty('No registrations waiting. New clinician sign-ups appear here for checking.', 'check');
  const table = (rows, rej = false) => `<div class="dtable-wrap"><table class="dtable zclins"><thead><tr><th>Clinician</th><th>Role</th><th>Council and registration</th><th>Practice area</th><th>${rej ? 'Rejected' : 'Verified'}</th><th>${rej ? 'Note' : 'Linked shops'}</th></tr></thead><tbody>
    ${rows.map((c) => `<tr><td><div class="pcell"><em class="av">${esc(initials(c.name))}</em><span><b>${esc(c.name)}</b><small><span class="mono">${esc(c.code)}</span> · ${esc(c.qualification || '')}</small></span></div></td>
      <td>${esc(ROLE[c.role] || c.role)}</td><td>${esc(c.council || '–')}<small>${esc(c.regNo || '–')}</small></td><td>${esc(c.area || '–')}<small>${c.pin ? `PIN ${esc(c.pin)}` : ''}</small></td>
      <td>${esc(dateText(c.verifiedAt))}<small>${esc(c.verifiedBy || '')}</small></td>
      <td>${rej ? esc(c.note || '–') : c.shops?.length ? `<div class="zchips">${c.shops.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : '<span class="muted">No active links</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  return `${band('Verification', 'Clinician registrations',
    'A clinician can sign off reviews only after the network admin checks their registration number with the council. This is how the network knows a clinician is authorised. Contact details are not shown here.', tiles)}
    ${flash}
    <h2 class="zsec">Waiting for verification</h2>${pendingHtml}
    <h2 class="zsec">Verified clinicians</h2>${verified.length ? table(verified) : empty('No verified clinicians yet.')}
    ${rejected.length ? `<h2 class="zsec">Rejected registrations</h2>${table(rejected, true)}` : ''}`;
}
async function decide(btn) {
  const el = btn.closest('[data-clin]'); const code = el.dataset.clin;
  const decision = btn.dataset.decide;
  const c = S.clins.find((x) => x.code === code);
  const err = $('[data-err]', el);
  if (decision === 'rejected' && S.rejecting !== code) {
    S.rejecting = code;
    btn.innerHTML = `${ic('x')}Confirm rejection`;
    setTimeout(() => { if (S.rejecting === code && btn.isConnected) { S.rejecting = null; btn.innerHTML = `${ic('x')}Reject`; } }, 5000);
    return;
  }
  S.rejecting = null;
  $$('button', el).forEach((b) => { b.disabled = true; });
  err.textContent = '';
  try {
    await api(`/zeiss/clinicians/${encodeURIComponent(code)}/verify`, { method: 'POST', body: JSON.stringify({ decision, note: $('input[name=note]', el).value.trim(), by: 'network admin' }) });
    S.flash = { code, name: c?.name || code, decision };
    await load();
  } catch (e) {
    if (e.status === 401) { signOut('Your admin session is no longer accepted. Sign in again.'); return; }
    err.textContent = `Could not save the decision: ${e.message}.`;
    $$('button', el).forEach((b) => { b.disabled = false; });
  }
}

// ---------------------------------------------------------------- versions
function renderVersions(o) {
  const rows = Object.entries(o.versions || {}).map(([k, n]) => {
    const m = /app\s+(\S+).*?rules\s+(\S+)/.exec(k);
    return { app: m ? m[1] : k, rules: m ? m[2] : '–', n };
  }).sort((a, b) => b.n - a.n);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const apps = new Set(rows.map((r) => r.app)); const rules = new Set(rows.map((r) => r.rules));
  const latest = rows[0];
  return `${band('Versions', `Optical store and referral rules in use${demoNote()}`,
    'Each case records the app version and the referral-rules version that triaged it, so a rules update can be traced across the network.', [
      tile(num(apps.size), apps.size === 1 ? 'app version in use' : 'app versions in use'),
      tile(num(rules.size), rules.size === 1 ? 'rules version in use' : 'rules versions in use'),
      tile(num(total), 'cases with a version recorded'),
    ].join(''))}
    ${rows.length ? `<div class="dash">${card('Cases by app and rules version', `<div class="dtable-wrap"><table class="dtable zvers"><thead><tr><th>App version</th><th>Rules version</th><th class="num">Cases</th><th class="num">Share of cases</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.app)}</b>${r === latest ? '<small>most cases</small>' : ''}</td><td>${esc(r.rules)}</td><td class="num">${num(r.n)}</td><td class="num">${pct(share(r.n, total))}</td></tr>`).join('')}</tbody></table></div>`,
      { cls: 'wide', meta: rows.length > 1 ? `${plural(rows.length, 'combination')} in use: older versions are still sending cases` : 'Every case was triaged by the same app and rules version' })}</div>`
    : empty('No cases yet, so no versions recorded.')}`;
}

// ---------------------------------------------------------------- paint
const RENDER = { overview: renderOverview, field: renderField, clinical: renderClinical, lenses: renderLenses, patients: renderPatients, calendar: renderCalendar, verify: renderVerify, versions: renderVersions };
function paint() {
  const o = S.ov;
  const admin = store.get(MODE) === 'admin';
  $('#zMode').innerHTML = `${ic(admin ? 'lock' : 'eye', { size: 16 })}${admin ? 'Network admin' : 'Demo access'}`;
  $('#zDemo').hidden = !S.demoShops.size;
  $('#zDemo').textContent = 'Demo data: the seeded shops, clinicians and their counters are synthetic';
  const gen = o ? new Date(o.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  $('#zGen').textContent = S.loading ? (o ? 'Refreshing…' : 'Loading…') : S.error && o ? `Could not refresh: ${S.error} Showing data generated ${gen}.` : o ? `Generated ${gen}` : '';
  $('#zRefresh').disabled = S.loading;
  const pend = (S.clins || []).filter((c) => c.status === 'pending').length;
  $('#navPending').hidden = !pend;
  $('#navPending').textContent = pend;
  $('#navPending').title = `${pend} pending`;
  Object.keys(RENDER).forEach((tab) => {
    const el = $(`#tab-${tab}`);
    if (!o) { el.innerHTML = S.loading ? loadingPage(tab) : S.error ? errorPage(tab) : ''; return; }
    el.innerHTML = RENDER[tab](o);
  });
  bindField();
}
function bindField() {
  const s = $('#fSearch'); const st = $('#fState');
  if (s) s.oninput = () => { S.f.q = s.value; $('#shopTable').innerHTML = shopTable(S.ov); };
  if (st) st.onchange = () => { S.f.st = st.value; $('#shopTable').innerHTML = shopTable(S.ov); };
}

// ---------------------------------------------------------------- navigation and session
const fromHash = () => { const h = location.hash.slice(1); return TABS[h] ? h : 'overview'; };
function show(tab) {
  S.tab = tab;
  $$('.tabpage').forEach((p) => { p.hidden = p.dataset.page !== tab; });
  $$('.navitem[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.title = `${TABS[tab]} · DivyaDrishti Network`;
}
function navigate(tab) {
  if (location.hash.slice(1) === tab) show(tab); else location.hash = tab;
  window.scrollTo(0, 0);
  $(`.navitem[data-tab="${tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function load() {
  S.loading = true; S.error = ''; paint();
  try {
    const [ov, clins, shops] = await Promise.all([
      api('/zeiss/overview'), api('/zeiss/clinicians'),
      fetch(`${API}/shops`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    S.ov = ov; S.clins = clins;
    S.demoShops = new Set((Array.isArray(shops) ? shops : []).filter((s) => s.demo).map((s) => s.code));
  } catch (e) {
    S.loading = false;
    if (e.status === 401) {
      signOut(store.get(TOKEN) ? 'That admin token was not accepted. Check it and sign in again.' : 'This server asks for a network admin token. Sign in with the token it was started with.');
      return;
    }
    S.error = /fetch|network/i.test(e.message) ? 'The server could not be reached.' : `${e.message.charAt(0).toUpperCase()}${e.message.slice(1)}.`;
  }
  S.loading = false; paint();
}

function showGate(msg = '') {
  $('#app').hidden = true; $('#gate').hidden = false;
  $('#gateErr').textContent = msg;
  document.title = 'DivyaDrishti Network';
}
async function enter(mode, token = '') {
  store.set(MODE, mode);
  if (token) store.set(TOKEN, token); else store.del(TOKEN);
  $('#gate').hidden = true; $('#app').hidden = false;
  show(fromHash());
  await load();
}
function signOut(msg = '') {
  store.del(TOKEN); store.del(MODE);
  S.ov = null; S.clins = []; S.flash = null; S.error = '';
  $$('.tabpage').forEach((p) => { p.innerHTML = ''; });
  history.replaceState(null, '', location.pathname);
  showGate(msg);
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const t = e.target;
  const go = t.closest('[data-go]');
  if (go) {
    if (go.dataset.sortTo) { S.f.sort = go.dataset.sortTo; S.f.dir = -1; $('#shopTable').innerHTML = shopTable(S.ov); }
    navigate(go.dataset.go); return;
  }
  const tab = t.closest('.navitem[data-tab]');
  if (tab) { navigate(tab.dataset.tab); return; }
  const sorth = t.closest('[data-sort]');
  if (sorth) {
    const k = sorth.dataset.sort;
    if (S.f.sort === k) S.f.dir = -S.f.dir; else { S.f.sort = k; S.f.dir = SORTS[k].text ? 1 : -1; }
    $('#shopTable').innerHTML = shopTable(S.ov);
    $(`[data-sort="${k}"]`)?.focus();
    return;
  }
  const kind = t.closest('[data-kind]');
  if (kind) { S.f.kind = kind.dataset.kind; $('#tab-field').innerHTML = renderField(S.ov); bindField(); $(`[data-kind="${S.f.kind}"]`)?.focus(); return; }
  if (t.closest('[data-clear]')) { S.f = { ...S.f, q: '', kind: 'all', st: 'all' }; $('#tab-field').innerHTML = renderField(S.ov); bindField(); return; }
  const d = t.closest('[data-decide]');
  if (d) { decide(d); return; }
  if (t.closest('[data-retry]')) load();
});

$$('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', ic(el.dataset.icon, { size: el.classList.contains('privacy') ? 20 : 18 })));
$$('[data-icon-end]').forEach((el) => el.insertAdjacentHTML('beforeend', ic(el.dataset.iconEnd)));
$('#demoBtn').onclick = () => enter('demo');
$('#signinForm').onsubmit = (e) => {
  e.preventDefault();
  const t = $('#tokenIn').value.trim();
  if (!t) { $('#gateErr').textContent = 'Enter the admin token.'; return; }
  $('#tokenIn').value = '';
  enter('admin', t);
};
$('#zRefresh').onclick = () => { S.flash = null; load(); };
$('#zOut').onclick = () => signOut();
window.addEventListener('hashchange', () => { if (!$('#app').hidden) show(fromHash()); });

const mode = store.get(MODE);
if (mode) enter(mode, store.get(TOKEN) || ''); else showGate();
