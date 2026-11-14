// Clinical scenarios for the graded red-flag rules (web/js/engine/redflags.js).
// Each test is one presentation an optometrist would recognise, with the tier
// and time-to-care we expect. The point is as much what is NOT an emergency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, RULES, REFS, TIERS, NOT_FLAGGED, emergencyFromAnswers } from '../../web/js/engine/redflags.js';
import { derive, buildProfile } from '../../web/js/engine/profile.js';
import { PERSONA_BY_KEY } from '../../web/js/engine/personas.js';
import { P } from '../../web/js/i18n.js';
import { runPersona } from './helpers.mjs';

const base = { age: 55, rf_vision_drop: false, rf_flashes: false, rf_double: false, rf_red: false, rf_injury: false };
const tri = (a, m = {}) => evaluate({ ...base, ...a }, m);
const codes = (r) => r.flags.map((f) => f.code);
const only = (r, code) => { assert.deepEqual(codes(r), [code]); return r.flags[0]; };

test('no symptoms: green, nothing flagged', () => {
  const r = tri({});
  assert.equal(r.lane, 'green');
  assert.equal(r.urgency, 'none');
  assert.equal(r.flags.length, 0);
});

test('new floaters without a curtain: urgent (24 h dilated exam), amber, NOT same day', () => {
  const r = tri({ rf_flashes: true, rf_curtain: false });
  const f = only(r, 'FLASHES_FLOATERS');
  assert.equal(f.tier, 'urgent');
  assert.equal(f.within, 'within 24 hours');
  assert.equal(r.lane, 'amber');
  assert.equal(derive({ ...base, rf_flashes: true, rf_curtain: false }).urgent, false, 'interview is not shortened');
});

test('floaters with a curtain, or with a sudden drop: emergency (detachment), floaters rule suppressed', () => {
  assert.equal(only(tri({ rf_flashes: true, rf_curtain: true }), 'RETINAL_DETACHMENT_SIGNS').tier, 'emergency');
  const r = tri({ rf_flashes: true, rf_vision_drop: true, rf_onset: 'lt2w', rf_curtain: false });
  assert.deepEqual(codes(r), ['RETINAL_DETACHMENT_SIGNS']);
  assert.equal(r.lane, 'red');
});

test('sudden drop: within 2 days emergency, 3-14 days urgent, older soon', () => {
  assert.equal(only(tri({ rf_vision_drop: true, rf_onset: 'lt2d', rf_curtain: false }), 'SUDDEN_LOSS_RECENT').tier, 'emergency');
  const sub = only(tri({ rf_vision_drop: true, rf_onset: 'lt2w', rf_curtain: false }), 'SUDDEN_LOSS_SUBACUTE');
  assert.equal(sub.tier, 'urgent');
  assert.equal(only(tri({ rf_vision_drop: true, rf_onset: 'gt2w', rf_curtain: false }), 'SUDDEN_LOSS_OLD').tier, 'soon');
});

test('sudden drop with the onset skipped: emergency in the final triage (fail-safe), but no urgent mode mid-interview', () => {
  assert.deepEqual(codes(tri({ rf_vision_drop: true })), ['SUDDEN_LOSS_RECENT']);
  assert.equal(emergencyFromAnswers({ ...base, rf_vision_drop: true }).length, 0);
});

