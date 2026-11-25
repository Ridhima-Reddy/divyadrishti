// My eye record. Visits, prescriptions and glasses orders arrive from the shops
// and optometrists on the network (by the patient's mobile number, with their
// consent at the counter); the patient never types them in. Self-checks are local.
import * as S from './store.js';
import * as A from './account.js';
import { $, $$, esc, icon, tierChip, fmtDate, toast, copyText, smsHref, OUTCOMES } from './ui.js';
import { TESTS, selfTestSummary } from './checks.js';

const EYES = [['R', 'Right'], ['L', 'Left']];

// ---------------------------------------------------------------- number formats (measurements in mono)
const sign = (v, ascii) => (v > 0 ? '+' : v < 0 ? (ascii ? '-' : '−') : '');
export const fmtD = (v, ascii = false) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '' : `${sign(Number(v), ascii)}${Math.abs(Number(v)).toFixed(2)}`);
const cell = (v) => (v === '' || v === null || v === undefined ? '<span class="p-nil">–</span>' : esc(v));

function eyeText(e, ascii = true) {
  if (!e) return '–';
  let s = e.sph === 0 && !e.cyl ? 'plano' : fmtD(e.sph, ascii);
  if (e.cyl) s += ` / ${fmtD(e.cyl, ascii)} x ${e.axis ?? '?'}`;
  if (e.add) s += ` Add ${fmtD(e.add, ascii)}`;
  return s;
}

function rxTable(rx, { big = false } = {}) {
  if (!S.hasRx(rx)) return '';
  const hasAdd = EYES.some(([k]) => rx[k]?.add);
  return `<table class="p-rx${big ? ' big' : ''}">
      <thead><tr><th scope="col"><span class="sr">Eye</span></th><th scope="col">SPH</th><th scope="col">CYL</th><th scope="col">AXIS</th>${hasAdd ? '<th scope="col">ADD</th>' : ''}</tr></thead>
      <tbody>${EYES.map(([k, name]) => {
    const e = rx[k];
    return `<tr><th scope="row">${name}</th>
          <td>${cell(e ? (e.sph === 0 && !e.cyl ? 'plano' : fmtD(e.sph)) : '')}</td>
          <td>${cell(e?.cyl ? fmtD(e.cyl) : '')}</td>
          <td>${cell(e?.cyl && e.axis !== null && e.axis !== undefined ? `${e.axis}°` : '')}</td>
          ${hasAdd ? `<td>${cell(e?.add ? fmtD(e.add) : '')}</td>` : ''}</tr>`;
  }).join('')}</tbody></table>`;
}

const where = (e) => [fmtDate(e.date), e.place].filter(Boolean).map(esc).join(' · ');
const netRx = (d) => ({ R: d.R ? { ...d.R, ...(d.add ? { add: d.add } : {}) } : null, L: d.L ? { ...d.L, ...(d.add ? { add: d.add } : {}) } : null });
const STEPS = [['ordered', 'Ordered'], ['in_lab', 'In the lab'], ['ready', 'Ready to collect'], ['delivered', 'Delivered']];
const TIER_OF = { Emergency: 'emergency', Urgent: 'urgent', Soon: 'soon' };

function latestRx(net) {
  const n = net.find((r) => r.kind === 'rx');
  const local = S.latestRx();
  if (n && (!local || n.date >= local.date)) return { date: n.date, place: n.place, rx: netRx(n.data), pd: n.data.pd, by: n.data.by, net: true };
  return local;
}

function latestHtml(e) {
  if (!e) {
    return `<h2>${icon('glasses')} Latest prescription</h2>
      <p class="muted">None yet. When an optical store or optometrist on the network checks your eyes, your prescription appears here by itself.</p>
      <a class="btn primary" href="#book">${icon('pin')} Book an appointment</a>`;
  }
  return `<h2>${icon('glasses')} Latest prescription</h2>
    <p class="meta">${where(e)}${e.net ? ' · from the shop' : e.type === 'passport' ? ' · from a Vision Passport' : ''}</p>
    ${rxTable(e.rx, { big: true })}
    ${e.pd ? `<div class="kv"><span>PD (distance between pupils)</span><b class="mono">${esc(e.pd)} mm</b></div>` : ''}
    ${e.by ? `<p class="small muted">${esc(e.by)}</p>` : ''}`;
}

