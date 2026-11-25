# Care network API

`server/network.py`. All paths are under `/api`. Times are ISO 8601. Slot times carry the India offset (`+05:30`).

## Who is calling

| Caller | How it identifies itself |
|---|---|
| Clinician (optometrist or ophthalmologist) | `X-Clin-Token` from `POST /clin/login`, `POST /clin/register` or `POST /clin/demo` |
| Shop with an account | `X-Shop-Token`, the shop account session from the optical store app |
| Demo shop (phone used without an account) | `X-Shop-Code: DDS-VEL01`; works for seeded demo shops only |
| Network admin (ZEISS dashboard) | `X-Admin-Token`, required only when `DD_ADMIN_TOKEN` is set; open in demo deployments |
| Patient app | anonymous; an appointment request is read back with its own secret |

**Seeded demo shops:**

| Code | Shop | Kind | State |
|---|---|---|---|
| `DDS-VEL01` | Chennai Optics, Velachery | store | Tamil Nadu |
| `DDS-KPM01` | Eye camp, Kanchipuram | camp | Tamil Nadu |
| `DDS-UPL01` | Sri Sai Opticals, Uppal | store | Telangana |
| `DDS-NSK01` | Patil Optics, Nashik | store | Maharashtra |
| `DDS-BMH01` | Eye camp, Bommanahalli | camp | Karnataka |
| `DDS-TBM01` | Nethra Opticals, Tambaram | store | Tamil Nadu |

**Seeded demo clinicians:**

| Code | Clinician | Role | Status |
|---|---|---|---|
| `DDO-MEEN1` | Optom. A. Meenakshi | optometrist | verified; the default demo session |
| `DDO-RAMN1` | Dr. S. Raman | ophthalmologist | verified |
| `DDO-PRIY1` | Optom. P. Priya | optometrist | verified |
| `DDO-FARQ1` | Optom. K. Farooq | optometrist | pending, so the admin can verify him |

## Clinicians

- `POST /clin/register` creates an account with status `pending` and returns `{token, expiresAt, clinician}`.
  - Body: `{name, role: optometrist|ophthalmologist, regNo, council, qualification, practiceArea, practicePin (6 digits), login (phone or email), password (min 8), attest: true}`
- `POST /clin/login` with `{login, password}` returns `{token, expiresAt, clinician}`. Five failures lock the login for 15 min; a rejected registration gets 403.
- `POST /clin/demo?as=DDO-MEEN1` returns `{token, clinician, demo: true}`: a verified demo clinician, no account needed.
- `GET /clin/me` returns `{clinician, demo, links[]}`.
- `POST /clin/logout`
- `GET /clin/directory?pin=600042` lists verified clinicians, nearest PIN first. Used by shops looking for someone to link with.
- `GET /clin/cases` returns `{scope: all|linked, cases[]}`, the same case summaries as `GET /cases`. A demo session sees all cases; a real clinician sees cases from active linked shops only.
- Signing off: `POST /cases/{id}/review` with `X-Clin-Token` signs as that clinician. It returns 403 while the clinician's registration is pending.

Clinician object:

```
{code, name, role, qualification, area, pin, status, demo,
 regNo, council, login, createdAt, verifiedAt, verifiedBy, note}
```

Everything from `regNo` onwards is returned to the clinician themselves only.

## Shops

- `GET /shops?pin=600040` lists shops for the patient app, nearest PIN first:

  ```
  [{code, name, kind, area, pin, city, state, demo, optometrist: bool, ophthalmologist: bool, distance}]
  ```

- `GET /shops/me` returns `{shop, links[]}`. `PUT /shops/me` takes `{name?, kind, area?, pin?, city?, state?}`. A shop account gets its `DDS-` code the first time it calls either.

## Links (many shops to many clinicians)

Link object:

```
{shopCode, shopName, shopKind, shopArea, shopPin, shopCity,
 clinicianCode, clinicianName, clinicianRole, clinicianStatus, clinicianArea,
 role, roleLabel, status: requested|active, requestedBy, createdAt}
```

- Roles: `primary` (Primary optometrist), `tele` (Tele-optometrist), `visiting_ophth` (Visiting ophthalmologist), `referral_ophth` (Referral ophthalmologist).
- `POST /links` (shop) with `{clinicianCode, role}` sends a request. A demo shop asking a demo clinician is accepted at once.
- `POST /links/{shopCode}/accept` (clinician) accepts a request.
- `DELETE /links?shopCode=&clinicianCode=` (either side) removes a link.

## Calendar

Slot object:

```
{id, start, end, mode: video|in_person|camp, place, placeName,
 clinicianCode, clinicianName, clinicianRole, note, booked,
 booking?: {id, shopCode, patientRef, caseRef, reason, status}}
```

- `booking` is included for the clinician who owns the slot, and for the shop that made the booking.
- `GET /slots`:
  - with `X-Clin-Token`: your own slots, from today, for 14 days;
  - with a shop header: future slots of your active linked clinicians;
  - with `?clinician=DDO-...`: one clinician's slots;
  - `?from=&to=` set the range.
- `POST /slots` (clinician) with `{date: YYYY-MM-DD, start: HH:MM, end: HH:MM, minutes, mode, place: "video" | linked shop code, note?}` creates back-to-back slots and returns `{created}`.
- `DELETE /slots/{id}` (clinician) works only if the slot is unbooked.
- `POST /bookings` (shop) with `{slotId, patientRef (initials or case code, never a full name), caseRef?, reason?, requestId?}` books a slot. It returns 409 if the slot is taken or past, and 403 if the shop is not linked to that clinician.
- `GET /bookings` returns the shop's or clinician's bookings from yesterday onwards.
- `PATCH /bookings/{id}` with `{status: booked|confirmed|done|cancelled|no_show}`.