test('red eye: itching/discharge routine; pain 48 h; pain + blur 24 h; haloes or contact lenses same day', () => {
  const mild = tri({ rf_red: true, rf_red_detail: ['discharge'] });
  assert.equal(only(mild, 'RED_EYE_MILD').tier, 'routine');
  assert.equal(mild.lane, 'green');
  assert.equal(only(tri({ rf_red: true, rf_red_detail: ['none'] }), 'RED_EYE_MILD').tier, 'routine');
  assert.equal(only(tri({ rf_red: true, rf_red_detail: ['pain'] }), 'PAINFUL_RED_EYE').within, 'within 48 hours');
  assert.equal(only(tri({ rf_red: true, rf_red_detail: ['photo'] }), 'PAINFUL_RED_EYE').tier, 'urgent');
  assert.equal(only(tri({ rf_red: true, rf_red_detail: ['pain', 'blur'] }), 'PAINFUL_RED_EYE_BLUR').within, 'within 24 hours');
  assert.equal(only(tri({ rf_red: true, rf_red_detail: ['pain', 'haloes'] }), 'ANGLE_CLOSURE_SIGNS').tier, 'emergency');
  assert.equal(only(tri({ rf_red: true, rf_red_detail: ['pain', 'vomit', 'blur'] }), 'ANGLE_CLOSURE_SIGNS').tier, 'emergency');
  assert.equal(only(tri({ rf_red: true, rf_red_detail: ['cl', 'blur'] }), 'CONTACT_LENS_KERATITIS').tier, 'emergency');
});

test('red eye with headache but clear sight and no haloes is not angle-closure', () => {
  assert.deepEqual(codes(tri({ rf_red: true, rf_red_detail: ['pain', 'vomit'] })), ['PAINFUL_RED_EYE']);
});

test('double vision: neuro signs same day; otherwise 48 h; one eye only routine', () => {
  assert.equal(only(tri({ rf_double: true, rf_double_cover: 'goes', rf_double_neuro: true }), 'DIPLOPIA_NEURO').tier, 'emergency');
  assert.equal(only(tri({ rf_double: true, rf_double_cover: 'goes', rf_double_neuro: false }), 'DIPLOPIA_NEW').tier, 'urgent');
  assert.equal(only(tri({ rf_double: true, rf_double_cover: 'unsure', rf_double_neuro: false }), 'DIPLOPIA_NEW').tier, 'urgent');
  const mono = tri({ rf_double: true, rf_double_cover: 'stays' });
  assert.equal(only(mono, 'MONOCULAR_DIPLOPIA').tier, 'routine');
  assert.equal(mono.lane, 'green');
});

test('injuries: chemical and sharp same day; scratch 18 h; blunt 24 h unless sight dropped', () => {
  const chem = only(tri({ rf_injury: true, rf_injury_type: ['chemical'] }), 'CHEMICAL_INJURY');
  assert.equal(chem.tier, 'emergency');
  assert.match(chem.action, /15 minutes/);
  assert.equal(only(tri({ rf_injury: true, rf_injury_type: ['sharp'] }), 'PENETRATING_INJURY').tier, 'emergency');
  const scratch = only(tri({ rf_injury: true, rf_injury_type: ['scratch'] }), 'CORNEAL_SCRATCH');
  assert.equal(scratch.within, 'within 18 hours');
  assert.match(scratch.action, /No steroid/);
  assert.equal(only(tri({ rf_injury: true, rf_injury_type: ['blunt'] }), 'BLUNT_INJURY').tier, 'urgent');
  assert.deepEqual(codes(tri({ rf_injury: true, rf_injury_type: ['blunt'], rf_vision_drop: true, rf_onset: 'lt2d', rf_curtain: false })), ['BLUNT_INJURY_VISION']);
  assert.deepEqual(codes(tri({ rf_injury: true, rf_injury_type: ['chemical', 'scratch'] })), ['CHEMICAL_INJURY']);
});

test('children: white glow 2 weeks; with squint same day; squint alone soon; squint with headache same day', () => {
  const kid = { age: 6 };
  assert.equal(only(tri({ ...kid, child_white: true, child_squint: false }), 'LEUKOCORIA').within, 'within 2 weeks');
  assert.equal(only(tri({ ...kid, child_white: true, child_squint: true, child_neuro: false }), 'LEUKOCORIA_WITH_SQUINT').tier, 'emergency');
  assert.equal(only(tri({ ...kid, child_white: false, child_squint: true, child_neuro: false }), 'CHILD_SQUINT').tier, 'soon');
  assert.equal(only(tri({ ...kid, child_white: false, child_squint: true, child_neuro: true }), 'CHILD_SQUINT_NEURO').tier, 'emergency');
});

