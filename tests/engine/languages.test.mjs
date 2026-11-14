import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseYesNo, parseHours, parseOptions, parseDirection } from '../../web/js/engine/parse.js';
import { parseRxSpeech } from '../../web/js/engine/rx.js';
import { QUESTIONS, QUESTION_BY_ID, questionText } from '../../web/js/engine/questions.js';
import { stateOf, createSession } from '../../web/js/engine/adaptive.js';
import { PERSONA_BY_KEY } from '../../web/js/engine/personas.js';
import { buildProfile } from '../../web/js/engine/profile.js';
import { LANGS, LOCALE, tr, P, pt, S } from '../../web/js/i18n.js';
import { PACK_BY_CODE } from '../../web/js/lang/index.js';
import { passportText } from '../../web/js/passport.js';
import { runPersona, askedIds } from './helpers.mjs';

const NEW = ['te', 'mr', 'kn'];
// every Indian language lives in a pack and must be complete
const PACKED = ['hi', 'ta', 'te', 'mr', 'kn', 'bn'];

test('seven languages registered with speech locales', () => {
  assert.deepEqual(Object.keys(LANGS).sort(), ['bn', 'en', 'hi', 'kn', 'mr', 'ta', 'te']);
  assert.equal(LOCALE.bn, 'bn-IN');
  assert.equal(LOCALE.te, 'te-IN'); assert.equal(LOCALE.mr, 'mr-IN'); assert.equal(LOCALE.kn, 'kn-IN');
});

test('every question, option label and unit exists in every Indian language', () => {
  const adult = stateOf(Object.assign(createSession(), { answers: { age: 50 } }));
  const child = stateOf(Object.assign(createSession(), { answers: { age: 9 } }));
  for (const c of PACKED) {
    for (const q of QUESTIONS) {
      for (const s of [adult, child]) {
        const txt = questionText(q, s, c);
        assert.ok(txt && txt !== questionText(q, s, 'en'), `${c} ${q.id}`);
      }
      for (const o of q.options || []) assert.ok(o.label[c], `${c} ${q.id}.${o.v}`);
      if (q.unit) assert.ok(q.unit[c], `${c} unit ${q.id}`);
    }
  }
});

test('every UI, passport and reply string exists in every Indian language', () => {
  for (const c of PACKED) {
    const pack = PACK_BY_CODE[c];
    for (const k of Object.keys(S)) assert.ok(pack.ui[k], `${c} ui.${k}`);
    for (const k of ['consentText', 'urgentBanner', 'acuitySetup', 'pinSetTitle', 'confirmLow']) assert.notEqual(tr(k, c), tr(k, 'en'), `${c} ${k}`);
    for (const group of ['lane', 'need', 'zone', 'lens', 'advice']) {
      for (const [k, v] of Object.entries(P[group])) assert.ok(v[c], `${c} passport ${group}.${k}`);
    }
    for (const k of ['approve', 'modify', 'in_person', 'urgent']) assert.ok(pack.reply[k], `${c} reply.${k}`);
    assert.ok(pack.places.in_person && pack.places.urgent && pack.nearWords, c);
    assert.ok(pt(P.title, c));
  }
});

test('Telugu numbers, halves and thousands', () => {
  assert.equal(parseNumber('యాభై తొమ్మిది', 'te'), 59);
  assert.equal(parseNumber('నలభై ఐదు సంవత్సరాలు', 'te'), 45);
  assert.equal(parseNumber('పదిహేను', 'te'), 15);
  assert.equal(parseHours('రెండున్నర గంటలు', 'te'), 2.5);
  assert.equal(parseHours('అరగంట', 'te'), 0.5);
  assert.equal(parseHours('రోజంతా', 'te'), 8);
  assert.equal(parseNumber('రెండు వేలు', 'te'), 2000);
  assert.equal(parseNumber('౫౪', 'te'), 54); // Telugu digits
});

test('Kannada numbers including fused sandhi forms', () => {
  assert.equal(parseNumber('ಐವತ್ತೆರಡು', 'kn'), 52);
  assert.equal(parseNumber('ಐವತ್ತೊಂದು', 'kn'), 51);
  assert.equal(parseNumber('ಅರವತ್ತೈದು', 'kn'), 65);
  assert.equal(parseNumber('ಐವತ್ತು ನಾಲ್ಕು', 'kn'), 54);
  assert.equal(parseHours('ಎರಡೂವರೆ ಗಂಟೆ', 'kn'), 2.5);
  assert.equal(parseHours('ಅರ್ಧ ಗಂಟೆ', 'kn'), 0.5);
  assert.equal(parseNumber('ಎರಡು ಸಾವಿರ', 'kn'), 2000);
  assert.equal(parseNumber('೫೨', 'kn'), 52); // Kannada digits
});