function orderSteps(d) {
  if (d.status === 'cancelled') return '<p class="small"><span class="status open">Cancelled</span></p>';
  const at = STEPS.findIndex(([k]) => k === d.status);
  return `<div class="p-orderbar" role="group" aria-label="Order progress: ${esc(STEPS[at]?.[1] || d.status)}">${STEPS.map(([k, l], i) => `<span class="${i < at ? 'done' : i === at ? 'now' : ''}">${esc(l)}</span>`).join('')}</div>`;
}

function netItem(r) {
  const d = r.data || {};
  let title = ''; let body = '';
  if (r.kind === 'visit') {
    title = d.summary || 'Checkup';
    body = `<p class="small">${d.urgency ? `<span class="tier ${TIER_OF[d.urgency] || 'routine'}">${esc(d.urgency)}</span> ` : ''}${esc(d.within || '')}</p>
      ${d.next ? `<p class="small">${esc(d.next)}</p>` : ''}
      ${d.review ? `<p class="small p-review">${icon('check', { size: 15 })} <span><b>Reviewed by ${esc(d.review.by || 'the optometrist')}</b>: ${esc(d.review.decision || '')}${d.review.note ? `. ${esc(d.review.note)}` : ''}</span></p>` : '<p class="small muted">Waiting for the optometrist’s review.</p>'}
      ${d.passport ? `<details class="p-pass"><summary>Show the full results</summary><pre class="p-passtext">${esc(d.passport)}</pre></details>` : ''}`;
  } else if (r.kind === 'rx') {
    title = 'Prescription';
    body = `${rxTable(netRx(d))}${d.pd ? `<p class="small">PD <span class="mono">${esc(d.pd)} mm</span></p>` : ''}${d.by ? `<p class="small muted">${esc(d.by)}</p>` : ''}`;
  } else if (r.kind === 'order') {
    title = `Glasses: ${d.lens || 'order'}`;
    body = `${orderSteps(d)}${d.coatings?.length ? `<p class="small muted">${esc(d.coatings.join(' · '))}</p>` : ''}${d.promised && !['delivered', 'cancelled'].includes(d.status) ? `<p class="small">Promised for ${esc(fmtDate(d.promised))}</p>` : ''}`;
  }
  return `<li class="p-ti ${r.kind === 'order' ? 'rx' : r.kind}"><div class="p-tihead"><b>${esc(title)}</b></div><p class="meta">${where(r)}</p>${body}</li>`;
}

function localItem(e) {
  let title = ''; let body = '';
  if (e.type === 'selfcheck') {
    title = `Self-checkup: ${TESTS[e.test]?.name || e.test}`;
    body = `<div class="p-scline">${tierChip(e.outcome)}</div>
      <ul class="p-sceyes">${(e.eyes || []).map((x) => `<li><b>${x.eye === 'R' ? 'Right eye' : x.eye === 'L' ? 'Left eye' : 'Both eyes'}:</b> ${esc(OUTCOMES[x.outcome]?.label || '')}. ${esc(x.why || '')}</li>`).join('')}</ul>`;
  } else if (e.type === 'passport') {
    title = 'Vision Passport';
    body = `${rxTable(e.rx)}<details class="p-pass"><summary>Show the passport text</summary><pre class="p-passtext">${esc(e.text)}</pre></details>`;
  } else return '';
  return `<li class="p-ti ${e.type === 'selfcheck' ? 'selfcheck' : 'passport'}">
      <div class="p-tihead"><b>${esc(title)}</b>
        <span class="p-delwrap"><button class="btn ghost small p-del" type="button" data-del="${esc(e.id)}" aria-label="Delete ${esc(title)}, ${esc(fmtDate(e.date))}">${icon('trash', { size: 17 })}</button></span></div>
      <p class="meta">${e.type === 'selfcheck' ? `${esc(fmtDate(e.date))} · at home, on this phone` : where(e)}</p>${body}</li>`;
}

// ---------------------------------------------------------------- the text a patient can send their optician
export function shareText(net = A.cached()) {
  const lines = ['My eye record (DivyaDrishti)'];
  const rx = latestRx(net);
  if (rx) {
    lines.push(`Prescription ${fmtDate(rx.date)}${rx.place ? `, ${rx.place}` : ''}:`);
    for (const [k, name] of EYES) lines.push(`${name}: ${eyeText(rx.rx[k])}`);
    if (rx.pd) lines.push(`PD ${rx.pd} mm`);
  }
  const visit = net.find((r) => r.kind === 'visit');
  if (visit) lines.push(`Last checkup: ${fmtDate(visit.date)}, ${visit.place}${visit.data?.review ? ` (${visit.data.review.decision})` : ''}`);
  const sc = selfTestSummary();
  if (sc) lines.push(sc);
  if (lines.length === 1) lines.push('Nothing saved yet.');
  return lines.join('\n');
}

