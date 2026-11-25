# DivyaDrishti

**A voice-first, adaptive eye-care interview that turns the phone a small optical store or eye-camp volunteer already owns into the front door to a remote optometrist.**

ZEISS Hackathon 2026 · Theme 3: No-Device Vision Intelligence & Accessible Clinical UX
Team: Ridhima · Kedar · Venkatesh · Rohit (IIT Madras)

---

## Live demo: four apps, one care network

**Start here: <https://divyadrishti-3dn2.onrender.com/about.html>** (the story page, with links to all four apps). Every app opens with **Explore the demo (no sign-in)**.

| App | Who it is for | Link |
|---|---|---|
| **Story page** | Anyone: what it does, the twelve tests, triage tiers, privacy, the network | <https://divyadrishti-3dn2.onrender.com/about.html> |
| **Optical store app** | Shop owner or eye-camp volunteer: interview and tests, sales and orders dashboard, walk-in prescriptions, ZEISS lens options, booking clinician slots | <https://divyadrishti-3dn2.onrender.com/> |
| **Optometrist portal** | Optometrist or ophthalmologist: review queue, calendar, linked shops, camp planning | <https://divyadrishti-3dn2.onrender.com/portal.html> |
| **Patient app** | The patient: self-checks by voice, booking at nearby network shops, eye record, eye-check interval | <https://divyadrishti-3dn2.onrender.com/patient.html> |
| **ZEISS network dashboard** | ZEISS and programme managers: de-identified network aggregates | <https://divyadrishti-3dn2.onrender.com/zeiss.html> |
| **Test screen** | A laptop or TV at the shop that shows the charts; the patient answers on their own phone | <https://divyadrishti-3dn2.onrender.com/display.html> |

The free host sleeps when idle: the first request can take about a minute. Demo data resets on restart (details under *Try it*).

## How the pieces fit

- **Patient app → optical store.** A patient picks a nearby network shop by PIN code and sends a visit request; the shop accepts, declines or books a clinician slot, and the patient reads the reply back in the app.
- **Optical store → optometrist portal.** The store runs the interview and tests and sends the case, encrypted; the optometrist reviews it against a response-time target, signs off and replies.
- **Optical store ↔ test screen.** The screen shows the charts for the shop.
- **Everything → ZEISS dashboard.** Shops send daily counters, the portal and bridge supply case lanes and review times, and the patient app sends anonymous self-test outcomes. The dashboard also lets the network admin verify new clinician registrations.

The store app is the hub of the network. The test screen signs in as the shop and is found by the shop's own devices with no pairing code; the patient answers by scanning its QR code. The ZEISS dashboard receives only de-identified aggregates (daily counters, case lanes, interview answer modes), never names or phone numbers. The full API is in `docs/NETWORK_API.md`.

---

## What it does

