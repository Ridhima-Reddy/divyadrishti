// ZEISS lens options to discuss, from the vision profile and the patient's own
// answers. Suggestions for the conversation at the counter, never a
// prescription: the optometrist confirms the power and the lens.
const LENS = {
  progressive: [{ name: 'ZEISS SmartLife Progressive', why: 'Near, arm’s length and distance in one lens, for a day that moves between the phone, the counter and the road.' }],
  office: [{ name: 'ZEISS Officelens', why: 'Wide zones for near and arm’s-length work such as screens, sewing or the counter. Not for driving.' }],
  bifocal: [{ name: 'ZEISS SmartLife Progressive', why: 'An upgrade from a bifocal: no line, and a clear arm’s-length zone. Offer it if the budget allows.' }],
  readers: [{ name: 'ZEISS SmartLife Single Vision', why: 'A single-vision lens set for the patient’s measured reading distance.' }],
  sv_distance: [
    { name: 'ZEISS SmartLife Single Vision', why: 'Everyday single-vision lens for distance.' },
    { name: 'ZEISS ClearView Single Vision', why: 'Flatter and thinner, with clear vision towards the edges.' },
  ],
  separate_pairs: [{ name: 'ZEISS SmartLife Single Vision (two pairs)', why: 'Separate distance and reading pairs: safer on steps for an older patient.' }],
};

export function zeissOptions({ category, age = null, answers = {} } = {}) {
  if (!category || category === 'urgent_referral') return { lenses: [], coatings: [], note: 'Referral first: no lens until the eye has been examined.' };
  const a = answers || {};
  const child = age != null && age < 16;
  const screens = (Number(a.screen_hours) || 0) >= 3 || a.occupation === 'office';
  const nightDrive = a.night_glare === true || a.drives === true || a.occupation === 'driver';
  const outdoors = (Number(a.outdoor_hours) || 0) >= 3 || ['farmer', 'fisher', 'driver', 'manual'].includes(a.occupation);
  const lenses = [...(LENS[category] || [])];
  if (child || category === 'child_refraction') lenses.unshift({ name: 'ZEISS MyoCare', why: 'Designed for myopia management in children. Discuss after the cycloplegic refraction.' });
  if (nightDrive && !child) lenses.push({ name: 'ZEISS DriveSafe', why: 'Designed for driving, including at night when headlights dazzle.' });
  if (screens) lenses.push({ name: 'ZEISS BlueGuard', why: 'Filters part of the blue light from screens, in a clear lens.' });
  if (outdoors) lenses.push({ name: 'ZEISS PhotoFusion X', why: 'Photochromic: darkens outdoors in sunlight, clear indoors.' });
  const coatings = [{ name: 'ZEISS DuraVision Platinum UV', why: 'Anti-reflective, hard-wearing, with UV protection.' }];
  if (screens) coatings.push({ name: 'ZEISS DuraVision BlueProtect UV', why: 'Anti-reflective coating that reflects part of the blue light from screens.' });
  if (nightDrive && !child) coatings.push({ name: 'ZEISS DuraVision DriveSafe', why: 'Reduces reflections from headlights at night.' });
  const seen = new Set();
  return { lenses: lenses.filter((l) => !seen.has(l.name) && seen.add(l.name)).slice(0, 4), coatings, note: 'Suggestions to discuss with the patient; the optometrist confirms the power and the lens.' };
}

export const LENS_DESIGNS = { sv_distance: 'Single vision (distance)', readers: 'Single vision (reading)', progressive: 'Progressive', office: 'Office / near-variable', bifocal: 'Bifocal', separate_pairs: 'Two pairs (distance + reading)', child_refraction: 'Child lens (after refraction)' };
