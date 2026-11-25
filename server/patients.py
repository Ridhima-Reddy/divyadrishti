"""The patient's own eye record on the care network.

Patients never type their history in. When a shop or camp on the network
screens a patient, saves a prescription or updates a glasses order, the field
app sends that record here under the patient's mobile number (with the consent
recorded at the counter). The patient signs in to the My eyes app with the same
number and a one-time code, and sees every visit, prescription and order.

- Phone numbers are stored only as a keyed hash (HMAC-SHA256 with a per-server
  secret), never in clear.
- There is no SMS gateway in this build, so the one-time code is returned to
  the browser and shown on screen ("demoCode"). With a gateway it would be sent
  by SMS instead and never returned.
- A demo patient with a seeded history needs no sign-in at all.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from datetime import timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from . import network as N

router = APIRouter(prefix="/api/patient")
CODE_TTL = timedelta(minutes=10)
SESSION_TTL = timedelta(days=30)
DEMO_PHONE = "9000000001"
_pepper: Optional[bytes] = None


def init(seed: bool) -> None:
    with N.lock():
        N.db().executescript(
            """CREATE TABLE IF NOT EXISTS patient_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS patient_codes (
                phone_hash TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS patient_sessions (
                token_hash TEXT PRIMARY KEY, phone_hash TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS patient_records (
                id TEXT PRIMARY KEY, phone_hash TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, shop_code TEXT, place TEXT,
                date TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS patient_records_phone ON patient_records (phone_hash);
            CREATE UNIQUE INDEX IF NOT EXISTS patient_records_ref ON patient_records (shop_code, kind, ref);"""
        )
        N.db().commit()
    if seed:
        seed_demo()


def pepper() -> bytes:
    global _pepper
    if _pepper is None:
        with N.lock():
            row = N.db().execute("SELECT v FROM patient_meta WHERE k = 'pepper'").fetchone()
            if not row:
                N.db().execute("INSERT INTO patient_meta VALUES ('pepper', ?)", (secrets.token_hex(32),))
                N.db().commit()
                row = N.db().execute("SELECT v FROM patient_meta WHERE k = 'pepper'").fetchone()
        _pepper = bytes.fromhex(row["v"])
    return _pepper


def norm_phone(v: str) -> str:
    d = re.sub(r"[\s()+-]", "", v or "")
    if not re.fullmatch(r"\d{10,13}", d) or d[-10] not in "6789":
        raise HTTPException(422, "enter a 10-digit mobile number")
    return d[-10:]


def phone_hash(phone: str) -> str:
    return hmac.new(pepper(), norm_phone(phone).encode(), hashlib.sha256).hexdigest()


def masked(phone: str) -> str:
    return f"{phone[:2]}xxxxxx{phone[-2:]}"


def session(token: Optional[str]) -> dict:
    if not token:
        raise HTTPException(401, "sign in first")
    with N.lock():
        row = N.db().execute("SELECT * FROM patient_sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not row or row["expires_at"] < N.iso(N.now()):
        raise HTTPException(401, "session expired: sign in again")
    return dict(row)


def new_session(ph: str, demo: bool) -> str:
    tok = secrets.token_urlsafe(32)
    with N.lock():
        N.db().execute("INSERT INTO patient_sessions VALUES (?,?,?,?)",
                       (hashlib.sha256(tok.encode()).hexdigest(), ph, int(demo), N.iso(N.now() + SESSION_TTL)))
        N.db().execute("DELETE FROM patient_sessions WHERE expires_at < ?", (N.iso(N.now()),))
        N.db().commit()
    return tok


def record_out(r: Any) -> dict:
    return {"id": r["id"], "kind": r["kind"], "date": r["date"], "place": r["place"], "shopCode": r["shop_code"],
            "data": json.loads(r["data"]), "updatedAt": r["updated_at"]}


def upsert(ph: str, kind: str, ref: Optional[str], shop_code: Optional[str], place: Optional[str], date: str, data: dict) -> str:
    t = N.iso(N.now())
    with N.lock():
        row = N.db().execute("SELECT id FROM patient_records WHERE shop_code IS ? AND kind = ? AND ref = ?", (shop_code, kind, ref)).fetchone() if ref else None
        if row:
            N.db().execute("UPDATE patient_records SET phone_hash = ?, place = ?, date = ?, data = ?, updated_at = ? WHERE id = ?",
                           (ph, place, date, json.dumps(data), t, row["id"]))
            rid = row["id"]
        else:
            rid = secrets.token_hex(8)
            N.db().execute("INSERT INTO patient_records VALUES (?,?,?,?,?,?,?,?,?,?)", (rid, ph, kind, ref, shop_code, place, date, json.dumps(data), t, t))
        N.db().commit()
    return rid


# ---------------------------------------------------------------- sign-in
class PhoneIn(BaseModel):
    phone: str = Field(min_length=10, max_length=16)


class LoginIn(PhoneIn):
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/code")
def send_code(body: PhoneIn) -> dict:
    ph = phone_hash(body.phone)
    code = f"{secrets.randbelow(10 ** 6):06d}"
    with N.lock():
        N.db().execute("INSERT OR REPLACE INTO patient_codes VALUES (?,?,?,0)",
                       (ph, hashlib.sha256(code.encode()).hexdigest(), N.iso(N.now() + CODE_TTL)))
        N.db().commit()
    # No SMS gateway in this build: the code comes back to be shown on screen.
    return {"sent": False, "demoCode": code, "expiresInMinutes": int(CODE_TTL.total_seconds() // 60)}


@router.post("/login")
def login(body: LoginIn) -> dict:
    phone = norm_phone(body.phone)
    ph = phone_hash(phone)
    with N.lock():
        row = N.db().execute("SELECT * FROM patient_codes WHERE phone_hash = ?", (ph,)).fetchone()
        if not row or row["expires_at"] < N.iso(N.now()):
            raise HTTPException(400, "the code has expired: ask for a new one")
        if row["tries"] >= 5:
            raise HTTPException(429, "too many wrong codes: ask for a new one")
        if not hmac.compare_digest(row["code_hash"], hashlib.sha256(body.code.encode()).hexdigest()):
            N.db().execute("UPDATE patient_codes SET tries = tries + 1 WHERE phone_hash = ?", (ph,))
            N.db().commit()
            raise HTTPException(401, "that code is not right")
        N.db().execute("DELETE FROM patient_codes WHERE phone_hash = ?", (ph,))
        N.db().commit()
    return {"token": new_session(ph, False), "phone": masked(phone), "demo": False}


@router.post("/demo")
def demo() -> dict:
    return {"token": new_session(phone_hash(DEMO_PHONE), True), "phone": masked(DEMO_PHONE), "demo": True, "name": "Lakshmi R."}


@router.post("/logout")
def logout(x_patient_token: Optional[str] = Header(None)) -> dict:
    if x_patient_token:
        with N.lock():
            N.db().execute("DELETE FROM patient_sessions WHERE token_hash = ?", (hashlib.sha256(x_patient_token.encode()).hexdigest(),))
            N.db().commit()
    return {"ok": True}


@router.get("/record")
def my_record(x_patient_token: Optional[str] = Header(None)) -> dict:
    s = session(x_patient_token)
    with N.lock():
        rows = N.db().execute("SELECT * FROM patient_records WHERE phone_hash = ? ORDER BY date DESC, updated_at DESC", (s["phone_hash"],)).fetchall()
    return {"demo": bool(s["demo"]), "records": [record_out(r) for r in rows]}


@router.delete("/record/{rid}")
def delete_record(rid: str, x_patient_token: Optional[str] = Header(None)) -> dict:
    s = session(x_patient_token)
    with N.lock():
        n = N.db().execute("DELETE FROM patient_records WHERE id = ? AND phone_hash = ?", (rid, s["phone_hash"])).rowcount
        N.db().commit()
    if not n:
        raise HTTPException(404, "not in your record")
    return {"deleted": rid}


# ---------------------------------------------------------------- from the shops
class RecordIn(BaseModel):
    phone: str = Field(min_length=10, max_length=16)
    kind: Literal["visit", "rx", "order"]
    ref: str = Field(min_length=1, max_length=80)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}")
    consent: bool
    data: dict


@router.post("/records")
def push_record(body: RecordIn, x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    """A shop on the network adds or updates a visit, prescription or order in the patient's record."""
    if not body.consent:
        raise HTTPException(400, "the patient has not agreed to receive their record")
    if len(json.dumps(body.data)) > 20_000:
        raise HTTPException(413, "record too large")
    shop = N.shop_of(x_shop_token, x_shop_code)
    rid = upsert(phone_hash(body.phone), body.kind, body.ref, shop["code"], shop["name"], body.date[:10], body.data)
    return {"id": rid}


def add_review(case_id: str, rv: dict) -> None:
    """Called when an optometrist signs a case off: the patient's visit shows the review."""
    with N.lock():
        rows = N.db().execute("SELECT id, data FROM patient_records WHERE kind = 'visit' AND ref = ?", (case_id,)).fetchall()
        for r in rows:
            d = json.loads(r["data"])
            d["review"] = {"decision": rv.get("decisionLabel"), "by": (rv.get("reviewer") or {}).get("name"), "at": rv.get("reviewedAt"),
                           "note": (rv.get("messageToPatient") or "")[:600], "next": (rv.get("nextStep") or "")[:300]}
            N.db().execute("UPDATE patient_records SET data = ?, updated_at = ? WHERE id = ?", (json.dumps(d), N.iso(N.now()), r["id"]))
        N.db().commit()


# ---------------------------------------------------------------- demo history
def seed_demo() -> None:
    ph = phone_hash(DEMO_PHONE)
    with N.lock():
        if N.db().execute("SELECT 1 FROM patient_records WHERE phone_hash = ? LIMIT 1", (ph,)).fetchone():
            return
    t = N.now()
    d = lambda days: (t - timedelta(days=days)).date().isoformat()  # noqa: E731
    rx = {"R": {"sph": -1.25, "cyl": -0.5, "axis": 90}, "L": {"sph": -1.0, "cyl": -0.25, "axis": 80}, "add": 1.5, "pd": 63,
          "by": "Optom. A. Meenakshi (TN-OPT-0000)"}
    upsert(ph, "visit", "demo-v1", "DDS-ANN01", "Vision Plus Opticals, Anna Nagar", d(350), {
        "summary": "Eye check: glasses needed for distance and reading", "urgency": "Routine", "within": "glasses can proceed",
        "tests": ["Distance sharpness", "Near reading", "Contrast", "Colour", "Amsler grid", "Astigmatism dial"],
        "next": "New progressive glasses. Next eye check in 12 months; a dilated retina check every year for diabetes.",
        "review": {"decision": "Agree: glasses can proceed", "by": "Optom. A. Meenakshi", "at": f"{d(349)}T11:20:00+05:30", "note": ""}})
    upsert(ph, "rx", "demo-rx1", "DDS-ANN01", "Vision Plus Opticals, Anna Nagar", d(350), rx)
    upsert(ph, "order", "demo-o1", "DDS-ANN01", "Vision Plus Opticals, Anna Nagar", d(350), {
        "lens": "ZEISS SmartLife Progressive", "coatings": ["DuraVision BlueProtect UV"], "status": "delivered", "statusLabel": "Delivered",
        "promised": d(343), "history": [{"status": "ordered", "at": d(350)}, {"status": "in_lab", "at": d(349)}, {"status": "ready", "at": d(344)}, {"status": "delivered", "at": d(343)}]})
    upsert(ph, "visit", "demo-v2", "DDS-ADY01", "Kumaran Opticals, Adyar", d(6), {
        "summary": "Yearly eye check: diabetic retina check due", "urgency": "Routine", "within": "next camp",
        "tests": ["Distance sharpness", "Near reading", "Amsler grid"],
        "next": "Glasses still right. A dilated retina check is due: booked with Dr. S. Raman at the Guindy eye camp.",
        "review": {"decision": "Refer: diabetic retina check at the next camp", "by": "Optom. A. Meenakshi", "at": f"{d(5)}T16:05:00+05:30", "note": ""}})
    upsert(ph, "order", "demo-o2", "DDS-ADY01", "Kumaran Opticals, Adyar", d(6), {
        "lens": "ZEISS SmartLife Progressive (same power, new frame)", "coatings": ["DuraVision Platinum UV"], "status": "in_lab", "statusLabel": "In the lab",
        "promised": (t + timedelta(days=2)).date().isoformat(), "history": [{"status": "ordered", "at": d(6)}, {"status": "in_lab", "at": d(5)}]})