1. **Adaptive voice anamnesis in six languages:** English, Hindi, Tamil, Telugu, Marathi and Kannada, written the way people speak, not as textbook translations. The patient talks; the phone listens until they pause (2.5 s, or 4 s with *More time*, up to 30 s, with a *Done speaking* button) and parses the answer, including native number words and fractions (ढाई, अडीच, ಎರಡೂವರೆ…), code-mixed speech ("sugar irukku", "BP undi") and dictated prescriptions. It asks only what can change the outcome for *this* patient, and says why. The app opens in the phone's own language (or English); the operator's language and the patient's language are chosen separately. Low-confidence speech is confirmed by tap.
2. **Clinically graded red flags.** One symptom per question, each about something NEW or SUDDEN, with follow-ups only after a yes. Five tiers with a time to care: **emergency** (same day: chemical or high-speed injury, fixed curtain, sudden loss within 2 days, angle-closure signs, contact-lens keratitis, double vision with neurological signs), **urgent** (18 h to 2 weeks: crop-leaf scratch, new floaters, painful red eye, new Amsler distortion, white pupil glow), **soon** (2–6 weeks), **routine** and **note**. Only emergencies go to hospital today; the full table with references, and the list of things that are *not* red flags, is in the app, the portal and `docs/REFERRAL_RULES.md`.
3. **Ask, then measure: 12 tests on the phone.** All five checks of the ZEISS Online Vision Screening (Landolt C or tumbling-E acuity with pinhole retest, Landolt C contrast sensitivity, colour number plates, astigmatism dial, Amsler grid), plus duochrome, an N-chart near test in the patient's language, and camera measurements (reading distance, focusing near point, convergence near point, PD and fitting height). **Lensometry:** the rear camera reads the power of the patient's current glasses from how a checkerboard is magnified through the lens. Every test is always listed; the engine marks the ones that matter for this patient and why.
4. **Functional Vision Profile.** Hours at near, arm's length and distance, mapped to the **Balanced / Intermediate / Near** design options that ZEISS individual progressive lenses already take. It adds an estimated reading add (Hofstetter amplitude at the *measured* working distance), child myopia risk, a triage lane and a lens category. A **decision path** shows each rule checked, **data quality** says what was measured versus assumed, and each case records its **rules version**.
5. **Remote Optometrist Bridge.** Cases are stored encrypted on the phone and sent when signal returns. Optometrists review them against response-time targets set by the most urgent finding (emergency 2 h, urgent 24 h, others 72 h), sign off or redirect, and send a **PIN-protected referral letter** to the hospital. Every case exports as a FHIR R4 bundle.
6. **Private by design.** Data on the phone is encrypted (AES-256-GCM, PIN-protected). The server never sees names or phone numbers: they are sealed to the optometrist hub's key (ECDH P-256), and only the hub's browser can open them. Patient files are shared as **end-to-end encrypted, expiring links** (key in the link's fragment, optional PIN, QR code), never as plaintext WhatsApp/SMS. Every access is logged, reviewed cases expire, and strict security headers apply. See `docs/PRIVACY_SECURITY.md`.
7. **Works on a phone, a laptop or a desktop.** One column on phones; two or three columns on wider screens (interview with the answers so far beside it, the test battery in a grid, the profile next to the recommendation).

8. **A care network, not one app.** Four apps share one server: the optical store app, the optometrist portal, a patient app (voice self-checks, booking at nearby shops, an eye record that network shops fill in by mobile number) and a ZEISS network dashboard built only from de-identified aggregates. Clinicians register with a council number and are verified before they can sign off; shops are linked to clinicians for tele-review, referral and visiting camps; slots are booked on a shared calendar. The shop's test screen signs in as the shop and is found by its devices with no code.

## Try it (for judges)

Open <https://divyadrishti-3dn2.onrender.com/about.html>, then use **Explore the demo (no sign-in)** on each app. No account, PIN or key is needed to look around.

1. **Optical store app** (`/`, phone or laptop). Explore the demo opens as the demo shop *Chennai Optics, Velachery* (`DDS-VEL01`). The dashboard shows sales, orders, remakes and cancellations; open **Patients** and start a demo patient to play the whole interview with no microphone (13 synthetic patients across six languages); **Tools** has the lensometer and the charts.
2. **Optometrist portal** (`/portal.html`). Explore the demo opens as a verified demo clinician (Optom. A. Meenakshi) with the review queue, calendar, linked shops and camp planning by shop and PIN code. A real clinician can also register (council number, then verification by the network admin) and sign in.
3. **Patient app** (`/patient.html`). Explore the demo opens as a demo patient with a year of visits, a prescription and a glasses order. Try a self-check by voice, then find nearby shops by PIN code (for example `600036` for Chennai) and request a visit.
4. **ZEISS dashboard** (`/zeiss.html`). Aggregates across the demo network: screening lanes and review times, interview answer modes (spoken, tapped, typed), store KPIs, patient-app self-tests, calendar use and clinician verification. It carries no names or phone numbers.
5. **Test screen** (`/display.html`) on a laptop. It signs in as the shop (an account, or a demo shop), is found by the shop's devices with no code, and the patient answers by scanning its QR code. A demo shop can run a short demo test on the screen itself.

- **Shop accounts also work:** create one on the first screen of the store app; sign in from a second browser and tick *shared computer* to see the camp-computer mode.
- **Deployed servers with a portal token:** if a review or rule edit answers "portal token required", open the portal once as `/portal.html#token=<key given in the submission>`. The portal's *Set up identity encryption* creates the hub key that opens sealed patient names.
- **Demo video:** _link added in the submission form_.
- Microphone, camera and video calls need HTTPS (the live link has it; on localhost they work too).
- **Demo data resets.** The live demo runs on a free host that restarts from time to time. The demo patients, demo shops, demo clinicians and the 13 sample cases in the portal always come back. Anything a visitor adds, such as shop accounts, clinician registrations, cases sent to the portal, reviews, bookings, shared links and rule edits, is cleared on restart, and a phone that was signed in to a shop account will need that account created again. Data kept on a phone or browser (PIN, locally saved patients) is not affected.

## Run it

```bash
# server + both web apps (Python 3.12)
python -m venv .venv && .venv/Scripts/pip install -r server/requirements-dev.txt   # Windows
uvicorn server.app:app --reload --port 8000
# or, for a phone demo on the same Wi-Fi:  powershell -ExecutionPolicy Bypass -File tools\run_demo.ps1
```

- Optical store (phone): <http://localhost:8000/>. Choose **Explore the demo**, then try a **demo patient** to watch the full adaptive flow without a microphone. **Phone check** verifies voices, microphone, camera and calibration.
- Optometrist portal: <http://localhost:8000/portal.html>. Choose **Explore the demo**; *Set up identity encryption* creates the hub key.
- Patient app: <http://localhost:8000/patient.html> · ZEISS dashboard: <http://localhost:8000/zeiss.html> · Test screen: <http://localhost:8000/display.html> · Story page: <http://localhost:8000/about.html>
- API docs: <http://localhost:8000/docs>

**Phone demo:** voice and camera need HTTPS. See `docs/PHONE_DEMO_SETUP.md` (quick tunnel, Cloud Run, or the same-Wi-Fi Chrome flag) and the phone's voice-data setup.

## Tests

```bash
npm test                                      # 122 engine tests: graded red-flag scenarios, hub rule edits, 6-language parsing, Rx,
                                              #   adaptive paths, profile, optics, contrast/colour/charts, lensometry,
                                              #   crypto (PIN vault, hub sealing, share links), decision path
.venv/Scripts/python -m pytest tests/server   # 30 API tests: shop accounts and sync, rule edits, chart-screen pairing, video-consult signalling, idempotency, consent, queue, review, FHIR, erasure,
                                              #   identity stripping, hub key, audit log, headers, retention, share links
BASE=http://127.0.0.1:8000 python tests/e2e/smoke.py   # real browser: hub key -> PIN -> interview -> reload/resume
                                                      #   -> checks -> sealed send -> review -> access log -> reply
npm run seed                                  # rebuild server/seed_cases.json from the personas
```

## Layout

| Path | What |
|---|---|
| `web/js/engine/` | Pure, tested clinical core: `questions.js` (38-question bank with eligibility rules and reasons), `redflags.js` (43 graded referral rules with references), `adaptive.js` (engine), `profile.js` (vision profile, lens, test plan and findings, decision path, data quality), `parse.js` (answers in six languages), `rx.js` (spoken prescriptions) |
| `web/js/lang/` | One pack per Indian language (`hi.js`, `ta.js`, `te.js`, `mr.js`, `kn.js`): UI, questions, answer keywords, colloquial yes/no, passport, reply templates. A native reviewer checks one file. |
| `web/js/measure/` | `geometry.js` (iris distance, PD with convergence correction, head-pose gate, Prentice, optotype sizes), `acuity.js` (staircase), `contrast.js` (Landolt C contrast), `plates.js` (colour plates), `charts.js` (N chart, astigmatism dial, duochrome), `lensometer.js` (camera lensometry), `face.js` (MediaPipe) |
| `web/js/tests_ui.js` | Screens for the extra tests |
| `web/js/share.js`, `share.html` | Encrypted, expiring share links and the patient's viewer; `qr.js` (vendored qrcode-generator, MIT) |
| `web/js/crypto.js` | WebCrypto: PIN vault, AES-256-GCM, identity sealing to the hub |
| `web/js/app.js`, `dashboard.js`, `account.js` | Optical store app (offline-first PWA, encrypted IndexedDB queue, autosave, phone check), its sales/orders dashboard, shop accounts |
| `web/js/portal.js`, `call.js` | Optometrist portal: sign-in and registration, review queue, calendar, linked shops, hub keys, access log, camp planning, video consult |
| `web/patient.html`, `js/patient.js`, `js/patient/`, `css/patient.css` | Patient app: voice self-checks, booking at network shops, eye record |
| `web/zeiss.html`, `js/zeiss.js`, `css/zeiss.css` | ZEISS network dashboard (de-identified aggregates) |
| `web/display.html`, `js/display.js`, `remote.js`, `answer.html` | Test screen for the shop, its phone remote and the patient's answer page opened from the QR code |
| `web/css/app.css`, `portal.css` | Design system "Porcelain and cobalt": Newsreader display, Instrument Sans UI, Geist Mono for measurements (all self-hosted, OFL); urgency colours reserved for triage. The decisions are recorded in `.interface-design/system.md` |
| `web/about.html`, `css/about.css`, `js/about.js` | Product story page |
| `server/` | FastAPI + SQLite bridge (`app.py`), care network (`network.py`: shops, clinicians, links, calendar, requests, telemetry, ZEISS aggregates), patient accounts and records (`patients.py`), FHIR R4 export, audit log, retention, security headers |
| `docs/` | `REFERRAL_RULES.md` (generated by `node tools/rules_table.mjs`), `CLINICAL_LOGIC.md`, `NETWORK_API.md` (care network API and demo accounts), `PRIVACY_SECURITY.md`, `BRIDGE.md`, `PHONE_DEMO_SETUP.md`, `DEMO_SCRIPT.md` |

## Honest status

- Clinical rules are **proposed** and must be reviewed by optometrists before any patient use. Nothing here diagnoses; the optometrist confirms every power.
- Camera measurements and lensometry are implemented and unit-tested on synthetic images, but they are **not yet validated against a pupillometer, lensmeter or ruler on real faces and real glasses**. Contrast and colour run on uncalibrated phone screens: screening only. That is the first pilot task (`docs/BRIDGE.md`).
- All Hindi, Tamil, Telugu, Marathi and Kannada text was drafted by the team and needs native-speaker review at the pilot sites.
- All patients, shops, clinicians and sales figures in the repo and the live demo are synthetic. Clinician verification in the demo is simulated: the council numbers are made up and nothing is checked against a real registry.
- The ZEISS dashboard is open in demo deployments; set `DD_ADMIN_TOKEN` to require a token. The portal's shared `DD_PORTAL_TOKEN` is not per-user login (see `docs/PRIVACY_SECURITY.md`).
