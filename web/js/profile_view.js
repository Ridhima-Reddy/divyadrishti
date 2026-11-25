// Renders a functional vision profile: shared by the optical store app (summary
// screen) and the optometrist portal. Also renders the referral-rules table,
// so operators and reviewers see exactly what is and is not a red flag.
import { snellen } from './measure/acuity.js';
import { ic } from './icons.js';
import { effectiveRules, ruleOverrides, TIERS, TIER_ORDER, REFS, NOT_FLAGGED } from './engine/redflags.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const LANE_TXT = { red: 'Emergency: eye hospital today', amber: 'Referral needed: see the time below', green: 'Routine: optometrist sign-off' };
export const ZONE_NAME = { near: 'Near (reading, phone, sewing)', intermediate: 'Arm’s length (screen, counter, loom)', distance: 'Distance (outdoors, driving)' };
export const TEST_NAME = {
  acuity: 'Distance vision', contrast: 'Contrast sensitivity', colour: 'Colour vision', astigmatism: 'Astigmatism dial',
  amsler: 'Amsler grid', duochrome: 'Duochrome (red-green)', near_acuity: 'Near vision', reading_distance: 'Reading distance',
  near_point: 'Focusing range (near point)', npc: 'Convergence (near point)', pd: 'PD and fitting height', lensometry: 'Current glasses power',
};

// One line that says how urgent the case is and by when.
export function urgencyLine(tri) {
  if (!tri) return '';
  const u = tri.urgency;
  if (!u) return LANE_TXT[tri.lane] || ''; // cases from before rules r3
  if (u === 'emergency') return 'Emergency: eye hospital today';
  if (u === 'urgent') return `Urgent: ${tri.within}`;
  if (u === 'soon') return `Soon: ${tri.within}`;
  if (u === 'routine') return 'Routine: glasses can proceed after sign-off; routine referral below';
  if (u === 'info') return 'Routine: optometrist sign-off (notes below)';
  return 'Routine: optometrist sign-off';
}

