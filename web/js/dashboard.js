// The shop's dashboard: what the shop owner runs the day by.
// Overview: sales, orders, remakes and cancellations, ZEISS lens share, stock.
// Orders: every pair of glasses from prescription to delivery (walk-in
// prescriptions too), with remakes and cancellations and why.
// Appointments: requests from the patient app, slots booked with linked
// optometrists and ophthalmologists, and which professionals this shop works with.
// Stock, sales and orders stay encrypted on this device (and in the shop
// account's sync); only de-identified daily counts go to the network.
import { zeissOptions, LENS_DESIGNS } from './zeiss_lenses.js';

const STATUS = { ordered: 'Ordered', in_lab: 'In the lab', ready: 'Ready for pickup', delivered: 'Delivered', cancelled: 'Cancelled' };
const NEXT = { ordered: ['in_lab', 'Sent to the lab'], in_lab: ['ready', 'Mark ready'], ready: ['delivered', 'Delivered to patient'] };
const REMAKE_WHY = ['Wrong power', 'Centration / fitting height', 'Lens damaged or scratched', 'Patient cannot adapt', 'Lab error', 'Frame broke'];
const CANCEL_WHY = ['Patient changed mind', 'Price', 'Referred for treatment first', 'Delay too long', 'Duplicate order'];
const ROLE = { primary: 'Primary optometrist', tele: 'Tele-optometrist', visiting_ophth: 'Visiting ophthalmologist', referral_ophth: 'Referral ophthalmologist' };
const MODE = { video: 'Video', in_person: 'In person', camp: 'Camp' };
const BK = { booked: 'Booked', confirmed: 'Confirmed', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };
const DEMO_SHOPS = { 'chennai optics, velachery': 'DDS-VEL01', 'eye camp, kanchipuram': 'DDS-KPM01', 'sri sai opticals, uppal': 'DDS-UPL01',
  'patil optics, nashik': 'DDS-NSK01', 'eye camp, bommanahalli': 'DDS-BMH01', 'nethra opticals, tambaram': 'DDS-TBM01' };

const dayKey = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 864e5);
const inMonth = (iso, now = new Date()) => { if (!iso) return false; const x = new Date(iso); return x.getMonth() === now.getMonth() && x.getFullYear() === now.getFullYear(); };
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const initials = (n) => String(n || '').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase() || '#';
const rxNum = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const rxEye = (e) => (e && e.sph != null ? `${e.sph > 0 ? '+' : ''}${Number(e.sph).toFixed(2)}${e.cyl ? ` / ${Number(e.cyl).toFixed(2)} × ${e.axis ?? 0}` : ''}` : '–');

// Who this shop is on the network: its account, or the demo shop that matches its name.
export function shopCodeExact(settings) { return settings.shopCode || DEMO_SHOPS[String(settings.site || '').trim().toLowerCase()] || null; }
export function shopCodeFor(settings) { return shopCodeExact(settings) || 'DDS-VEL01'; }
export function shopHeaders(api) { return api.account.signedIn() ? api.account.headers() : { 'X-Shop-Code': shopCodeFor(api.settings) }; }

async function net(api, path, opts = {}) {
  const r = await fetch(`${api.store.API}${path}`, { ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...shopHeaders(api), ...(opts.headers || {}) } });
  if (!r.ok) { let m = `${r.status}`; try { m = (await r.json()).detail || m; } catch { /* keep status */ } throw new Error(m); }
  return r.json();
}

async function loadShop(api) {
  const d = (await api.store.getSecret('shopdata')) || { stock: [], sales: [], orders: [], updatedAt: '' };
  d.orders = d.orders || [];
  return d;
}
async function saveShop(api, d) {
  d.updatedAt = new Date().toISOString();
  pushPatientRecords(api, d); // marks what was sent, so it runs before the save
  await api.store.putSecret('shopdata', d); api.account.push('shop', 'data', d); pushMetrics(api, d).catch(() => {});
}

// The patient's own record (My eyes app): each order the patient agreed to share
// goes to the network under their mobile number, with the prescription, and again
// whenever its status changes. Nothing is sent for orders without a phone number.
function pushPatientRecords(api, d) {
  for (const o of d.orders) {
    const phone = String(o.patient?.phone || '').replace(/\D/g, '');
    if (!o.toPatient || phone.length < 10) continue;
    const sig = `${o.status}|${(o.remakes || []).length}`;
    if (o.sentSig === sig) continue;
    const date = String(o.createdAt).slice(0, 10);
    const send = (kind, ref, data) => net(api, '/patient/records', { method: 'POST', body: JSON.stringify({ phone, kind, ref, date, consent: true, data }) });
    const jobs = [send('order', o.id, { lens: o.lens?.name || LENS_DESIGNS[o.design] || 'Glasses', coatings: o.coatings || [], status: o.status,
      statusLabel: STATUS[o.status], promised: o.promised || null, remakes: (o.remakes || []).length, history: o.history })];
    if (!o.sentSig && (o.rx?.R?.sph != null || o.rx?.L?.sph != null)) jobs.push(send('rx', o.id, { R: o.rx.R, L: o.rx.L, add: o.rx.add, pd: o.rx.pd, by: o.source === 'walk_in' ? 'Prescription brought by the patient' : '' }));
    o.sentSig = sig;
    Promise.all(jobs).catch(() => { o.sentSig = null; }); // offline: tried again on the next save
  }
}

// Today's de-identified counts for the network: no names, no amounts.
export async function pushMetrics(api, d) {
  const cases = (await api.store.allCases().catch(() => [])).filter((c) => !c.unreadable);
  const today = dayKey();
  const on = (iso) => iso && dayKey(iso) === today;
  const orders = d.orders || [];
  const deliveredToday = orders.filter((o) => on(o.deliveredAt));
  const counters = {
    screened: cases.filter((c) => on(c.createdAt)).length,
    ordersCreated: orders.filter((o) => on(o.createdAt)).length,
    ordersDelivered: deliveredToday.length,
    ordersReady: orders.filter((o) => o.status === 'ready').length,
    remakes: orders.reduce((a, o) => a + (o.remakes || []).filter((r) => on(r.at)).length, 0),
    cancellations: orders.filter((o) => o.cancel && on(o.cancel.at)).length,
    zeissLensOrders: orders.filter((o) => on(o.createdAt) && o.lens?.zeiss).length,
    glassesSold: (d.sales || []).filter((s) => on(s.at)).length,
    walkInRx: orders.filter((o) => on(o.createdAt) && o.source === 'walk_in').length,
    turnaroundDaysSum: Math.round(deliveredToday.reduce((a, o) => a + daysBetween(o.createdAt, o.deliveredAt), 0) * 10) / 10,
    turnaroundCount: deliveredToday.length,
  };
  await net(api, '/metrics', { method: 'PUT', body: JSON.stringify({ day: today, counters }) });
}