test('Tamil fused numbers with sandhi', () => {
  assert.equal(parseNumber('ஐம்பத்தொன்று', 'ta'), 51);
  assert.equal(parseNumber('ஐம்பத்தெட்டு', 'ta'), 58);
});

test('Marathi numbers and fractions, without breaking Hindi', () => {
  assert.equal(parseNumber('पंचेचाळीस', 'mr'), 45);
  assert.equal(parseNumber('बावन्न', 'mr'), 52);
  assert.equal(parseNumber('तेरा', 'mr'), 13);
  assert.equal(parseNumber('तेरा', 'hi'), null, '"तेरा" means "your" in Hindi');
  assert.equal(parseHours('दीड तास', 'mr'), 1.5);
  assert.equal(parseHours('अडीच तास', 'mr'), 2.5);
  assert.equal(parseHours('साडे तीन तास', 'mr'), 3.5);
  assert.equal(parseHours('दिवसभर', 'mr'), 8);
});

test('yes / no in Telugu, Kannada, Marathi; language-specific words stay in their language', () => {
  for (const [w, lang] of [['అవును', 'te'], ['షుగర్ ఉంది', 'te'], ['ಹೌದು', 'kn'], ['ಬಿಪಿ ಇದೆ', 'kn'], ['हो', 'mr'], ['होय', 'mr'], ['शुगर आहे', 'mr'], ['हो ना', 'mr']]) {
    assert.equal(parseYesNo(w, lang), true, `${lang}: ${w}`);
  }
  for (const [w, lang] of [['లేదు', 'te'], ['లేదండి', 'te'], ['ಇಲ್ಲ', 'kn'], ['ಇಲ್ಲವೇ ಇಲ್ಲ', 'kn'], ['नाही', 'mr'], ['नको', 'mr']]) {
    assert.equal(parseYesNo(w, lang), false, `${lang}: ${w}`);
  }
  assert.equal(parseYesNo('हो गया', 'hi'), null, 'Hindi "हो" is not yes');
  assert.equal(parseYesNo('हा', 'mr'), null, 'Marathi "हा" means "this"');
});

test('options and directions in the new languages', () => {
  const occ = QUESTION_BY_ID.occupation.options;
  assert.equal(parseOptions('ఆటో నడుపుతాను', occ), 'driver');
  assert.equal(parseOptions('ಹೊಲಿಗೆ ಕೆಲಸ', occ), 'tailor');
  assert.equal(parseOptions('मी शिक्षिका आहे', occ), 'teacher');
  const gt = QUESTION_BY_ID.glasses_type.options;
  assert.equal(parseOptions('గీత లేని', gt), 'progressive');
  assert.equal(parseOptions('ಗೆರೆ ಇರುವ', gt), 'bifocal');
  assert.equal(parseOptions('रेषा नसलेला', gt), 'progressive');
  assert.equal(parseDirection('ಮೇಲೆ'), 'up');
  assert.equal(parseDirection('ఎడమ'), 'left');
  assert.equal(parseDirection('उजवीकडे'), 'right');
});

test('spoken prescription eye words in the new languages', () => {
  const r = parseRxSpeech('కుడి minus two ఎడమ minus one point five');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.R.sph, -2); assert.equal(r.L.sph, -1.5);
});

test('Ramulu (Telugu, 59, auto driver, diabetic): green with routine referrals, glare coating', () => {
  const p = PERSONA_BY_KEY.ramulu;
  const s = runPersona(p);
  assert.ok(!askedIds(s).includes('screen_hours') && !askedIds(s).includes('drives'));
  const pr = buildProfile(s.answers, p.measure);
  // last retina check 2 years ago, early cataract signs with useful vision: routine, glasses can proceed
  assert.equal(pr.triage.lane, 'green');
  assert.equal(pr.triage.urgency, 'routine');
  const codes = pr.triage.flags.map((f) => f.code);
  assert.ok(codes.includes('DIABETES_RETINA_DUE') && codes.includes('CATARACT_EARLY'), codes.join());
  assert.equal(pr.vision.dominance, 'distance');
  assert.ok(pr.recommendation.coatings.some((c) => c.includes('night driving')));
});