const tierChip = (tier) => (tier ? `<span class="tier ${tier}">${esc(TIERS[tier]?.label || tier)}</span>` : '');
const refLink = (key) => {
  const r = REFS[key];
  if (!r) return '';
  const label = r.cite.split(/[:(]/)[0].trim().slice(0, 70);
  return `<a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.cite)}">${esc(label)}</a> <span class="muted">(${esc(r.kind)})</span>`;
};

export function flagsHtml(flags = []) {
  if (!flags.length) return '';
  return `<ul class="flags">${flags.map((f) => `<li class="flag ${f.lane}">
      <div class="row between wrap">${tierChip(f.tier)}<span class="within">${esc(f.within || '')}</span></div>
      <b>${esc(f.title)}</b>
      <span>${esc(f.detail)}</span>
      <em>${esc(f.action)}</em>
      ${f.refs?.length ? `<small class="refs">Evidence: ${f.refs.map(refLink).join(' · ')}</small>` : ''}
    </li>`).join('')}</ul>`;
}

export function findingsHtml(findings = []) {
  if (!findings.length) return '';
  return `<h3>Test results</h3><ul class="findings">${findings.map((f) => `<li><span>${esc(TEST_NAME[f.test] || f.test)}</span><b>${esc(f.result)}</b><small>${esc(f.meaning)}</small></li>`).join('')}</ul>`;
}

export function profileHtml(prof, m = {}, answers = {}, { collapse = false } = {}) {
  const z = prof.vision.zones;
  const bars = ['near', 'intermediate', 'distance'].map((k) => `
    <div class="zone ${prof.vision.dominance === k ? 'dom' : ''}">
      <div class="row between"><span>${ZONE_NAME[k]}</span><span>${z[k].hours} h · ${Math.round(z[k].share * 100)}%</span></div>
      <div class="bar"><i style="width:${Math.round(z[k].share * 100)}%"></i></div>
      <span class="muted tiny-note">${z[k].source}${k === 'near' ? ` · ${z.near.workingDistanceCm} cm (${z.near.distanceSource})` : ''}</span>
    </div>`).join('');
  const p = prof.presbyopia;
  const r = prof.recommendation;
  return `
    <div class="lane ${prof.triage.lane}">${esc(urgencyLine(prof.triage))}</div>
    ${prof.triage.flags.length ? `<h3>Referral findings</h3>${flagsHtml(prof.triage.flags)}` : '<p class="muted small">No red flags or referral findings.</p>'}
    <div class="pgrid">
    <details class="sect" ${collapse ? '' : 'open'}><summary>Functional vision profile and test results</summary>
    <section>
    <h3>Functional vision profile</h3>
    <p class="dominance">${prof.vision.dominance === 'balanced' ? 'Balanced' : prof.vision.dominance[0].toUpperCase() + prof.vision.dominance.slice(1) + '-dominant'}
      <span class="chip on">Lens design emphasis: ${prof.vision.designEmphasis}</span></p>
    ${bars}
    ${p ? `<div class="kv"><span>Accommodation</span><b>${p.amplitudeD} D</b><small>${esc(p.amplitudeSource)}; age-expected ≥ ${p.expectedAmplitudeD.min} D</small></div>
      <div class="kv"><span>Reading add (estimate)</span><b>${p.addD ? `+${p.addD.toFixed(2)} D` : 'none'}</b><small>for ${p.workingDistanceCm} cm · status: ${p.status}</small></div>` : ''}
    ${prof.myopiaRisk ? `<div class="kv"><span>Myopia risk</span><b>${prof.myopiaRisk.level}</b><small>${esc(prof.myopiaRisk.factors.join('; ') || 'no risk factors reported')}</small></div>` : ''}
    ${m.acuity?.R ? `<div class="kv"><span>Distance vision</span><b>R ${snellen(m.acuity.R.logmar)} · L ${snellen(m.acuity.L?.logmar ?? null)}</b><small>${['R', 'L'].filter((e) => m.acuity[e]?.pinholeLogmar !== undefined).map((e) => `${e} pinhole ${snellen(m.acuity[e].pinholeLogmar)}`).join(' · ')}${m.acuity.optotype === 'C' ? ' · Landolt C' : ''}</small></div>` : ''}
    ${m.amsler?.R ? `<div class="kv"><span>Amsler grid</span><b>R ${esc(m.amsler.R)} · L ${esc(m.amsler.L || '–')}</b>${m.amsler.onset ? `<small>distortion noticed: ${esc(m.amsler.onset)}</small>` : ''}</div>` : ''}
    ${m.pd ? `<div class="kv"><span>Centration</span><b>PD ${m.pd.binocularMm} mm</b><small>${m.pd.rightMm ? `R ${m.pd.rightMm} / L ${m.pd.leftMm} · near ${m.pd.nearMm} · ` : ''}${esc(m.pd.method)}</small></div>` : ''}
    ${answers.rx_known?.text ? `<div class="kv"><span>Current Rx</span><b>${esc(answers.rx_known.text)}</b><small>prescription slip</small></div>` : ''}
    ${findingsHtml(prof.findings)}
    </section></details>
    <section>
    <h3>Suggested</h3>
    <div class="rec"><b>${esc(r.title)}</b>
      <ul>${r.rationale.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${r.example ? `<p class="muted small">${esc(r.example)}</p>` : ''}
      ${r.coatings.length ? `<p class="small"><b>Coatings:</b> ${esc(r.coatings.join('; '))}</p>` : ''}
      ${r.notes.map((x) => `<p class="small note">${esc(x)}</p>`).join('')}
      ${r.centrationNeeded && !m.pd ? '<p class="small warn-text">Needs PD and fitting height before ordering.</p>' : ''}
    </div>
    ${decisionPathHtml(r.decisionPath)}
    ${qualityHtml(prof.quality)}
    ${prof.rulesVersion ? `<p class="muted tiny-note">Rules ${esc(prof.rulesVersion)}: proposed, for optometrist review</p>` : ''}
    </section>
    </div>`;
}

// How the lens category was reached: each rule checked, in order.
export function decisionPathHtml(path) {
  if (!path?.length) return '';
  return `<details class="dpath"><summary>How this suggestion was reached (${path.length} rules checked)</summary>
    <ol>${path.map((p) => `<li class="${p.passed ? 'pass' : 'fail'}"><b>${ic(p.passed ? 'check' : 'x', { size: 14 })} ${esc(p.rule)}</b><span>${esc(p.detail)}</span></li>`).join('')}</ol></details>`;
}

// What the profile rests on: reported, measured or assumed, and how reliable.
export function qualityHtml(q) {
  if (!q?.items?.length) return '';
  return `<details class="quality"><summary>Data quality: <b>${esc(q.level)}</b></summary>
    <ul>${q.items.map((i) => `<li class="${i.ok ? 'ok' : 'warn'}"><span>${ic(i.ok ? 'check' : 'alert', { size: 14 })} ${esc(i.label)}</span><em>${esc(i.value)}</em></li>`).join('')}</ul></details>`;
}

// The whole rule set: what scores at which tier, and what is deliberately not flagged.
// editable: the portal adds an Edit button per rule (hub edits, see redflags.js).
export function rulesTableHtml({ editable = false } = {}) {
  const all = effectiveRules();
  const hub = ruleOverrides();
  const editedNote = (r) => (r.edited ? `<small class="edited">${r.off ? 'Switched off' : 'Edited'} by ${esc(r.edited.by)}${r.edited.at ? ` on ${esc(r.edited.at.slice(0, 10))}` : ''}: ${esc(r.edited.reason)}${r.edited.baseTier !== r.tier ? ` (was ${esc(TIERS[r.edited.baseTier].label)})` : ''}</small>` : '');
  const off = all.filter((r) => r.off);
  const groups = TIER_ORDER.map((tier) => {
    const rules = all.filter((r) => r.tier === tier && !r.off);
    if (!rules.length) return '';
    const t = TIERS[tier];
    return `<section class="rgroup ${t.lane}">
      <h3>${tierChip(tier)} ${esc(t.within)} <span class="muted small">· ${t.lane} lane · hub reviews within ${t.reviewHours} h</span></h3>
      <div class="tablewrap"><table class="rules"><thead><tr><th>Finding</th><th>Scores when</th><th>Time to care</th><th>Action</th><th>Evidence</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
      ${rules.map((r) => `<tr class="${r.edited ? 'is-edited' : ''}"><td><b>${esc(r.title)}</b>${editedNote(r)}</td><td>${esc(r.criteria)}</td><td>${esc(r.within)}</td><td>${esc(r.action)}</td><td>${[r.ref, r.also].filter(Boolean).map((k) => `<a href="${esc(REFS[k].url)}" target="_blank" rel="noopener">${esc(REFS[k].cite)}</a>`).join('<br>')}</td>${editable ? `<td><button class="btn small" data-edit="${esc(r.code)}">Edit</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div></section>`;
  }).join('');
  const offHtml = off.length ? `<section class="rgroup"><h3>Switched off by the hub</h3><div class="tablewrap"><table class="rules"><tbody>
    ${off.map((r) => `<tr class="is-edited"><td><b>${esc(r.title)}</b>${editedNote(r)}</td><td>${esc(r.criteria)}</td>${editable ? `<td><button class="btn small" data-edit="${esc(r.code)}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div></section>` : '';
  const not = `<section class="rgroup green"><h3>Not a red flag</h3>
    <div class="tablewrap"><table class="rules"><thead><tr><th>Presentation</th><th>Why it is not flagged</th></tr></thead><tbody>
    ${NOT_FLAGGED.map((n) => `<tr><td><b>${esc(n.what)}</b></td><td>${esc(n.why)}</td></tr>`).join('')}</tbody></table></div></section>`;
  const ver = hub.version ? `<p class="small edited-banner">Hub edits in force: version ${hub.version}${hub.updatedAt ? `, last changed ${esc(hub.updatedAt.slice(0, 16).replace('T', ' '))}` : ''}. Edited rules are marked below.</p>` : '';
  return `<p class="muted small">Only the findings in the Emergency table send a patient to hospital today. Everything else gets the slowest safe time to care. The reviewing optometrists can change a rule's tier, time to care and action from the portal; the test that decides when a rule fires is fixed.</p>${ver}${groups}${offHtml}${not}`;
}