test('Amsler distortion: new (or unknown at 50+) within 1 working day; long-standing soon', () => {
  const ab = (onset) => ({ amsler: { R: 'abnormal', L: 'normal', onset } });
  assert.equal(only(tri({}, ab('new')), 'MACULA_NEW').within, 'within 1 working day');
  assert.equal(only(tri({ age: 64 }, ab('unsure')), 'MACULA_NEW').tier, 'urgent');
  assert.equal(only(tri({ age: 42 }, ab('unsure')), 'MACULA_OLD').tier, 'soon');
  assert.equal(only(tri({}, ab('old')), 'MACULA_OLD').tier, 'soon');
});

test('diabetes: never checked for 5+ years soon; otherwise a routine yearly check', () => {
  const d = { conditions: ['diabetes'] };
  assert.equal(only(tri({ ...d, diabetes_years: 8, retina_exam: 'never' }), 'DIABETES_RETINA_OVERDUE').tier, 'soon');
  assert.equal(only(tri({ ...d, diabetes_years: 3, retina_exam: 'never' }), 'DIABETES_RETINA_DUE').tier, 'routine');
  assert.equal(only(tri({ ...d, diabetes_years: 12, retina_exam: 'over_1y' }), 'DIABETES_RETINA_DUE').tier, 'routine');
  assert.equal(tri({ ...d, diabetes_years: 12, retina_exam: 'within_1y' }).flags.length, 0);
});

test('cataract: early signs routine (glasses still help); vision 6/18 or worse soon; never same day', () => {
  const early = tri({ age: 66, night_glare: true }, { acuity: { R: { logmar: 0.2 }, L: { logmar: 0.3 } } });
  assert.equal(only(early, 'CATARACT_EARLY').tier, 'routine');
  assert.equal(early.lane, 'green');
  const op = tri({ age: 66, night_glare: true }, { acuity: { R: { logmar: 0.7, pinholeLogmar: 0.6, pinholeImproved: false }, L: { logmar: 0.3 } } });
  assert.equal(only(op, 'CATARACT_OPERABLE').tier, 'soon');
  assert.notEqual(op.lane, 'red');
});

test('reduced vision a pinhole does not fix (no cataract signs): soon; worse than 6/60: soon', () => {
  const r = tri({ age: 35 }, { acuity: { R: { logmar: 0.6, pinholeLogmar: 0.6, pinholeImproved: false }, L: { logmar: 0.0 } } });
  assert.equal(only(r, 'VA_UNEXPLAINED').tier, 'soon');
  const sev = tri({ age: 35 }, { acuity: { R: { logmar: 1.3, pinholeLogmar: 1.3, pinholeImproved: false }, L: { logmar: 0.0 } } });
  assert.ok(codes(sev).includes('SEVERE_VI'));
  assert.equal(sev.urgency, 'soon');
});

test('contrast: below 1.0 soon; 1.0-1.35 routine; at 50+ it counts as a cataract sign instead', () => {
  assert.equal(only(tri({ age: 40 }, { contrast: { R: { logCS: 0.9 }, L: { logCS: 1.6 } } }), 'CONTRAST_MARKED').tier, 'soon');
  assert.equal(only(tri({ age: 40 }, { contrast: { R: { logCS: 1.2 }, L: { logCS: 1.6 } } }), 'CONTRAST_REDUCED').tier, 'routine');
  const older = tri({ age: 62 }, { contrast: { R: { logCS: 1.2 }, L: { logCS: 1.5 } }, acuity: { R: { logmar: 0.2 }, L: { logmar: 0.1 } } });
  assert.deepEqual(codes(older), ['CATARACT_EARLY']);
});

