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
      rf_vision_drop: 'no', rf_flashes: 'no', rf_double: 'no', rf_red: 'no', rf_injury: 'no', conditions: 'no', glaucoma_family: 'no', eye_surgery: 'no',
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
      duochrome: { R: 'red', L: 'equal', withGlasses: true, distanceM: 2 },
      nearAcuity: { N: 10, distanceCm: 36, withGlasses: true },
      npc: { cm: 8, method: 'camera' },
      astigmatism: { R: { even: false, line: '12-6', axis: 180 }, L: { even: true } },
    },
  },
  {
    key: 'lakshmi', name: 'R. Lakshmi', phone: '+91 94440 00387', village: 'Kanchipuram 631501', lang: 'ta',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '47, tailor, diabetic 8 years, never had a retina check',
    say: {
      age: 'நாற்பத்தி ஏழு', sex: 'பெண்', complaint: 'அருகில் படிக்க கஷ்டமா இருக்கு', rf_vision_drop: 'இல்லை', rf_flashes: 'இல்ல', rf_double: 'இல்லைங்க', rf_red: 'இல்ல', rf_injury: 'இல்லை',
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
      age: '62', sex: 'ஆண்', complaint: 'தூரம் மங்கலா தெரியுது படிக்கவும் கஷ்டம்', rf_vision_drop: 'இல்லை', rf_flashes: 'இல்லை', rf_double: 'இல்லை', rf_red: 'இல்லை',
      rf_injury: 'கிடையாது',
      conditions: 'எதுவும் இல்லை', glaucoma_family: 'இல்லை', eye_surgery: 'இல்லை', glasses_now: 'இல்லை',
      occupation: 'விவசாயம்', near_hours: 'ஒரு மணி நேரம்', drives: 'இல்லை', night_glare: 'ஆமா ராத்திரி லைட் கண்ணைக் கூசுது',
      budget: 'ஆயிரம் ரூபாய்க்குக் குறைவாக',
    },
    measure: {
      acuity: { distanceM: 2, R: { logmar: 0.6, pinholeLogmar: 0.3, pinholeImproved: true }, L: { logmar: 0.8, pinholeLogmar: 0.8, pinholeImproved: false } },
      amsler: { R: 'normal', L: 'normal' },
      contrast: { R: { logCS: 1.35, actualLogCS: 1.35 }, L: { logCS: 1.05, actualLogCS: 1.05 } },
    },
  },
  {
    key: 'priya', name: 'Priya (child of A. Devi)', phone: '+91 99620 00718', village: 'Tambaram 600045', lang: 'hi',
    site: 'Chennai Optics, Velachery', siteType: 'store',
    blurb: '9, struggles with the school board, 30 min outdoors a day',
    say: {
      age: 'नौ साल', sex: 'लड़की', complaint: 'दूर का धुंधला दिखता है', rf_vision_drop: 'नहीं', rf_flashes: 'नहीं', rf_double: 'नहीं', rf_red: 'नहीं जी', rf_injury: 'नहीं', child_white: 'नहीं',
      child_squint: 'नहीं', glasses_now: 'नहीं', near_hours: 'चार घंटे', outdoor_hours: 'आधा घंटा', child_board: 'हाँ',
      parent_myopia: 'दोनों', budget: 'एक से तीन हज़ार',
    },
    measure: { readingDistanceCm: 22, acuity: { distanceM: 2, R: { logmar: 0.5 }, L: { logmar: 0.6 } } },
  },
  {
    key: 'ravi', name: 'M. Ravi', phone: '+91 90030 00962', village: 'Guduvanchery 603202', lang: 'hi',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '58, sight dropped last night with a dark curtain: same-day emergency',
    say: {
      age: 'अट्ठावन', sex: 'पुरुष', complaint: 'दूर का धुंधला', rf_vision_drop: 'हाँ अचानक कम हो गया',
      rf_onset: 'कल रात से', rf_curtain: 'हाँ एक तरफ़ काला पर्दा सा है', conditions: 'शुगर है',
    },
    measure: { acuity: { distanceM: 2, R: { logmar: 1.1 }, L: { logmar: 0.2 } } },
  },
  {
    key: 'fatima', name: 'A. Fatima', phone: '+91 98410 00233', village: 'Pallavaram 600043', lang: 'en',
    site: 'Chennai Optics, Velachery', siteType: 'store',
    blurb: '68, cataract surgery done, fell twice this year',
    say: {
      age: '68', sex: 'female', complaint: 'I cannot read the newspaper', rf_vision_drop: 'no', rf_flashes: 'no', rf_double: 'no', rf_red: 'no', rf_injury: 'nothing like that', conditions: 'blood pressure',
      glaucoma_family: 'no', eye_surgery: 'cataract surgery in both eyes', glasses_now: 'yes', glasses_type: 'bifocal',
      glasses_years: 'five', glasses_ok: 'near is blurry', rx_known: 'skip', frequent_change: 'no',
      occupation: 'housewife', near_hours: 'three hours', outdoor_hours: 'two hours', drives: 'no', night_glare: 'no',
      falls: 'yes I fell twice', budget: 'between one and three thousand',
    },
    measure: {
      readingDistanceCm: 38, acuity: { distanceM: 2, R: { logmar: 0.2 }, L: { logmar: 0.3 } }, amsler: { R: 'normal', L: 'normal' },
      lensometry: { R: { sph: 0.5, cyl: -0.75, axis: 90, se: 0.13 }, L: { sph: 0.75, cyl: -0.5, axis: 85, se: 0.5 }, method: 'camera magnification (L 40 cm, a 20 cm)', quality: 'good' },
      nearAcuity: { N: 12, distanceCm: 38, withGlasses: true },
    },
  },
  {
    key: 'arjun', name: 'V. Arjun', phone: '+91 96000 00510', village: 'Guindy, Chennai 600032', lang: 'en',
    site: 'Chennai Optics, Velachery', siteType: 'store',
    blurb: '24, student, short-sighted, 5 h/day on a laptop',
    say: {
      age: '24', sex: 'male', complaint: 'the board is blurry far away', rf_vision_drop: 'no', rf_flashes: 'no', rf_double: 'no', rf_red: 'no', rf_injury: 'no', conditions: 'none',
      glasses_now: 'yes', glasses_type: 'distance', glasses_years: 'three', glasses_ok: 'far is blurry',
      rx_known: 'right eye minus two fifty left eye minus two seventy five', occupation: 'student',
      near_hours: 'five hours', screen_hours: 'five hours', outdoor_hours: 'one hour', drives: 'yes', night_glare: 'no',
    },
    measure: {
      readingDistanceCm: 31, acuity: { distanceM: 2, R: { logmar: 0.3 }, L: { logmar: 0.3 } },
      astigmatism: { R: { even: true }, L: { even: false, line: '3-9', axis: 90 } },
      colour: { result: 'possible_rg', correct: 2, plates: 5, demoOk: true, eyes: 'both' },
      duochrome: { R: 'red', L: 'red', withGlasses: true, distanceM: 2 },
      npc: { cm: 9, method: 'camera' },
    },
  },
  {
    key: 'selvi', name: 'P. Selvi', phone: '+91 94430 00684', village: 'Kanchipuram 631502', lang: 'ta',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '44, silk weaver, starting to struggle up close',
    say: {
      age: '44', sex: 'பெண்', complaint: 'அருகில் மங்கல்', rf_vision_drop: 'இல்லை', rf_flashes: 'இல்லை', rf_double: 'இல்லை', rf_red: 'இல்லை', rf_injury: 'இல்லை',
      conditions: 'எதுவும் இல்லை',
      glaucoma_family: 'இல்லை', eye_surgery: 'இல்லை', glasses_now: 'இல்லை', occupation: 'நெசவு', near_hours: 'நாலு மணி நேரம்',
      outdoor_hours: 'ஒரு மணி', drives: 'இல்லை', budget: 'ஆயிரம் முதல் மூவாயிரம்',
    },
    measure: { readingDistanceCm: 42, nearPointCm: 30, acuity: { distanceM: 2, R: { logmar: 0.0 }, L: { logmar: 0.1 } } },
  },
  {
    key: 'ramulu', name: 'G. Ramulu', phone: '+91 98490 00327', village: 'Uppal, Hyderabad 500039', lang: 'te',
    site: 'Sri Sai Opticals, Uppal', siteType: 'store',
    blurb: '59, auto driver, diabetic 6 years, glare at night',
    say: {
      age: 'యాభై తొమ్మిది', sex: 'మగ', complaint: 'దూరం మసకగా ఉంది చదవడం కూడా కష్టం', rf_vision_drop: 'లేదు', rf_flashes: 'లేదండి', rf_double: 'లేదు', rf_red: 'లేదు', rf_injury: 'లేదండి',
      conditions: 'షుగర్ ఉంది', diabetes_years: 'ఆరు సంవత్సరాలు', retina_exam: 'రెండు సంవత్సరాల క్రితం', glaucoma_family: 'లేదు',
      eye_surgery: 'లేదు', glasses_now: 'లేదు', occupation: 'ఆటో నడుపుతాను', near_hours: 'ఒక గంట',
      night_glare: 'అవును రాత్రి లైట్లు కళ్ళు చెదురుతాయి', budget: 'రెండు వేలు',
    },
    measure: {
      acuity: { distanceM: 2, R: { logmar: 0.4 }, L: { logmar: 0.5, pinholeLogmar: 0.3, pinholeImproved: true } },
      amsler: { R: 'normal', L: 'normal' },
    },
  },
  {
    key: 'sunita', name: 'Sunita Patil', phone: '+91 98220 00145', village: 'Nashik 422001', lang: 'mr',
    site: 'Patil Optics, Nashik', siteType: 'store',
    blurb: '45, teacher, distance glasses, now struggling to read',
    say: {
      age: 'पंचेचाळीस', sex: 'स्त्री', complaint: 'जवळचे वाचायला त्रास होतो आणि डोके दुखते', rf_vision_drop: 'नाही', rf_flashes: 'नाही', rf_double: 'नाही', rf_red: 'नाही हो', rf_injury: 'नाही',
      conditions: 'काही नाही', glaucoma_family: 'नाही', eye_surgery: 'नाही', glasses_now: 'हो', glasses_type: 'दूरचा',
      glasses_years: 'चार वर्षे', glasses_ok: 'जवळचे धूसर दिसते',
      rx_known: 'right eye minus one cylinder minus point five axis ninety left eye minus one point two five',
      frequent_change: 'नाही', occupation: 'मी शिक्षिका आहे', near_hours: 'तीन तास', screen_hours: 'दोन तास',
      outdoor_hours: 'एक तास', drives: 'हो स्कूटर चालवते', night_glare: 'नाही', budget: 'तीन हजारांपेक्षा जास्त',
    },
    measure: {
      readingDistanceCm: 38, nearPointCm: 40,
      acuity: { distanceM: 2, R: { logmar: 0.1 }, L: { logmar: 0.1 } },
      pd: { binocularMm: 61.5, rightMm: 30.5, leftMm: 31, nearMm: 58, method: 'iris' },
    },
  },
  {
    key: 'manjula', name: 'S. Manjula', phone: '+91 99000 00512', village: 'Bommanahalli, Bengaluru 560068', lang: 'kn',
    site: 'Eye camp, Bommanahalli', siteType: 'camp',
    blurb: '52, garment-factory tailor, mother has glaucoma',
    say: {
      age: 'ಐವತ್ತೆರಡು', sex: 'ಹೆಂಗಸು', complaint: 'ಹತ್ತಿರ ಓದಲು ಕಷ್ಟ', rf_vision_drop: 'ಇಲ್ಲ', rf_flashes: 'ಇಲ್ಲ', rf_double: 'ಇಲ್ಲ', rf_red: 'ಇಲ್ಲ', rf_injury: 'ಇಲ್ಲರೀ', conditions: 'ಬಿಪಿ ಇದೆ',
      glaucoma_family: 'ಹೌದು ಅಮ್ಮನಿಗೆ ಇದೆ', eye_surgery: 'ಇಲ್ಲ', glasses_now: 'ಹೌದು', glasses_type: 'ಓದಲು',
      glasses_years: 'ಎರಡು ವರ್ಷ', glasses_ok: 'ಹತ್ತಿರ ಮಸುಕು', rx_known: 'skip', frequent_change: 'ಇಲ್ಲ',
      occupation: 'ಹೊಲಿಗೆ ಕೆಲಸ', near_hours: 'ಎಂಟು ಗಂಟೆ', outdoor_hours: 'ಅರ್ಧ ಗಂಟೆ', drives: 'ಇಲ್ಲ', night_glare: 'ಇಲ್ಲ',
      budget: 'ಸಾವಿರ ರೂಪಾಯಿಗಿಂತ ಕಡಿಮೆ',
    },
    measure: {
      readingDistanceCm: 27,
      acuity: { distanceM: 2, R: { logmar: 0.1 }, L: { logmar: 0.1 } },
      amsler: { R: 'normal', L: 'normal' },
    },
  },
  {
    key: 'gopal', name: 'T. Gopal', phone: '+91 94860 00271', village: 'Sriperumbudur 602105', lang: 'ta',
    site: 'Eye camp, Kanchipuram', siteType: 'camp',
    blurb: '61, farmer, new floaters for 3 days, no curtain: urgent within 24 h, not same day',
    say: {
      age: 'அறுபத்தி ஒன்னு', sex: 'ஆண்', complaint: 'படிக்க கஷ்டமா இருக்கு', rf_vision_drop: 'இல்லை',
      rf_flashes: 'ஆமா மூணு நாளா கண்ணுக்குள்ள பூச்சி பறக்குற மாதிரி புள்ளி வருது', rf_curtain: 'இல்லை',
      rf_double: 'இல்லை', rf_red: 'இல்லை', rf_injury: 'இல்லை', conditions: 'எதுவும் இல்லை', glaucoma_family: 'இல்லை',
      eye_surgery: 'இல்லை', glasses_now: 'இல்லை', occupation: 'விவசாயம்', near_hours: 'ஒரு மணி நேரம்', drives: 'இல்லை',
      night_glare: 'இல்லை', budget: 'ஆயிரம் ரூபாய்க்குக் குறைவாக',
    },
    measure: {
      readingDistanceCm: 40,
      acuity: { distanceM: 2, R: { logmar: 0.1 }, L: { logmar: 0.1 } },
      amsler: { R: 'normal', L: 'normal' },
    },
  },
  {
    key: 'santosh', name: 'Santosh Jadhav', phone: '+91 97300 00418', village: 'Karad, Satara 415110', lang: 'mr',
    site: 'Patil Optics, Nashik', siteType: 'store',
    blurb: '38, sugarcane farmer, leaf scratched the eye yesterday: ointment within 18 h',
    say: {
      age: 'अडतीस', sex: 'पुरुष', complaint: 'डोळा दुखतोय', rf_vision_drop: 'नाही', rf_flashes: 'नाही', rf_double: 'नाही',
      rf_red: 'हो डोळा लाल झालाय', rf_red_detail: 'दुखतंय आणि पाणी येतंय', rf_injury: 'हो काल उसाचं पान लागलं',
      rf_injury_type: 'उसाच्या पानाने खरचटलं', conditions: 'काही नाही', glasses_now: 'नाही', occupation: 'शेती',
      outdoor_hours: 'आठ तास', near_hours: 'एक तास', drives: 'हो मोटरसायकल', night_glare: 'नाही',
    },
    measure: { acuity: { distanceM: 2, R: { logmar: 0.0 }, L: { logmar: 0.1 } } },
  },
];

export const PERSONA_BY_KEY = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
