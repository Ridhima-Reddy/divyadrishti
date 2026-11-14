# Clinical logic and evidence

Every rule below is implemented in `web/js/engine/profile.js` and `web/js/engine/questions.js` and covered by tests in `tests/engine/`. They are **proposed** rules, written to be reviewed line by line with optometrists before use.

## 1. Adaptive anamnesis

- 38-question bank in clinical order: core → red flags → child → medical → current glasses → visual tasks → preference.
- A question is asked only when its answer can change triage or the lens decision for this patient (its `when` rule). Examples: farmers are not asked about computer screens (the occupation prior already says 0 h); glaucoma family history and cataract surgery are asked from 40; falls from 65; budget only when the lens choice spans a price range.
- **Red-flag screen: one symptom per question,** each about something NEW or SUDDEN: sudden drop in sight, new flashes or floaters, new double vision, a red or painful eye, an injury in the last few days. Follow-up questions are asked only after a yes (when did it start; is there a fixed curtain; does the double vision go away with one eye covered; neurological signs; which symptoms come with the red eye; what kind of injury). The earlier version asked one compound question and sent every yes to hospital the same day; see section 2.
- **Urgent mode:** only an *emergency* finding drops the remaining lifestyle questions. Urgent and lower findings keep the full interview, because the glasses decision is still needed.
- Each asked question is logged with the reason it was asked, the patient's own words and the parsed value.
- Measured on the 13 synthetic personas: 16 to 24 questions asked out of 38, median 18. The emergency patient finishes in 7.

## 2. Triage: five tiers with a time to care

The full table, generated from the code, is in **[REFERRAL_RULES.md](REFERRAL_RULES.md)** (43 rules, each with the exact criteria, time to care, action and reference, plus the presentations that are deliberately *not* flagged). It is also shown in the field app (🚦 Referral rules) and the portal.

| Tier | Time to care | Lane | Examples |
|---|---|---|---|
| **Emergency** | same day | red | chemical or high-speed injury; fixed curtain; flashes/floaters with a sudden drop; sudden loss within 2 days; painful red eye with haloes (angle closure); contact-lens wearer with a painful red eye; new double vision with headache or droopy lid; child's squint with headache/vomiting, or with a white pupil glow |
| **Urgent** | 18 h to 2 weeks, stated per rule | amber | scratch from a leaf or crop (antibiotic ointment within 18 h, Bhaktapur study); new flashes or floaters without a curtain (dilated exam within 24 h); painful red eye with blur (24 h) or without (48 h); new double vision without neurological signs (48 h); new Amsler distortion (macula within 1 working day, NICE NG82); white pupil glow (2 weeks, NICE NG12) |
| **Soon** | 2 to 6 weeks | amber | operable cataract (best vision 6/18 or worse); vision a pinhole does not fix; worse than 6/60; child needing glasses or with a squint; diabetes 5+ years never checked; long-standing Amsler distortion; contrast below 1.0 log CS |
| **Routine** | next camp / 3 months | green | early cataract with useful vision; diabetic check due; glaucoma in a parent or sibling at 40+; receded convergence; double vision in one eye only; red eye with only itching or discharge; high refractive error |
| **Note** | no referral | green | possible red-green colour vision difference |

What changed (rules 2026.11-r3) and why: the old rules put any "yes" to a compound question (sudden blur, flashes, curtain *or* double vision) and any red eye with blur into the red lane, so long-standing floaters or conjunctivitis sent people to hospital the same day. Now the red lane holds only presentations that UK guidance (College of Optometrists Annex 4 and CMGs) treats as emergencies; everything else carries the time limit its guideline actually sets. On the demo set, 1 of 13 patients is an emergency (the fixed curtain), 2 are urgent (new floaters; a cane-leaf scratch), 3 are soon and the rest routine.

## 3. Functional Vision Profile