## Appointment requests (patient app → shop)

- `POST /requests` with `{shopCode, kind: routine|with_optometrist, preferred?, note?, name, phone, selftest?, consent: true}` returns `{id, secret}`.
  - The patient app keeps `id` and `secret` on the device.
  - The name and phone are deleted with the request after 30 days.
- `GET /requests/{id}?s=secret` returns `{status, reply, kind, shopName, shopArea, updatedAt, appointment?: {start, end, mode, clinicianName, clinicianRole, placeName, status}}`.
- `GET /requests` (shop) returns `[{id, kind, preferred, note, name, phone, selftest, status, reply, bookingId, createdAt}]`.
- `PATCH /requests/{id}` (shop) with `{status: new|accepted|booked|declined|done, reply?}`. Booking a slot with `requestId` marks the request `booked`.

## De-identified telemetry

- `PUT /metrics` (shop) with `{day, counters: {...}}` sends that day's totals.
  - Allowed counters: `screened`, `ordersCreated`, `ordersDelivered`, `ordersReady`, `remakes`, `cancellations`, `zeissLensOrders`, `glassesSold`, `walkInRx`, `turnaroundDaysSum`, `turnaroundCount`.
  - Counts only: no names, no amounts.
- `POST /selftests` (patient app, anonymous) with `{test: acuity|near|amsler|colour|contrast|astigmatism, outcome: looks_good|follow_up|see_soon, ageBand: <18|18-39|40-59|60+|unknown}`.

## ZEISS network dashboard

- `GET /zeiss/overview` returns aggregates only, in these groups:

  | Group | Contents |
  |---|---|
  | `network` | shops, clinicians verified and pending, links |
  | `screening` | cases, lanes, urgency, referral rate, review within target, median review minutes by lane, 30 days of daily counts, top rules, decisions |
  | `interview` | median questions asked, minutes, answer modes, languages |
  | `tests` | tests done, simulated share, patient-phone share, data quality |
  | `lenses` | ZEISS lens families recommended |
  | `field` | screened, orders, delivered, remake, cancellation and ZEISS-share rates, walk-in prescriptions, turnaround, daily orders |
  | `patientApp` | self-tests by test and outcome, age bands, requests, request-to-booking rate |
  | `calendar` | upcoming slots, booked, utilisation by mode, cancellations and no-shows |
  | `shops[]` | per-shop KPIs, de-identified |
  | `versions` | app and rules versions in use |

- `GET /zeiss/clinicians?status=pending` lists registrations for verification (registration number and council, no contact details).
- `POST /zeiss/clinicians/{code}/verify` with `{decision: verified|rejected, note?, by?}`.

## Camp planning

- `GET /network/planning` (optional `X-Clin-Token`) returns per shop:

  ```
  {code, name, kind, area, city, state, pin, cases, red, amber, green, open,
   pins: [{pin, cases, referred}], topFlags}
  ```

  A real clinician sees their linked shops; a demo session or no token sees all.

## Patient phone as the answer pad (chart screen)

The shop phone controls the session with `X-Display-Controller`:

- `POST /display/answers/session` starts a new code for the next patient; the previous patient's code stops working.
- `DELETE /display/answers/session` ends it.
- `GET /display/answers?since=` returns `{active, joined, answers: [{seq, value, chart}], seq}`.

The chart screen reads `answerToken` and `answerJoined` from `GET /display/state` and shows the QR code for `answer.html#<token>`.

The patient's phone, with `X-Answer-Token`:

- `GET /answer/state` returns `{active, chart, eye, optotype, index, n, answered}`. It returns 410 once the session has ended.
- `POST /answer` with `{value}`. Values: `up`, `down`, `left`, `right`, `cant`, digits for a plate (`74`), `none`, `red`, `green`, `equal`, `yes`, `no`, dial `line1`…`line6` or `even`, near `N5`…`N24`.

## Patient record (server/patients.py)

Patients never type their history in. Shops push it, by the patient's mobile number, with the patient's consent recorded at the counter.

| Call | Who | What |
|---|---|---|
| `POST /api/patient/code` `{phone}` | patient | Starts sign-in. There is no SMS gateway in this build, so the one-time code comes back as `demoCode` and the app shows it. |
| `POST /api/patient/login` `{phone, code}` | patient | Returns `{token}`; send it as `X-Patient-Token`. Five wrong codes end the code. |
| `POST /api/patient/demo` | anyone | Signs in as the demo patient (Lakshmi R.), who has a seeded history. |
| `GET /api/patient/record` | patient | Visits, prescriptions and glasses orders, newest first. |
| `DELETE /api/patient/record/{id}` | patient | Removes one entry. |
| `POST /api/patient/records` `{phone, kind: visit\|rx\|order, ref, date, consent: true, data}` | shop (`X-Shop-Token` or demo `X-Shop-Code`) | Adds an entry, or updates it in place when the same shop sends the same `ref` again (order status changes). |

Phone numbers are stored only as an HMAC-SHA256 under a per-server secret. When an optometrist signs off a case, the review is added to the patient's visit for that case.

## The shop's test screen

`POST /api/display` with shop headers (`X-Shop-Token`, or a demo `X-Shop-Code`) opens a chart screen that belongs to that shop, with no pairing code. The shop's own phone or computer then calls `POST /api/display/connect` with the same shop headers, which returns `{found, controller}` for the shop's most recently seen screen. `GET /api/display/state` reports `shop` and `phoneConnected`. The older code pairing (`POST /api/display` without shop headers, then `/api/display/claim`) still works for older phones.

## Shops near a PIN code

`GET /api/shops?pin=` returns only shops in the same postal district (the first 3 digits of the PIN code) that are linked to at least one verified clinician.
