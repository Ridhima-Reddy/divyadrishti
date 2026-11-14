# DivyaDrishti

**A voice-first, adaptive eye-care interview that turns the phone a small optical store or eye-camp volunteer already owns into the front door to a remote optometrist.**

ZEISS Hackathon 2026 · Theme 3: No-Device Vision Intelligence & Accessible Clinical UX
Team: Ridhima · Kedar · Venkatesh · Rohit (IIT Madras)

---

## What it does

1. **Adaptive voice anamnesis in six languages:** English, Hindi, Tamil, Telugu, Marathi and Kannada, written the way people speak, not as textbook translations. The patient talks; the phone listens until they pause (2.5 s, or 4 s with *More time*, up to 30 s, with a *Done speaking* button) and parses the answer, including native number words and fractions (ढाई, अडीच, ಎರಡೂವರೆ…), code-mixed speech ("sugar irukku", "BP undi") and dictated prescriptions. It asks only what can change the outcome for *this* patient, and says why. The app opens in the phone's own language (or English); the operator's language and the patient's language are chosen separately. Low-confidence speech is confirmed by tap.
2. **Clinically graded red flags.** One symptom per question, each about something NEW or SUDDEN, with follow-ups only after a yes. Five tiers with a time to care: **emergency** (same day: chemical or high-speed injury, fixed curtain, sudden loss within 2 days, angle-closure signs, contact-lens keratitis, double vision with neurological signs), **urgent** (18 h to 2 weeks: crop-leaf scratch, new floaters, painful red eye, new Amsler distortion, white pupil glow), **soon** (2–6 weeks), **routine** and **note**. Only emergencies go to hospital today; the full table with references, and the list of things that are *not* red flags, is in the app, the portal and `docs/REFERRAL_RULES.md`.
3. **Ask, then measure: 12 tests on the phone.** All five checks of the ZEISS Online Vision Screening (Landolt C or tumbling-E acuity with pinhole retest, Landolt C contrast sensitivity, colour number plates, astigmatism dial, Amsler grid), plus duochrome, an N-chart near test in the patient's language, and camera measurements (reading distance, focusing near point, convergence near point, PD and fitting height). **Lensometry:** the rear camera reads the power of the patient's current glasses from how a checkerboard is magnified through the lens. Every test is always listed; the engine marks the ones that matter for this patient and why.
4. **Functional Vision Profile.** Hours at near, arm's length and distance, mapped to the **Balanced / Intermediate / Near** design options that ZEISS individual progressive lenses already take. It adds an estimated reading add (Hofstetter amplitude at the *measured* working distance), child myopia risk, a triage lane and a lens category. A **decision path** shows each rule checked, **data quality** says what was measured versus assumed, and each case records its **rules version**.
5. **Remote Optometrist Bridge.** Cases are stored encrypted on the phone and sent when signal returns. Optometrists review them against response-time targets set by the most urgent finding (emergency 2 h, urgent 24 h, others 72 h), sign off or redirect, and send a **PIN-protected referral letter** to the hospital. Every case exports as a FHIR R4 bundle.
6. **Private by design.** Data on the phone is encrypted (AES-256-GCM, PIN-protected). The server never sees names or phone numbers: they are sealed to the optometrist hub's key (ECDH P-256), and only the hub's browser can open them. Patient files are shared as **end-to-end encrypted, expiring links** (key in the link's fragment, optional PIN, QR code), never as plaintext WhatsApp/SMS. Every access is logged, reviewed cases expire, and strict security headers apply. See `docs/PRIVACY_SECURITY.md`.
7. **Works on a phone, a laptop or a desktop.** One column on phones; two or three columns on wider screens (interview with the answers so far beside it, the test battery in a grid, the profile next to the recommendation).

## Run it

```bash
# server + both web apps (Python 3.12)
python -m venv .venv && .venv/Scripts/pip install -r server/requirements-dev.txt   # Windows
uvicorn server.app:app --reload --port 8000
# or, for a phone demo on the same Wi-Fi:  powershell -ExecutionPolicy Bypass -File tools\run_demo.ps1
```

- Field app (phone): <http://localhost:8000/>. Set a PIN, then try a **demo patient** (13 synthetic patients across six languages) to watch the full adaptive flow without a microphone. **Phone check** verifies voices, microphone, camera and calibration.
- Optometrist portal: <http://localhost:8000/portal.html>. Click *Set up identity encryption* first.
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
| `web/js/app.js` | Field app (offline-first PWA, encrypted IndexedDB queue, autosave, phone check) |
| `web/js/portal.js` | Optometrist Bridge portal, hub keys, access log, camp-planning view |
| `server/` | FastAPI + SQLite bridge, FHIR R4 export, audit log, retention, security headers |
| `docs/` | `REFERRAL_RULES.md` (generated by `node tools/rules_table.mjs`), `CLINICAL_LOGIC.md`, `PRIVACY_SECURITY.md`, `BRIDGE.md`, `PHONE_DEMO_SETUP.md`, `DEMO_SCRIPT.md` |

## Honest status

- Clinical rules are **proposed** and must be reviewed by optometrists before any patient use. Nothing here diagnoses; the optometrist confirms every power.
- Camera measurements and lensometry are implemented and unit-tested on synthetic images, but they are **not yet validated against a pupillometer, lensmeter or ruler on real faces and real glasses**. Contrast and colour run on uncalibrated phone screens: screening only. That is the first pilot task (`docs/BRIDGE.md`).
- All Hindi, Tamil, Telugu, Marathi and Kannada text was drafted by the team and needs native-speaker review at the pilot sites.
- All patients in the repo are synthetic.
