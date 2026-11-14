// The anamnesis question bank. Every question carries:
//   when(s)   - clinical eligibility rule (the adaptive part: most questions are
//               only asked when their answer can change triage or the lens)
//   reason(s) - why it is being asked, shown to the operator and logged for
//               the reviewing optometrist
//   urgentOk  - still asked once a red flag has switched the session to urgent
// s = { a: answers, d: derived state from adaptive.derive() }
// English, Hindi and Tamil text live here; Telugu, Marathi and Kannada are
// merged in from js/lang/ packs at the bottom of this file. All drafted by the
// team, to be reviewed by native speakers at the pilot sites before use.
import { PACKS } from '../lang/index.js';

const YN = 'yesno';

const opt = (v, en, kw = [], extra = {}) => ({ v, label: { en }, kw, ...extra });

export const OCCUPATIONS = [
  opt('farmer', 'Farming', ['farm', 'farmer', 'farming', 'agriculture', 'field', 'fields', 'kisan', 'kheti', 'vivasayam']),
  opt('fisher', 'Fishing', ['fish', 'fisherman', 'fishing', 'boat']),
  opt('driver', 'Driving', ['driver', 'driving', 'auto', 'lorry', 'truck', 'taxi', 'bus driver']),
  opt('labour', 'Manual / construction', ['labour', 'labourer', 'labor', 'construction', 'mason', 'coolie', 'factory', 'majdoor']),
  opt('tailor', 'Tailoring / sewing', ['tailor', 'tailoring', 'sewing', 'stitching', 'darzi', 'silai']),
  opt('weaver', 'Weaving', ['weaver', 'weaving', 'loom', 'handloom', 'bunkar']),
  opt('fine', 'Fine work (jewellery, repair)', ['goldsmith', 'jeweller', 'jewellery', 'jewelry', 'watch repair', 'electronics', 'mobile repair', 'embroidery', 'sunar']),
  opt('shop', 'Shop / business', ['shop', 'shopkeeper', 'store', 'business', 'sales', 'counter', 'dukaan', 'dukan']),
  opt('homemaker', 'Housework', ['housewife', 'homemaker', 'house work', 'housework', 'home', 'cooking', 'household']),
  opt('teacher', 'Teaching', ['teacher', 'teaching', 'professor', 'lecturer']),
  opt('office', 'Office / computer', ['office', 'computer', 'laptop', 'accountant', 'accounts', 'clerk', 'software', 'it', 'bank']),
  opt('student', 'Studying', ['student', 'study', 'studying', 'college', 'school']),
  opt('health', 'Health worker', ['nurse', 'asha', 'health worker', 'anganwadi']),
  opt('retired', 'Retired / not working', ['retired', 'no work', 'not working', 'pension']),
  opt('other', 'Other', ['other', 'something else']),
];

const COMPLAINTS = [
  opt('far_blur', 'Blurry far away', ['far', 'distance', 'faraway', 'board', 'bus number', 'tv', 'television', 'road']),
  opt('near_blur', 'Blurry up close', ['near', 'close', 'up close', 'reading', 'read', 'newspaper', 'phone', 'mobile', 'small letters', 'small print', 'needle']),
  opt('strain', 'Headache / tired eyes', ['headache', 'head ache', 'tired', 'strain', 'burning', 'watering', 'itching', 'dry']),
  opt('checkup', 'Routine check / new glasses', ['check', 'checkup', 'check up', 'routine', 'test', 'new glasses', 'new specs']),
  opt('eye_problem', 'Red, painful or injured eye', ['red eye', 'red', 'pain', 'painful', 'hurts', 'injury', 'injured', 'swelling', 'something went in']),
];

const t = (en) => ({ en });
const has = (arr, v) => Array.isArray(arr) && arr.includes(v);
const OUTDOOR_JOBS = ['farmer', 'fisher', 'driver', 'labour'];
const SCREEN_JOBS = ['office', 'student', 'teacher', 'shop', 'health', 'other', 'retired'];
const NEAR_JOBS = ['tailor', 'weaver', 'fine', 'student', 'office', 'teacher'];