- Hours per zone: **near** (reading, phone, sewing ~25–40 cm), **intermediate** (screen, counter, loom ~66 cm), **distance**. Each comes from the patient's answer or, if not asked, from an occupation prior (`OCC_PRIORS`). The source is shown.
- Dominance: the top zone if its share is ≥ 45 % and leads the next by ≥ 12 points; otherwise *balanced*.
- **Design emphasis:** Near / Intermediate / Balanced. This is the same three-way choice ZEISS Progressive Individual 2 and SmartLife individual designs take from "a few simple lifestyle questions" (Intermediate option: up to 25 % larger intermediate zone; Near: up to 30 % larger near zone).
- Near working distance: **measured** with the camera when available (habitual reading distance), else typical for the occupation (tailor 30 cm, goldsmith 25 cm, office 40 cm).

## 4. Accommodation and reading add

- Minimum expected amplitude (Hofstetter 1950): `A = 15 − 0.25 × age` D. If the near point was measured, `A = 100 / near point (cm)`.
- After cataract surgery (pseudophakia): `A ≈ 0.5 D`, whatever the age.
- Tentative add = near demand − A/2 (half the amplitude kept in reserve), rounded to 0.25 D, capped at +3.50 D. Symptomatic patients aged 38+ get at least +0.75 D.
- At 40 cm this gives +1.25 D at 50, +2.00 D at 55 and +2.50 D at 60, in line with the usual age tables.
- Working distance matters: at 47, a tailor sewing at 30 cm gets +1.75 D, while someone reading at 40 cm gets +1.00 D.

## 5. Lens category (in order)

1. Red lane → no glasses today.
2. Child (<16) → cycloplegic refraction, then single vision. With moderate/high myopia risk, discuss myopia management (e.g. ZEISS MyoCare, ages 6–12) after confirmation.
3. No add needed → single-vision distance (or no change).
4. Age 65+ with a fall and outdoor activity → **two pairs**: single-vision distance for walking plus readers (VISIBLE trial).
5. Near ≥ 50 % with little distance or arm's-length work → reading glasses at the measured distance; ready-made readers once the optometrist approves the add.
6. Intermediate-dominant, or near + intermediate ≥ 75 % → office / near-variable lens (one-pair alternative: progressive, Intermediate/Near design).
7. Low budget, or already comfortable in bifocals → bifocal.
8. Otherwise → progressive with the profile's design emphasis.

Coatings: anti-reflective for night driving and glare; UV and photochromic for 4+ h of sun; impact-resistant for children and manual work.

### Blue-light ("blue ray") lenses for laptop users: checked again

Many stores, chains included, sell blue-cut lenses as a fix for screen strain. The evidence does not support that claim:

- **Cochrane review (Singh et al., 2023, 17 randomised trials):** blue-light filtering lenses *probably make no difference* to eye strain from computer use (short-term follow-up, low-certainty evidence). The authors do not know whether they help sleep (very low certainty), found no study of retinal (macular) protection, and found no consistent harms. Their conclusion: the findings do not support prescribing them to the general population. Typical lenses filter only about 10–25% of blue light.
- **American Academy of Ophthalmology:** does not recommend any special eyewear for computer use. Screen strain comes from *how* we use screens (reduced blinking and sustained focusing at close range), not from the screen's light.
- **Newer studies (2024–2025)** are mostly observational or small and do not change the picture.

