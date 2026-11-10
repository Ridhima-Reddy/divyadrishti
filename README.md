# DivyaDrishti

**A voice-first, adaptive eye-care interview that turns the phone a small optical store or eye-camp volunteer already owns into the front door to a remote optometrist.**

ZEISS Hackathon 2026 · Theme 3: No-Device Vision Intelligence & Accessible Clinical UX
Team: Ridhima · Kedar · Venkatesh · Rohit (IIT Madras)

---

## What it does

1. **Adaptive voice anamnesis** in Tamil, Hindi or English. The patient talks; the phone listens, parses the answer (Tamil and Hindi number words, code-mixed speech, dictated prescriptions) and asks only what can change the outcome for *this* patient. A red flag (sudden vision loss, painful red eye, white pupil in a child) switches to urgent mode immediately.
2. **Ask, then measure.** ZEISS's own SmartLife Individual 3 research found self-reported viewing behaviour differs markedly from objective measurement, so the phone camera measures what questionnaires guess:
   - habitual reading distance and near point (iris as a ruler, MediaPipe on-device),
   - pupillary distance and fitting height (centration),
   - tumbling-E distance acuity with a paper-pinhole retest, and an Amsler grid.
3. **Functional Vision Profile.** Hours at near, arm's length and distance, mapped to the **Balanced / Intermediate / Near** design options that ZEISS individual progressive lenses already take, plus an estimated reading add (Hofstetter amplitude at the *measured* working distance), child myopia risk, triage lane and a lens category.
4. **Remote Optometrist Bridge.** Cases are stored on the phone and sent when signal returns. Optometrists review them by lane against response-time targets (red 2 h, amber 24 h, green 72 h), sign off or redirect, and the reply goes back to the patient as a **Vision Passport** in their language (WhatsApp/SMS). Every case exports as a FHIR R4 bundle.

## Run it

```bash
# server + both web apps (Python 3.12)
python -m venv .venv && .venv/Scripts/pip install -r server/requirements-dev.txt   # Windows
uvicorn server.app:app --reload --port 8000
```

- Field app (phone): <http://localhost:8000/>. Try a **demo patient** on the home screen to watch the full adaptive flow without a microphone.
- Optometrist portal: <http://localhost:8000/portal.html> (8 synthetic cases are seeded).
- API docs: <http://localhost:8000/docs>

Voice and camera need HTTPS on a phone (localhost is exempt). For a phone demo, deploy to Cloud Run (`Dockerfile` included, region `asia-south1`) or use a tunnel.

**Browsers.** Chrome on Android: speech recognition for `ta-IN`, `hi-IN`, `en-IN`; Google TTS voices if installed. Edge on desktop has natural Tamil and Hindi voices. Without speech support the app falls back to large tap buttons, and it never reads Tamil with an English voice.

## Tests

```bash
npm test                                   # 44 engine tests: parsing, Rx, adaptive paths, profile, optics
.venv/Scripts/python -m pytest tests/server   # 8 API tests: idempotency, consent, queue, review, FHIR, erasure
BASE=http://127.0.0.1:8000 python tests/e2e/smoke.py   # real browser: interview -> checks -> send -> review -> reply
npm run seed                               # rebuild server/seed_cases.json from the personas
```

## Layout

| Path | What |
|---|---|
| `web/js/engine/` | Pure, tested clinical core: `questions.js` (30-question bank with eligibility rules and reasons), `adaptive.js` (engine), `profile.js` (vision profile, triage, lens), `parse.js` (en/hi/ta answers), `rx.js` (spoken prescriptions) |
| `web/js/measure/` | `geometry.js` (iris distance, PD with convergence correction, Prentice, optotype sizes), `acuity.js` (tumbling-E staircase), `face.js` (MediaPipe) |
| `web/js/app.js` | Field app (offline-first PWA, IndexedDB queue) |
| `web/js/portal.js` | Optometrist Bridge portal and camp-planning view |
| `server/` | FastAPI + SQLite bridge, FHIR R4 export |
| `docs/` | `CLINICAL_LOGIC.md` (rules + evidence), `BRIDGE.md` (operating model), `DEMO_SCRIPT.md` |

## Honest status

- Clinical rules are **proposed** and must be reviewed by optometrists before any patient use. Nothing here diagnoses; the optometrist confirms every power.
- Camera measurements are implemented and their geometry is unit-tested, but they are **not yet validated against a pupillometer, autorefractor or ruler on real faces**. That is the first pilot task (`docs/BRIDGE.md`).
- Hindi and Tamil text was drafted by the team and needs native-speaker review at the pilot sites.
- All patients in the repo are synthetic.