export const QUESTIONS = [
  // ---------------------------------------------------------- core
  {
    id: 'age', module: 'core', type: 'number', min: 1, max: 110, unit: t('years'), urgentOk: true,
    quick: [8, 15, 25, 40, 50, 60, 70],
    text: t('How old are you?'),
    when: () => true,
    reason: () => 'Age sets which eye changes to look for: myopia in children, presbyopia after 40, cataract after 50.',
  },
  {
    id: 'sex', module: 'core', type: 'single', urgentOk: true,
    text: t('Are you female or male?'),
    options: [
      opt('female', 'Female', ['female', 'woman', 'lady', 'girl', 'mahila', 'aurat', 'ladki', 'penn', 'ponnu']),
      opt('male', 'Male', ['male', 'man', 'boy', 'gents', 'purush', 'aadmi', 'ladka', 'aambala', 'paiyan']),
      opt('other', 'Other', ['other', 'transgender']),
    ],
    when: () => true,
    reason: () => 'Needed for the record; some conditions differ by sex (angle-closure glaucoma is more common in women).',
  },
  {
    id: 'complaint', module: 'core', type: 'multi', urgentOk: true,
    text: t('What brings you here today? For example: can’t see far clearly, can’t read up close, headache or tired eyes, a red or painful eye, or just a check-up.'),
    options: COMPLAINTS,
    when: () => true,
    reason: () => 'The main complaint decides which tests and follow-up questions matter.',
  },

  // ---------------------------------------------------------- red flags
  // One symptom per question (plain-language best practice), each asking about
  // something NEW or SUDDEN, so long-standing floaters or slow blur are not
  // mistaken for emergencies. Follow-ups only after a "yes". The urgency each
  // answer leads to is in redflags.js. Once an emergency is established, only
  // urgentOk questions remain.
  {
    id: 'rf_vision_drop', module: 'redflag', type: YN, urgentOk: true,
    text: t('Has the sight in either eye got worse suddenly, over minutes, hours or a few days? Not slowly over months.'),
    when: () => true,
    reason: () => 'A sudden drop (not a slow one) can be a detachment, a blocked blood vessel or an optic-nerve problem. When it started decides same day or within 48 hours.',
  },
  {
    id: 'rf_onset', module: 'redflag', type: 'single', urgentOk: true,
    text: t('When did it start: today or yesterday, in the last two weeks, or more than two weeks ago?'),
    options: [
      opt('lt2d', 'Today or yesterday', ['today', 'yesterday', 'this morning', 'last night', 'just now', 'few hours', 'hours ago', 'aaj', 'kal', 'inniki', 'nethu']),
      opt('lt2w', 'In the last 2 weeks', ['last week', 'this week', 'few days', 'days ago', 'three days', 'four days', 'five days', 'week', 'two weeks', 'ten days']),
      opt('gt2w', 'More than 2 weeks ago', ['more than two weeks', 'month', 'months', 'long time', 'long ago', 'year', 'years']),
    ],
    when: (s) => s.a.rf_vision_drop === true,
    reason: () => 'Started within 2 days: same day. 3 to 14 days ago: eye doctor within 48 hours. Longer: within 2 weeks.',
  },
  {
    id: 'rf_flashes', module: 'redflag', type: YN,
    text: t('In the last few weeks, have you started seeing NEW flashes of light, or lots of new floating spots or cobwebs?'),
    when: () => true,
    reason: () => 'New flashes or floaters can come with a retinal tear (10-15% of cases): dilated retina check within 24 hours. Old floaters that have not changed are not a concern.',
  },
  {
    id: 'rf_curtain', module: 'redflag', type: YN, urgentOk: true,
    text: t('Is part of what you see covered by a dark shadow or curtain that does not go away?'),
    when: (s) => s.a.rf_vision_drop === true || s.a.rf_flashes === true,
    reason: () => 'A fixed shadow or curtain suggests a retinal detachment: eye hospital the same day.',
  },
  {
    id: 'rf_double', module: 'redflag', type: YN,
    text: t('In the last few weeks, have you started seeing double, two of everything?'),
    when: () => true,
    reason: () => 'New double vision can come from a nerve palsy or a stroke; double vision in one eye only is usually cataract or astigmatism.',
  },
  {
    id: 'rf_double_cover', module: 'redflag', type: 'single', urgentOk: true,
    text: t('Cover one eye with your hand. Does the double vision go away?'),
    options: [
      opt('goes', 'Yes, it goes away', ['goes away', 'goes', 'gone', 'becomes one', 'single', 'yes']),
      opt('stays', 'No, still double', ['still double', 'still', 'stays', 'remains', 'no']),
      opt('unsure', 'Not sure', ['not sure', 'dont know', 'no idea']),
    ],
    when: (s) => s.a.rf_double === true,
    reason: () => 'If it goes away when either eye is covered, both eyes are involved (a nerve or muscle problem); if it stays, the cause is inside one eye (cataract, astigmatism, dry eye).',
  },
  {
    id: 'rf_double_neuro', module: 'redflag', type: YN, urgentOk: true,
    text: t('Along with it, is there a new bad headache, a drooping eyelid, weakness or numbness, or trouble speaking?'),
    when: (s) => s.a.rf_double === true && s.a.rf_double_cover !== undefined && s.a.rf_double_cover !== 'stays',
    reason: () => 'These with new double vision can mean an aneurysm or a stroke: hospital the same day.',
  },
  {
    id: 'rf_red', module: 'redflag', type: YN,
    text: t('Is either eye red or painful right now?'),
    when: () => true,
    reason: () => 'Most red eyes are mild. Pain, blur, coloured rings or contact lenses make one urgent; the next question sorts which.',
  },
  {
    id: 'rf_red_detail', module: 'redflag', type: 'multi', urgentOk: true,
    text: t('Which of these are there? Real pain, not just itching; blurred sight; coloured rings around lights; headache or vomiting; light hurts the eye; sticky discharge or itching; or do you wear contact lenses? Say none if nothing else.'),
    options: [
      opt('pain', 'Real pain', ['pain', 'painful', 'hurts', 'aching', 'dard', 'vali']),
      opt('blur', 'Blurred sight', ['blur', 'blurred', 'blurry', 'cannot see', 'hazy']),
      opt('haloes', 'Coloured rings around lights', ['rings', 'haloes', 'halos', 'rainbow', 'coloured rings', 'circles around lights']),
      opt('vomit', 'Headache or vomiting', ['vomit', 'vomiting', 'nausea', 'headache', 'head ache']),
      opt('photo', 'Light hurts the eye', ['light hurts', 'cannot open', 'light sensitive', 'sensitive to light', 'glare hurts']),
      opt('discharge', 'Sticky discharge or itching', ['discharge', 'sticky', 'pus', 'itching', 'itchy', 'watering', 'gum']),
      opt('cl', 'Wears contact lenses', ['contact lens', 'contact lenses', 'lenses', 'contacts']),
      opt('none', 'None of these', ['none', 'nothing', 'nothing else', 'no'], { exclusive: true }),
    ],
    when: (s) => s.a.rf_red === true,
    reason: () => 'Pain with coloured rings or vomiting: possible angle-closure (same day). Contact lenses: possible infection (same day). Pain or blur: within 24-48 hours. Only itching or discharge: usually conjunctivitis.',
  },
  {
    id: 'rf_injury', module: 'redflag', type: YN,
    text: t('In the last few days, has anything hit the eye, gone into it, or splashed into it?'),
    when: () => true,
    reason: () => 'Chemical and high-speed injuries are emergencies; a scratch from a leaf or crop needs antibiotic ointment within 18 hours to prevent a fungal ulcer.',
  },
  {
    id: 'rf_injury_type', module: 'redflag', type: 'multi', urgentOk: true,
    text: t('What was it? A chemical like lime (chuna), acid or a cleaner; a chip from hammering or grinding, or something sharp; a hit from a ball, fist or stick; or a scratch from a leaf, crop, branch or nail?'),
    options: [
      opt('chemical', 'Chemical (lime/chuna, acid, cleaner)', ['chemical', 'lime', 'chuna', 'choona', 'acid', 'cleaner', 'phenyl', 'bleach', 'battery', 'cement', 'holi colour', 'splash']),
      opt('sharp', 'Chip from hammering/grinding, or sharp', ['hammer', 'hammering', 'grinding', 'grinder', 'welding', 'drilling', 'metal', 'iron', 'chip', 'sharp', 'glass', 'knife', 'needle']),
      opt('blunt', 'Hit (ball, fist, stick)', ['hit', 'ball', 'cricket ball', 'fist', 'punch', 'stick', 'fell', 'blow', 'cracker']),
      opt('scratch', 'Scratch (leaf, crop, branch, nail)', ['scratch', 'leaf', 'crop', 'paddy', 'sugarcane', 'branch', 'thorn', 'nail', 'fingernail', 'dust', 'sand', 'husk']),
    ],
    when: (s) => s.a.rf_injury === true,
    reason: () => 'The kind of injury decides between rinse-and-hospital today and antibiotic ointment within 18 hours.',
  },
  {
    id: 'child_white', module: 'child', type: YN, urgentOk: true,
    text: t('Have you ever seen a white glow, like a cat’s eye, in the child’s eye, in person or in a photo?'),
    when: (s) => s.d.isChild,
    reason: () => 'A white pupil glow (leukocoria) can be childhood cataract or retinoblastoma: specialist within 2 weeks, the same day if there is also a squint.',
  },
  {
    id: 'child_squint', module: 'child', type: YN, urgentOk: true,
    text: t('Does one of the child’s eyes turn in or out, or does the child tilt their head or close one eye to see?'),
    when: (s) => s.d.isChild,
    reason: () => 'A squint or head tilt can mean amblyopia (lazy eye), which responds best when treated young.',
  },
  {
    id: 'child_neuro', module: 'child', type: YN, urgentOk: true,
    text: t('With the squint, does the child also have headaches, vomiting, or walk unsteadily?'),
    when: (s) => s.d.isChild && s.a.child_squint === true,
    reason: () => 'A squint with headaches, vomiting or unsteadiness needs a children’s hospital the same day.',
  },

  // ---------------------------------------------------------- medical
  {
    id: 'conditions', module: 'medical', type: 'multi', urgentOk: true,
    text: t('Do you have diabetes, high blood pressure, or a thyroid problem?'),
    options: [
      opt('diabetes', 'Diabetes (sugar)', ['diabetes', 'diabetic', 'sugar']),
      opt('bp', 'High blood pressure', ['bp', 'blood pressure', 'pressure', 'hypertension']),
      opt('thyroid', 'Thyroid', ['thyroid']),
      opt('none', 'None of these', ['none', 'no', 'nothing', 'neither', 'illa', 'nahi'], { exclusive: true }),
    ],
    when: (s) => s.d.age >= 18,
    reason: () => 'Diabetes damages the retina silently and makes glasses power fluctuate; blood pressure and thyroid disease also affect the eyes.',
  },
  {
    id: 'diabetes_years', module: 'medical', type: 'number', min: 0, max: 80, unit: t('years'),
    quick: [1, 3, 5, 10, 15, 20],
    text: t('For how many years have you had diabetes?'),
    when: (s) => s.d.diabetic,
    reason: () => 'Retinopathy risk rises with every year of diabetes; a new diagnosis also means the glasses power may still be shifting.',
  },
  {
    id: 'retina_exam', module: 'medical', type: 'single',
    text: t('When did a doctor last put drops in your eyes and check the back of the eye? Within the last year, more than a year ago, or never?'),
    options: [
      opt('within_1y', 'Within the last year', ['within', 'this year', 'last year', 'recently', 'recent', 'months', 'month', 'few months']),
      opt('over_1y', 'More than a year ago', ['more than', 'years ago', 'long ago', 'long time', 'two years', 'three years']),
      opt('never', 'Never', ['never', 'not done', 'no']),
    ],
    when: (s) => s.d.diabetic,
    reason: () => 'People with diabetes need a dilated retina check every year; an overdue check is referred.',
  },
  {
    id: 'glaucoma_family', module: 'medical', type: YN,
    text: t('Does your mother, father, brother or sister have glaucoma, the eye pressure disease?'),
    when: (s) => s.d.age >= 40,
    reason: () => 'Glaucoma runs in families and steals sight painlessly; relatives over 40 need an eye-pressure and optic-nerve check.',
  },
  {
    id: 'eye_surgery', module: 'medical', type: 'single',
    text: t('Have you had cataract surgery, or any other eye operation?'),
    options: [
      opt('cataract', 'Cataract surgery', ['cataract', 'lens', 'iol']),
      opt('other', 'Another eye operation', ['other', 'laser', 'lasik', 'retina', 'squint']),
      opt('none', 'No operation', ['no', 'none', 'never']),
    ],
    when: (s) => s.d.age >= 40,
    reason: () => 'After cataract surgery the eye cannot focus up close, so near glasses are needed whatever the age.',
  },

  // ---------------------------------------------------------- current glasses
  {
    id: 'glasses_now', module: 'glasses', type: YN,
    text: t('Do you wear glasses now?'),
    when: () => true,
    reason: () => 'Current glasses show the past prescription and what is or isn’t working.',
  },
  {
    id: 'glasses_type', module: 'glasses', type: 'single',
    text: t('What kind are they: for distance, for reading, bifocal with a line, or progressive with no line?'),
    options: [
      opt('distance', 'Distance', ['distance', 'far']),
      opt('reading', 'Reading', ['reading', 'read', 'near', 'readers']),
      opt('bifocal', 'Bifocal (line)', ['bifocal', 'line', 'kryptok']),
      opt('progressive', 'Progressive (no line)', ['progressive', 'no line', 'varifocal', 'without line']),
      opt('unknown', 'Don’t know', ['dont know', 'not sure', 'no idea']),
    ],
    when: (s) => s.a.glasses_now === true,
    reason: () => 'Tells us which zones the patient already relies on, and whether they have adapted to multifocals before.',
  },
  {
    id: 'glasses_years', module: 'glasses', type: 'number', min: 0, max: 40, unit: t('years'),
    quick: [0.5, 1, 2, 3, 5, 10],
    text: t('How old are your current glasses, in years?'),
    when: (s) => s.a.glasses_now === true,
    reason: () => 'Prescriptions older than about two years are often out of date, especially after 40.',
  },
  {
    id: 'glasses_ok', module: 'glasses', type: 'single',
    text: t('With these glasses, how do you see: fine, blurry far away, blurry up close, or do they give you headaches?'),
    options: [
      opt('fine', 'Fine', ['fine', 'good', 'ok', 'okay', 'clear', 'no problem']),
      opt('far_blur', 'Blurry far away', ['far', 'distance']),
      opt('near_blur', 'Blurry up close', ['near', 'close', 'reading']),
      opt('discomfort', 'Headaches / discomfort', ['headache', 'pain', 'discomfort', 'dizzy', 'dizziness']),
    ],
    when: (s) => s.a.glasses_now === true,
    reason: () => 'Separates an outdated prescription from a wrong lens type or a poor fit.',
  },
  {
    id: 'rx_known', module: 'glasses', type: 'rx', asr: 'en',
    text: t('If you have the prescription slip, read it out. For example: right eye minus one point five, cylinder minus point five, axis ninety. Or say skip.'),
    when: (s) => s.a.glasses_now === true,
    reason: () => 'A known prescription is the best starting point; it is checked against valid lens steps and for big differences between the eyes.',
  },
  {
    id: 'frequent_change', module: 'glasses', type: YN,
    text: t('In the last two years, have you needed new glasses more than once because the power kept changing?'),
    when: (s) => s.a.glasses_now === true && (s.d.age >= 45 || s.d.diabetic),
    reason: () => 'Power that keeps changing can signal a developing cataract or uncontrolled diabetes.',
  },

  // ---------------------------------------------------------- visual tasks (the profile)
  {
    id: 'occupation', module: 'lifestyle', type: 'single',
    text: t('What work do you do for most of the day? For example: farming, tailoring, driving, a shop, office or computer work, housework, or studies.'),
    options: OCCUPATIONS,
    when: (s) => !s.d.isChild,
    reason: () => 'Work sets how many hours go to near, arm’s-length and far vision, the core of the vision profile.',
  },
  {
    id: 'near_hours', module: 'lifestyle', type: 'hours',
    quick: [0, 1, 2, 3, 4, 6, 8],
    text: (s) => (s.d.isChild
      ? t('How many hours a day does the child spend on homework, books, or a phone or tablet?')
      : t('On a normal day, how many hours do you spend on close work: reading, the phone, sewing or fine handwork?')),
    when: (s) => s.d.isChild || s.d.age >= 35 || NEAR_JOBS.includes(s.d.occ)
      || has(s.a.complaint, 'near_blur') || has(s.a.complaint, 'strain'),
    reason: (s) => (s.d.isChild
      ? 'More than about 3 hours of close work a day raises a child’s myopia risk.'
      : s.d.age >= 35 ? 'From the late 30s, hours of close work decide the reading add and the lens type.'
        : 'Long close work explains strain symptoms and shapes the lens design.'),
  },
  {
    id: 'screen_hours', module: 'lifestyle', type: 'hours',
    quick: [0, 1, 2, 4, 6, 8],
    text: t('How many hours a day do you work on a computer or laptop screen?'),
    when: (s) => !s.d.isChild && SCREEN_JOBS.includes(s.d.occ),
    reason: () => 'Screens sit at arm’s length ("intermediate" vision), which standard bifocals do not cover and progressives cover narrowly.',
  },
  {
    id: 'outdoor_hours', module: 'lifestyle', type: 'hours',
    quick: [0, 0.5, 1, 2, 3, 4, 6],
    text: (s) => (s.d.isChild
      ? t('How many hours a day does the child play or spend time outdoors in daylight?')
      : t('How many hours a day are you outdoors in daylight?')),
    when: (s) => s.d.isChild || (s.d.occ !== null && !OUTDOOR_JOBS.includes(s.d.occ)),
    reason: (s) => (s.d.isChild
      ? 'Daylight outdoors protects against myopia; children with under 2 hours a day are at higher risk.'
      : 'Long hours in sunlight call for UV protection and possibly photochromic lenses.'),
  },
  {
    id: 'child_board', module: 'child', type: YN,
    text: t('Does the child have trouble reading the board at school, or sit very close to the TV?'),
    when: (s) => s.d.isChild && s.d.age >= 4,
    reason: () => 'The classic early sign of myopia in school children.',
  },
  {
    id: 'parent_myopia', module: 'child', type: 'single',
    text: t('Do the child’s parents wear glasses for seeing far? Neither, one parent, or both?'),
    options: [
      opt('none', 'Neither', ['none', 'neither', 'no', 'nobody']),
      opt('one', 'One parent', ['one', 'mother', 'father', 'mom', 'dad']),
      opt('both', 'Both', ['both']),
    ],
    when: (s) => s.d.isChild,
    reason: () => 'Myopia risk rises with one short-sighted parent and more with two.',
  },
  {
    id: 'drives', module: 'lifestyle', type: YN,
    text: t('Do you drive a vehicle or ride a two-wheeler?'),
    when: (s) => s.d.age >= 16 && s.d.occ !== 'driver',
    reason: () => 'Driving needs sharp distance vision and wide side vision; it changes lens design and coating advice.',
  },
  {
    id: 'night_glare', module: 'lifestyle', type: YN,
    text: t('At night, do headlights or street lights dazzle you, or do colours look dull and faded?'),
    when: (s) => s.d.age >= 50 || s.a.drives === true || s.d.occ === 'driver',
    reason: (s) => (s.d.age >= 50
      ? 'Glare and faded colours after 50 are early cataract signs.'
      : 'Night glare for a driver calls for an anti-reflective coating.'),
  },
  {
    id: 'falls', module: 'lifestyle', type: YN,
    text: t('In the past year, have you had a fall, or do you find steps and kerbs hard to judge?'),
    when: (s) => s.d.age >= 65,
    reason: () => 'In active older people, bifocals and progressives blur steps and kerbs; a separate distance pair for walking can prevent falls.',
  },

  // ---------------------------------------------------------- preference
  {
    id: 'budget', module: 'preference', type: 'single',
    text: t('How much would you like to spend on the lenses: under one thousand rupees, one to three thousand, or more than three thousand?'),
    options: [
      opt('low', 'Under ₹1,000', ['under', 'below', 'less than', 'cheap', 'low'], { range: [0, 1000] }),
      opt('mid', '₹1,000 – 3,000', ['between', 'one to three', 'medium'], { range: [1000, 3001] }),
      opt('high', 'Over ₹3,000', ['more than', 'above', 'over', 'best'], { range: [3001, 1e9] }),
    ],
    when: (s) => s.d.presbyopeLikely || s.d.isChild,
    reason: () => 'Lens options for near-and-far needs range from low-cost bifocals to progressives; advice must be affordable to be followed.',
  },
];

// ---------------------------------------------------------------- merge language packs
for (const pack of PACKS) {
  const c = pack.code;
  for (const q of QUESTIONS) {
    const tx = pack.q[q.id];
    if (tx && typeof q.text === 'function') {
      const prev = q.text; // child/adult variants: wrap, keeping earlier languages
      q.text = (s) => ({ ...prev(s), [c]: s.d.isChild ? tx.child : tx.adult });
    } else if (tx && typeof tx === 'string') {
      q.text[c] = tx;
    }
    if (q.unit) q.unit[c] = pack.units.years;
    const opts = pack.opt[q.id];
    if (opts && q.options) {
      for (const o of q.options) {
        const entry = opts[o.v];
        if (!entry) continue;
        o.label[c] = entry[0];
        o.kw = [...o.kw, ...entry];
      }
    }
  }
}

export const QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

export function questionText(q, s, lang) {
  const txt = typeof q.text === 'function' ? q.text(s) : q.text;
  return txt[lang] || txt.en;
}