test('Sunita (Marathi, 45, teacher): green, progressive, prescription parsed', () => {
  const p = PERSONA_BY_KEY.sunita;
  const s = runPersona(p);
  assert.equal(s.answers.drives, true, 'Marathi "हो" heard as yes');
  assert.equal(s.answers.rx_known.R.cyl, -0.5);
  const pr = buildProfile(s.answers, p.measure);
  assert.equal(pr.triage.lane, 'green');
  assert.equal(pr.recommendation.category, 'progressive');
  assert.equal(pr.presbyopia.amplitudeSource, 'measured near point');
});

test('Manjula (Kannada, 52, tailor, glaucoma in mother): green with a routine glaucoma check, readers at 27 cm', () => {
  const p = PERSONA_BY_KEY.manjula;
  const s = runPersona(p);
  assert.equal(s.answers.age, 52);
  const pr = buildProfile(s.answers, p.measure);
  assert.equal(pr.triage.lane, 'green');
  assert.ok(pr.triage.flags.some((f) => f.code === 'GLAUCOMA_FAMILY' && f.tier === 'routine'));
  assert.equal(pr.recommendation.category, 'readers');
  assert.equal(pr.vision.zones.near.workingDistanceCm, 27);
});

test('Vision Passport renders in each new language', () => {
  for (const key of ['ramulu', 'sunita', 'manjula']) {
    const p = PERSONA_BY_KEY[key];
    const s = runPersona(p);
    const prof = buildProfile(s.answers, p.measure);
    const txt = passportText({ id: 'abc', patient: { name: p.name }, profile: prof, answers: s.answers }, p.lang);
    assert.ok(txt.includes(pt(P.title, p.lang)), key);
    assert.ok(/[ऀ-ॿఀ-೿]/.test(txt), key);
  }
});

test('Bengali numbers, hours, digits, yes / no and options', () => {
  assert.equal(parseNumber('বাহান্ন', 'bn'), 52);
  assert.equal(parseNumber('আমার বয়স পঞ্চাশ বছর', 'bn'), 50);
  assert.equal(parseNumber('পঁয়ষট্টি', 'bn'), 65);
  assert.equal(parseNumber('একশো পঞ্চাশ', 'bn'), 150);
  assert.equal(parseNumber('দুই হাজার', 'bn'), 2000);
  assert.equal(parseNumber('৫২', 'bn'), 52); // Bengali digits
  assert.equal(parseNumber('দুই থেকে তিন', 'bn'), 2.5);
  assert.equal(parseHours('সাড়ে তিন ঘণ্টা', 'bn'), 3.5);
  assert.equal(parseHours('দেড় ঘন্টা', 'bn'), 1.5);
  assert.equal(parseHours('আধ ঘণ্টা', 'bn'), 0.5);
  assert.equal(parseHours('সারাদিন', 'bn'), 8);
  for (const w of ['হ্যাঁ', 'জি', 'আছে', 'হঠাৎ কমে গেছে', 'চশমা পরি']) assert.equal(parseYesNo(w, 'bn'), true, w);
  for (const w of ['না', 'নেই', 'জি না', 'কখনো না', 'ঠিক আছে', 'চশমা পরি না', 'হয়নি']) assert.equal(parseYesNo(w, 'bn'), false, w);
  // "I can't see" could be the vision loss itself: stays unclear instead of "no"
  for (const w of ['দেখি না', 'দেখতে পাই না', 'দেখা যায় না']) assert.equal(parseYesNo(w, 'bn'), null, w);
  const occ = QUESTION_BY_ID.occupation.options;
  assert.equal(parseOptions('টোটো চালাই', occ), 'driver');
  assert.equal(parseOptions('স্কুলে পড়াই', occ), 'teacher');
  assert.equal(parseOptions('স্কুলে পড়ি', occ), 'student');
  const gt = QUESTION_BY_ID.glasses_type.options;
  assert.equal(parseOptions('দাগ ছাড়া', gt), 'progressive');
  assert.equal(parseOptions('মাঝখানে দাগ আছে', gt), 'bifocal');
  const ok = QUESTION_BY_ID.glasses_ok.options;
  assert.equal(parseOptions('ভালো দেখি', ok), 'fine');
  assert.equal(parseOptions('ভালো দেখি না', ok), 'discomfort');
  const cover = QUESTION_BY_ID.rf_double_cover.options;
  assert.equal(parseOptions('হ্যাঁ, বন্ধ হয়ে যায়', cover), 'goes');
  assert.equal(parseOptions('না, যায় না', cover), 'stays');
  assert.equal(parseDirection('বাঁ দিকে'), 'left');
  assert.equal(parseDirection('ডানে'), 'right');
  assert.equal(parseDirection('উপরে'), 'up');
});