function kpis(d, cases) {
  const now = new Date();
  const created = d.orders.filter((o) => inMonth(o.createdAt));
  const delivered = d.orders.filter((o) => inMonth(o.deliveredAt));
  const remakes = d.orders.reduce((a, o) => a + (o.remakes || []).filter((r) => inMonth(r.at)).length, 0);
  const cancels = d.orders.filter((o) => o.cancel && inMonth(o.cancel.at)).length;
  const turn = delivered.length ? delivered.reduce((a, o) => a + daysBetween(o.createdAt, o.deliveredAt), 0) / delivered.length : null;
  const screened = cases.filter((c) => c.createdAt && inMonth(c.createdAt)).length;
  return {
    sales: (d.sales || []).filter((x) => inMonth(x.at, now)).reduce((a, x) => a + (x.amount || 0), 0),
    sold: (d.sales || []).filter((x) => inMonth(x.at, now)).length,
    open: d.orders.filter((o) => ['ordered', 'in_lab'].includes(o.status)).length,
    ready: d.orders.filter((o) => o.status === 'ready').length,
    created: created.length, remakes, cancels, turn, screened,
    zeiss: created.filter((o) => o.lens?.zeiss).length,
  };
}

function views(api, view, counts) {
  const v = [['overview', 'Overview'], ['orders', `Orders${counts.orders ? ` · ${counts.orders}` : ''}`], ['appointments', `Appointments${counts.requests ? ` · ${counts.requests} new` : ''}`]];
  return `<div class="seg dviews" role="tablist" aria-label="Dashboard">${v.map(([k, l]) => `<button class="chip ${view === k ? 'on' : ''}" data-view="${k}" role="tab" aria-selected="${view === k}">${api.esc(l)}</button>`).join('')}</div>`;
}

export async function dashboard(api, view = 'overview', opts = {}) {
  const [d, cases] = await Promise.all([loadShop(api), api.store.allCases().catch(() => [])]);
  const real = cases.filter((c) => !c.unreadable);
  let reqs = [];
  try { reqs = await net(api, '/requests'); } catch { reqs = null; }
  const counts = { orders: d.orders.filter((o) => ['ordered', 'in_lab', 'ready'].includes(o.status)).length, requests: (reqs || []).filter((r) => r.status === 'new').length };
  if (view === 'orders') return orders(api, d, real, counts, opts);
  if (view === 'appointments') return appointments(api, d, real, reqs, counts, opts);
  return overview(api, d, real, counts, opts.filter || 'all');
}

function wireViews(api) {
  api.$$('[data-view]').forEach((b) => b.onclick = () => dashboard(api, b.dataset.view));
}

// ---------------------------------------------------------------- overview
const TYPE_LABEL = { frame: 'Frame', lens: 'Lens', ready: 'Ready readers', accessory: 'Accessory' };
const stockStatus = (it) => (it.qty <= 0 ? ['out', 'Out of stock'] : it.qty <= Math.max(1, Math.floor(it.reorder / 2)) ? ['reorder', 'Reorder'] : it.qty <= it.reorder ? ['low', `${it.qty} left`] : ['ok', 'In stock']);
const SAMPLE_STOCK = [
  ['Rectangle acetate frame, black', 'frame', 14, 1200, 4], ['Round metal frame, gold', 'frame', 3, 1800, 4], ['Cat-eye acetate frame, tortoise', 'frame', 6, 1500, 3],
  ['Kids flexible frame, blue', 'frame', 0, 900, 3], ['Single-vision lens pair, 1.56', 'lens', 40, 600, 10], ['ZEISS SmartLife Single Vision pair', 'lens', 12, 2600, 4],
  ['ZEISS SmartLife Progressive pair', 'lens', 5, 7800, 3], ['ZEISS Officelens pair', 'lens', 2, 5200, 2], ['ZEISS PhotoFusion X pair', 'lens', 4, 4200, 2],
  ['Progressive lens pair', 'lens', 5, 4200, 4], ['Reading glasses +2.00', 'ready', 12, 350, 5], ['Lens cleaning kit', 'accessory', 30, 120, 10],
].map(([name, type, qty, price, reorder], i) => ({ id: `s${i + 1}`, name, type, qty, price, reorder }));