**What the app does:** it never presents a blue-light filter as a treatment. It may be offered as a preference: it is harmless, and some in-material designs also block UV and cut reflections. The app states the evidence and recommends what does relieve screen strain:
1. the right power at the screen distance (for presbyopes, an intermediate add or office lens; this is where the engine's Intermediate design emphasis comes from);
2. correcting small uncorrected errors;
3. an anti-reflective coating;
4. blinking and 20-20-20 breaks.

This corrects a claim in our own idea-stage deck.

## 6. Child myopia risk score

+2 outdoors < 2 h/day; +1 near work > 3 h (+2 if > 5 h); +1 one myopic parent, +2 both; +1 measured reading distance < 25 cm; +2 trouble with the school board; +1 if under 10 and any risk. High ≥ 4, moderate 2–3. Outdoor time is the modifiable factor (He et al. 2015: an extra 40 min outdoors at school cut 3-year myopia incidence from 39.5 % to 30.4 %).

## 7. Camera measurements (`web/js/measure/geometry.js`)

- **Distance from the iris:** horizontal visible iris diameter ≈ 11.7 ± 0.5 mm (±4 %); `Z = f × 11.7 / iris_px`. The focal length comes from a one-time 40 cm calibration per phone (default: 63° lens, about ±15 %). MediaPipe Iris reports under 10 % depth error.
- **PD:** pupil separation × (11.7 / iris px) is depth-independent. Optionally an ID-1 card (85.6 mm) on the forehead gives the scale, corrected for the card sitting ~12 mm in front of the eyes. Convergence correction from near fixation back to distance PD (pupil ~10.5 mm in front of the centre of rotation). Near PD at the spectacle plane: `PD × w / (w + 27 mm)`.
- **Prentice's rule** (prism = decentration in cm × power) converts PD uncertainty into induced prism for *this patient's* power, so a ±2 mm PD is fine at −1 D and not at −6 D.
- **Acuity:** tumbling E, 5 arc-minutes at logMAR 0, sized from the screen calibration (card-matching slider). Staircase: pass 2 of 3, 0.2 steps then 0.1. Paper-pinhole retest when vision is 6/19 or worse: improvement by 2 lines means refractive error; no improvement means eye disease, so refer.
- Smartphone PD apps read slightly low against pupillometers and are considered screening-grade (Jung & Chu 2024; Han et al. 2023). **Validation against a pupillometer, autorefractor and tape is the first pilot task.**

## 8. Vision tests on the phone (the five ZEISS online screening checks, plus more)

ZEISS's Online Vision Screening Check covers visual acuity and contrast (Landolt C), colour (number plates), astigmatism (stripe pattern) and the central field (Amsler). The field app has all five, plus duochrome, near vision, three camera measurements and camera lensometry. Every test is listed on the tests screen; the engine marks which ones matter for the patient and why.

| Test | Method | Result recorded | Used for | Limits |
|---|---|---|---|---|
| Distance acuity | Tumbling E or Landolt C at 2 m, 2-of-3 staircase, pinhole retest below 6/19 | logMAR per eye, pinhole | every decision; cataract and "not glasses" rules | screen size must be calibrated |
| Contrast sensitivity | Landolt C (~3°) at falling Weber contrast in 0.15 log steps, 2 of 3 to pass; grey level computed for sRGB and the achieved contrast recorded | log CS per eye | cataract sign at 50+; reduced (<1.35) routine, marked (<1.0) soon | brightness and room light not calibrated |
| Colour vision | 1 demonstration + 5 generated dot plates (red-green confusion colours, matched lightness) | plates read, normal / possible red-green / inconclusive | note only (never a referral) | uncalibrated screen colours; screening, not diagnosis |
| Astigmatism | clock dial; darkest line tapped; rule of 30 for the minus-cyl axis | even, or line + axis per eye | starting point for the optometrist | subjective |
| Amsler grid | 5 mm grid, per eye; if abnormal, "new or long-standing?" | normal/abnormal per eye, onset | new: macula within 1 working day; old: soon | |
| Duochrome | red/green halves with black rings at 2 m, with or without current glasses | red / green / equal per eye | red: needs more minus; green: less minus or more plus | at 2 m a slight green bias is expected (0.5 D vergence) |
| Near vision | N24 to N5 lines at the measured reading distance, in the patient's language | smallest N line, distance, with/without glasses | confirms the add | font x-height differs from Times |
| Reading distance | camera (iris as a ruler) | cm | add and design | ±5% calibrated, ±15% not |
| Focusing range (NPA) | camera, phone brought closer until print blurs | cm, dioptres | measured amplitude instead of the age table | |
| Convergence (NPC) | camera, phone brought towards the nose until double | cm (or "closer than the camera can measure") | receded beyond 6 cm (<40) / 10 cm (40+): routine binocular check | face is lost below ~10 cm; manual ruler entry available |
| PD and fitting height | camera with head-pose gate, optional ID-card scale | mm | centration | |
| Lensometry | rear camera through the current glasses at a checkerboard 40 cm away, lens halfway; magnification matrix from the pattern's lattice (autocorrelation) through the lens vs. two clear patches either side; F = (L/ab)(I − M⁻¹) | sph / cyl × axis per lens | current Rx when there is no prescription slip; anisometropia / high-error rules | estimate (±0.50 D expected); keep the target square to the phone; progressives give only the zone looked through; strong plus (> +10 D at these distances) cannot be read |

### Where each test is reliable: phone, big screen, or both

No test chart is shown on the phone. A phone screen is about 7 × 15 cm and held close, so every chart test runs on a laptop or TV (the chart screen) and the phone only guides the set-up and records the patient's answers (left, right, the number seen, the smallest line read). On a phone, a chart test cannot start until a chart screen is paired. The phone is used as an instrument only where its camera measures something.

| Test | Tag | Why |
|---|---|---|
| Distance vision | Big screen | At 3 or 6 m (or 6 m with a mirror in a 3 m room), as in an optical store; the phone is the remote. |
| Contrast, colour plates, near vision | Big screen | Contrast rings at 1 m on a steady bright screen; plates large at reading distance; the N chart at true print size at 40 cm. Screen colour and brightness keep these screening only. |
| Amsler grid | Big screen | The grid must cover the central 20 degrees: 10 cm at 30 cm. A phone covers only about 12 degrees and can miss distortion just outside the centre. On a laptop the full 20 × 20 grid is drawn at true size. |
| Astigmatism dial | Big screen | Read from 3 m or more with focus relaxed for distance. On a phone the dial is small and close, so focusing effort and thin lines make the answer unreliable. |
| Duochrome | Big screen | Checks focus for distance and is read at 3 to 6 m. Closer, the eye's own focusing shifts the answer by about 0.5 D. |
| Reading distance, focusing range, convergence, PD | Phone camera | The phone is the measuring instrument, held the way the patient naturally reads; nothing is shown on it as a chart. |
| Lensometry | Phone + big screen | The rear camera reads a pattern shown on the screen (or printed). |

**Chart screen.** A laptop or TV opens `display.html` and shows a 6-digit code; the phone pairs with it once, then drives the charts like the remote of a store's chart projector while it records the answers. Only chart instructions (which chart, letter size, direction, distance) pass through the hub, never patient data. The laptop is calibrated once with an ID card so letters are their true size.

## References

- Hofstetter HW. A useful age-amplitude formula. *Optom World* 1950;38:42–45.
- He M et al. Effect of time spent outdoors at school on the development of myopia among children in China. *JAMA* 2015;314(11):1142–1148.
- Haran MJ et al. Effect on falls of providing single lens distance vision glasses to multifocal glasses wearers: VISIBLE randomised controlled trial. *BMJ* 2010;340:c2265.
- Singh S et al. Blue-light filtering spectacle lenses for visual performance, sleep, and macular health in adults. *Cochrane Database Syst Rev* 2023 (CD013244.pub2).
- American Academy of Ophthalmology: no special eyewear recommended for computer use; screen strain comes from usage habits.
- Bastawrous A et al. Development and validation of a smartphone-based visual acuity test (Peek Acuity). *JAMA Ophthalmol* 2015;133(8):930–937. Mean difference vs ETDRS 0.07 logMAR; used by lay health workers.
- Google Research. MediaPipe Iris: real-time iris tracking and depth estimation (2020).
- Jung & Chu. A comparative analysis of interpupillary distance measurement techniques. *Clin Optom* 2024. Han et al. Comparing smartphone applications for IPD. *Cureus* 2023.
- ZEISS Progressive Individual 2 ECP brochure (Balanced / Intermediate / Near). ZEISS SmartLife Individual 3 press release, Feb 2023.
- Marmamula S, Keeffe JE, Rao GN. RARE study, Mahabubnagar. *Ophthalmic Epidemiol* 2009: presbyopia 63.7 % over 35; near-vision spectacle coverage 19 %.
- Sheeladevi S et al. Refractive errors and presbyopia in adults in India: a systematic review. *Indian J Ophthalmol* 2019 (uncorrected presbyopia ~33 %).
- International Council of Ophthalmology. Guidelines for diabetic eye care (annual retinal examination).
