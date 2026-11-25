"""The care network around the cases: who is who, who works with whom, and when.

- Clinicians (optometrists and ophthalmologists) register with their council
  registration number and are verified by the network admin (the ZEISS
  dashboard) before they can sign off cases. Judges and visitors use a demo
  session instead of an account.
- Shops and camps have a public code (DDS-...). A shop can work with several
  clinicians and a clinician with many shops: links are many-to-many, each with
  a role (primary optometrist, visiting ophthalmologist, tele-optometrist).
- Clinicians publish time slots; linked shops book them for a patient. Only a
  patient reference (initials or case code) reaches the server, never a name.
- The patient app can ask a shop for an appointment. The name and phone the
  patient types are kept for 30 days so the shop can call back, then deleted.
- Shops report daily de-identified counters (orders, remakes, cancellations,
  ZEISS lens orders); the patient app reports anonymous self-test outcomes.
  The ZEISS dashboard sees only these aggregates.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any, Callable, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api")
IST = timezone(timedelta(hours=5, minutes=30))
CLIN_TTL = timedelta(hours=12)
REQUEST_KEEP = timedelta(days=30)
ADMIN_TOKEN = os.environ.get("DD_ADMIN_TOKEN")  # set in production: required to verify clinicians
B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# filled by init() from app.py: the case store and helpers
ctx: dict[str, Any] = {}
fail_lock = threading.Lock()
failures: dict[str, list[datetime]] = {}

ROLES = {
    "primary": "Primary optometrist",
    "tele": "Tele-optometrist",
    "visiting_ophth": "Visiting ophthalmologist",
    "referral_ophth": "Referral ophthalmologist",
}
METRIC_KEYS = {"ordersCreated", "ordersDelivered", "ordersReady", "remakes", "cancellations", "zeissLensOrders",
               "glassesSold", "walkInRx", "screened", "turnaroundDaysSum", "turnaroundCount"}
SELFTESTS = {"acuity", "near", "amsler", "colour", "contrast", "astigmatism"}
# lens categories from the vision profile -> the ZEISS lens family a shop would discuss
ZEISS_FAMILY = {
    "progressive": "ZEISS SmartLife Progressive", "office": "ZEISS Officelens", "bifocal": "ZEISS bifocal / SmartLife Progressive",
    "readers": "ZEISS SmartLife Single Vision (near)", "sv_distance": "ZEISS SmartLife Single Vision",
    "separate_pairs": "ZEISS SmartLife Single Vision (two pairs)", "child_refraction": "ZEISS MyoCare (after refraction)",
}


def now() -> datetime:
    return ctx["now"]()


def iso(dt: datetime) -> str:
    return ctx["iso"](dt)


def db():
    return ctx["store"].db


def lock():
    return ctx["store"].lock


def audit(actor: str, action: str, detail: str = "") -> None:
    ctx["store"].audit(actor, action, None, detail[:300])


def code(prefix: str) -> str:
    return f"{prefix}-{''.join(secrets.choice(B32) for _ in range(5))}"


def pw_hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 210_000).hex()


def pin_distance(a: Optional[str], b: Optional[str]) -> int:
    try:
        return abs(int(a or 0) - int(b or 0)) if a and b else 10 ** 7
    except ValueError:
        return 10 ** 7


def init(store: Any, *, now_fn: Callable, iso_fn: Callable, full_case: Callable, row_summary: Callable, norm_login: Callable, shop_session: Callable, seed: bool) -> None:
    ctx.update(store=store, now=now_fn, iso=iso_fn, full_case=full_case, row_summary=row_summary, norm_login=norm_login, shop_session=shop_session)
    with store.lock:
        store.db.executescript(
            """CREATE TABLE IF NOT EXISTS clinicians (
                id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, login TEXT UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
                reg_no TEXT NOT NULL, council TEXT NOT NULL, qualification TEXT, practice_area TEXT, practice_pin TEXT,
                salt TEXT, pw_hash TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, verified_at TEXT, verified_by TEXT,
                note TEXT, demo INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS clin_sessions (
                token_hash TEXT PRIMARY KEY, clinician_id TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT, expires_at TEXT);
            CREATE TABLE IF NOT EXISTS shops (
                code TEXT PRIMARY KEY, account_id TEXT UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'store',
                area TEXT, pin TEXT, city TEXT, state TEXT, created_at TEXT, demo INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS links (
                shop_code TEXT NOT NULL, clinician_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
                requested_by TEXT, created_at TEXT, PRIMARY KEY (shop_code, clinician_id));
            CREATE TABLE IF NOT EXISTS slots (
                id TEXT PRIMARY KEY, clinician_id TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
                place TEXT NOT NULL, mode TEXT NOT NULL, note TEXT, created_at TEXT);
            CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY, slot_id TEXT UNIQUE NOT NULL, shop_code TEXT NOT NULL, patient_ref TEXT, case_ref TEXT,
                reason TEXT, status TEXT NOT NULL, request_id TEXT, created_at TEXT, updated_at TEXT);
            CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, shop_code TEXT NOT NULL, kind TEXT NOT NULL, preferred TEXT,
                note TEXT, name TEXT, phone TEXT, selftest TEXT, status TEXT NOT NULL, reply TEXT, booking_id TEXT,
                created_at TEXT, updated_at TEXT);
            CREATE TABLE IF NOT EXISTS metrics (
                shop_code TEXT NOT NULL, day TEXT NOT NULL, k TEXT NOT NULL, v REAL NOT NULL, PRIMARY KEY (shop_code, day, k));
            CREATE TABLE IF NOT EXISTS selftests (
                id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, test TEXT, outcome TEXT, age_band TEXT);"""
        )
        store.db.commit()
        empty = not store.db.execute("SELECT 1 FROM clinicians LIMIT 1").fetchone()
    if seed and empty:
        seed_network()
    elif seed:
        ensure_demo_shops()
    purge()


# ---------------------------------------------------------------- demo network
DEMO_SHOPS = [
    ("DDS-VEL01", "Chennai Optics, Velachery", "store", "Velachery", "600042", "Chennai", "Tamil Nadu"),
    ("DDS-KPM01", "Eye camp, Kanchipuram", "camp", "Kanchipuram", "631501", "Kanchipuram", "Tamil Nadu"),
    ("DDS-UPL01", "Sri Sai Opticals, Uppal", "store", "Uppal", "500039", "Hyderabad", "Telangana"),
    ("DDS-NSK01", "Patil Optics, Nashik", "store", "College Road", "422001", "Nashik", "Maharashtra"),
    ("DDS-BMH01", "Eye camp, Bommanahalli", "camp", "Bommanahalli", "560068", "Bengaluru", "Karnataka"),
    ("DDS-TBM01", "Nethra Opticals, Tambaram", "store", "Tambaram", "600045", "Chennai", "Tamil Nadu"),
    ("DDS-ADY01", "Kumaran Opticals, Adyar", "store", "Adyar", "600020", "Chennai", "Tamil Nadu"),
    ("DDS-TNG01", "Lakshmi Opticals, T. Nagar", "store", "T. Nagar", "600017", "Chennai", "Tamil Nadu"),
    ("DDS-ANN01", "Vision Plus Opticals, Anna Nagar", "store", "Anna Nagar", "600040", "Chennai", "Tamil Nadu"),
    ("DDS-MYL01", "Sri Ganesh Opticals, Mylapore", "store", "Mylapore", "600004", "Chennai", "Tamil Nadu"),
    ("DDS-PRR01", "Annai Opticals, Porur", "store", "Porur", "600116", "Chennai", "Tamil Nadu"),
    ("DDS-GDY01", "Eye camp, Guindy", "camp", "Guindy", "600032", "Chennai", "Tamil Nadu"),
]
DEMO_CLIN = [
    # code, name, role, reg no, council, qualification, area, pin, status
    ("DDO-MEEN1", "Optom. A. Meenakshi", "optometrist", "TN-OPT-0000", "Indian Optometric Association (IOA)", "M.Optom", "Velachery, Chennai", "600042", "verified"),
    ("DDO-RAMN1", "Dr. S. Raman", "ophthalmologist", "TNMC-54321", "State Medical Council", "MS (Ophthalmology)", "Kanchipuram", "631501", "verified"),
    ("DDO-PRIY1", "Optom. P. Priya", "optometrist", "TS-OPT-2208", "Optometry Council of India (OCI)", "B.Optom", "Uppal, Hyderabad", "500039", "verified"),
    ("DDO-FARQ1", "Optom. K. Farooq", "optometrist", "MH-OPT-1187", "Indian Optometric Association (IOA)", "B.Optom", "Nashik", "422001", "pending"),
]
DEMO_LINKS = [
    ("DDS-VEL01", "DDO-MEEN1", "primary"), ("DDS-KPM01", "DDO-MEEN1", "tele"), ("DDS-UPL01", "DDO-MEEN1", "tele"),
    ("DDS-NSK01", "DDO-MEEN1", "tele"), ("DDS-BMH01", "DDO-MEEN1", "tele"), ("DDS-TBM01", "DDO-MEEN1", "primary"),
    ("DDS-VEL01", "DDO-RAMN1", "referral_ophth"), ("DDS-KPM01", "DDO-RAMN1", "visiting_ophth"), ("DDS-TBM01", "DDO-RAMN1", "referral_ophth"),
    ("DDS-UPL01", "DDO-PRIY1", "primary"), ("DDS-BMH01", "DDO-PRIY1", "tele"),
    ("DDS-ADY01", "DDO-MEEN1", "tele"), ("DDS-TNG01", "DDO-MEEN1", "tele"), ("DDS-ANN01", "DDO-MEEN1", "primary"),
    ("DDS-MYL01", "DDO-MEEN1", "tele"), ("DDS-PRR01", "DDO-MEEN1", "tele"), ("DDS-GDY01", "DDO-MEEN1", "primary"),
    ("DDS-ANN01", "DDO-RAMN1", "referral_ophth"), ("DDS-GDY01", "DDO-RAMN1", "visiting_ophth"), ("DDS-ADY01", "DDO-RAMN1", "referral_ophth"),
]


def ensure_demo_shops() -> None:
    """Add demo shops and links that are missing from an older demo database (idempotent)."""
    t = now()
    with lock():
        ids = {r["code"]: r["id"] for r in db().execute("SELECT id, code FROM clinicians WHERE demo = 1").fetchall()}
        if not ids:
            return
        for c, name, kind, area, pin, city, state in DEMO_SHOPS:
            db().execute("INSERT OR IGNORE INTO shops VALUES (?,?,?,?,?,?,?,?,?,1)", (c, None, name, kind, area, pin, city, state, iso(t)))
        for s, c, role in DEMO_LINKS:
            if c in ids:
                db().execute("INSERT OR IGNORE INTO links VALUES (?,?,?,?,?,?)", (s, ids[c], role, "active", "seed", iso(t)))
        db().commit()


def seed_network() -> None:
    t = now()
    rnd = secrets.SystemRandom()
    with lock():
        for c, name, kind, area, pin, city, state in DEMO_SHOPS:
            db().execute("INSERT OR IGNORE INTO shops VALUES (?,?,?,?,?,?,?,?,?,1)", (c, None, name, kind, area, pin, city, state, iso(t)))
        ids = {}
        for c, name, role, reg, council, qual, area, pin, status in DEMO_CLIN:
            cid = secrets.token_hex(8)
            ids[c] = cid
            db().execute("INSERT INTO clinicians VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                         (cid, c, None, name, role, reg, council, qual, area, pin, None, None, status, iso(t - timedelta(days=20)),
                          iso(t - timedelta(days=19)) if status == "verified" else None, "network admin (demo)" if status == "verified" else None, None))
        for s, c, role in DEMO_LINKS:
            db().execute("INSERT OR IGNORE INTO links VALUES (?,?,?,?,?,?)", (s, ids[c], role, "active", "seed", iso(t)))
        db().execute("INSERT OR IGNORE INTO links VALUES (?,?,?,?,?,?)", ("DDS-NSK01", ids["DDO-FARQ1"], "primary", "requested", "shop", iso(t)))
        # availability for the next 10 days (IST): tele slots, in-store clinics, a weekend camp
        today = datetime.now(IST).date()
        slot_ids: list[tuple[str, str, str]] = []
        for d in range(0, 10):
            day = today + timedelta(days=d)
            if day.weekday() == 6:
                continue
            for h, m in [(10, 0), (10, 20), (10, 40), (11, 0), (11, 20), (11, 40)]:
                slot_ids.append(_slot(ids["DDO-MEEN1"], day, h, m, 20, "video", "video"))
            if day.weekday() in (1, 3):
                for h, m in [(15, 0), (15, 30), (16, 0), (16, 30)]:
                    slot_ids.append(_slot(ids["DDO-MEEN1"], day, h, m, 30, "DDS-VEL01", "in_person"))
            if day.weekday() == 5:
                for h, m in [(9, 0), (9, 30), (10, 0), (10, 30), (11, 0), (11, 30), (12, 0)]:
                    slot_ids.append(_slot(ids["DDO-RAMN1"], day, h, m, 30, "DDS-KPM01", "camp"))
            if day.weekday() in (0, 2, 4):
                for h, m in [(17, 0), (17, 30)]:
                    slot_ids.append(_slot(ids["DDO-RAMN1"], day, h, m, 30, "DDS-VEL01", "in_person"))
                for h, m in [(14, 0), (14, 20), (14, 40)]:
                    slot_ids.append(_slot(ids["DDO-PRIY1"], day, h, m, 20, "DDS-UPL01", "in_person"))
        refs = ["RL · DD-4BA09D", "TG · DD-B9902B", "KM · DD-FF6D1F", "SJ · DD-6EE02F", "AD · DD-E5E39D", "walk-in · V.S.", "walk-in · M.P."]
        reasons = ["Dilated retina check (diabetes)", "New floaters: retina check", "Cataract assessment", "Prescription review",
                   "Child: cycloplegic refraction", "Progressive fitting check", "Routine eye examination"]
        picks = rnd.sample(slot_ids, k=min(9, len(slot_ids)))
        for i, (sid, place, mode) in enumerate(picks):
            shop = place if place.startswith("DDS-") else rnd.choice(["DDS-VEL01", "DDS-KPM01", "DDS-UPL01", "DDS-NSK01"])
            db().execute("INSERT INTO bookings VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (secrets.token_hex(6), sid, shop, refs[i % len(refs)], None, reasons[i % len(reasons)],
                          "confirmed" if i % 3 else "booked", None, iso(t), iso(t)))
        # appointment requests from the patient app
        for name, kind, pref, note, st in [
            ("Lakshmi", "with_optometrist", "Saturday morning", "Self-test: near vision blurry; I have diabetes", "new"),
            ("Arun", "routine", "Any evening this week", "Want new glasses, last check 3 years ago", "new"),
            ("Fathima", "with_optometrist", "Thursday", "Wavy lines on the grid test", "accepted"),
        ]:
            db().execute("INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (secrets.token_hex(6), hashlib.sha256(secrets.token_bytes(16)).hexdigest(), "DDS-VEL01", kind, pref, note, name,
                          "98765 4" + str(rnd.randint(1000, 9999)), None, st, "We will confirm your booking shortly." if st == "accepted" else None,
                          None, iso(t - timedelta(hours=rnd.randint(1, 30))), iso(t)))
        # 30 days of de-identified shop counters (synthetic)
        for c, _n, kind, *_ in DEMO_SHOPS:
            scale = 0.6 if kind == "camp" else 1.0
            for d in range(30):
                day = (today - timedelta(days=d)).isoformat()
                screened = max(0, round(rnd.gauss(7 if kind == "store" else 18, 3)))
                orders = max(0, round(screened * rnd.uniform(0.35, 0.6) * scale))
                vals = {"screened": screened, "ordersCreated": orders, "ordersDelivered": max(0, orders - rnd.randint(0, 2)),
                        "remakes": 1 if rnd.random() < 0.12 * orders / 4 else 0, "cancellations": 1 if rnd.random() < 0.08 else 0,
                        "zeissLensOrders": max(0, round(orders * rnd.uniform(0.25, 0.55))), "glassesSold": orders,
                        "walkInRx": rnd.randint(0, 3) if kind == "store" else 0,
                        "turnaroundDaysSum": round(orders * rnd.uniform(2.5, 5.5), 1), "turnaroundCount": orders}
                for k, v in vals.items():
                    db().execute("INSERT OR REPLACE INTO metrics VALUES (?,?,?,?)", (c, day, k, v))
        for d in range(30):
            day = (today - timedelta(days=d)).isoformat()
            for _ in range(rnd.randint(3, 11)):
                test = rnd.choice(["acuity", "acuity", "near", "amsler", "colour", "contrast"])
                out = rnd.choices(["looks_good", "follow_up", "see_soon"], weights=[70, 24, 6])[0]
                db().execute("INSERT INTO selftests (day, test, outcome, age_band) VALUES (?,?,?,?)",
                             (day, test, out, rnd.choice(["<18", "18-39", "40-59", "40-59", "60+"])))
        db().commit()
    audit("system", "network_seeded", f"{len(DEMO_SHOPS)} demo shops, {len(DEMO_CLIN)} demo clinicians")


def _slot(cid: str, day: date, h: int, m: int, mins: int, place: str, mode: str) -> tuple[str, str, str]:
    start = datetime(day.year, day.month, day.day, h, m, tzinfo=IST)
    sid = secrets.token_hex(6)
    db().execute("INSERT INTO slots VALUES (?,?,?,?,?,?,?,?)",
                 (sid, cid, start.isoformat(), (start + timedelta(minutes=mins)).isoformat(), place, mode, None, iso(now())))
    return sid, place, mode


def purge() -> None:
    cut = iso(now() - REQUEST_KEEP)
    with lock():
        db().execute("DELETE FROM requests WHERE created_at < ?", (cut,))
        db().execute("DELETE FROM clin_sessions WHERE expires_at < ?", (iso(now()),))
        db().commit()


# ---------------------------------------------------------------- who is calling
def clin_session(token: Optional[str], *, required: bool = True) -> Optional[dict]:
    if not token:
        if required:
            raise HTTPException(401, "sign in first")
        return None
    th = hashlib.sha256(token.encode()).hexdigest()
    with lock():
        row = db().execute("SELECT s.demo AS sdemo, s.expires_at, c.* FROM clin_sessions s JOIN clinicians c ON c.id = s.clinician_id WHERE s.token_hash = ?", (th,)).fetchone()
    if not row or row["expires_at"] < iso(now()):
        raise HTTPException(401, "session expired: sign in again")
    out = dict(row)
    out["session_demo"] = bool(row["sdemo"])
    return out


def shop_of(token: Optional[str], demo_code: Optional[str]) -> dict:
    """The calling shop: a signed-in shop account (X-Shop-Token), or a demo shop by code (X-Shop-Code)."""
    if token:
        s = ctx["shop_session"](token)
        with lock():
            row = db().execute("SELECT * FROM shops WHERE account_id = ?", (s["account_id"],)).fetchone()
            if not row:
                c = code("DDS")
                db().execute("INSERT INTO shops VALUES (?,?,?,?,?,?,?,?,?,0)", (c, s["account_id"], s["shop_name"], "store", None, None, None, None, iso(now())))
                db().commit()
                row = db().execute("SELECT * FROM shops WHERE code = ?", (c,)).fetchone()
        return dict(row)
    if demo_code:
        with lock():
            row = db().execute("SELECT * FROM shops WHERE code = ? AND demo = 1", (demo_code.upper(),)).fetchone()
        if row:
            return dict(row)
    raise HTTPException(401, "sign in to the shop account, or use a demo shop")


def require_admin(token: Optional[str]) -> None:
    if ADMIN_TOKEN and token != ADMIN_TOKEN:
        raise HTTPException(401, "network admin token required")


def clin_out(c: Any, *, private: bool = False) -> dict:
    o = {"code": c["code"], "name": c["name"], "role": c["role"], "qualification": c["qualification"], "area": c["practice_area"],
         "pin": c["practice_pin"], "status": c["status"], "demo": bool(c["demo"])}
    if private:
        o.update(regNo=c["reg_no"], council=c["council"], login=c["login"], createdAt=c["created_at"], verifiedAt=c["verified_at"],
                 verifiedBy=c["verified_by"], note=c["note"])
    return o


def shop_out(s: Any) -> dict:
    return {"code": s["code"], "name": s["name"], "kind": s["kind"], "area": s["area"], "pin": s["pin"], "city": s["city"],
            "state": s["state"], "demo": bool(s["demo"])}


def links_for(*, shop_code: Optional[str] = None, clinician_id: Optional[str] = None) -> list[dict]:
    q = ("SELECT l.*, c.code AS ccode, c.name AS cname, c.role AS crole, c.status AS cstatus, c.practice_area AS carea, "
         "s.name AS sname, s.kind AS skind, s.area AS sarea, s.pin AS spin, s.city AS scity FROM links l "
         "JOIN clinicians c ON c.id = l.clinician_id JOIN shops s ON s.code = l.shop_code WHERE ")
    args: tuple = ()
    if shop_code:
        q += "l.shop_code = ?"
        args = (shop_code,)
    else:
        q += "l.clinician_id = ?"
        args = (clinician_id,)
    with lock():
        rows = db().execute(q + " ORDER BY l.status, s.name", args).fetchall()
    return [{"shopCode": r["shop_code"], "shopName": r["sname"], "shopKind": r["skind"], "shopArea": r["sarea"], "shopPin": r["spin"],
             "shopCity": r["scity"], "clinicianCode": r["ccode"], "clinicianName": r["cname"], "clinicianRole": r["crole"],
             "clinicianStatus": r["cstatus"], "clinicianArea": r["carea"], "role": r["role"], "roleLabel": ROLES.get(r["role"], r["role"]),
             "status": r["status"], "requestedBy": r["requested_by"], "createdAt": r["created_at"]} for r in rows]


def shop_code_of_case(case: dict, by_name: dict[str, str]) -> Optional[str]:
    site = case.get("site") or {}
    if site.get("code"):
        return str(site["code"]).upper()
    return by_name.get(str(site.get("name") or "").strip().lower())


def shop_names() -> dict[str, str]:
    with lock():
        return {r["name"].strip().lower(): r["code"] for r in db().execute("SELECT code, name FROM shops").fetchall()}


# ---------------------------------------------------------------- clinicians: register, sign in, demo
class ClinRegisterIn(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    role: Literal["optometrist", "ophthalmologist"]
    regNo: str = Field(pattern=r"^[A-Za-z0-9/ .-]{4,24}$")
    council: str = Field(min_length=2, max_length=80)
    qualification: str = Field(min_length=2, max_length=60)
    practiceArea: str = Field(min_length=2, max_length=80)
    practicePin: str = Field(pattern=r"^\d{6}$")
    login: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    attest: bool


class ClinLoginIn(BaseModel):
    login: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=200)


def new_clin_session(cid: str, demo: bool) -> dict:
    token = secrets.token_urlsafe(32)
    with lock():
        db().execute("INSERT INTO clin_sessions VALUES (?,?,?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), cid, int(demo), iso(now()), iso(now() + CLIN_TTL)))
        db().commit()
    return {"token": token, "expiresAt": iso(now() + CLIN_TTL)}


@router.post("/clin/register", status_code=201)
def clin_register(body: ClinRegisterIn) -> dict:
    if not body.attest:
        raise HTTPException(422, "confirm that the registration details are yours")
    lg = ctx["norm_login"](body.login)
    reg = re.sub(r"\s+", "", body.regNo.upper())
    salt = secrets.token_hex(16)
    cid = secrets.token_hex(8)
    with lock():
        if db().execute("SELECT 1 FROM clinicians WHERE login = ?", (lg,)).fetchone():
            raise HTTPException(409, "an account with this phone or email exists")
        if db().execute("SELECT 1 FROM clinicians WHERE reg_no = ? AND council = ?", (reg, body.council)).fetchone():
            raise HTTPException(409, "this registration number is already registered")
        c = code("DDO")
        db().execute("INSERT INTO clinicians VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
                     (cid, c, lg, body.name.strip(), body.role, reg, body.council, body.qualification.strip(), body.practiceArea.strip(),
                      body.practicePin, salt, pw_hash(body.password, salt), "pending", iso(now()), None, None, None))
        db().commit()
        row = db().execute("SELECT * FROM clinicians WHERE id = ?", (cid,)).fetchone()
    audit(f"clinician {c}", "clinician_registered", f"{body.role}, {body.council}; awaiting verification")
    return {**new_clin_session(cid, False), "clinician": clin_out(row, private=True)}


@router.post("/clin/login")
def clin_login(body: ClinLoginIn) -> dict:
    lg = ctx["norm_login"](body.login)
    t = now()
    with fail_lock:
        recent = [x for x in failures.get(lg, []) if t - x < timedelta(minutes=15)]
        failures[lg] = recent
        if len(recent) >= 5:
            raise HTTPException(429, "too many attempts: wait 15 minutes")
    with lock():
        row = db().execute("SELECT * FROM clinicians WHERE login = ?", (lg,)).fetchone()
    if not row or not row["salt"] or not hmac.compare_digest(row["pw_hash"], pw_hash(body.password, row["salt"])):
        with fail_lock:
            failures.setdefault(lg, []).append(t)
        raise HTTPException(401, "wrong phone/email or password")
    if row["status"] == "rejected":
        raise HTTPException(403, "registration not verified: contact the network admin")
    audit(f"clinician {row['code']}", "clinician_signed_in")
    return {**new_clin_session(row["id"], False), "clinician": clin_out(row, private=True)}


@router.post("/clin/demo")
def clin_demo(as_code: str = Query("DDO-MEEN1", alias="as", pattern=r"^DDO-[A-Z0-9]{5}$")) -> dict:
    """A demo session as one of the seeded, verified clinicians: no account needed."""
    with lock():
        row = db().execute("SELECT * FROM clinicians WHERE code = ? AND demo = 1 AND status = 'verified'", (as_code,)).fetchone()
    if not row:
        raise HTTPException(404, "demo clinician not found")
    return {**new_clin_session(row["id"], True), "clinician": clin_out(row, private=True), "demo": True}


@router.get("/clin/me")
def clin_me(x_clin_token: Optional[str] = Header(None)) -> dict:
    c = clin_session(x_clin_token)
    return {"clinician": clin_out(c, private=True), "demo": c["session_demo"], "links": links_for(clinician_id=c["id"])}


@router.post("/clin/logout")
def clin_logout(x_clin_token: Optional[str] = Header(None)) -> dict:
    if x_clin_token:
        with lock():
            db().execute("DELETE FROM clin_sessions WHERE token_hash = ?", (hashlib.sha256(x_clin_token.encode()).hexdigest(),))
            db().commit()
    return {"ok": True}


@router.get("/clin/directory")
def clin_directory(pin: Optional[str] = Query(None, pattern=r"^\d{6}$")) -> list[dict]:
    with lock():
        rows = db().execute("SELECT * FROM clinicians WHERE status = 'verified'").fetchall()
    out = [clin_out(r) for r in rows]
    out.sort(key=lambda c: (pin_distance(c["pin"], pin), c["name"]))
    return out


@router.get("/clin/cases")
def clin_cases(x_clin_token: Optional[str] = Header(None)) -> dict:
    """The review queue for this clinician: cases from the shops they are linked to (a demo session sees every case)."""
    c = clin_session(x_clin_token)
    rows = [ctx["row_summary"](r) for r in ctx["store"].all()]
    if c["session_demo"]:
        return {"scope": "all", "cases": rows}
    mine = linked_shop_codes(c)
    by_name = shop_names()
    keep = [r for r in rows if case_in_shops(r, mine, by_name)]
    return {"scope": "linked", "shops": sorted(mine), "cases": keep}


def linked_shop_codes(c: dict) -> set[str]:
    return {l["shopCode"] for l in links_for(clinician_id=c["id"]) if l["status"] == "active"}


def case_in_shops(r: dict, codes: set[str], by_name: Optional[dict] = None) -> bool:
    site = r.get("site") or {}
    by_name = shop_names() if by_name is None else by_name
    sc = site.get("code") or by_name.get(str(site.get("name") or "").strip().lower())
    return bool(sc) and sc.upper() in codes


def clin_may_open(token: Optional[str], r: dict) -> None:
    """A signed-in clinician opens only cases from their linked shops (a demo session opens any)."""
    if not token:
        return
    c = clin_session(token)
    if not c["session_demo"] and not case_in_shops(r, linked_shop_codes(c)):
        raise HTTPException(403, "this case is from a shop you are not linked to")


def clin_must_be_verified(token: Optional[str]) -> Optional[dict]:
    """Rule edits, like sign-off, need a verified registration when a clinician is signed in."""
    if not token:
        return None
    c = clin_session(token)
    if c["status"] != "verified":
        raise HTTPException(403, "your registration is still being verified: rule edits unlock once you are verified")
    return c


# ---------------------------------------------------------------- shops
class ShopIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    kind: Literal["store", "camp", "vision_centre"] = "store"
    area: Optional[str] = Field(default=None, max_length=80)
    pin: Optional[str] = Field(default=None, pattern=r"^\d{6}$")
    city: Optional[str] = Field(default=None, max_length=60)
    state: Optional[str] = Field(default=None, max_length=60)


@router.get("/shops")
def shops_list(pin: Optional[str] = Query(None, pattern=r"^\d{6}$"), limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    with lock():
        rows = db().execute("SELECT * FROM shops").fetchall()
        links = db().execute("SELECT l.shop_code, c.role FROM links l JOIN clinicians c ON c.id = l.clinician_id WHERE l.status = 'active' AND c.status = 'verified'").fetchall()
    roles: dict[str, set] = {}
    for l in links:
        roles.setdefault(l["shop_code"], set()).add(l["role"])
    # With a PIN code: only shops in the same postal district (the first 3 digits of
    # an Indian PIN code), and only shops linked to at least one verified clinician.
    out = [{**shop_out(r), "optometrist": "optometrist" in roles.get(r["code"], set()),
            "ophthalmologist": "ophthalmologist" in roles.get(r["code"], set()), "distance": pin_distance(r["pin"], pin)}
           for r in rows if r["pin"] and (not pin or (r["pin"][:3] == pin[:3] and r["code"] in roles))]
    out.sort(key=lambda s: (s["distance"], s["name"]))
    return out[:limit]


@router.get("/shops/me")
def shop_me(x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    s = shop_of(x_shop_token, x_shop_code)
    return {"shop": shop_out(s), "links": links_for(shop_code=s["code"])}


@router.put("/shops/me")
def shop_update(body: ShopIn, x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    s = shop_of(x_shop_token, x_shop_code)
    with lock():
        db().execute("UPDATE shops SET name = COALESCE(?, name), kind = ?, area = COALESCE(?, area), pin = COALESCE(?, pin), city = COALESCE(?, city), state = COALESCE(?, state) WHERE code = ?",
                     (body.name, body.kind, body.area, body.pin, body.city, body.state, s["code"]))
        db().commit()
        row = db().execute("SELECT * FROM shops WHERE code = ?", (s["code"],)).fetchone()
    return {"shop": shop_out(row), "links": links_for(shop_code=s["code"])}


# ---------------------------------------------------------------- links: many shops, many clinicians
class LinkIn(BaseModel):
    clinicianCode: str = Field(pattern=r"^DDO-[A-Za-z0-9]{5}$")
    role: Literal["primary", "tele", "visiting_ophth", "referral_ophth"] = "primary"


@router.post("/links", status_code=201)
def link_request(body: LinkIn, x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    s = shop_of(x_shop_token, x_shop_code)
    with lock():
        c = db().execute("SELECT * FROM clinicians WHERE code = ?", (body.clinicianCode.upper(),)).fetchone()
        if not c or c["status"] != "verified":
            raise HTTPException(404, "no verified clinician with that code")
        # a demo shop asking a demo clinician is accepted at once, so the demo flows end to end
        status = "active" if (s["demo"] and c["demo"]) else "requested"
        db().execute("INSERT OR REPLACE INTO links VALUES (?,?,?,?,?,?)", (s["code"], c["id"], body.role, status, "shop", iso(now())))
        db().commit()
    audit(f"shop {s['code']}", "link_requested", f"{c['code']} as {body.role} ({status})")
    return {"links": links_for(shop_code=s["code"])}


@router.post("/links/{shop_code}/accept")
def link_accept(shop_code: str, x_clin_token: Optional[str] = Header(None)) -> dict:
    c = clin_session(x_clin_token)
    with lock():
        n = db().execute("UPDATE links SET status = 'active' WHERE shop_code = ? AND clinician_id = ?", (shop_code.upper(), c["id"])).rowcount
        db().commit()
    if not n:
        raise HTTPException(404, "no such request")
    audit(f"clinician {c['code']}", "link_accepted", shop_code)
    return {"links": links_for(clinician_id=c["id"])}


@router.delete("/links")
def link_remove(shopCode: str = Query(..., pattern=r"^DDS-[A-Za-z0-9]{5}$"), clinicianCode: str = Query(..., pattern=r"^DDO-[A-Za-z0-9]{5}$"),
                x_clin_token: Optional[str] = Header(None), x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    if x_clin_token:
        c = clin_session(x_clin_token)
        if c["code"] != clinicianCode.upper():
            raise HTTPException(403, "not your link")
    else:
        s = shop_of(x_shop_token, x_shop_code)
        if s["code"] != shopCode.upper():
            raise HTTPException(403, "not your link")
    with lock():
        db().execute("DELETE FROM links WHERE shop_code = ? AND clinician_id = (SELECT id FROM clinicians WHERE code = ?)", (shopCode.upper(), clinicianCode.upper()))
        db().commit()
    return {"ok": True}


# ---------------------------------------------------------------- calendar: slots and bookings
class SlotsIn(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")
    minutes: int = Field(ge=10, le=240)
    mode: Literal["video", "in_person", "camp"]
    place: str = Field(min_length=3, max_length=12)  # a linked shop code, or "video"
    note: str = Field(default="", max_length=120)


class BookingIn(BaseModel):
    slotId: str = Field(min_length=6, max_length=32)
    patientRef: str = Field(min_length=1, max_length=40)  # initials or case code, never a full name
    caseRef: Optional[str] = Field(default=None, max_length=64)
    reason: str = Field(default="", max_length=120)
    requestId: Optional[str] = Field(default=None, max_length=32)


class BookingPatch(BaseModel):
    status: Literal["booked", "confirmed", "done", "cancelled", "no_show"]


def slot_rows(where: str, args: tuple) -> list[dict]:
    q = ("SELECT sl.*, c.code AS ccode, c.name AS cname, c.role AS crole, b.id AS bid, b.shop_code AS bshop, b.patient_ref, b.case_ref, "
         "b.reason, b.status AS bstatus, sh.name AS pname FROM slots sl JOIN clinicians c ON c.id = sl.clinician_id "
         "LEFT JOIN bookings b ON b.slot_id = sl.id AND b.status != 'cancelled' LEFT JOIN shops sh ON sh.code = sl.place WHERE " + where + " ORDER BY sl.start")
    with lock():
        return [dict(r) for r in db().execute(q, args).fetchall()]


def slot_out(r: dict, *, see: Optional[str] = None, owner: bool = False) -> dict:
    o = {"id": r["id"], "start": r["start"], "end": r["end"], "mode": r["mode"], "place": r["place"], "placeName": r["pname"] or ("Video consult" if r["place"] == "video" else r["place"]),
         "clinicianCode": r["ccode"], "clinicianName": r["cname"], "clinicianRole": r["crole"], "note": r["note"], "booked": bool(r["bid"])}
    if r["bid"] and (owner or (see and r["bshop"] == see)):
        o["booking"] = {"id": r["bid"], "shopCode": r["bshop"], "patientRef": r["patient_ref"], "caseRef": r["case_ref"], "reason": r["reason"], "status": r["bstatus"]}
    return o


@router.get("/slots")
def slots_list(clinician: Optional[str] = Query(None, pattern=r"^DDO-[A-Za-z0-9]{5}$"), frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = Query(None),
               x_clin_token: Optional[str] = Header(None), x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> list[dict]:
    start = frm or datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    end = to or (datetime.fromisoformat(start) + timedelta(days=14)).isoformat()
    me = clin_session(x_clin_token, required=False) if x_clin_token else None
    shop = None
    if not me and (x_shop_token or x_shop_code):
        shop = shop_of(x_shop_token, x_shop_code)
        start = max(start, datetime.now(IST).isoformat())  # a shop can only book what is still ahead
    if me and not clinician:
        rows = slot_rows("c.id = ? AND sl.start >= ? AND sl.start < ?", (me["id"], start, end))
        return [slot_out(r, owner=True) for r in rows]
    if clinician:
        rows = slot_rows("c.code = ? AND sl.start >= ? AND sl.start < ?", (clinician.upper(), start, end))
    elif shop:
        linked = [l["clinicianCode"] for l in links_for(shop_code=shop["code"]) if l["status"] == "active"]
        if not linked:
            return []
        rows = slot_rows(f"c.code IN ({','.join('?' * len(linked))}) AND sl.start >= ? AND sl.start < ?", (*linked, start, end))
    else:
        raise HTTPException(400, "which clinician?")
    owner = bool(me and clinician and me["code"] == clinician.upper())
    return [slot_out(r, see=shop["code"] if shop else None, owner=owner) for r in rows]


@router.post("/slots", status_code=201)
def slots_add(body: SlotsIn, x_clin_token: Optional[str] = Header(None)) -> dict:
    c = clin_session(x_clin_token)
    d = date.fromisoformat(body.date)
    h1, m1 = map(int, body.start.split(":"))
    h2, m2 = map(int, body.end.split(":"))
    t = datetime(d.year, d.month, d.day, h1, m1, tzinfo=IST)
    stop = datetime(d.year, d.month, d.day, h2, m2, tzinfo=IST)
    if stop <= t:
        raise HTTPException(422, "the end time must be after the start")
    if body.place != "video" and not any(l["shopCode"] == body.place.upper() and l["status"] == "active" for l in links_for(clinician_id=c["id"])):
        raise HTTPException(422, "place must be video or a shop you are linked to")
    made = 0
    with lock():
        while t + timedelta(minutes=body.minutes) <= stop and made < 48:
            db().execute("INSERT INTO slots VALUES (?,?,?,?,?,?,?,?)", (secrets.token_hex(6), c["id"], t.isoformat(),
                         (t + timedelta(minutes=body.minutes)).isoformat(), body.place.upper() if body.place != "video" else "video", body.mode, body.note or None, iso(now())))
            t += timedelta(minutes=body.minutes)
            made += 1
        db().commit()
    return {"created": made}


@router.delete("/slots/{slot_id}")
def slots_delete(slot_id: str, x_clin_token: Optional[str] = Header(None)) -> dict:
    c = clin_session(x_clin_token)
    with lock():
        if db().execute("SELECT 1 FROM bookings WHERE slot_id = ? AND status != 'cancelled'", (slot_id,)).fetchone():
            raise HTTPException(409, "this slot is booked: cancel the booking first")
        n = db().execute("DELETE FROM slots WHERE id = ? AND clinician_id = ?", (slot_id, c["id"])).rowcount
        db().commit()
    if not n:
        raise HTTPException(404, "slot not found")
    return {"ok": True}


@router.post("/bookings", status_code=201)
def booking_add(body: BookingIn, x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    s = shop_of(x_shop_token, x_shop_code)
    rows = slot_rows("sl.id = ?", (body.slotId,))
    if not rows:
        raise HTTPException(404, "slot not found")
    r = rows[0]
    if r["bid"]:
        raise HTTPException(409, "that slot was just taken: pick another")
    if r["start"] < datetime.now(IST).isoformat():
        raise HTTPException(409, "that slot has passed")
    if not any(l["clinicianCode"] == r["ccode"] and l["status"] == "active" for l in links_for(shop_code=s["code"])):
        raise HTTPException(403, "this shop is not linked to that clinician")
    bid = secrets.token_hex(6)
    with lock():
        db().execute("DELETE FROM bookings WHERE slot_id = ? AND status = 'cancelled'", (body.slotId,))
        db().execute("INSERT INTO bookings VALUES (?,?,?,?,?,?,?,?,?,?)", (bid, body.slotId, s["code"], body.patientRef.strip(), body.caseRef, body.reason.strip(),
                     "booked", body.requestId, iso(now()), iso(now())))
        if body.requestId:
            db().execute("UPDATE requests SET status = 'booked', booking_id = ?, updated_at = ? WHERE id = ? AND shop_code = ?", (bid, iso(now()), body.requestId, s["code"]))
        db().commit()
    audit(f"shop {s['code']}", "slot_booked", f"{r['ccode']} {r['start'][:16]}")
    return {"id": bid, "slot": slot_out(slot_rows("sl.id = ?", (body.slotId,))[0], see=s["code"])}


@router.get("/bookings")
def bookings_list(x_clin_token: Optional[str] = Header(None), x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> list[dict]:
    since = (datetime.now(IST) - timedelta(days=1)).isoformat()
    if x_clin_token:
        c = clin_session(x_clin_token)
        rows = slot_rows("c.id = ? AND b.id IS NOT NULL AND sl.start >= ?", (c["id"], since))
        return [slot_out(r, owner=True) for r in rows]
    s = shop_of(x_shop_token, x_shop_code)
    rows = slot_rows("b.shop_code = ? AND sl.start >= ?", (s["code"], since))
    return [slot_out(r, see=s["code"]) for r in rows]


@router.patch("/bookings/{booking_id}")
def booking_patch(booking_id: str, body: BookingPatch, x_clin_token: Optional[str] = Header(None), x_shop_token: Optional[str] = Header(None),
                  x_shop_code: Optional[str] = Header(None)) -> dict:
    with lock():
        b = db().execute("SELECT b.*, sl.clinician_id FROM bookings b JOIN slots sl ON sl.id = b.slot_id WHERE b.id = ?", (booking_id,)).fetchone()
    if not b:
        raise HTTPException(404, "booking not found")
    if x_clin_token:
        if clin_session(x_clin_token)["id"] != b["clinician_id"]:
            raise HTTPException(403, "not your booking")
    elif shop_of(x_shop_token, x_shop_code)["code"] != b["shop_code"]:
        raise HTTPException(403, "not your booking")
    with lock():
        db().execute("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?", (body.status, iso(now()), booking_id))
        db().commit()
    return {"id": booking_id, "status": body.status}


# ---------------------------------------------------------------- appointment requests from the patient app
class RequestIn(BaseModel):
    shopCode: str = Field(pattern=r"^DDS-[A-Za-z0-9]{5}$")
    kind: Literal["routine", "with_optometrist"]
    preferred: str = Field(default="", max_length=60)
    note: str = Field(default="", max_length=300)
    name: str = Field(min_length=1, max_length=60)
    phone: str = Field(pattern=r"^[0-9+ ]{10,16}$")
    selftest: Optional[str] = Field(default=None, max_length=300)  # the patient's own self-test summary, if they chose to attach it
    consent: bool


class RequestPatch(BaseModel):
    status: Literal["new", "accepted", "booked", "declined", "done"]
    reply: str = Field(default="", max_length=300)


@router.post("/requests", status_code=201)
def request_add(body: RequestIn) -> dict:
    if not body.consent:
        raise HTTPException(422, "consent is needed to share your name and phone with the shop")
    with lock():
        if not db().execute("SELECT 1 FROM shops WHERE code = ?", (body.shopCode.upper(),)).fetchone():
            raise HTTPException(404, "shop not found")
        rid = secrets.token_hex(6)
        secret = secrets.token_urlsafe(16)
        db().execute("INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (rid, hashlib.sha256(secret.encode()).hexdigest(), body.shopCode.upper(), body.kind, body.preferred.strip(), body.note.strip(),
                      body.name.strip(), body.phone.strip(), body.selftest, "new", None, None, iso(now()), iso(now())))
        db().commit()
    audit("patient app", "appointment_requested", f"{body.shopCode.upper()} ({body.kind})")
    return {"id": rid, "secret": secret, "status": "new"}


@router.get("/requests/{rid}")
def request_status(rid: str, s: str = Query(..., min_length=10, max_length=64)) -> dict:
    with lock():
        r = db().execute("SELECT r.*, sh.name AS sname, sh.area AS sarea FROM requests r JOIN shops sh ON sh.code = r.shop_code WHERE r.id = ?", (rid,)).fetchone()
    if not r or not hmac.compare_digest(r["secret_hash"], hashlib.sha256(s.encode()).hexdigest()):
        raise HTTPException(404, "request not found")
    out = {"id": r["id"], "status": r["status"], "reply": r["reply"], "kind": r["kind"], "shopName": r["sname"], "shopArea": r["sarea"], "updatedAt": r["updated_at"]}
    if r["booking_id"]:
        rows = slot_rows("b.id = ?", (r["booking_id"],))
        if rows:
            out["appointment"] = {"start": rows[0]["start"], "end": rows[0]["end"], "mode": rows[0]["mode"], "clinicianName": rows[0]["cname"],
                                  "clinicianRole": rows[0]["crole"], "placeName": rows[0]["pname"] or "Video consult", "status": rows[0]["bstatus"]}
    return out


@router.get("/requests")
def requests_list(x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> list[dict]:
    sh = shop_of(x_shop_token, x_shop_code)
    purge()
    with lock():
        rows = db().execute("SELECT * FROM requests WHERE shop_code = ? ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, created_at DESC", (sh["code"],)).fetchall()
    return [{"id": r["id"], "kind": r["kind"], "preferred": r["preferred"], "note": r["note"], "name": r["name"], "phone": r["phone"], "selftest": r["selftest"],
             "status": r["status"], "reply": r["reply"], "bookingId": r["booking_id"], "createdAt": r["created_at"]} for r in rows]


@router.patch("/requests/{rid}")
def request_patch(rid: str, body: RequestPatch, x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    sh = shop_of(x_shop_token, x_shop_code)
    with lock():
        n = db().execute("UPDATE requests SET status = ?, reply = ?, updated_at = ? WHERE id = ? AND shop_code = ?", (body.status, body.reply.strip() or None, iso(now()), rid, sh["code"])).rowcount
        db().commit()
    if not n:
        raise HTTPException(404, "request not found")
    return {"id": rid, "status": body.status}


# ---------------------------------------------------------------- de-identified telemetry
class MetricsIn(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    counters: dict[str, float]


class SelfTestIn(BaseModel):
    test: str = Field(max_length=20)
    outcome: Literal["looks_good", "follow_up", "see_soon"]
    ageBand: Literal["<18", "18-39", "40-59", "60+", "unknown"] = "unknown"


@router.put("/metrics")
def metrics_put(body: MetricsIn, x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    s = shop_of(x_shop_token, x_shop_code)
    bad = [k for k in body.counters if k not in METRIC_KEYS]
    if bad:
        raise HTTPException(422, f"unknown counters: {', '.join(bad[:5])}")
    with lock():
        for k, v in body.counters.items():
            db().execute("INSERT OR REPLACE INTO metrics VALUES (?,?,?,?)", (s["code"], body.day, k, max(0.0, min(float(v), 1e7))))
        db().commit()
    return {"ok": True}


@router.post("/selftests", status_code=201)
def selftest_add(body: SelfTestIn) -> dict:
    if body.test not in SELFTESTS:
        raise HTTPException(422, "unknown test")
    with lock():
        db().execute("INSERT INTO selftests (day, test, outcome, age_band) VALUES (?,?,?,?)", (datetime.now(IST).date().isoformat(), body.test, body.outcome, body.ageBand))
        db().commit()
    return {"ok": True}


# ---------------------------------------------------------------- ZEISS network dashboard (aggregates only)
@router.get("/zeiss/overview")
def zeiss_overview(x_admin_token: Optional[str] = Header(None)) -> dict:
    require_admin(x_admin_token)
    cases = [ctx["full_case"](r) for r in ctx["store"].all()]
    by_name = shop_names()
    today = datetime.now(IST).date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    with lock():
        shops = [dict(r) for r in db().execute("SELECT * FROM shops").fetchall()]
        clins = [dict(r) for r in db().execute("SELECT * FROM clinicians").fetchall()]
        links = [dict(r) for r in db().execute("SELECT * FROM links").fetchall()]
        met = db().execute("SELECT shop_code, day, k, v FROM metrics WHERE day >= ?", (days[0],)).fetchall()
        st = db().execute("SELECT day, test, outcome, age_band FROM selftests WHERE day >= ?", (days[0],)).fetchall()
        reqs = db().execute("SELECT kind, status FROM requests").fetchall()
        slots = db().execute("SELECT sl.mode, sl.start, b.status AS bstatus FROM slots sl LEFT JOIN bookings b ON b.slot_id = sl.id AND b.status != 'cancelled'").fetchall()
        cancelled = db().execute("SELECT COUNT(*) FROM bookings WHERE status IN ('cancelled','no_show')").fetchone()[0]

    # screening and review
    per_day = {d: {"cases": 0, "referred": 0} for d in days}
    lanes = {"red": 0, "amber": 0, "green": 0}
    urg: dict[str, int] = {}
    flags: dict[str, int] = {}
    langs: dict[str, int] = {}
    tests: dict[str, int] = {}
    quality: dict[str, int] = {}
    lens: dict[str, int] = {}
    decisions: dict[str, int] = {}
    versions: dict[str, int] = {}
    modes = {"voice": 0, "tap": 0, "typed": 0}
    # Each interview is classed by how most of its answers were given: a mode
    # with 60% or more of the answers "leads"; otherwise the interview is mixed.
    led = {"voice": 0, "tap": 0, "typed": 0, "mixed": 0}
    review_by_lane: dict[str, list[float]] = {"red": [], "amber": [], "green": []}
    within = [0, 0]
    asked, durations, simulated, remote_answered = [], [], 0, 0
    shop_rows: dict[str, dict] = {}
    for c in cases:
        prof = c.get("profile", {}) or {}
        tri = prof.get("triage", {}) or {}
        lane = tri.get("lane", "green")
        lanes[lane] = lanes.get(lane, 0) + 1
        u = tri.get("urgency") or "none"
        urg[u] = urg.get(u, 0) + 1
        d = (c["server"]["receivedAt"] or "")[:10]
        if d in per_day:
            per_day[d]["cases"] += 1
            per_day[d]["referred"] += lane != "green"
        for f in tri.get("flags", []):
            k = f.get("code") or f.get("title")
            flags[k] = flags.get(k, 0) + 1
        langs[c.get("lang", "?")] = langs.get(c.get("lang", "?"), 0) + 1
        m = c.get("measurements") or {}
        for k in ("acuity", "contrast", "colour", "astigmatism", "amsler", "duochrome", "nearAcuity", "readingDistanceCm", "nearPointCm", "npc", "pd", "lensometry"):
            if m.get(k) not in (None, {}, []):
                tests[k] = tests.get(k, 0) + 1
        simulated += bool(m.get("simulated"))
        remote_answered += bool(m.get("patientRemote"))
        q = (prof.get("quality") or {}).get("level")
        if q:
            quality[q] = quality.get(q, 0) + 1
        rc = (prof.get("recommendation") or {}).get("category")
        if rc:
            fam = ZEISS_FAMILY.get(rc, "No lens: referral or no change")
            lens[fam] = lens.get(fam, 0) + 1
        v = f"app {c.get('appVersion') or '?'} · rules {c.get('rulesVersion') or prof.get('rulesVersion') or '?'}"
        versions[v] = versions.get(v, 0) + 1
        iv = c.get("interview") or {}
        if iv.get("asked"):
            asked.append(iv["asked"])
        if iv.get("startedAt") and iv.get("finishedAt"):
            try:
                durations.append((datetime.fromisoformat(iv["finishedAt"].replace("Z", "+00:00")) - datetime.fromisoformat(iv["startedAt"].replace("Z", "+00:00"))).total_seconds() / 60)
            except ValueError:
                pass
        own = {"voice": 0, "tap": 0, "typed": 0}
        for tr in iv.get("trace") or []:
            if tr.get("mode") in modes:
                modes[tr["mode"]] += 1
                own[tr["mode"]] += 1
        if sum(own.values()):
            top = max(own, key=own.get)
            led[top if own[top] >= 0.6 * sum(own.values()) else "mixed"] += 1
        rv = c.get("review")
        sc = shop_code_of_case(c, by_name) or "unregistered"
        sr = shop_rows.setdefault(sc, {"cases": 0, "referred": 0, "reviewed": 0, "mins": []})
        sr["cases"] += 1
        sr["referred"] += lane != "green"
        if rv and rv.get("reviewedAt"):
            mins = (datetime.fromisoformat(rv["reviewedAt"]) - datetime.fromisoformat(c["server"]["receivedAt"])).total_seconds() / 60
            review_by_lane.setdefault(lane, []).append(mins)
            within[0] += rv["reviewedAt"] <= c["server"]["slaDueAt"]
            within[1] += 1
            sr["reviewed"] += 1
            sr["mins"].append(mins)
            decisions[rv.get("decision", "?")] = decisions.get(rv.get("decision", "?"), 0) + 1

    # field metrics
    totals: dict[str, float] = {}
    per_day_orders = {d: 0.0 for d in days}
    shop_metric: dict[str, dict[str, float]] = {}
    for r in met:
        totals[r["k"]] = totals.get(r["k"], 0) + r["v"]
        shop_metric.setdefault(r["shop_code"], {}).setdefault(r["k"], 0)
        shop_metric[r["shop_code"]][r["k"]] += r["v"]
        if r["k"] == "ordersCreated" and r["day"] in per_day_orders:
            per_day_orders[r["day"]] += r["v"]
    oc = totals.get("ordersCreated", 0) or 0
    rate = lambda a, b: round(a / b, 4) if b else None  # noqa: E731

    # patient app
    st_by: dict[str, dict[str, int]] = {}
    ages: dict[str, int] = {}
    for r in st:
        st_by.setdefault(r["test"], {"looks_good": 0, "follow_up": 0, "see_soon": 0})[r["outcome"]] += 1
        ages[r["age_band"]] = ages.get(r["age_band"], 0) + 1
    req_status: dict[str, int] = {}
    req_kind: dict[str, int] = {}
    for r in reqs:
        req_status[r["status"]] = req_status.get(r["status"], 0) + 1
        req_kind[r["kind"]] = req_kind.get(r["kind"], 0) + 1

    # calendar
    now_ist = datetime.now(IST).isoformat()
    upcoming = [s for s in slots if s["start"] >= now_ist]
    booked = sum(1 for s in upcoming if s["bstatus"])
    by_mode: dict[str, dict[str, int]] = {}
    for s in upcoming:
        bm = by_mode.setdefault(s["mode"], {"slots": 0, "booked": 0})
        bm["slots"] += 1
        bm["booked"] += bool(s["bstatus"])

    shop_table = []
    for s in shops:
        sr = shop_rows.get(s["code"], {"cases": 0, "referred": 0, "reviewed": 0, "mins": []})
        sm = shop_metric.get(s["code"], {})
        n_links = [l for l in links if l["shop_code"] == s["code"] and l["status"] == "active"]
        shop_table.append({
            "code": s["code"], "name": s["name"], "kind": s["kind"], "area": s["area"], "city": s["city"], "state": s["state"], "pin": s["pin"],
            "cases": sr["cases"], "referralRate": rate(sr["referred"], sr["cases"]), "reviewed": sr["reviewed"],
            "medianReviewMinutes": round(median(sr["mins"])) if sr["mins"] else None, "clinicians": len(n_links),
            "screened30d": int(sm.get("screened", 0)), "orders30d": int(sm.get("ordersCreated", 0)),
            "remakeRate": rate(sm.get("remakes", 0), sm.get("ordersCreated", 0)), "cancelRate": rate(sm.get("cancellations", 0), sm.get("ordersCreated", 0)),
            "zeissShare": rate(sm.get("zeissLensOrders", 0), sm.get("ordersCreated", 0)),
            "turnaroundDays": round(sm.get("turnaroundDaysSum", 0) / sm["turnaroundCount"], 1) if sm.get("turnaroundCount") else None,
        })
    shop_table.sort(key=lambda r: -(r["cases"] + r["screened30d"]))
    states: dict[str, int] = {}
    for s in shops:
        states[s["state"] or "Not set"] = states.get(s["state"] or "Not set", 0) + 1
    all_mins = [x for v in review_by_lane.values() for x in v]
    return {
        "generatedAt": iso(now()),
        "network": {
            "shops": len(shops), "stores": sum(1 for s in shops if s["kind"] == "store"), "camps": sum(1 for s in shops if s["kind"] == "camp"),
            "states": states,
            "clinicians": {"verified": sum(1 for c in clins if c["status"] == "verified"), "pending": sum(1 for c in clins if c["status"] == "pending"),
                           "optometrists": sum(1 for c in clins if c["role"] == "optometrist" and c["status"] == "verified"),
                           "ophthalmologists": sum(1 for c in clins if c["role"] == "ophthalmologist" and c["status"] == "verified")},
            "links": {"active": sum(1 for l in links if l["status"] == "active"), "requested": sum(1 for l in links if l["status"] == "requested")},
            "cliniciansPerShop": round(sum(1 for l in links if l["status"] == "active") / len(shops), 2) if shops else None,
        },
        "screening": {
            "cases": len(cases), "byLane": lanes, "byUrgency": urg, "referralRate": rate(lanes.get("red", 0) + lanes.get("amber", 0), len(cases)),
            "reviewed": within[1], "reviewRate": rate(within[1], len(cases)), "withinTarget": rate(within[0], within[1]),
            "medianReviewMinutes": round(median(all_mins)) if all_mins else None,
            "medianReviewMinutesByLane": {k: (round(median(v)) if v else None) for k, v in review_by_lane.items()},
            "overdueOpen": sum(1 for c in cases if c["server"]["overdue"]),
            "daily": [{"day": d, **per_day[d]} for d in days],
            "topRules": sorted(flags.items(), key=lambda x: -x[1])[:10],
            "decisions": decisions,
        },
        "interview": {"medianAsked": median(asked) if asked else None, "medianMinutes": round(median(durations), 1) if durations else None,
                      "answerModes": modes, "interviewsByMode": led, "languages": langs},
        "tests": {"done": tests, "simulatedShare": rate(simulated, len(cases)), "patientPhoneShare": rate(remote_answered, len(cases)), "dataQuality": quality},
        "lenses": {"zeissFamilies": lens},
        "field": {
            "screened30d": int(totals.get("screened", 0)), "orders30d": int(oc), "delivered30d": int(totals.get("ordersDelivered", 0)),
            "remakeRate": rate(totals.get("remakes", 0), oc), "cancelRate": rate(totals.get("cancellations", 0), oc),
            "zeissShare": rate(totals.get("zeissLensOrders", 0), oc), "walkInRx30d": int(totals.get("walkInRx", 0)),
            "turnaroundDays": round(totals.get("turnaroundDaysSum", 0) / totals["turnaroundCount"], 1) if totals.get("turnaroundCount") else None,
            "ordersDaily": [{"day": d, "orders": int(per_day_orders[d])} for d in days],
        },
        "patientApp": {"selfTests30d": len(st), "byTest": st_by, "ageBands": ages, "requests": {"byStatus": req_status, "byKind": req_kind},
                       "requestToBooking": rate(req_status.get("booked", 0) + req_status.get("done", 0), len(reqs))},
        "calendar": {"upcomingSlots": len(upcoming), "booked": booked, "utilisation": rate(booked, len(upcoming)), "byMode": by_mode, "cancelledOrNoShow": cancelled},
        "shops": shop_table,
        "versions": versions,
    }


@router.get("/zeiss/clinicians")
def zeiss_clinicians(status: Optional[Literal["pending", "verified", "rejected"]] = None, x_admin_token: Optional[str] = Header(None)) -> list[dict]:
    require_admin(x_admin_token)
    with lock():
        rows = db().execute("SELECT * FROM clinicians" + (" WHERE status = ?" if status else "") + " ORDER BY status, created_at DESC", (status,) if status else ()).fetchall()
    out = []
    for r in rows:
        o = clin_out(r, private=True)
        o.pop("login", None)  # the admin verifies the registration, not the contact details
        o["shops"] = [l["shopName"] for l in links_for(clinician_id=r["id"]) if l["status"] == "active"]
        out.append(o)
    return out


class VerifyIn(BaseModel):
    decision: Literal["verified", "rejected"]
    note: str = Field(default="", max_length=200)
    by: str = Field(default="network admin", max_length=80)


@router.post("/zeiss/clinicians/{ccode}/verify")
def zeiss_verify(ccode: str, body: VerifyIn, x_admin_token: Optional[str] = Header(None)) -> dict:
    require_admin(x_admin_token)
    with lock():
        n = db().execute("UPDATE clinicians SET status = ?, verified_at = ?, verified_by = ?, note = ? WHERE code = ?",
                         (body.decision, iso(now()), body.by.strip(), body.note.strip() or None, ccode.upper())).rowcount
        db().commit()
    if not n:
        raise HTTPException(404, "clinician not found")
    audit(body.by.strip() or "network admin", f"clinician_{body.decision}", ccode.upper())
    return {"code": ccode.upper(), "status": body.decision}


@router.get("/network/planning")
def network_planning(x_clin_token: Optional[str] = Header(None)) -> dict:
    """Camp planning for a clinician: per linked shop and per PIN code, patients seen and referrals waiting."""
    c = clin_session(x_clin_token, required=False) if x_clin_token else None
    by_name = shop_names()
    with lock():
        shops = {r["code"]: dict(r) for r in db().execute("SELECT * FROM shops").fetchall()}
    mine = None
    if c and not c["session_demo"]:
        mine = {l["shopCode"] for l in links_for(clinician_id=c["id"]) if l["status"] == "active"}
    per_shop: dict[str, dict] = {}
    for r in ctx["store"].all():
        case = ctx["full_case"](r)
        sc = shop_code_of_case(case, by_name) or "unregistered"
        if mine is not None and sc not in mine:
            continue
        tri = (case.get("profile") or {}).get("triage") or {}
        lane = tri.get("lane", "green")
        ps = per_shop.setdefault(sc, {"cases": 0, "red": 0, "amber": 0, "green": 0, "open": 0, "pins": {}, "flags": {}})
        ps["cases"] += 1
        ps[lane] = ps.get(lane, 0) + 1
        ps["open"] += case["server"]["status"] != "reviewed"
        pin = case["server"]["patient"].get("pin") or "unknown"
        pp = ps["pins"].setdefault(pin, {"cases": 0, "referred": 0})
        pp["cases"] += 1
        pp["referred"] += lane != "green"
        for f in tri.get("flags", []):
            ps["flags"][f.get("title")] = ps["flags"].get(f.get("title"), 0) + 1
    out = []
    for sc, ps in per_shop.items():
        s = shops.get(sc, {})
        out.append({"code": sc, "name": s.get("name") or "Unregistered site", "kind": s.get("kind"), "area": s.get("area"), "city": s.get("city"),
                    "state": s.get("state"), "pin": s.get("pin"), **{k: ps[k] for k in ("cases", "red", "amber", "green", "open")},
                    "pins": sorted(({"pin": k, **v} for k, v in ps["pins"].items()), key=lambda x: -x["cases"]),
                    "topFlags": sorted(ps["flags"].items(), key=lambda x: -x[1])[:4]})
    out.sort(key=lambda x: -(x["red"] * 3 + x["amber"] * 2 + x["cases"]))
    return {"scope": "linked" if mine is not None else "all", "shops": out}
