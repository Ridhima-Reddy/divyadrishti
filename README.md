# DivyaDrishti

**A voice-first, adaptive eye-care interview that turns the phone a small optical store or eye-camp volunteer already owns into the front door to a remote optometrist.**

ZEISS Hackathon 2026 · Theme 3: No-Device Vision Intelligence & Accessible Clinical UX
Team: Ridhima · Kedar · Venkatesh · Rohit (IIT Madras)

## Live demo

Start at the story page: <https://divyadrishti-3dn2.onrender.com/about.html>. Every app opens with **Explore the demo (no sign-in)**.

| App | Link |
|---|---|
| Story page | <https://divyadrishti-3dn2.onrender.com/about.html> |
| Optical store app | <https://divyadrishti-3dn2.onrender.com/> |
| Optometrist portal | <https://divyadrishti-3dn2.onrender.com/portal.html> |
| Patient app | <https://divyadrishti-3dn2.onrender.com/patient.html> |
| ZEISS dashboard | <https://divyadrishti-3dn2.onrender.com/zeiss.html> |
| Test screen | <https://divyadrishti-3dn2.onrender.com/display.html> |

The free host sleeps when idle, so the first request can take about a minute. Demo data resets on restart. Microphone and camera need HTTPS (the live link has it).

## What it does

- **Adaptive voice interview** in seven languages: English, Hindi, Tamil, Telugu, Marathi, Kannada and Bengali. It asks only what can change the outcome for this patient. Demo patients play the whole interview without a microphone.
- **Graded red flags** in five tiers (emergency, urgent, soon, routine, note), each with a time to care. See `docs/REFERRAL_RULES.md`.
- **12 tests on the phone:** the five ZEISS Online Vision Screening checks, duochrome, a near-vision chart, camera measurements and lensometry.
- **Functional vision profile** mapped to the Balanced / Intermediate / Near design options of ZEISS individual progressive lenses.
- **Remote optometrist bridge:** cases are stored encrypted on the phone, sent when signal returns, reviewed and signed off in the portal, and exported as FHIR R4.
- **Care network:** a patient app, shop-linked test screen and a ZEISS dashboard built from de-identified aggregates. API in `docs/NETWORK_API.md`.
- **Private by design:** see `docs/PRIVACY_SECURITY.md`.

## Run it

```bash
python -m venv .venv && .venv/Scripts/pip install -r server/requirements-dev.txt   # Windows
uvicorn server.app:app --reload --port 8000
```

Then open <http://localhost:8000/> (also `/portal.html`, `/patient.html`, `/zeiss.html`, `/display.html`, `/about.html`). API docs at `/docs`. For a phone demo see `docs/PHONE_DEMO_SETUP.md`.

## Tests

```bash
npm test                                      # 122 engine tests
.venv/Scripts/python -m pytest tests/server   # 30 API tests
```

## Layout

| Path | What |
|---|---|
| `web/` | The six pages, with `js/engine/` (tested clinical core), `js/lang/` (language packs) and `js/measure/` (camera and chart tests) |
| `server/` | FastAPI + SQLite: bridge, care network (`network.py`), patients (`patients.py`), FHIR export |
| `docs/` | Referral rules, clinical logic, network API, privacy, bridge, phone demo setup |
| `tests/`, `tools/` | Engine and server tests, seed and demo scripts |

## Honest status

- Clinical rules are **proposed** and need optometrist review before any patient use. Nothing here diagnoses.
- Camera measurements and lensometry are unit-tested on synthetic images but **not yet validated on real faces and glasses**. Contrast and colour run on uncalibrated screens: screening only.
- Non-English text was drafted by the team and needs native-speaker review.
- All patients, shops and clinicians in the repo and the live demo are synthetic.
