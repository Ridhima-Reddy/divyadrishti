// Red flags and urgency: exactly what is scored, at which tier, and why.
//
// Five tiers, each with a time-to-care, modelled on the College of
// Optometrists' referral categories (emergency / urgent / routine) and the
// NICE time limits where NICE sets one:
//   emergency  same day (eye casualty)            -> red lane, interview shortens
//   urgent     18 hours to 2 weeks (rule says)    -> amber lane, hub reviews in 24 h
//   soon       2 to 6 weeks                       -> amber lane
//   routine    next camp / within 3 months        -> green lane, glasses can proceed
//   info       for the record, no referral        -> green lane
//
// Only a handful of findings are emergencies. Everything else gets the
// slowest safe time-to-care, so a patient with long-standing floaters or
// itchy eyes is not sent to hospital today.
//
// Every rule is data: the optical store app and the portal render this table, the
// tests exercise it, and docs/CLINICAL_LOGIC.md lists the same rules with
// references. Proposed rules, to be agreed with the reviewing optometrists.

const has = (arr, v) => Array.isArray(arr) && arr.includes(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const TIERS = {
  emergency: { rank: 4, lane: 'red', label: 'Emergency', within: 'same day', reviewHours: 2 },
  urgent: { rank: 3, lane: 'amber', label: 'Urgent', within: '18 hours to 2 weeks (each rule states it)', reviewHours: 24 },
  soon: { rank: 2, lane: 'amber', label: 'Soon', within: '2 to 6 weeks', reviewHours: 72 },
  routine: { rank: 1, lane: 'green', label: 'Routine', within: 'next camp or within 3 months', reviewHours: 72 },
  info: { rank: 0, lane: 'green', label: 'Note', within: 'no referral', reviewHours: 72 },
};
export const TIER_ORDER = ['emergency', 'urgent', 'soon', 'routine', 'info'];

// Short evidence keys used by the rules; full citations in REFS (and the docs).
export const REFS = {
  cop_annex4: { cite: 'College of Optometrists, Guidance for Professional Practice, Annex 4: urgency of referrals', url: 'https://www.college-optometrists.org/clinical-guidance/guidance/guidance-annexes/annex-4-urgency-of-referrals-table', kind: 'guideline' },
  cop_cmg: { cite: 'College of Optometrists, Clinical Management Guidelines (categories A1 emergency, A3 urgent within 1 week, B1 routine)', url: 'https://www.college-optometrists.org/guidance/clinical-management-guidelines/what-are-clinical-management-guidelines.html', kind: 'guideline' },
  cop_flashes: { cite: 'College of Optometrists, Examining patients who present with flashes and floaters (emergency if detachment, haemorrhage or symptomatic break; otherwise dilated examination)', url: 'https://www.college-optometrists.org/Clinical-guidance/Guidance/Knowledge,-skills-and-performance/Examining-patients-who-present-with-flashes-and-fl', kind: 'guideline' },
  pvd_pathway: { cite: 'NHS flashes and floaters pathway (James Paget University Hospitals, 2025): dilated assessment within 24 h; 10-15% of acute PVDs have a retinal tear (WikEM)', url: 'https://www.jpaget.nhs.uk/media/tabnvp1f/flashes-and-floaters-jan-2025.pdf', kind: 'local pathway' },
  cop_keratitis: { cite: 'College of Optometrists CMG: Microbial keratitis, A1 emergency (same day) if fungal or sight-threatening bacterial keratitis is suspected', url: 'https://www.college-optometrists.org/clinical-guidance/clinical-management-guidelines/microbialkeratitis_bacterial_fungal', kind: 'guideline' },
  bhaktapur: { cite: 'Upadhyay et al., Bhaktapur Eye Study, Br J Ophthalmol 2001: no ulcers when antibiotic ointment started within 18 h of a corneal abrasion', url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Bhaktapur+eye+study+corneal+ulceration+antibiotic+prophylaxis', kind: 'trial' },
  madurai: { cite: 'Srinivasan et al., corneal ulceration in Madurai, south India, Br J Ophthalmol 1997;81:965-71: mostly after agricultural injury, often fungal', url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Srinivasan+1997+corneal+ulceration+Madurai', kind: 'study' },
  nice_ng82: { cite: 'NICE NG82 (AMD) 1.2: refer suspected wet active AMD urgently to a macula service, normally within 1 working day; not an emergency', url: 'https://www.nice.org.uk/guidance/ng82/chapter/recommendations', kind: 'guideline' },
  nice_ng12: { cite: 'NICE NG12 (suspected cancer) 1.12.2: urgent referral (appointment within 2 weeks) for a child with an absent red reflex', url: 'https://www.nice.org.uk/guidance/ng12', kind: 'guideline' },
  nice_ng127: { cite: 'NICE NG127 (suspected neurological conditions): new squint with loss of red reflex, or with headache, vomiting or unsteadiness, refer immediately; other squints to ophthalmology', url: 'https://www.nice.org.uk/guidance/ng127', kind: 'guideline' },
  neuro_diplopia: { cite: 'Neuro-ophthalmology teaching (e.g. EyeWiki, third nerve palsy): new double vision with headache, a droopy lid or other neurological signs can be an aneurysm or stroke', url: 'https://eyewiki.org/index.php?search=third+nerve+palsy', kind: 'clinical consensus' },
  who_vi: { cite: 'WHO / ICD-11 visual impairment categories: moderate worse than 6/18, severe worse than 6/60', url: 'https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment', kind: 'classification' },
  pinhole: { cite: 'Pinhole test: reduced vision that a pinhole does not improve points to disease, not refractive error', url: 'https://eyewiki.org/index.php?search=pinhole+visual+acuity', kind: 'clinical consensus' },
  ico_dr: { cite: 'ICO Guidelines for Diabetic Eye Care (2017): retinal examination at diagnosis of type 2 diabetes, then every year', url: 'https://icoph.org/?s=diabetic+eye+care+guidelines', kind: 'guideline' },
  ico_glaucoma: { cite: 'ICO Guidelines for Glaucoma Eye Care (2016): first-degree relatives are at higher risk; examine from 40', url: 'https://icoph.org/?s=glaucoma+eye+care+guidelines', kind: 'guideline' },
  amblyopia: { cite: 'Amblyopia responds best to treatment in early childhood (PEDIG studies; NICE CKS amblyopia)', url: 'https://eyewiki.org/index.php?search=amblyopia', kind: 'clinical consensus' },
  npc: { cite: 'Convergence insufficiency: near point of convergence break beyond 6 cm (under 40) or 10 cm (40 and over) is receded (EyeWiki; CITT used 6 cm)', url: 'https://eyewiki.org/Convergence_Insufficiency', kind: 'clinical consensus' },
  pelli: { cite: 'Pelli-Robson norms: about 1.65-1.95 log CS in healthy adults; below 1.5 is reduced (Mantyjarvi & Laitinen, J Cataract Refract Surg 2001)', url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Mantyjarvi+Laitinen+normal+values+Pelli-Robson', kind: 'study' },
  refraction: { cite: 'High refractive error and anisometropia: annual review; amblyopia risk in children', url: 'https://eyewiki.org/index.php?search=anisometropia', kind: 'clinical consensus' },
};

// Patient-facing need, translated in every language pack (passport.need.<key>).
// Many rules share one plain-language need.

// ---------------------------------------------------------------- context
// Everything the rules look at, computed once.
export function context(a = {}, m = {}, extras = {}) {
  const age = num(a.age);
  const isChild = age !== null && age < 16;
  const pseudophakic = a.eye_surgery === 'cataract';
  const acuity = m.acuity || {};
  const eyes = ['R', 'L'];
  const presenting = (e) => num(acuity[e]?.logmar);
  // pinhole result is the best phone proxy for corrected vision
  const corrected = (e) => {
    const p = presenting(e);
    const ph = num(acuity[e]?.pinholeLogmar);
    if (p === null) return null;
    return ph === null ? p : Math.min(p, ph);
  };
  const worst = (f) => { const v = eyes.map(f).filter((x) => x !== null); return v.length ? Math.max(...v) : null; };
  const pinholeFailed = eyes.some((e) => presenting(e) >= 0.5 && acuity[e]?.pinholeImproved === false);
  const red = a.rf_red === true;
  const rd = red ? a.rf_red_detail || [] : [];
  const injury = a.rf_injury === true ? a.rf_injury_type || [] : [];
  const contrast = eyes.map((e) => num(m.contrast?.[e]?.logCS)).filter((x) => x !== null);
  const contrastMin = contrast.length ? Math.min(...contrast) : null;
  const amslerAbnormal = Boolean(m.amsler && (m.amsler.R === 'abnormal' || m.amsler.L === 'abnormal'));
  const cataractSigns = [];
  if (age !== null && age >= 50 && !pseudophakic) {
    if (a.night_glare === true) cataractSigns.push('night glare or faded colours');
    if (a.frequent_change === true) cataractSigns.push('glasses power changing often');
    if (pinholeFailed) cataractSigns.push('reduced vision not improved by pinhole');
    if (contrastMin !== null && contrastMin < 1.35) cataractSigns.push(`reduced contrast sensitivity (${contrastMin.toFixed(2)} log CS)`);
  }
  return {
    a, m, age, isChild, pseudophakic, red, rd, injury,
    pain: red && (has(rd, 'pain') || has(rd, 'photo')),
    redBlur: red && has(rd, 'blur'),
    diabetic: has(a.conditions, 'diabetes'),
    worstPresenting: worst(presenting),
    worstCorrected: worst(corrected),
    pinholeFailed, contrastMin, amslerAbnormal, cataractSigns,
    rxFindings: extras.rxFindings || [],
  };
}

const eyesWith = (m, key, val) => ['R', 'L'].filter((e) => m[key]?.[e] === val).join(' & ');
const snellen6 = (lm) => (lm === null ? '?' : `6/${Math.round(6 * 10 ** lm)}`);

// ---------------------------------------------------------------- the rules
// test(x) returns false, true, or a detail string. answersOnly rules can be
// decided from the interview alone (used to shorten an emergency interview).
export const RULES = [
  // ======================= EMERGENCY: same day
  {
    code: 'CHEMICAL_INJURY', tier: 'emergency', answersOnly: true, need: 'injury', ref: 'cop_cmg',
    title: 'Chemical in the eye',
    criteria: 'Injury type: chemical (lime/chuna, acid, cleaning liquid, battery fluid, Holi colour)',
    action: 'Rinse with clean running water for at least 15 minutes NOW, then eye casualty today. Do not wait for the review.',
    within: 'now, then same day',
    test: (x) => has(x.injury, 'chemical'),
  },
  {
    code: 'PENETRATING_INJURY', tier: 'emergency', answersOnly: true, need: 'injury', ref: 'cop_annex4',
    title: 'High-speed or sharp object injury',
    criteria: 'Injury type: chip from hammering, grinding or drilling, or a sharp object',
    action: 'Do not press or rub. Tape a paper cup over the eye. Eye casualty today; a metal chip can be inside the eye with little pain.',
    within: 'same day',
    test: (x) => has(x.injury, 'sharp'),
  },
  {
    code: 'BLUNT_INJURY_VISION', tier: 'emergency', answersOnly: true, need: 'injury', ref: 'cop_annex4',
    title: 'Blow to the eye with reduced vision',
    criteria: 'Injury type: a hit (ball, fist, stick) AND sight has dropped or is blurred',
    action: 'Eye casualty today (bleeding inside the eye or a ruptured globe must be ruled out).',
    within: 'same day',
    test: (x) => has(x.injury, 'blunt') && (x.a.rf_vision_drop === true || x.redBlur),
  },
  {
    code: 'RETINAL_DETACHMENT_SIGNS', tier: 'emergency', answersOnly: true, need: 'retina_today', ref: 'cop_flashes',
    title: 'Possible retinal detachment',
    criteria: 'A shadow or curtain that does not go away, OR new flashes/floaters together with a sudden drop in sight',
    action: 'Eye hospital today. Avoid heavy lifting on the way.',
    within: 'same day',
    test: (x) => {
      if (x.a.rf_curtain === true) return 'Persistent shadow or curtain in the vision.';
      if (x.a.rf_flashes === true && x.a.rf_vision_drop === true) return 'New flashes or floaters with a sudden drop in sight.';
      return false;
    },
  },
  {
    code: 'SUDDEN_LOSS_RECENT', tier: 'emergency', answersOnly: true, need: 'sudden_today', ref: 'cop_annex4',
    title: 'Sudden loss of vision in the last 2 days',
    criteria: 'Sight dropped suddenly (minutes to days, not months) AND it started today or yesterday. If the start was not recorded it is treated as recent.',
    action: 'Eye hospital today: a blocked blood vessel, detachment or optic-nerve problem is time-critical.',
    within: 'same day',
    unless: ['RETINAL_DETACHMENT_SIGNS', 'BLUNT_INJURY_VISION'],
    test: (x, final) => x.a.rf_vision_drop === true && (x.a.rf_onset === 'lt2d' || (final && x.a.rf_onset == null)),
  },
  {
    code: 'ANGLE_CLOSURE_SIGNS', tier: 'emergency', answersOnly: true, need: 'red_eye_today', ref: 'cop_annex4',
    title: 'Possible acute angle-closure glaucoma',
    criteria: 'Red eye with real pain AND either coloured rings around lights, or headache/vomiting together with blurred sight',
    action: 'Eye hospital today: pressure inside the eye can blind within hours. No eye drops from the shop.',
    within: 'same day',
    test: (x) => x.red && has(x.rd, 'pain') && (has(x.rd, 'haloes') || (has(x.rd, 'vomit') && has(x.rd, 'blur'))),
  },
  {
    code: 'CONTACT_LENS_KERATITIS', tier: 'emergency', answersOnly: true, need: 'red_eye_today', ref: 'cop_keratitis',
    title: 'Contact-lens wearer with a painful or blurred red eye',
    criteria: 'Wears contact lenses AND red eye with pain, light sensitivity or blur',
    action: 'Remove the lenses, keep them and the case for the doctor, eye hospital today (possible corneal infection).',
    within: 'same day',
    test: (x) => x.red && has(x.rd, 'cl') && (has(x.rd, 'pain') || has(x.rd, 'photo') || has(x.rd, 'blur')),
  },
  {
    code: 'DIPLOPIA_NEURO', tier: 'emergency', answersOnly: true, need: 'double_today', ref: 'neuro_diplopia',
    title: 'New double vision with neurological signs',
    criteria: 'New double vision that is not monocular (does not stay with one eye covered) AND new severe headache, droopy eyelid, weakness, numbness or trouble speaking',
    action: 'Hospital emergency today (possible aneurysm or stroke). Do not let the patient drive.',
    within: 'same day',
    test: (x) => x.a.rf_double === true && x.a.rf_double_cover !== 'stays' && x.a.rf_double_neuro === true,
  },
  {
    code: 'CHILD_SQUINT_NEURO', tier: 'emergency', answersOnly: true, need: 'child_today', ref: 'nice_ng127',
    title: 'Squint in a child with headache, vomiting or unsteadiness',
    criteria: 'Child with a squint AND headaches, vomiting or unsteady walking',
    action: 'Children’s hospital emergency today (raised pressure in the head must be ruled out).',
    within: 'same day',
    test: (x) => x.isChild && x.a.child_squint === true && x.a.child_neuro === true,
  },
  {
    code: 'LEUKOCORIA_WITH_SQUINT', tier: 'emergency', answersOnly: true, need: 'child_today', ref: 'nice_ng127',
    title: 'White pupil glow with a squint in a child',
    criteria: 'Child with a white glow in the pupil AND a squint',
    action: 'Paediatric ophthalmology today or as an immediate referral.',
    within: 'same day',
    test: (x) => x.isChild && x.a.child_white === true && x.a.child_squint === true,
  },

  // ======================= URGENT: 18 hours to 2 weeks
  {
    code: 'CORNEAL_SCRATCH', tier: 'urgent', need: 'scratch', ref: 'bhaktapur',
    title: 'Scratch on the eye (leaf, crop, branch, nail, dust)',
    criteria: 'Injury type: scratch, and no chemical or sharp-object injury',
    action: 'Antibiotic eye ointment within 18 hours from the vision centre or PHC. No steroid drops, no home remedies (risk of a fungal ulcer after crop injuries).',
    within: 'within 18 hours',
    unless: ['CHEMICAL_INJURY', 'PENETRATING_INJURY'],
    test: (x) => has(x.injury, 'scratch'),
    also: 'madurai',
  },
  {
    code: 'BLUNT_INJURY', tier: 'urgent', need: 'injury_check', ref: 'cop_annex4',
    title: 'Blow to the eye, vision normal',
    criteria: 'Injury type: a hit, and sight has not dropped',
    action: 'Optometrist or eye doctor within 24 hours; same day if vision drops, pain grows or a red level appears in the eye.',
    within: 'within 24 hours',
    unless: ['BLUNT_INJURY_VISION', 'CHEMICAL_INJURY', 'PENETRATING_INJURY'],
    test: (x) => has(x.injury, 'blunt'),
  },
  {
    code: 'FLASHES_FLOATERS', tier: 'urgent', need: 'retina_check', ref: 'cop_flashes',
    title: 'New flashes or floaters, no curtain, sight unchanged',
    criteria: 'NEW flashes or a shower of new floaters in the last few weeks, no curtain, no sudden drop in sight',
    action: 'Dilated retina examination within 24 hours. Go the same day if a curtain appears or sight drops.',
    within: 'within 24 hours',
    unless: ['RETINAL_DETACHMENT_SIGNS'],
    test: (x) => x.a.rf_flashes === true,
    also: 'pvd_pathway',
  },
  {
    code: 'SUDDEN_LOSS_SUBACUTE', tier: 'urgent', need: 'sudden_check', ref: 'cop_annex4',
    title: 'Sudden drop in sight 3 to 14 days ago',
    criteria: 'Sight dropped suddenly AND it started 3 to 14 days ago',
    action: 'Eye doctor within 24-48 hours.',
    within: 'within 48 hours',
    unless: ['RETINAL_DETACHMENT_SIGNS', 'BLUNT_INJURY_VISION'],
    test: (x) => x.a.rf_vision_drop === true && x.a.rf_onset === 'lt2w',
  },
  {
    code: 'DIPLOPIA_NEW', tier: 'urgent', need: 'double_check', ref: 'neuro_diplopia',
    title: 'New double vision (both eyes), no neurological signs',
    criteria: 'New double vision that goes away when either eye is covered (or not sure), and no headache, droopy lid, weakness or speech problem',
    action: 'Eye doctor within 24-48 hours; check blood pressure and sugar (nerve palsies are common in diabetes). Same day if a headache or droopy lid starts. No driving meanwhile.',
    within: 'within 48 hours',
    unless: ['DIPLOPIA_NEURO'],
    test: (x) => x.a.rf_double === true && x.a.rf_double_cover !== 'stays',
  },
  {
    code: 'PAINFUL_RED_EYE_BLUR', tier: 'urgent', need: 'red_eye_check', ref: 'cop_keratitis',
    title: 'Painful red eye with blurred sight',
    criteria: 'Red eye with pain or light sensitivity AND blurred sight (no haloes or vomiting, no contact lenses)',
    action: 'Eye doctor within 24 hours (keratitis or iritis). No steroid drops from the shop.',
    within: 'within 24 hours',
    unless: ['ANGLE_CLOSURE_SIGNS', 'CONTACT_LENS_KERATITIS'],
    test: (x) => x.pain && x.redBlur,
  },
  {
    code: 'PAINFUL_RED_EYE', tier: 'urgent', need: 'red_eye_check', ref: 'cop_annex4',
    title: 'Painful red eye, sight normal',
    criteria: 'Red eye with real pain or light sensitivity, sight not blurred',
    action: 'Optometrist or eye doctor within 48 hours; sooner if sight blurs.',
    within: 'within 48 hours',
    unless: ['ANGLE_CLOSURE_SIGNS', 'CONTACT_LENS_KERATITIS', 'PAINFUL_RED_EYE_BLUR'],
    test: (x) => x.pain && !x.redBlur,
  },
  {
    code: 'MACULA_NEW', tier: 'urgent', need: 'macula', ref: 'nice_ng82',
    title: 'New distortion on the Amsler grid',
    criteria: 'Wavy, broken or missing lines AND new (or not sure, age 50+)',
    action: 'Macula assessment (OCT or retinal exam) within 1 working day; wet AMD treatment works best early.',
    within: 'within 1 working day',
    test: (x) => {
      if (!x.amslerAbnormal) return false;
      const onset = x.m.amsler.onset;
      if (onset === 'new' || (onset !== 'old' && x.age !== null && x.age >= 50)) {
        return `Eye: ${eyesWith(x.m, 'amsler', 'abnormal')}; ${onset === 'new' ? 'noticed recently' : 'onset not known, age 50+'}. Possible wet AMD or macular oedema.`;
      }
      return false;
    },
  },
  {
    code: 'LEUKOCORIA', tier: 'urgent', need: 'child_eye', ref: 'nice_ng12',
    title: 'White pupil glow in a child',
    criteria: 'Child with a white glow in the pupil (seen in person or in a photo), no squint',
    action: 'Paediatric ophthalmology within 2 weeks (childhood cataract or retinoblastoma). Phone the hospital to confirm the date.',
    within: 'within 2 weeks',
    unless: ['LEUKOCORIA_WITH_SQUINT'],
    test: (x) => x.isChild && x.a.child_white === true,
  },

  // ======================= SOON: 2 to 6 weeks
  {
    code: 'SUDDEN_LOSS_OLD', tier: 'soon', need: 'full_exam', ref: 'cop_annex4',
    title: 'Sudden drop in sight more than 2 weeks ago',
    criteria: 'Sight dropped suddenly AND it started more than 2 weeks ago',
    action: 'Full eye examination within 1-2 weeks (old vein occlusion, bleed or macular problem).',
    within: 'within 2 weeks',
    unless: ['RETINAL_DETACHMENT_SIGNS', 'BLUNT_INJURY_VISION'],
    test: (x) => x.a.rf_vision_drop === true && x.a.rf_onset === 'gt2w',
  },
  {
    code: 'CHILD_SQUINT', tier: 'soon', need: 'squint', ref: 'nice_ng127',
    title: 'Squint or head tilt in a child',
    criteria: 'Child whose eye turns in or out, or who tilts the head or closes one eye, with no headache, vomiting or white glow',
    action: 'Paediatric optometrist or ophthalmologist within 4-6 weeks: lazy eye responds best when treated young.',
    within: 'within 6 weeks',
    unless: ['CHILD_SQUINT_NEURO', 'LEUKOCORIA_WITH_SQUINT'],
    test: (x) => x.isChild && x.a.child_squint === true,
    also: 'amblyopia',
  },
  {
    code: 'CHILD_REFRACTION', tier: 'soon', need: 'child_refraction', ref: 'amblyopia',
    title: 'Child likely needs glasses',
    criteria: 'Child with trouble seeing the school board, or vision worse than 6/9 in either eye',
    action: 'Cycloplegic refraction (with drops) by an optometrist; phone estimates are not safe for children.',
    within: 'within 6 weeks',
    test: (x) => {
      if (!x.isChild) return false;
      if (x.a.child_board === true) return 'Trouble seeing the school board.';
      if (x.worstPresenting !== null && x.worstPresenting > 0.2) return `Vision ${snellen6(x.worstPresenting)} in the weaker eye.`;
      return false;
    },
  },
  {
    code: 'SEVERE_VI', tier: 'soon', need: 'full_exam', ref: 'who_vi',
    title: 'Vision worse than 6/60 in an eye',
    criteria: 'Best phone-measured vision (with pinhole) worse than 6/60 in either eye',
    action: 'Full eye examination within 2-4 weeks; most often cataract in this age group.',
    within: 'within 4 weeks',
    test: (x) => x.worstCorrected !== null && x.worstCorrected > 1.0 && `Best vision ${snellen6(x.worstCorrected)} in the weaker eye.`,
  },
  {
    code: 'CATARACT_OPERABLE', tier: 'soon', need: 'cataract', ref: 'who_vi',
    title: 'Possible cataract affecting vision',
    criteria: 'Age 50+, no cataract surgery, a cataract sign (night glare, power changing, pinhole fails, low contrast) AND best vision 6/18 or worse',
    action: 'Cataract assessment at the next camp or vision centre; surgery restores sight better than new glasses.',
    within: 'within 6 weeks',
    test: (x) => x.cataractSigns.length > 0 && x.worstCorrected !== null && x.worstCorrected >= 0.48
      && `${x.cataractSigns.join('; ')}; best vision ${snellen6(x.worstCorrected)}.`,
  },
  {
    code: 'VA_UNEXPLAINED', tier: 'soon', need: 'full_exam', ref: 'pinhole',
    title: 'Reduced vision not explained by glasses',
    criteria: 'Vision 6/18 or worse that a pinhole does not improve, and no cataract signs at 50+',
    action: 'Optometrist or ophthalmologist examination within 4 weeks.',
    within: 'within 4 weeks',
    unless: ['CATARACT_OPERABLE'],
    test: (x) => x.pinholeFailed && !(x.age >= 50 && x.cataractSigns.length > 0),
  },
  {
    code: 'MACULA_OLD', tier: 'soon', need: 'macula_check', ref: 'nice_ng82',
    title: 'Long-standing distortion on the Amsler grid',
    criteria: 'Wavy, broken or missing lines that the patient says have been there a long time (or not sure, under 50)',
    action: 'Retina examination within 2-4 weeks; urgent if it changes.',
    within: 'within 4 weeks',
    unless: ['MACULA_NEW'],
    test: (x) => x.amslerAbnormal && `Eye: ${eyesWith(x.m, 'amsler', 'abnormal')}.`,
  },
  {
    code: 'DIABETES_RETINA_OVERDUE', tier: 'soon', need: 'diabetes', ref: 'ico_dr',
    title: 'Diabetes, retina never checked, 5+ years',
    criteria: 'Diabetes AND never had a dilated retina check AND diabetes for 5 years or more (or vision 6/12 or worse)',
    action: 'Dilated retina examination or retinal photo within 4-6 weeks.',
    within: 'within 6 weeks',
    test: (x) => {
      if (!x.diabetic || x.a.retina_exam !== 'never') return false;
      const yrs = num(x.a.diabetes_years);
      if (yrs !== null && yrs >= 5) return `${yrs} years of diabetes, never checked.`;
      if (x.worstCorrected !== null && x.worstCorrected >= 0.3) return `Never checked; vision ${snellen6(x.worstCorrected)}.`;
      return false;
    },
  },
  {
    code: 'CONTRAST_MARKED', tier: 'soon', need: 'full_exam', ref: 'pelli',
    title: 'Markedly reduced contrast sensitivity',
    criteria: 'Contrast below 1.0 log CS in an eye, not already explained by a cataract finding',
    action: 'Full eye examination within 4 weeks (cataract, glaucoma, optic nerve or retina).',
    within: 'within 4 weeks',
    unless: ['CATARACT_OPERABLE'],
    test: (x) => x.contrastMin !== null && x.contrastMin < 1.0 && `${x.contrastMin.toFixed(2)} log CS (healthy adults about 1.65-1.95).`,
  },
  {
    code: 'CHILD_ANISOMETROPIA', tier: 'soon', need: 'child_refraction', ref: 'refraction',
    title: 'Large difference between the eyes in a child',
    criteria: 'Child AND 2.00 D or more difference in spherical equivalent between the eyes',
    action: 'Optometrist within 4-6 weeks: amblyopia check.',
    within: 'within 6 weeks',
    test: (x) => x.isChild && x.rxFindings.some((f) => f.code === 'ANISOMETROPIA'),
  },

  // ======================= ROUTINE: next camp / within 3 months, glasses can proceed
  {
    code: 'CATARACT_EARLY', tier: 'routine', need: 'cataract', ref: 'who_vi',
    title: 'Early cataract signs, vision still useful',
    criteria: 'Age 50+, a cataract sign, best vision better than 6/18',
    action: 'Cataract check at the next camp; glasses can still help now.',
    within: 'next camp',
    unless: ['CATARACT_OPERABLE'],
    test: (x) => x.cataractSigns.length > 0 && `${x.cataractSigns.join('; ')}.`,
  },
  {
    code: 'DIABETES_RETINA_DUE', tier: 'routine', need: 'diabetes', ref: 'ico_dr',
    title: 'Diabetic retina check due',
    criteria: 'Diabetes AND last dilated retina check more than a year ago (or never, under 5 years)',
    action: 'Yearly dilated retina check or retinal photo at the next camp or vision centre.',
    within: 'next camp',
    unless: ['DIABETES_RETINA_OVERDUE'],
    test: (x) => x.diabetic && x.a.retina_exam && x.a.retina_exam !== 'within_1y'
      && `Last check: ${x.a.retina_exam === 'never' ? 'never' : 'over a year ago'}${num(x.a.diabetes_years) !== null ? `; ${x.a.diabetes_years} years of diabetes` : ''}.`,
  },
  {
    code: 'GLAUCOMA_FAMILY', tier: 'routine', need: 'glaucoma', ref: 'ico_glaucoma',
    title: 'Glaucoma in a parent, brother or sister, age 40+',
    criteria: 'First-degree relative with glaucoma AND age 40 or over',
    action: 'Eye pressure and optic-nerve check at the next camp or vision centre.',
    within: 'next camp',
    test: (x) => x.a.glaucoma_family === true && x.age !== null && x.age >= 40,
  },
  {
    code: 'UNSTABLE_POWER', tier: 'routine', need: 'full_exam', ref: 'cop_cmg',
    title: 'Glasses power changing often',
    criteria: 'Needed new glasses more than once in 2 years, no cataract finding',
    action: 'Check sugar control and keratoconus before a new prescription.',
    within: 'before the next prescription',
    unless: ['CATARACT_OPERABLE', 'CATARACT_EARLY'],
    test: (x) => x.a.frequent_change === true,
  },
  {
    code: 'CONTRAST_REDUCED', tier: 'routine', need: 'full_exam', ref: 'pelli',
    title: 'Reduced contrast sensitivity',
    criteria: 'Contrast 1.0-1.35 log CS in an eye, not explained by a cataract finding',
    action: 'Full eye examination at the next visit.',
    within: 'next camp',
    unless: ['CONTRAST_MARKED', 'CATARACT_OPERABLE', 'CATARACT_EARLY'],
    test: (x) => x.contrastMin !== null && x.contrastMin < 1.35 && `${x.contrastMin.toFixed(2)} log CS.`,
  },
  {
    code: 'CONVERGENCE_RECEDED', tier: 'routine', need: 'binocular', ref: 'npc',
    title: 'Eyes do not team well up close (receded convergence)',
    criteria: 'Near point of convergence beyond 6 cm (under 40) or 10 cm (40+)',
    action: 'Binocular vision assessment; eye exercises often help. Explains strain with close work.',
    within: 'next visit',
    test: (x) => {
      const cm = num(x.m.npc?.cm);
      if (cm === null) return false;
      const limit = x.age !== null && x.age >= 40 ? 10 : 6;
      return cm > limit && `Breaks at ${Math.round(cm)} cm (limit ${limit} cm for this age).`;
    },
  },
  {
    code: 'MONOCULAR_DIPLOPIA', tier: 'routine', need: 'full_exam', ref: 'neuro_diplopia',
    title: 'Double vision in one eye only',
    criteria: 'Double vision that stays when the other eye is covered',
    action: 'Optometrist: usually cataract, astigmatism or dry eye, not a nerve problem.',
    within: 'next visit',
    test: (x) => x.a.rf_double === true && x.a.rf_double_cover === 'stays',
  },
  {
    code: 'RED_EYE_MILD', tier: 'routine', need: 'red_eye_mild', ref: 'cop_cmg',
    title: 'Red eye without pain or blur',
    criteria: 'Red eye with only itching, sticky discharge or nothing else; no pain, light sensitivity, blur or contact lenses',
    action: 'Usually conjunctivitis or dry eye: wash hands, do not share towels. Optometrist if not better in 7 days; same day if pain or blur starts.',
    within: 'if not better in 7 days',
    test: (x) => x.red && !x.pain && !x.redBlur && !has(x.rd, 'cl') && !has(x.rd, 'haloes'),
  },
  {
    code: 'PROGRESSIVE_INTOLERANCE', tier: 'routine', need: 'fitting', ref: 'cop_cmg',
    title: 'Discomfort with current progressives',
    criteria: 'Wears progressives AND reports headaches or discomfort',
    action: 'Check centration (PD, fitting height) before changing the lens.',
    within: 'at dispensing',
    test: (x) => x.a.glasses_type === 'progressive' && x.a.glasses_ok === 'discomfort',
  },
  {
    code: 'ANISOMETROPIA', tier: 'routine', need: 'full_exam', ref: 'refraction',
    title: 'Large difference between the eyes',
    criteria: 'Adult with 2.00 D or more difference in spherical equivalent',
    action: 'Optometrist review of the prescription and lens choice.',
    within: 'next visit',
    unless: ['CHILD_ANISOMETROPIA'],
    test: (x) => { const f = x.rxFindings.find((r) => r.code === 'ANISOMETROPIA'); return Boolean(f) && `${f.diff.toFixed(2)} D difference.`; },
  },
  {
    code: 'HIGH_MYOPIA', tier: 'routine', need: 'retina_yearly', ref: 'refraction',
    title: 'High myopia',
    criteria: 'Spherical equivalent -6.00 D or more',
    action: 'Yearly retina check (higher risk of detachment and glaucoma); explain flashes/curtain warning signs.',
    within: 'yearly',
    test: (x) => { const f = x.rxFindings.filter((r) => r.code === 'HIGH_MYOPIA'); return f.length > 0 && f.map((r) => `${r.eye} ${r.se.toFixed(2)} D`).join(', '); },
  },
  {
    code: 'HIGH_HYPEROPIA', tier: 'routine', need: 'full_exam', ref: 'refraction',
    title: 'High hyperopia',
    criteria: 'Spherical equivalent +5.00 D or more',
    action: 'Optometrist review (narrow-angle risk in adults, amblyopia risk in children).',
    within: 'next visit',
    test: (x) => { const f = x.rxFindings.filter((r) => r.code === 'HIGH_HYPEROPIA'); return f.length > 0 && f.map((r) => `${r.eye} +${r.se.toFixed(2)} D`).join(', '); },
  },
  {
    code: 'HIGH_ASTIGMATISM', tier: 'routine', need: 'full_exam', ref: 'refraction',
    title: 'High astigmatism',
    criteria: 'Cylinder 3.00 D or more',
    action: 'Optometrist review; corneal topography if available (keratoconus).',
    within: 'next visit',
    test: (x) => { const f = x.rxFindings.filter((r) => r.code === 'HIGH_ASTIGMATISM'); return f.length > 0 && f.map((r) => `${r.eye} ${r.cyl} D`).join(', '); },
  },

  // ======================= INFO: for the record
  {
    code: 'COLOUR_VISION', tier: 'info', need: 'colour', ref: 'cop_cmg',
    title: 'Possible red-green colour vision difference',
    criteria: '2 or more number plates misread on the colour test',
    action: 'Usually inherited and harmless; tell the patient (driving, electrical and some jobs). Refer only if it is new or in one eye.',
    within: 'no referral',
    test: (x) => x.m.colour?.result === 'possible_rg' && `${x.m.colour.correct} of ${x.m.colour.plates} plates read correctly (phone screen, not calibrated).`,
  },
];

export const RULE_BY_CODE = Object.fromEntries(RULES.map((r) => [r.code, r]));

// What is deliberately NOT scored as a red flag, and why. Shown next to the
// rules so operators and reviewers see both sides.
export const NOT_FLAGGED = [
  { what: 'Floaters that have been there for months or years and have not changed', why: 'Old, stable floaters are usually harmless vitreous changes; only NEW flashes or a shower of NEW floaters are flagged.' },
  { what: 'Blur that came on slowly over months', why: 'Gradual blur is glasses or cataract: handled by the vision tests and routine referral, not as an emergency.' },
  { what: 'Itchy, watery, gritty or burning eyes without pain or blur', why: 'Allergy, dry eye or mild conjunctivitis: advice, and an optometrist only if not better in a week.' },
  { what: 'A squint in an adult that has been there since childhood', why: 'Long-standing, not new; recorded for the optometrist.' },
  { what: 'Headache or tired eyes after long close or screen work, sight otherwise normal', why: 'Usually an uncorrected near or intermediate power: fixed by the right glasses and breaks.' },
  { what: 'Haloes around lights at night without pain or redness', why: 'Usually cataract or uncorrected power: routine, unless the eye is red and painful.' },
  { what: 'Known cataract with slowly falling vision', why: 'Routine or soon cataract referral depending on vision, not same-day.' },
  { what: 'Colour vision difference since birth', why: 'Inherited and stable: information for the patient, not a referral.' },
];

// ---------------------------------------------------------------- evaluate
// Returns { lane, urgency, within, reviewWithinHours, flags }.
// `final` = the interview is over, so missing answers are treated safely
// (e.g. an unrecorded onset of sudden vision loss counts as recent).
// ---------------------------------------------------------------- hub edits
// The reviewing optometrists can change a rule's tier, time to care and action,
// or switch it off, from the portal, with a reason (every edit is logged on the
// hub). Phones pull the edits and the engine applies them here. The clinical
// test itself is never editable, and an emergency rule cannot be switched off.
let HUB = { version: 0, rules: {} };
export function setRuleOverrides(o) {
  HUB = o && typeof o === 'object' && o.rules && typeof o.rules === 'object'
    ? { version: Number(o.version) || 0, rules: o.rules, updatedAt: o.updatedAt || null }
    : { version: 0, rules: {} };
}
export const ruleOverrides = () => HUB;
export function effectiveRule(r) {
  const o = HUB.rules[r.code];
  if (!o) return r;
  const tier = TIERS[o.tier] ? o.tier : r.tier;
  return {
    ...r,
    tier,
    within: o.within || (tier !== r.tier ? TIERS[tier].within : r.within),
    action: o.action || r.action,
    off: Boolean(o.off) && r.tier !== 'emergency',
    edited: { reason: o.reason || '', by: o.by || '', at: o.at || '', baseTier: r.tier, baseWithin: r.within, baseAction: r.action },
  };
}
export const effectiveRules = () => RULES.map(effectiveRule);

export function evaluate(a = {}, m = {}, extras = {}, { final = true, answersOnly = false } = {}) {
  const x = context(a, m, extras);
  const matched = new Map();
  for (const base of RULES) {
    const r = effectiveRule(base);
    if (r.off) continue;
    if (answersOnly && !r.answersOnly) continue;
    let res;
    try { res = r.test(x, final); } catch { res = false; }
    if (res) matched.set(r.code, { rule: r, detail: typeof res === 'string' ? res : '' });
  }
  for (const [code, { rule }] of [...matched]) {
    if (rule.unless?.some((u) => matched.has(u))) matched.delete(code);
  }
  const flags = [...matched.values()].map(({ rule, detail }) => ({
    code: rule.code,
    tier: rule.tier,
    lane: TIERS[rule.tier].lane,
    title: rule.title,
    detail: detail || rule.criteria,
    criteria: rule.criteria,
    action: rule.action,
    within: rule.within,
    need: rule.need,
    ref: rule.ref,
    refs: [rule.ref, rule.also].filter(Boolean),
    ...(rule.edited ? { edited: true } : {}),
  }));
  flags.sort((p, q) => TIERS[q.tier].rank - TIERS[p.tier].rank);
  const top = flags[0];
  const urgency = top ? top.tier : 'none';
  const lane = top ? top.lane : 'green';
  const reviewWithinHours = top ? Math.min(...flags.map((f) => TIERS[f.tier].reviewHours)) : 72;
  return { lane, urgency, within: top ? top.within : null, reviewWithinHours, flags };
}

// Emergency findings decidable from the interview so far: switches the
// interview to urgent mode. Uses only explicit answers.
export const emergencyFromAnswers = (a) => evaluate(a, {}, {}, { final: false, answersOnly: true }).flags.filter((f) => f.tier === 'emergency');