function overview(api, d, real, counts, filter) {
  const { esc, ic, rupee } = api;
  const k = kpis(d, real);
  const now = new Date();
  const low = d.stock.filter((it) => stockStatus(it)[0] !== 'ok');
  const days = api.lastDays(14);
  const perDay = days.map((dd) => d.sales.filter((x) => new Date(x.at).toDateString() === dd.key).reduce((a, x) => a + x.amount, 0));
  const shown = d.stock.filter((it) => filter === 'all' || (filter === 'low' ? stockStatus(it)[0] !== 'ok' : it.type === filter));
  const today = dayKey();
  const attention = [];
  const late = d.orders.filter((o) => ['ordered', 'in_lab'].includes(o.status) && o.promised && o.promised < today);
  const waiting = d.orders.filter((o) => o.status === 'ready' && daysBetween(o.readyAt || o.createdAt, new Date()) >= 3);
  if (counts.requests) attention.push(`<button class="nx t2" data-go="appointments">${ic('inbox')}<span>${counts.requests} new appointment request${counts.requests > 1 ? 's' : ''} from the patient app<small>Confirm the booking, then book a slot with an optometrist if needed</small></span>${ic('right')}</button>`);
  if (late.length) attention.push(`<button class="nx red" data-go="orders">${ic('clock')}<span>${late.length} order${late.length > 1 ? 's' : ''} past the promised date<small>${esc(late.slice(0, 3).map((o) => o.patient.name).join(', '))}</small></span>${ic('right')}</button>`);
  if (waiting.length) attention.push(`<button class="nx t3" data-go="orders">${ic('glasses')}<span>${waiting.length} pair${waiting.length > 1 ? 's' : ''} ready for 3 days or more<small>Call the patient to collect</small></span>${ic('right')}</button>`);
  if (low.length) attention.push(`<button class="nx" data-go="stock">${ic('alert')}<span>${low.length} stock item${low.length > 1 ? 's' : ''} to reorder</span>${ic('right')}</button>`);

  api.setScreen(`
    ${views(api, 'overview', counts)}
    <section class="band">
      <h1>Dashboard</h1>
      <p class="meta">${esc(api.settings.site)} · ${esc(now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }))}</p>
      <section class="stats">
        <div class="stat"><span>Sales this month</span><b>${rupee(k.sales)}</b></div>
        <div class="stat"><span>Orders in progress</span><b>${k.open}</b></div>
        <div class="stat"><span>Ready for pickup</span><b>${k.ready}</b></div>
        <div class="stat"><span>Glasses sold</span><b>${k.sold}</b></div>
      </section>
    </section>
    <section class="kpis" aria-label="This month">
      <div class="kpi"><span>Remakes</span><b>${k.remakes}</b><small>${k.created ? `${pct(k.remakes, k.created)} of orders` : 'no orders yet'}</small></div>
      <div class="kpi"><span>Cancelled</span><b>${k.cancels}</b><small>${k.created ? `${pct(k.cancels, k.created)} of orders` : 'no orders yet'}</small></div>
      <div class="kpi"><span>Turnaround</span><b>${k.turn != null ? `${k.turn.toFixed(1)} d` : '–'}</b><small>order to delivery</small></div>
      <div class="kpi"><span>ZEISS lenses</span><b>${pct(k.zeiss, k.created)}</b><small>${k.zeiss} of ${k.created} orders</small></div>
      <div class="kpi"><span>Screened</span><b>${k.screened}</b><small>${k.screened ? `${pct(k.created, k.screened)} ordered glasses` : 'patients this month'}</small></div>
    </section>
    ${attention.length ? `<section class="next">${attention.join('')}</section>` : ''}
    <div class="dash">
      <section class="card"><div class="row between wrap gap"><h2>Sales, last 14 days</h2><button class="btn small primary" id="saleBtn">${ic('plus')} Record a sale</button></div>
        ${api.barChart({ labels: days.map((x, i) => (i % 2 ? '' : x.label)), title: 'Sales per day in rupees', stacked: false, series: [{ name: 'Sales', color: 'var(--accent)', values: perDay }] })}</section>
      <section class="card"><div class="row between wrap gap"><h2>Orders by stage</h2><button class="btn small" data-go="orders">Open orders ${ic('right')}</button></div>
        <ul class="pipe">${['ordered', 'in_lab', 'ready'].map((s) => `<li class="${s}"><b>${d.orders.filter((o) => o.status === s).length}</b><span>${STATUS[s]}</span></li>`).join('')}
          <li class="delivered"><b>${d.orders.filter((o) => inMonth(o.deliveredAt)).length}</b><span>Delivered this month</span></li></ul>
        <button class="btn small primary" id="newOrderBtn">${ic('plus')} New order or walk-in prescription</button></section>
    </div>
    <div id="shopForm"></div>
    <section class="card" id="stockCard"><div class="row between wrap gap"><h2>Stock</h2><div class="row gap wrap">
        <button class="btn small" id="addItem">${ic('plus')} Add item</button>${d.stock.length ? '' : '<button class="btn small ghost" id="sampleStock">Load sample stock</button>'}</div></div>
      <div class="seg" id="stockFilter">${[['all', 'All', d.stock.length], ['frame', 'Frames'], ['lens', 'Lenses'], ['low', 'To reorder', low.length]].map(([key, l, n]) => `<button class="chip ${filter === key ? 'on' : ''}" data-sf="${key}">${l}${n !== undefined ? ` · ${n}` : ''}</button>`).join('')}</div>
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
  wireViews(api);
  api.$$('[data-go]').forEach((b) => b.onclick = () => (b.dataset.go === 'stock' ? api.$('#stockCard').scrollIntoView({ behavior: 'smooth' }) : dashboard(api, b.dataset.go)));
  api.$('#newOrderBtn').onclick = () => dashboard(api, 'orders', { form: true });
  api.$$('[data-sf]').forEach((b) => b.onclick = () => overview(api, d, real, counts, b.dataset.sf));
  api.$$('[data-dq]').forEach((b) => b.onclick = async () => {
    const it = d.stock.find((x) => x.id === b.dataset.id); if (!it) return;
    it.qty = Math.max(0, it.qty + Number(b.dataset.dq)); await saveShop(api, d); overview(api, d, real, counts, filter);
  });
  const ss = api.$('#sampleStock'); if (ss) ss.onclick = async () => { d.stock = SAMPLE_STOCK.map((x) => ({ ...x })); await saveShop(api, d); overview(api, d, real, counts, 'all'); };
  const closeForm = () => { api.$('#shopForm').innerHTML = ''; };
  api.$('#addItem').onclick = () => {
    api.$('#shopForm').innerHTML = `<form class="card shopform" id="itemForm"><h2>Add a stock item</h2>
      <div class="row gap wrap"><label>Name<input id="iName" maxlength="80"></label><label>Type<select id="iType">${Object.entries(TYPE_LABEL).map(([key, v]) => `<option value="${key}">${v}</option>`).join('')}</select></label></div>
      <div class="row gap wrap"><label>Quantity<input id="iQty" type="number" min="0" value="1"></label><label>Price (₹)<input id="iPrice" type="number" min="0" value="0"></label><label>Reorder when at<input id="iRe" type="number" min="0" value="3"></label></div>
      <div class="row gap"><button class="btn primary" type="submit">Save item</button><button class="btn ghost" type="button" id="formX">Cancel</button></div></form>`;
    api.$('#itemForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!api.$('#iName').value.trim()) return;
      d.stock.push({ id: `s${Date.now()}`, name: api.$('#iName').value.trim(), type: api.$('#iType').value, qty: Number(api.$('#iQty').value) || 0, price: Number(api.$('#iPrice').value) || 0, reorder: Number(api.$('#iRe').value) || 0 });
      await saveShop(api, d); overview(api, d, real, counts, filter);
    };
    api.$('#formX').onclick = closeForm;
    api.$('#itemForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  api.$('#saleBtn').onclick = () => {
    const frames = d.stock.filter((x) => x.type === 'frame' && x.qty > 0);
    const lenses = d.stock.filter((x) => (x.type === 'lens' || x.type === 'ready') && x.qty > 0);
    const pats = real.slice(0, 30);
    const opt = (list, none) => `<option value="">${none}</option>${list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${rupee(x.price)} (${x.qty} left)</option>`).join('')}`;
    api.$('#shopForm').innerHTML = `<form class="card shopform" id="saleForm"><h2>Record a sale</h2>
      <label>Patient<select id="saleCase"><option value="">Walk-in customer</option>${pats.map((c) => `<option value="${esc(c.id)}">${esc(c.patient?.name || api.shortCode(c.id))} · ${esc(api.shortCode(c.id))}</option>`).join('')}</select></label>
      <div class="row gap wrap"><label>Frame<select id="saleFrame">${opt(frames, 'No frame')}</select></label><label>Lenses<select id="saleLens">${opt(lenses, 'No lenses')}</select></label></div>
      <label>Amount (₹)<input id="salePrice" type="number" min="0"></label>
      <div class="row gap"><button class="btn primary" type="submit" id="saleSave">Save sale</button><button class="btn ghost" type="button" id="formX">Cancel</button></div><p class="err" id="saleErr"></p></form>`;
    if (pats.length) api.$('#saleCase').value = pats[0].id;
    if (frames.length) api.$('#saleFrame').value = frames[0].id;
    if (lenses.length) api.$('#saleLens').value = lenses[0].id;
    const sum = () => { const f = d.stock.find((x) => x.id === api.$('#saleFrame').value); const l = d.stock.find((x) => x.id === api.$('#saleLens').value); api.$('#salePrice').value = (f?.price || 0) + (l?.price || 0); };
    api.$('#saleFrame').onchange = sum; api.$('#saleLens').onchange = sum; sum();
    api.$('#saleForm').onsubmit = async (e) => {
      e.preventDefault();
      const items = [api.$('#saleFrame').value, api.$('#saleLens').value].map((id) => d.stock.find((x) => x.id === id)).filter(Boolean);
      if (!items.length) { api.$('#saleErr').textContent = 'Choose a frame or lenses.'; return; }
      items.forEach((x) => { x.qty = Math.max(0, x.qty - 1); });
      const c = real.find((x) => x.id === api.$('#saleCase').value);
      d.sales.push({ id: `v${Date.now()}`, at: new Date().toISOString(), caseId: c?.id || null, patient: c ? (c.patient?.name || api.shortCode(c.id)) : '',
        items: items.map((x) => ({ id: x.id, name: x.name, price: x.price })), amount: Number(api.$('#salePrice').value) || 0 });
      await saveShop(api, d); overview(api, d, real, counts, filter);
    };
    api.$('#formX').onclick = closeForm;
    api.$('#saleForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

// ---------------------------------------------------------------- orders
function orderCard(api, o) {
  const { esc, ic, rupee } = api;
  const late = ['ordered', 'in_lab'].includes(o.status) && o.promised && o.promised < dayKey();
  const nx = NEXT[o.status];
  const bal = Math.max(0, (o.price || 0) - (o.advance || 0));
  return `<article class="ocard ${o.status} ${late ? 'late' : ''}" data-oid="${esc(o.id)}">
    <div class="row between gap"><b>${esc(o.patient.name || 'Walk-in')}</b><span class="mono small">${esc(o.id.slice(-5).toUpperCase())}</span></div>
    <p class="small muted">${o.source === 'walk_in' ? 'Walk-in prescription' : 'From a screening'} · ${esc(LENS_DESIGNS[o.design] || o.design || '')}</p>
    <dl class="rxmini"><dt>R</dt><dd class="mono">${esc(rxEye(o.rx?.R))}</dd><dt>L</dt><dd class="mono">${esc(rxEye(o.rx?.L))}</dd>${o.rx?.add ? `<dt>Add</dt><dd class="mono">+${Number(o.rx.add).toFixed(2)}</dd>` : ''}</dl>
    ${o.lens?.name ? `<p class="small lensline">${o.lens.zeiss ? '<span class="zchip">ZEISS</span>' : ''}${esc(o.lens.name.replace(/^ZEISS /, ''))}${o.coatings?.length ? ` · ${esc(o.coatings.map((c) => c.replace(/^ZEISS /, '')).join(', '))}` : ''}</p>` : ''}
    <p class="small">${o.status === 'delivered' ? `Delivered ${esc(fmtDay(o.deliveredAt))}` : o.status === 'cancelled' ? `Cancelled: ${esc(o.cancel?.reason || '')}` : `Promised ${esc(fmtDay(o.promised))}${late ? ' · <b class="warn-text">late</b>' : ''}`}${bal && o.status !== 'cancelled' ? ` · balance ${rupee(bal)}` : ''}</p>
    ${o.remakes?.length ? `<p class="small remk">${ic('refresh', { size: 13 })} Remade ${o.remakes.length}×: ${esc(o.remakes.map((r) => r.reason).join('; '))}</p>` : ''}
    ${o.status !== 'delivered' && o.status !== 'cancelled' ? `<div class="row gap wrap oact">${nx ? `<button class="btn small primary" data-next="${esc(o.id)}">${esc(nx[1])}</button>` : ''}
      <button class="btn small ghost" data-remake="${esc(o.id)}">Remake</button><button class="btn small ghost" data-cancel="${esc(o.id)}">Cancel</button></div>` : ''}
    ${o.status === 'delivered' ? `<div class="row gap wrap oact"><button class="btn small ghost" data-remake="${esc(o.id)}">Remake</button></div>` : ''}
  </article>`;
}

function orders(api, d, real, counts, opts = {}) {
  const { esc, ic } = api;
  const filter = opts.filter || 'active';
  const recent = (o) => o.status !== 'delivered' || daysBetween(o.deliveredAt, new Date()) <= 14;
  const cols = ['ordered', 'in_lab', 'ready', 'delivered'];
  const issues = d.orders.filter((o) => o.status === 'cancelled' || o.remakes?.length).slice(-12).reverse();
  api.setScreen(`
    ${views(api, 'orders', counts)}
    <div class="row between wrap gap ohead"><h1>Orders</h1><button class="btn primary" id="newOrder">${ic('plus')} New order</button></div>
    <p class="muted small">From a screened patient or a prescription a patient brings in. Track each pair until it is in the patient’s hands.</p>
    <div id="orderForm"></div>
    <div class="seg ofilters">${[['active', 'In progress'], ['issues', `Remakes and cancellations${issues.length ? ` · ${issues.length}` : ''}`]].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-of="${k}">${esc(l)}</button>`).join('')}</div>
    ${filter === 'issues'
    ? `<section class="olist">${issues.map((o) => orderCard(api, o)).join('') || '<p class="muted small">No remakes or cancellations. Each one is recorded with its reason, so patterns show up here.</p>'}</section>`
    : `<section class="pipeline">${cols.map((s) => { const list = d.orders.filter((o) => o.status === s && recent(o)).reverse(); return `<div class="ocol ${s}"><h3>${STATUS[s]}${s === 'delivered' ? ', last 14 days' : ''} <span>${list.length}</span></h3>${list.map((o) => orderCard(api, o)).join('') || '<p class="muted small">None</p>'}</div>`; }).join('')}</section>`}`, 'shop-orders');
  wireViews(api);
  api.$$('[data-of]').forEach((b) => b.onclick = () => orders(api, d, real, counts, { filter: b.dataset.of }));
  api.$('#newOrder').onclick = () => orderForm(api, d, real, counts);
  if (opts.form) orderForm(api, d, real, counts);
  const find = (id) => d.orders.find((o) => o.id === id);
  api.$$('[data-next]').forEach((b) => b.onclick = async () => {
    const o = find(b.dataset.next); const [to] = NEXT[o.status];
    o.status = to; o.history.push({ status: to, at: new Date().toISOString() });
    if (to === 'ready') o.readyAt = new Date().toISOString();
    if (to === 'delivered') {
      o.deliveredAt = new Date().toISOString();
      if (!d.sales.some((s) => s.orderId === o.id) && o.price) d.sales.push({ id: `v${Date.now()}`, at: o.deliveredAt, caseId: o.caseId, orderId: o.id, patient: o.patient.name, items: [{ name: o.lens?.name || 'Glasses', price: o.price }, ...(o.frameName ? [{ name: o.frameName, price: 0 }] : [])], amount: o.price });
    }
    await saveShop(api, d); orders(api, d, real, counts, { filter });
  });
  const ask = (o, kind) => {
    const box = api.$(`[data-oid="${o.id}"]`);
    const list = kind === 'remake' ? REMAKE_WHY : CANCEL_WHY;
    box.insertAdjacentHTML('beforeend', `<form class="whyform"><label>${kind === 'remake' ? 'Why is it being remade?' : 'Why was it cancelled?'}<select name="why">${list.map((w) => `<option>${esc(w)}</option>`).join('')}</select></label>
      <div class="row gap"><button class="btn small ${kind === 'remake' ? 'primary' : 'warn'}" type="submit">${kind === 'remake' ? 'Send back to the lab' : 'Cancel the order'}</button><button class="btn small ghost" type="button" data-x>Keep</button></div></form>`);
    const f = box.querySelector('.whyform');
    f.querySelector('[data-x]').onclick = () => f.remove();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const at = new Date().toISOString();
      if (kind === 'remake') { o.remakes = [...(o.remakes || []), { at, reason: f.why.value }]; o.status = 'in_lab'; o.deliveredAt = null; o.history.push({ status: 'remake', at, reason: f.why.value }); }
      else { o.cancel = { at, reason: f.why.value }; o.status = 'cancelled'; o.history.push({ status: 'cancelled', at, reason: f.why.value }); }
      await saveShop(api, d); orders(api, d, real, counts, { filter });
    };
  };
  api.$$('[data-remake]').forEach((b) => b.onclick = () => ask(find(b.dataset.remake), 'remake'));
  api.$$('[data-cancel]').forEach((b) => b.onclick = () => ask(find(b.dataset.cancel), 'cancel'));
}

function orderForm(api, d, real, counts) {
  const { esc, rupee } = api;
  const frames = d.stock.filter((x) => x.type === 'frame' && x.qty > 0);
  const lensStock = d.stock.filter((x) => x.type === 'lens' && x.qty > 0);
  const promised = dayKey(Date.now() + 5 * 864e5);
  const eyeRow = (e) => `<tr><th>${e}</th>${['sph', 'cyl', 'axis'].map((f) => `<td><input class="mono" name="${e}${f}" type="number" step="${f === 'axis' ? 1 : 0.25}" min="${f === 'axis' ? 0 : f === 'cyl' ? -8 : -20}" max="${f === 'axis' ? 180 : f === 'cyl' ? 0 : 20}" aria-label="${e} ${f}"></td>`).join('')}</tr>`;
  api.$('#orderForm').innerHTML = `<form class="card shopform orderform" id="oForm">
    <h2>New order</h2>
    <label>Patient<select name="case"><option value="">Walk-in: a prescription the patient brought</option>${real.slice(0, 40).map((c) => `<option value="${esc(c.id)}">${esc(c.patient?.name || api.shortCode(c.id))} · screened ${esc(new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}${c.review ? ' · reviewed' : ''}</option>`).join('')}</select></label>
    <div class="row gap wrap" id="walkin"><label>Name<input name="name" maxlength="60" autocomplete="off"></label><label>Phone<input name="phone" inputmode="tel" maxlength="16" autocomplete="off"></label></div>
    <h3>Prescription <span class="muted">(from the optometrist’s slip)</span></h3>
    <table class="rxin"><thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th></tr></thead><tbody>${eyeRow('R')}${eyeRow('L')}</tbody></table>
    <div class="row gap wrap"><label>Add<input class="mono" name="add" type="number" step="0.25" min="0" max="4"></label><label>PD (mm)<input class="mono" name="pd" type="number" step="0.5" min="40" max="80"></label>
      <label>Lens design<select name="design">${Object.entries(LENS_DESIGNS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label></div>
    <div class="lifechips" id="life"><span class="small muted">Patient’s day:</span>
      ${[['drives', 'Drives, or night glare'], ['screens', 'Screens 3 h or more'], ['outdoors', 'Outdoors 3 h or more'], ['child', 'Child under 16']].map(([k, l]) => `<button type="button" class="chip small" data-life="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    <div class="zopts" id="zopts"></div>
    <div class="row gap wrap"><label>Frame<select name="frame"><option value="">Patient’s own frame</option>${frames.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${rupee(x.price)}</option>`).join('')}</select></label>
      <label>Price (₹)<input name="price" type="number" min="0"></label><label>Advance paid (₹)<input name="advance" type="number" min="0" value="0"></label><label>Promised for<input name="promised" type="date" value="${promised}"></label></div>
    <label class="check"><input type="checkbox" name="toPatient" checked> <span>Send this prescription and order updates to the patient's My eyes record, by their mobile number (the patient agrees)</span></label>
    <div class="row gap"><button class="btn primary" type="submit">Save order</button><button class="btn ghost" type="button" id="oX">Cancel</button></div><p class="err" id="oErr"></p></form>`;
  const f = api.$('#oForm');
  const life = new Set();
  const draw = () => {
    const c = real.find((x) => x.id === f.case.value);
    const ans = { ...(c?.interview?.answers || {}) };
    if (life.has('drives')) ans.drives = true;
    if (life.has('screens')) ans.screen_hours = 4;
    if (life.has('outdoors')) ans.outdoor_hours = 4;
    const age = life.has('child') ? 10 : (c?.patient?.age ?? c?.interview?.answers?.age ?? null);
    const z = zeissOptions({ category: f.design.value, age, answers: ans });
    f.querySelector('#zopts').innerHTML = `<h3>ZEISS options to discuss</h3><p class="small muted">${esc(z.note)}</p>
      <div class="zlist">${z.lenses.map((l, i) => `<label class="zopt"><input type="radio" name="lens" value="${esc(l.name)}" ${i === 0 ? 'checked' : ''}><span><b>${esc(l.name)}</b><small>${esc(l.why)}</small></span></label>`).join('')}
        ${lensStock.filter((x) => !/ZEISS/.test(x.name)).slice(0, 3).map((x) => `<label class="zopt other"><input type="radio" name="lens" value="${esc(x.name)}"><span><b>${esc(x.name)}</b><small>From stock · ${rupee(x.price)}</small></span></label>`).join('')}</div>
      ${z.coatings.length ? `<div class="zcoat"><span class="small muted">Coatings:</span>${z.coatings.map((c, i) => `<label class="check"><input type="checkbox" name="coat" value="${esc(c.name)}" ${i === 0 ? 'checked' : ''}> <span>${esc(c.name.replace(/^ZEISS /, ''))}<small class="muted"> · ${esc(c.why)}</small></span></label>`).join('')}</div>` : ''}`;
  };
  const fill = () => {
    const c = real.find((x) => x.id === f.case.value);
    api.$('#walkin').hidden = Boolean(c);
    if (c) {
      const cat = c.review?.lensCategory || c.profile?.recommendation?.category;
      if (cat && LENS_DESIGNS[cat]) f.design.value = cat;
      const add = c.review?.addD ?? c.profile?.presbyopia?.addD;
      if (add) f.add.value = add;
      if (c.measurements?.pd?.binocularMm) f.pd.value = c.measurements.pd.binocularMm;
      const rx = c.interview?.answers?.rx_known;
      for (const e of ['R', 'L']) if (rx?.[e]) { f[`${e}sph`].value = rx[e].sph ?? ''; f[`${e}cyl`].value = rx[e].cyl ?? ''; f[`${e}axis`].value = rx[e].axis ?? ''; }
    }
    draw();
  };
  f.case.onchange = fill; f.design.onchange = draw;
  f.querySelectorAll('[data-life]').forEach((b) => b.onclick = () => { const k = b.dataset.life; if (life.has(k)) life.delete(k); else life.add(k); b.classList.toggle('on', life.has(k)); b.setAttribute('aria-pressed', String(life.has(k))); draw(); });
  fill();
  api.$('#oX').onclick = () => { api.$('#orderForm').innerHTML = ''; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const c = real.find((x) => x.id === f.case.value);
    const name = c ? (c.patient?.name || api.shortCode(c.id)) : f.name.value.trim();
    if (!name) { api.$('#oErr').textContent = 'Enter the patient’s name.'; return; }
    const eye = (k) => ({ sph: rxNum(f[`${k}sph`].value), cyl: rxNum(f[`${k}cyl`].value), axis: rxNum(f[`${k}axis`].value) });
    const rx = { R: eye('R'), L: eye('L'), add: rxNum(f.add.value), pd: rxNum(f.pd.value) };
    if (rx.R.sph == null && rx.L.sph == null && f.design.value !== 'readers') { api.$('#oErr').textContent = 'Enter the prescription (at least the SPH of one eye).'; return; }
    const lensName = f.querySelector('input[name=lens]:checked')?.value || '';
    const frame = d.stock.find((x) => x.id === f.frame.value);
    if (frame) frame.qty = Math.max(0, frame.qty - 1);
    const at = new Date().toISOString();
    d.orders.push({ id: `o${Date.now()}`, createdAt: at, caseId: c?.id || null, source: c ? 'screening' : 'walk_in', patient: { name, phone: c ? (c.patient?.phone || '') : f.phone.value.trim() },
      rx, design: f.design.value, lens: { name: lensName, zeiss: /^ZEISS /.test(lensName) }, coatings: [...f.querySelectorAll('input[name=coat]:checked')].map((x) => x.value),
      frameId: frame?.id || null, frameName: frame?.name || '', price: Number(f.price.value) || 0, advance: Number(f.advance.value) || 0, promised: f.promised.value,
      status: 'ordered', remakes: [], cancel: null, history: [{ status: 'ordered', at }], toPatient: Boolean(f.toPatient.checked) });
    await saveShop(api, d);
    orders(api, d, real, counts);
  };
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- appointments
async function appointments(api, d, real, reqs, counts, opts = {}) {
  const { esc, ic } = api;
  let me = null; let bookings = []; let netErr = '';
  try { [me, bookings] = await Promise.all([net(api, '/shops/me'), net(api, '/bookings')]); } catch (e) { netErr = e.message; }
  const links = me?.links || [];
  const active = links.filter((l) => l.status === 'active');
  const reqRow = (r) => `<article class="reqrow ${r.status}" data-rid="${esc(r.id)}">
      <div class="row between wrap gap"><b>${esc(r.name)}</b><span class="tier ${r.kind === 'with_optometrist' ? 'soon' : 'info'}">${r.kind === 'with_optometrist' ? 'With an optometrist' : 'Routine check'}</span></div>
      <p class="small"><a href="tel:${esc(r.phone.replace(/\s/g, ''))}">${esc(r.phone)}</a>${r.preferred ? ` · prefers ${esc(r.preferred)}` : ''} · ${esc(new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</p>
      ${r.note ? `<p class="small">${esc(r.note)}</p>` : ''}${r.selftest ? `<p class="small muted">Self-check: ${esc(r.selftest)}</p>` : ''}
      ${r.reply ? `<p class="small comment">${esc(r.reply)}</p>` : ''}
      <div class="row gap wrap"><span class="status ${r.status === 'new' ? 'open' : r.status === 'booked' ? 'reviewed' : 'sent'}">${esc({ new: 'New', accepted: 'Accepted', booked: 'Booked', declined: 'Declined', done: 'Done' }[r.status] || r.status)}</span>
        ${r.status === 'new' ? `<button class="btn small primary" data-acc="${esc(r.id)}">Accept</button><button class="btn small ghost" data-dec="${esc(r.id)}">Decline</button>` : ''}
        ${['new', 'accepted'].includes(r.status) && active.length ? `<button class="btn small" data-bookreq="${esc(r.id)}">${ic('clock', { size: 15 })} Book a slot</button>` : ''}</div></article>`;
  api.setScreen(`
    ${views(api, 'appointments', counts)}
    <h1 class="ohead">Appointments</h1>
    ${netErr ? `<div class="banner amber">${ic('alert')}<span>Could not reach the network (${esc(netErr)}). Appointments need the internet.</span></div>` : ''}
    <div class="apgrid">
      <div>
        <section class="card"><div class="row between wrap gap"><h2>${ic('inbox')} Requests from the patient app</h2><span class="muted small">${(reqs || []).length}</span></div>
          <p class="small muted">Patients ask for a routine check, or for a visit with an optometrist present. Call them back, then book a slot below.</p>
          <div class="reqs">${(reqs || []).map(reqRow).join('') || '<p class="muted small">No requests yet.</p>'}</div></section>
        <section class="card" id="bookCard"><h2>${ic('clock')} Book an optometrist or ophthalmologist</h2>
          ${active.length ? `<label>Professional<select id="bkClin">${active.map((l) => `<option value="${esc(l.clinicianCode)}">${esc(l.clinicianName)} · ${esc(l.roleLabel)}</option>`).join('')}</select></label>
            <div id="slotList" class="slotlist"><p class="muted small">Loading free slots…</p></div>
            <form id="bkForm" hidden><p class="small" id="bkWhen"></p>
              <div class="row gap wrap"><label>Patient<select id="bkCase"><option value="">Someone not yet screened</option>${real.slice(0, 30).map((c) => `<option value="${esc(c.id)}" data-ref="${esc(initials(c.patient?.name))} · ${esc(api.shortCode(c.id))}">${esc(c.patient?.name || api.shortCode(c.id))} · ${esc(api.shortCode(c.id))}</option>`).join('')}</select></label>
                <label>Reference sent to the professional<input id="bkRef" maxlength="40" placeholder="Initials or case code, never a full name"></label></div>
              <label>Reason<input id="bkReason" maxlength="120" placeholder="e.g. Dilated retina check (diabetes)"></label>
              <input type="hidden" id="bkReq"><div class="row gap"><button class="btn primary" type="submit" id="bkGo">Book this slot</button><button class="btn ghost" type="button" id="bkX">Choose another</button></div><p class="err" id="bkErr"></p></form>`
    : '<p class="muted small">Connect an optometrist or ophthalmologist first (on the right).</p>'}
        </section>
      </div>
      <div>
        <section class="card"><h2>${ic('users')} Who this shop works with</h2>
          <p class="small muted">Shop ID <b class="mono">${esc(me?.shop?.code || shopCodeFor(api.settings))}</b>${me?.shop?.demo ? ' · demo shop' : ''}. A shop can work with several optometrists and ophthalmologists, and each of them with many shops.</p>
          <ul class="links">${links.map((l) => `<li><span class="lav">${esc(initials(l.clinicianName))}</span><span><b>${esc(l.clinicianName)}</b><small>${esc(l.roleLabel)} · ${esc(l.clinicianArea || '')} · <span class="mono">${esc(l.clinicianCode)}</span></small></span><span class="status ${l.status === 'active' ? 'reviewed' : 'open'}">${l.status === 'active' ? 'Linked' : 'Requested'}</span></li>`).join('') || '<li class="muted small">No one yet.</li>'}</ul>
          <button class="btn small" id="findClin">${ic('plus')} Connect another professional</button><div id="dir"></div></section>
        <section class="card"><h2>${ic('clock')} Upcoming bookings</h2>
          <ul class="bklist">${bookings.filter((b) => b.booking && b.booking.status !== 'cancelled').map((b) => `<li><span class="when"><b>${esc(fmtDay(b.start))}</b><small class="mono">${esc(fmtTime(b.start))}</small></span>
            <span><b>${esc(b.booking.patientRef)}</b><small>${esc(b.clinicianName)} · ${esc(MODE[b.mode] || b.mode)}${b.mode !== 'video' ? ` · ${esc(b.placeName)}` : ''}${b.booking.reason ? ` · ${esc(b.booking.reason)}` : ''}</small></span>
            <span class="row gap"><span class="status ${b.booking.status === 'confirmed' ? 'reviewed' : 'sent'}">${esc(BK[b.booking.status] || b.booking.status)}</span><button class="btn small ghost" data-cancelbk="${esc(b.booking.id)}" aria-label="Cancel booking">${ic('x', { size: 15 })}</button></span></li>`).join('') || '<li class="muted small">Nothing booked.</li>'}</ul></section>
      </div>
    </div>`, 'shop-appts');
  wireViews(api);
  const refresh = () => dashboard(api, 'appointments', opts);
  const patch = async (id, body) => { await net(api, `/requests/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); refresh(); };
  api.$$('[data-acc]').forEach((b) => b.onclick = () => patch(b.dataset.acc, { status: 'accepted', reply: 'We will confirm your booking shortly.' }).catch(() => {}));
  api.$$('[data-dec]').forEach((b) => b.onclick = () => patch(b.dataset.dec, { status: 'declined', reply: 'Sorry, we cannot take this request. Please choose another shop.' }).catch(() => {}));
  api.$$('[data-cancelbk]').forEach((b) => b.onclick = async () => { await net(api, `/bookings/${b.dataset.cancelbk}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }).catch(() => {}); refresh(); });
  api.$('#findClin').onclick = async () => {
    const box = api.$('#dir');
    box.innerHTML = '<p class="muted small">Looking up verified professionals near this shop…</p>';
    try {
      const list = await fetch(`${api.store.API}/clin/directory${me?.shop?.pin ? `?pin=${me.shop.pin}` : ''}`).then((r) => r.json());
      const have = new Set(links.map((l) => l.clinicianCode));
      box.innerHTML = `<ul class="links dir">${list.filter((c) => !have.has(c.code)).map((c) => `<li><span class="lav">${esc(initials(c.name))}</span><span><b>${esc(c.name)}</b><small>${esc(c.role === 'ophthalmologist' ? 'Ophthalmologist' : 'Optometrist')} · ${esc(c.qualification || '')} · ${esc(c.area || '')}</small></span>
        <span class="row gap"><select data-role="${esc(c.code)}" aria-label="Role">${Object.entries(ROLE).filter(([k]) => (c.role === 'ophthalmologist') === k.endsWith('ophth')).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="btn small primary" data-link="${esc(c.code)}">Connect</button></span></li>`).join('') || '<li class="muted small">Everyone nearby is already linked.</li>'}</ul>`;
      box.querySelectorAll('[data-link]').forEach((b) => b.onclick = async () => {
        await net(api, '/links', { method: 'POST', body: JSON.stringify({ clinicianCode: b.dataset.link, role: box.querySelector(`[data-role="${b.dataset.link}"]`).value }) }).catch((e) => { box.insertAdjacentHTML('beforeend', `<p class="err">${esc(e.message)}</p>`); });
        refresh();
      });
    } catch { box.innerHTML = '<p class="err">Could not load the directory.</p>'; }
  };
  if (!active.length) return;
  let chosen = null;
  const loadSlots = async () => {
    const box = api.$('#slotList');
    try {
      const all = await net(api, `/slots?clinician=${encodeURIComponent(api.$('#bkClin').value)}`);
      const free = all.filter((s) => !s.booked);
      const byDay = {};
      free.forEach((s) => { (byDay[s.start.slice(0, 10)] = byDay[s.start.slice(0, 10)] || []).push(s); });
      box.innerHTML = Object.entries(byDay).slice(0, 6).map(([day, list]) => `<div class="sday"><b>${esc(fmtDay(list[0].start))}</b><div class="slots">${list.map((s) => `<button type="button" class="chip slot ${s.mode}" data-slot="${esc(s.id)}" title="${esc(MODE[s.mode])} · ${esc(s.placeName)}">${esc(fmtTime(s.start))}<small>${esc(MODE[s.mode])}</small></button>`).join('')}</div></div>`).join('') || '<p class="muted small">No free slots in the next two weeks. Ask the professional to add availability.</p>';
      box.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => {
        chosen = free.find((s) => s.id === b.dataset.slot);
        box.querySelectorAll('[data-slot]').forEach((x) => x.classList.toggle('on', x === b));
        api.$('#bkForm').hidden = false;
        api.$('#bkWhen').innerHTML = `<b>${esc(fmtDay(chosen.start))}, ${esc(fmtTime(chosen.start))}</b> · ${esc(chosen.clinicianName)} · ${esc(MODE[chosen.mode])}${chosen.mode !== 'video' ? ` at ${esc(chosen.placeName)}` : ''}`;
      });
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  api.$('#bkClin').onchange = () => { api.$('#bkForm').hidden = true; loadSlots(); };
  api.$('#bkCase').onchange = (e) => { const o = e.target.selectedOptions[0]; if (o?.dataset.ref) api.$('#bkRef').value = o.dataset.ref; };
  api.$('#bkX').onclick = () => { api.$('#bkForm').hidden = true; };
  api.$$('[data-bookreq]').forEach((b) => b.onclick = () => {
    const r = (reqs || []).find((x) => x.id === b.dataset.bookreq);
    api.$('#bkReq').value = r.id; api.$('#bkRef').value = `${initials(r.name)} · app request`; api.$('#bkReason').value = r.note.slice(0, 120);
    api.$('#bookCard').scrollIntoView({ behavior: 'smooth' });
  });
  api.$('#bkForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!chosen) return;
    const ref = api.$('#bkRef').value.trim();
    if (!ref) { api.$('#bkErr').textContent = 'Add a reference: initials or the case code.'; return; }
    api.$('#bkGo').disabled = true;
    try {
      await net(api, '/bookings', { method: 'POST', body: JSON.stringify({ slotId: chosen.id, patientRef: ref, caseRef: api.$('#bkCase').value || null, reason: api.$('#bkReason').value.trim(), requestId: api.$('#bkReq').value || null }) });
      refresh();
    } catch (err) { api.$('#bkErr').textContent = err.message; api.$('#bkGo').disabled = false; }
  };
  loadSlots();
}
