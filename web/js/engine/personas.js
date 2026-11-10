// Synthetic patients (not real people) used by tests, the demo mode and the
// seed data. `say` holds what each patient says, in their own language, so
// the whole voice-parsing path is exercised; `measure` holds the phone checks.

export const PERSONAS = [
  {
    key: 'kumar', name: 'S. Kumar', phone: '+91 98400 00421', village: 'Velachery, Chennai 600042', lang: 'en',
    site: 'Chennai Optics, Velachery', siteType: 'store',
    blurb: '54, accountant, bifocals, 6 h/day on a computer',
    say: {
      age: 'fifty four', sex: 'male', complaint: 'blurry when I read and a headache after computer work',
      rf_sudden: 'no', rf_pain: 'no', conditions: 'no', glaucoma_family: 'no', eye_surgery: 'no',
      glasses_now: 'yes', glasses_type: 'bifocal', glasses_years: 'three years', glasses_ok: 'near is blurry',
      rx_known: 'right eye minus two point five cylinder minus point seven five axis one eighty left eye minus two point two five cylinder minus point five axis one seventy',
      frequent_change: 'no', occupation: 'I am an accountant', near_hours: 'two hours', screen_hours: 'six hours',
      outdoor_hours: 'about one hour', drives: 'yes', night_glare: 'no', budget: 'more than three thousand',
    },
    measure: {
      readingDistanceCm: 36, nearPointCm: 58,
      acuity: { distanceM: 2, R: { logmar: 0.2 }, L: { logmar: 0.2 } },
      amsler: { R: 'normal', L: 'normal' },
      pd: { binocularMm: 63.5, rightMm: 32, leftMm: 31.5, nearMm: 60, method: 'iris' },
    },
  },
  {
    key: 'lakshmi', name: 'R. Lakshmi', phone: '+91 94440 00387', village: 'Kanchipuram 631501', lang: 'ta',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '47, tailor, diabetic 8 years, never had a retina check',
    say: {
      age: 'நாற்பத்தி ஏழு', sex: 'பெண்', complaint: 'அருகில் படிக்க கஷ்டமா இருக்கு', rf_sudden: 'இல்லை', rf_pain: 'இல்ல',
      conditions: 'சுகர் இருக்கு', diabetes_years: 'எட்டு வருஷம்', retina_exam: 'ஒருபோதும் பார்க்கவில்லை',
      glaucoma_family: 'இல்லை', eye_surgery: 'இல்லை', glasses_now: 'இல்லை', occupation: 'தையல் வேலை',
      near_hours: 'ஏழு மணி நேரம்', outdoor_hours: 'ஒரு மணி நேரம்', drives: 'இல்லை', budget: 'ஆயிரம் ரூபாய்க்குக் குறைவாக',
    },
    measure: {
      readingDistanceCm: 29,
      acuity: { distanceM: 2, R: { logmar: 0.1 }, L: { logmar: 0.1 } },
      amsler: { R: 'normal', L: 'normal' },
    },
  },
  {
    key: 'murugan', name: 'K. Murugan', phone: '+91 97890 00155', village: 'Walajabad 631605', lang: 'ta',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '62, farmer, night glare, never had glasses',
    say: {
      age: '62', sex: 'ஆண்', complaint: 'தூரம் மங்கலா தெரியுது படிக்கவும் கஷ்டம்', rf_sudden: 'இல்லை', rf_pain: 'இல்லை',
      conditions: 'எதுவும் இல்லை', glaucoma_family: 'இல்லை', eye_surgery: 'இல்லை', glasses_now: 'இல்லை',
      occupation: 'விவசாயம்', near_hours: 'ஒரு மணி நேரம்', drives: 'இல்லை', night_glare: 'ஆமா ராத்திரி லைட் கண்ணைக் கூசுது',
      budget: 'ஆயிரம் ரூபாய்க்குக் குறைவாக',
    },
    measure: {
      acuity: { distanceM: 2, R: { logmar: 0.6, pinholeLogmar: 0.3, pinholeImproved: true }, L: { logmar: 0.8, pinholeLogmar: 0.8, pinholeImproved: false } },
      amsler: { R: 'normal', L: 'normal' },
    },
  },
  {
    key: 'priya', name: 'Priya (child of A. Devi)', phone: '+91 99620 00718', village: 'Tambaram 600045', lang: 'hi',
    site: 'Chennai Optics, Velachery', siteType: 'store',
    blurb: '9, struggles with the school board, 30 min outdoors a day',
    say: {
      age: 'नौ साल', sex: 'लड़की', complaint: 'दूर का धुंधला दिखता है', rf_sudden: 'नहीं', rf_pain: 'नहीं', child_white: 'नहीं',
      child_squint: 'नहीं', glasses_now: 'नहीं', near_hours: 'चार घंटे', outdoor_hours: 'आधा घंटा', child_board: 'हाँ',
      parent_myopia: 'दोनों', budget: 'एक से तीन हज़ार',
    },
    measure: { readingDistanceCm: 22, acuity: { distanceM: 2, R: { logmar: 0.5 }, L: { logmar: 0.6 } } },
  },
  {
    key: 'ravi', name: 'M. Ravi', phone: '+91 90030 00962', village: 'Guduvanchery 603202', lang: 'hi',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '58, sudden dark curtain in one eye: red flag',
    say: {
      age: 'अट्ठावन', sex: 'पुरुष', complaint: 'दूर का धुंधला', rf_sudden: 'हाँ अचानक काला पर्दा सा आ गया',
      rf_sudden_which: 'काला पर्दा', rf_pain: 'नहीं', conditions: 'शुगर है',
    },
    measure: { acuity: { distanceM: 2, R: { logmar: 1.1 }, L: { logmar: 0.2 } } },
  },
  {
    key: 'fatima', name: 'A. Fatima', phone: '+91 98410 00233', village: 'Pallavaram 600043', lang: 'en',
    site: 'Chennai Optics, Velachery', siteType: 'store',
    blurb: '68, cataract surgery done, fell twice this year',
    say: {
      age: '68', sex: 'female', complaint: 'I cannot read the newspaper', rf_sudden: 'no', rf_pain: 'no', conditions: 'blood pressure',
      glaucoma_family: 'no', eye_surgery: 'cataract surgery in both eyes', glasses_now: 'yes', glasses_type: 'bifocal',
      glasses_years: 'five', glasses_ok: 'near is blurry', rx_known: 'skip', frequent_change: 'no',
      occupation: 'housewife', near_hours: 'three hours', outdoor_hours: 'two hours', drives: 'no', night_glare: 'no',
      falls: 'yes I fell twice', budget: 'between one and three thousand',
    },
    measure: { readingDistanceCm: 38, acuity: { distanceM: 2, R: { logmar: 0.2 }, L: { logmar: 0.3 } }, amsler: { R: 'normal', L: 'normal' } },
  },
  {
    key: 'arjun', name: 'V. Arjun', phone: '+91 96000 00510', village: 'Guindy, Chennai 600032', lang: 'en',
    site: 'Chennai Optics, Velachery', siteType: 'store',
    blurb: '24, student, short-sighted, 5 h/day on a laptop',
    say: {
      age: '24', sex: 'male', complaint: 'the board is blurry far away', rf_sudden: 'no', rf_pain: 'no', conditions: 'none',
      glasses_now: 'yes', glasses_type: 'distance', glasses_years: 'three', glasses_ok: 'far is blurry',
      rx_known: 'right eye minus two fifty left eye minus two seventy five', occupation: 'student',
      near_hours: 'five hours', screen_hours: 'five hours', outdoor_hours: 'one hour', drives: 'yes', night_glare: 'no',
    },
    measure: { readingDistanceCm: 31, acuity: { distanceM: 2, R: { logmar: 0.3 }, L: { logmar: 0.3 } } },
  },
  {
    key: 'selvi', name: 'P. Selvi', phone: '+91 94430 00684', village: 'Kanchipuram 631502', lang: 'ta',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '44, silk weaver, starting to struggle up close',
    say: {
      age: '44', sex: 'பெண்', complaint: 'அருகில் மங்கல்', rf_sudden: 'இல்லை', rf_pain: 'இல்லை', conditions: 'எதுவும் இல்லை',
      glaucoma_family: 'இல்லை', eye_surgery: 'இல்லை', glasses_now: 'இல்லை', occupation: 'நெசவு', near_hours: 'நாலு மணி நேரம்',
      outdoor_hours: 'ஒரு மணி', drives: 'இல்லை', budget: 'ஆயிரம் முதல் மூவாயிரம்',
    },
    measure: { readingDistanceCm: 42, nearPointCm: 30, acuity: { distanceM: 2, R: { logmar: 0.0 }, L: { logmar: 0.1 } } },
  },
];

export const PERSONA_BY_KEY = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