// ====================================================================== the record
export async function view(app) {
  const s = A.session();
  app.render('<p class="muted center p-loading">Loading your record…</p>', 'record');
  let net = []; let netErr = '';
  try { net = await A.records({ fresh: true }); } catch (e) { netErr = e.message; }
  const local = S.sortedEntries().filter((e) => e.type === 'selfcheck' || e.type === 'passport');
  const items = [...net.map((r) => ({ date: r.date, at: r.updatedAt, html: netItem(r) })), ...local.map((e) => ({ date: e.date, at: e.date, html: localItem(e) }))]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at).localeCompare(String(a.at)));
  const orders = net.filter((r) => r.kind === 'order' && !['delivered', 'cancelled'].includes(r.data?.status));
  app.render(`
    <section class="band p-recband">
      <div class="p-reccopy">
        <h1 tabindex="-1">My eye record</h1>
        <p class="lede">Every visit to a shop or optometrist on the DivyaDrishti network appears here by itself: results, prescriptions and your glasses order. You never need to type it in.</p>
        <p class="small p-who">${icon('user', { size: 16 })} ${s?.demo ? `Demo patient ${esc(s.name || '')} · ` : ''}Mobile ${esc(s?.phone || '')}</p>
        <div class="p-actions">
          <button class="btn p-onnight" type="button" id="shareBtn" aria-expanded="false" aria-controls="shareBox">${icon('send')} Share with my optician</button>
          <button class="btn p-onnight" type="button" id="printBtn">${icon('printer')} Print</button>
        </div>
      </div>
      <div class="card p-latest">${latestHtml(latestRx(net))}</div>
    </section>
    ${orders.length ? `<section class="card p-orders"><h2>${icon('glasses')} Glasses on the way</h2><ul class="p-orderlist">${orders.map(netItem).join('')}</ul></section>` : ''}
    <section class="card p-sharebox" id="shareBox" hidden>
      <h2>${icon('send')} Share with my optician</h2>
      <p class="muted small">A short summary as text. You choose who gets it; nothing is sent until you press send in your messages app.</p>
      <pre class="p-sharetext" id="shareText"></pre>
      <div class="p-actions">
        <a class="btn primary" id="smsLink" href="#">${icon('send')} Send by SMS</a>
        <button class="btn" type="button" id="copyBtn">${icon('copy')} Copy as text</button>
      </div>
    </section>
    <section class="card p-history">
      <h2>${icon('clock')} History</h2>
      ${netErr ? `<p class="err">${esc(netErr)}</p>` : ''}
      ${items.length ? `<ol class="p-timeline">${items.map((x) => x.html).join('')}</ol>`
    : '<p class="muted">Nothing yet. Your visits, prescriptions and glasses orders from stores on the network show here, with your self-checkup results.</p>'}
    </section>
    <p class="muted small p-printnote">Printed from My eyes, DivyaDrishti. A personal record; not a clinical document.</p>`, 'record');

  $('#printBtn').onclick = () => window.print();
  $('#shareBtn').onclick = () => {
    const box = $('#shareBox');
    const open = box.hidden;
    box.hidden = !open;
    $('#shareBtn').setAttribute('aria-expanded', String(open));
    if (!open) return;
    const text = shareText(net);
    $('#shareText').textContent = text;
    $('#smsLink').href = smsHref(text);
    box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  };
  $('#copyBtn').onclick = async () => { toast(await copyText(shareText(net)) ? 'Copied. Paste it into a message to your optician.' : 'Could not copy. Select the text and copy it.'); };

  $$('[data-del]').forEach((b) => {
    b.onclick = () => {
      const wrap = b.parentElement;
      wrap.innerHTML = `<span class="p-confirm"><span class="small">Delete?</span><button class="btn small warn" type="button" data-yes>Delete</button><button class="btn small ghost" type="button" data-no>Keep</button></span>`;
      wrap.querySelector('[data-yes]').focus();
      wrap.querySelector('[data-yes]').onclick = () => { S.removeEntry(b.dataset.del); toast('Deleted from this phone'); view(app); };
      wrap.querySelector('[data-no]').onclick = () => view(app);
    };
  });
}