test('convergence: beyond 6 cm under 40 or 10 cm at 40+ is routine; normal otherwise', () => {
  assert.equal(only(tri({ age: 22 }, { npc: { cm: 9 } }), 'CONVERGENCE_RECEDED').tier, 'routine');
  assert.equal(tri({ age: 45 }, { npc: { cm: 9 } }).flags.length, 0);
  assert.equal(only(tri({ age: 45 }, { npc: { cm: 14 } }), 'CONVERGENCE_RECEDED').tier, 'routine');
});

test('colour vision difference is a note, never a referral', () => {
  const r = tri({}, { colour: { result: 'possible_rg', correct: 2, plates: 5 } });
  assert.equal(only(r, 'COLOUR_VISION').tier, 'info');
  assert.equal(r.lane, 'green');
});

test('family glaucoma at 40+ is routine (green), not amber', () => {
  const r = tri({ age: 45, glaucoma_family: true });
  assert.equal(only(r, 'GLAUCOMA_FAMILY').tier, 'routine');
  assert.equal(r.lane, 'green');
  assert.equal(tri({ age: 35, glaucoma_family: true }).flags.length, 0);
});

test('red lane only for emergencies; review deadline follows the most urgent finding', () => {
  for (const r of RULES) {
    const lane = TIERS[r.tier].lane;
    assert.equal(lane === 'red', r.tier === 'emergency', r.code);
  }
  assert.equal(tri({ rf_flashes: true, rf_curtain: false }).reviewWithinHours, 24);
  assert.equal(tri({ rf_injury: true, rf_injury_type: ['chemical'] }).reviewWithinHours, 2);
  assert.equal(tri({ age: 45, glaucoma_family: true }).reviewWithinHours, 72);
});

test('every rule is complete, referenced and explainable', () => {
  const seen = new Set();
  for (const r of RULES) {
    assert.ok(!seen.has(r.code), `duplicate ${r.code}`); seen.add(r.code);
    assert.ok(TIERS[r.tier], r.code);
    for (const k of ['title', 'criteria', 'action', 'within', 'need']) assert.ok(r[k] && r[k].length > 3, `${r.code}.${k}`);
    assert.ok(REFS[r.ref], `${r.code} ref ${r.ref}`);
    if (r.also) assert.ok(REFS[r.also], `${r.code} also ${r.also}`);
    for (const u of r.unless || []) assert.ok(seen.has(u) || RULES.some((q) => q.code === u), `${r.code} unless ${u}`);
    assert.ok(P.need[r.need]?.en, `patient text for need "${r.need}"`);
  }
  assert.ok(NOT_FLAGGED.length >= 6);
});

test('emergency answers switch the interview to urgent mode; urgent ones do not', () => {
  assert.equal(derive({ ...base, rf_red: true, rf_red_detail: ['pain', 'haloes'] }).urgent, true);
  assert.equal(derive({ ...base, rf_injury: true, rf_injury_type: ['scratch'] }).urgent, false);
  assert.equal(derive({ ...base, rf_flashes: true }).urgent, false);
});

test('personas: Gopal (new floaters) amber urgent with a dispensing hold; Santosh (cane-leaf scratch) urgent within 18 h', () => {
  const g = PERSONA_BY_KEY.gopal;
  const pg = buildProfile(runPersona(g).answers, g.measure);
  assert.equal(pg.triage.urgency, 'urgent');
  assert.equal(pg.triage.lane, 'amber');
  assert.deepEqual(pg.triage.flags.map((f) => f.code), ['FLASHES_FLOATERS']);
  assert.ok(pg.recommendation.notes[0].startsWith('Hold dispensing'));
  const s = PERSONA_BY_KEY.santosh;
  const ps = buildProfile(runPersona(s).answers, s.measure);
  const c = ps.triage.flags.map((f) => f.code);
  assert.ok(c.includes('CORNEAL_SCRATCH') && c.includes('PAINFUL_RED_EYE'), c.join());
  assert.equal(ps.triage.lane, 'amber');
});
