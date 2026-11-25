// How often this person needs an eye check: a few questions about age, eye
// history, health and daily life, then the shortest interval any of them calls
// for, with the reasons in plain words. Intervals follow common optometry
// guidance (adults with no risks every 2 years; yearly from 60, with diabetes,
// glaucoma in the family from 40, or contact lenses; children who wear glasses
// every 6 months). A reminder, not a diagnosis: sudden changes are never "wait".

export const QUESTIONS = [
  { id: 'age', q: 'How old is the person these checkups are for?', type: 'one', opts: [['u6', 'Under 6'], ['6-17', '6 to 17'], ['18-39', '18 to 39'], ['40-59', '40 to 59'], ['60+', '60 or older']] },
  { id: 'wear', q: 'Do they wear glasses or contact lenses?', type: 'one', opts: [['none', 'Neither'], ['glasses', 'Glasses'], ['contacts', 'Contact lenses']] },
  { id: 'health', q: 'Any of these health conditions?', type: 'many', opts: [['diabetes', 'Diabetes (sugar)'], ['bp', 'High blood pressure'], ['thyroid', 'Thyroid problem'], ['none', 'None of these']] },
  { id: 'eyes', q: 'Any of these eye problems, now or before?', type: 'many', opts: [['glaucoma', 'Glaucoma'], ['macula', 'Macular degeneration'], ['cataract', 'Cataract or cataract surgery'], ['highpower', 'High power (above 6) or very thick glasses'], ['squint', 'Squint or lazy eye'], ['injury', 'An eye injury'], ['none', 'None of these']] },
  { id: 'family', q: 'Does a parent, brother or sister have glaucoma?', type: 'one', opts: [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']] },
  { id: 'screen', q: 'How many hours a day on phones, computers, reading or other close work?', type: 'one', opts: [['lt2', 'Less than 2'], ['2-6', '2 to 6'], ['6+', 'More than 6']] },
  { id: 'life', q: 'Which of these fit their day?', type: 'many', opts: [['drive', 'Drives or rides, also at night'], ['outdoor', 'Works outdoors in the sun'], ['fine', 'Fine close work (sewing, repairs, jewellery)'], ['none', 'None of these']] },
  { id: 'change', q: 'Has their sight changed in the last few months?', type: 'one', opts: [['no', 'No'], ['slow', 'Yes, slowly'], ['sudden', 'Yes, suddenly']] },
];

const has = (a, v) => Array.isArray(a) && a.includes(v);

// -> { months, dueNow, reasons: [{ months, text }], advice: [text], urgent }
export function plan(a) {
  const r = [];
  const add = (months, text) => r.push({ months, text });
  const child = a.age === 'u6' || a.age === '6-17';
  const over40 = a.age === '40-59' || a.age === '60+';

  if (a.age === 'u6') add(12, 'Young children: once a year, while the eyes are still developing.');
  else if (a.age === '6-17') add(12, 'School-age children: once a year; eyes change quickly while growing.');
  else if (a.age === '18-39') add(24, 'Adults under 40 with no risks: every 2 years.');
  else if (a.age === '40-59') add(24, 'From 40: every 2 years, with an eye-pressure check for glaucoma.');
  else if (a.age === '60+') add(12, 'From 60: every year, as cataract, glaucoma and macular changes become common.');

  if (a.wear === 'glasses' && child) add(6, 'Children who wear glasses: every 6 months, as the power can change quickly.');
  else if (a.wear === 'glasses') add(12, 'Glasses wearers: every year, so the power stays right.');
  if (a.wear === 'contacts') add(12, 'Contact lens wearers: every year, to check the lenses still suit the eye.');

  if (has(a.health, 'diabetes')) add(12, 'Diabetes: a retina check with eye drops every year, even when sight seems fine.');
  if (has(a.health, 'bp')) add(12, 'High blood pressure can affect the blood vessels at the back of the eye: every year.');
  if (has(a.health, 'thyroid')) add(12, 'Thyroid problems can affect the eyes and eyelids: every year.');

  if (has(a.eyes, 'glaucoma')) add(6, 'Glaucoma: follow the eye doctor’s plan, usually every 3 to 6 months.');
  if (has(a.eyes, 'macula')) add(6, 'Macular degeneration: every 6 months, and check the Amsler grid at home every week.');
  if (has(a.eyes, 'cataract')) add(12, 'Cataract, or after cataract surgery: every year.');
  if (has(a.eyes, 'highpower')) add(12, 'High power: a yearly check of the retina, which is thinner in very short-sighted eyes.');
  if (has(a.eyes, 'squint') && child) add(6, 'A child with a squint or lazy eye: every 6 months; treatment works best early.');
  else if (has(a.eyes, 'squint')) add(12, 'A squint or lazy eye: every year.');
  if (has(a.eyes, 'injury')) add(12, 'An eye injury in the past raises the risk of glaucoma later: every year.');

  if (a.family === 'yes' && over40) add(12, 'Glaucoma in the family: a yearly eye-pressure check from 40.');

  const advice = [];
  if (a.family === 'yes' && !over40) advice.push('Glaucoma runs in the family: from 40, check the eye pressure every year.');
  if (a.screen === '6+') advice.push('Long close work: every 20 minutes, look 20 feet (6 m) away for 20 seconds.');
  if (has(a.life, 'drive')) advice.push('Night driving: tell the optometrist about glare from headlights; an anti-reflection coating helps.');
  if (has(a.life, 'outdoor')) advice.push('Outdoor work: UV-protective sunglasses or lenses protect against cataract.');
  if (has(a.life, 'fine')) advice.push('Fine close work: good light, and from about 40, reading glasses for that distance.');
  if (child && a.screen !== 'lt2') advice.push('Children: at least 2 hours a day outdoors in daylight slows short sight.');

  const months = r.length ? Math.min(...r.map((x) => x.months)) : 24;
  const urgent = a.change === 'sudden';
  const dueNow = urgent || a.change === 'slow';
  return {
    months,
    dueNow,
    urgent,
    reasons: r.filter((x) => x.months === months).map((x) => x.text),
    others: r.filter((x) => x.months !== months).map((x) => x.text),
    advice,
  };
}

export const complete = (a) => Boolean(a) && QUESTIONS.every((q) => (q.type === 'many' ? Array.isArray(a[q.id]) && a[q.id].length : a[q.id]));
