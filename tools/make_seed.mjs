// Build server/seed_cases.json by running every synthetic persona through the
// real engine (adaptive interview -> profile -> passport), exactly as the
// phone would. Usage: npm run seed
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PERSONAS } from '../web/js/engine/personas.js';
import { createSession, nextQuestion, interpret, submitAnswer, bankSize, notAsked } from '../web/js/engine/adaptive.js';
import { buildProfile } from '../web/js/engine/profile.js';
import { passportText } from '../web/js/passport.js';

const idFor = (key) => {
  const h = createHash('sha1').update(`divyadrishti-seed-${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const RECEIVED_MIN_AGO = { ravi: 25, murugan: 190, priya: 50, lakshmi: 75, kumar: 300, fatima: 330, arjun: 1500, selvi: 40, ramulu: 110, sunita: 20, manjula: 65 };
const REVIEWS = {
  kumar: {
    reviewer: { name: 'Optom. A. Meenakshi', regNo: 'TN-OPT-0000 (demo)' }, decision: 'approve', lensCategory: 'office',
    designEmphasis: 'Intermediate', nextStep: 'Office lens for the desk; keep current bifocal for driving. Recheck in 12 months.',
    notes: 'Measured near point 58 cm matches age. PD 63.5 mm (iris scale) acceptable for an office lens; confirm with a PD ruler.',
    messageToPatient: 'Your work glasses are approved. Collect them at Chennai Optics in 5 days.', afterMinutes: 18,
  },
  arjun: {
    reviewer: { name: 'Optom. A. Meenakshi', regNo: 'TN-OPT-0000 (demo)' }, decision: 'modify', lensCategory: 'sv_distance',
    nextStep: 'Re-refract at the store: vision 6/12 with current glasses suggests the power has increased.',
    notes: 'Young myope, 5 h/day screen. Advise outdoor time and 20-20-20.',
    messageToPatient: 'Please come back to the store for a new power check this week.', afterMinutes: 40,
  },
};

// Deterministic 0..1 from a string, so the seed file is stable between runs.
const unit = (str) => parseInt(createHash('sha1').update(str).digest('hex').slice(0, 8), 16) / 0xffffffff;

// How each answer was given, as in real use: older patients at camps mostly
// speak; younger, literate patients tap more; numbers and prescriptions are
// often typed by the operator. Every answer records its own mode.
const VOICE_SHARE = { camp: 0.75, store: 0.5 };
function modeFor(p, q) {
  const r = unit(`${p.key}:${q.id}:mode`);
  if ((q.type === 'number' || q.type === 'rx' || q.type === 'hours') && r < 0.45) return 'typed';
  const voice = (VOICE_SHARE[p.siteType] ?? 0.55) + ((p.say.age ?? 40) >= 55 ? 0.15 : 0) - ((p.say.age ?? 40) < 25 ? 0.2 : 0);
  return r < voice ? 'voice' : r < voice + 0.08 ? 'typed' : 'tap';
}

function runPersona(p, created) {
  const s = createSession({ lang: p.lang, id: p.key });
  for (let i = 0; i < 60; i++) {
    const q = nextQuestion(s);
    if (!q) break;
    const raw = p.say[q.id];
    const r = interpret(q, raw, q.asr || p.lang);
    if (!r.ok) throw new Error(`${p.key}: cannot parse ${q.id}`);
    submitAnswer(s, q.id, r.value, { raw, mode: modeFor(p, q) });
  }
  // Real pacing: 12 to 40 seconds per answer (voice answers include the question being read out).
  let t = new Date(created).getTime();
  s.startedAt = new Date(t).toISOString();
  for (const tr of s.trace) {
    if (tr.qid && !tr.event) t += (12 + unit(`${p.key}:${tr.qid}:t`) * 22 + (tr.mode === 'voice' ? 6 : 0)) * 1000;
    tr.at = new Date(t).toISOString();
  }
  s.finishedAt = new Date(t + 20000).toISOString();
  return s;
}

const out = PERSONAS.map((p) => {
  const id = idFor(p.key);
  const minsAgo = RECEIVED_MIN_AGO[p.key] ?? 60;
  const created = new Date(Date.now() - (minsAgo + 8) * 60000).toISOString();
  const session = runPersona(p, created);
  const profile = buildProfile(session.answers, p.measure, { trace: session.trace });
  const asked = session.trace.filter((x) => x.qid && !x.event).length;
  const patient = { name: p.name, phone: p.phone, village: p.village, age: session.answers.age, sex: session.answers.sex };
  const c = {
    id, createdAt: created, appVersion: '0.2.0', lang: p.lang, demo: true,
    site: { name: p.site, type: p.siteType }, operator: p.siteType === 'camp' ? 'Camp volunteer (demo)' : 'Store owner (demo)',
    patient,
    consent: { given: true, at: created, lang: p.lang, textVersion: 'consent-v1', method: 'demo' },
    interview: { answers: session.answers, trace: session.trace, skipped: session.skipped, startedAt: session.startedAt, finishedAt: session.finishedAt, asked, bank: bankSize(), notAsked: notAsked(session) },
    measurements: p.measure,
    profile,
    rulesVersion: profile.rulesVersion,
    passport: { lang: p.lang, text: passportText({ id, patient, profile, answers: session.answers }, p.lang) },
  };
  const seed = { case: c, receivedMinutesAgo: minsAgo };
  if (REVIEWS[p.key]) seed.review = { ...REVIEWS[p.key], decisionLabel: REVIEWS[p.key].decision === 'approve' ? 'Approved' : 'Approved with changes' };
  return seed;
});

writeFileSync(new URL('../server/seed_cases.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`wrote ${out.length} seed cases:`, out.map((s) => `${s.case.patient.name} [${s.case.profile.triage.lane}] asked ${s.case.interview.asked}`).join('; '));
