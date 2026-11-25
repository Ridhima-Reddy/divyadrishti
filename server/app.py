"""DivyaDrishti bridge server: the link between field phones and remote optometrists.

Field phones POST cases (store-and-forward, idempotent on the client case id).
Optometrists review them in the portal by triage lane, with a response-time
target per lane. Reviews flow back to the phone and on to the patient's Vision
Passport. Every case can be exported as a FHIR R4 bundle.

Privacy by design:
- The server stores clinical data under a pseudonymous case id. The patient's
  name, phone and village arrive sealed to the hub's public key (only the
  optometrist's browser can open them) or not at all. Plaintext identity in a
  non-demo case is stripped on arrival.
- Every read, review, export and erasure is written to an append-only audit log
  (no personal data in it).
- Reviewed cases are purged after DD_RETENTION_DAYS (default 180).
- Share links (/api/shares) hold only ciphertext; the key stays in the link's
  URL fragment. They expire, run out of views or are revoked, then are purged.
- Security headers on every response; API responses are never cached.

Run:  uvicorn server.app:app --reload --port 8000   (from the repo root)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .fhir import case_to_bundle

VERSION = "0.4.0"
ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DB_PATH = Path(os.environ.get("DD_DB", ROOT / "server" / "data" / "divyadrishti.db"))
SEED_FILE = ROOT / "server" / "seed_cases.json"
SEED = os.environ.get("DD_SEED", "1") == "1"
PORTAL_TOKEN = os.environ.get("DD_PORTAL_TOKEN")  # set in production: required for review / delete / hub key
RETENTION_DAYS = int(os.environ.get("DD_RETENTION_DAYS", "180"))
MAX_CASE_BYTES = 512_000
LANGS = ("en", "hi", "ta", "te", "mr", "kn", "bn")

SLA_HOURS = {"red": 2, "amber": 24, "green": 72}
LANE_ORDER = {"red": 0, "amber": 1, "green": 2}
DECISIONS = {
    "approve": "Approved",
    "other": "Other (see comments)",
    "modify": "Approved with changes",
    "in_person": "In-person examination",
    "urgent": "Urgent referral",
}

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
    "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwk_thumbprint(jwk: dict) -> str:
    """RFC 7638 thumbprint, identical to the browser's computation."""
    canon = json.dumps({"crv": jwk["crv"], "kty": jwk["kty"], "x": jwk["x"], "y": jwk["y"]}, separators=(",", ":"))
    return b64url(hashlib.sha256(canon.encode()).digest())


# ---------------------------------------------------------------- storage
class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(
            """CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY, created_at TEXT, received_at TEXT, lane TEXT, status TEXT,
                patient_name TEXT, age INTEGER, village TEXT, site_name TEXT, demo INTEGER,
                payload TEXT NOT NULL, review TEXT, reviewed_at TEXT);
            CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, action TEXT, case_id TEXT, detail TEXT);
            -- encrypted share links: ciphertext only, the key never reaches the server
            CREATE TABLE IF NOT EXISTS shares (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, ciphertext TEXT, iv TEXT, salt TEXT, iterations INTEGER,
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL, max_views INTEGER NOT NULL,
                views INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
                delete_hash TEXT NOT NULL, case_ref TEXT);"""
        )
        self.db.commit()
        self.last_purge: Optional[datetime] = None

    def count(self) -> int:
        with self.lock:
            return self.db.execute("SELECT COUNT(*) FROM cases").fetchone()[0]

    def get(self, case_id: str) -> Optional[sqlite3.Row]:
        with self.lock:
            return self.db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()

    def insert(self, payload: dict, received_at: datetime, review: Optional[dict] = None) -> None:
        p = payload.get("patient") or {}
        lane = payload["profile"]["triage"]["lane"]
        with self.lock:
            self.db.execute(
                "INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    payload["id"], payload.get("createdAt"), iso(received_at), lane,
                    "reviewed" if review else "new", p.get("name"), p.get("age"), p.get("pin") or p.get("village"),
                    (payload.get("site") or {}).get("name"), int(bool(payload.get("demo"))),
                    json.dumps(payload, ensure_ascii=False), json.dumps(review, ensure_ascii=False) if review else None,
                    review.get("reviewedAt") if review else None,
                ),
            )
            self.db.commit()

    def set_review(self, case_id: str, review: dict) -> None:
        with self.lock:
            self.db.execute(
                "UPDATE cases SET review = ?, reviewed_at = ?, status = 'reviewed' WHERE id = ?",
                (json.dumps(review, ensure_ascii=False), review["reviewedAt"], case_id),
            )
            self.db.commit()

    def delete(self, case_id: str) -> bool:
        with self.lock:
            cur = self.db.execute("DELETE FROM cases WHERE id = ?", (case_id,))
            self.db.commit()
            return cur.rowcount > 0

    def all(self) -> list[sqlite3.Row]:
        with self.lock:
            return self.db.execute("SELECT * FROM cases").fetchall()

    # -- meta (hub public key)
    def get_meta(self, k: str) -> Optional[str]:
        with self.lock:
            row = self.db.execute("SELECT v FROM meta WHERE k = ?", (k,)).fetchone()
            return row["v"] if row else None

    def set_meta(self, k: str, v: str) -> None:
        with self.lock:
            self.db.execute("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", (k, v))
            self.db.commit()

    # -- audit (append-only; never personal data)
    def audit(self, actor: str, action: str, case_id: Optional[str] = None, detail: str = "") -> None:
        with self.lock:
            self.db.execute("INSERT INTO audit (at, actor, action, case_id, detail) VALUES (?,?,?,?,?)",
                            (iso(now()), (actor or "unknown")[:80], action, case_id, detail[:300]))
            self.db.commit()

    def audit_list(self, case_id: Optional[str], limit: int) -> list[dict]:
        with self.lock:
            if case_id:
                rows = self.db.execute("SELECT * FROM audit WHERE case_id = ? ORDER BY id DESC LIMIT ?", (case_id, limit)).fetchall()
            else:
                rows = self.db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    # -- retention
    def purge_reviewed_before(self, cutoff: datetime) -> list[str]:
        with self.lock:
            ids = [r["id"] for r in self.db.execute(
                "SELECT id FROM cases WHERE status = 'reviewed' AND reviewed_at < ?", (iso(cutoff),)).fetchall()]
            self.db.executemany("DELETE FROM cases WHERE id = ?", [(i,) for i in ids])
            self.db.commit()
        return ids

    # -- encrypted share links (ciphertext only; see the share endpoints below)
    def share_insert(self, s: dict) -> bool:
        """False if the id is already taken."""
        with self.lock:
            try:
                self.db.execute(
                    "INSERT INTO shares (id, kind, ciphertext, iv, salt, iterations, created_at, expires_at, max_views,"
                    " delete_hash, case_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (s["id"], s["kind"], s["ciphertext"], s["iv"], s["salt"], s["iterations"], s["created_at"],
                     s["expires_at"], s["max_views"], s["delete_hash"], s["case_ref"]),
                )
            except sqlite3.IntegrityError:
                return False
            self.db.commit()
            return True

    def share_open(self, share_id: str, at: datetime) -> tuple[str, Optional[dict]]:
        """Count one view. Returns ('ok', row) or (refusal, row): missing, revoked, expired, used.
        The ciphertext is wiped as the last allowed view is served."""
        with self.lock:
            row = self.db.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
            if not row:
                return "missing", None
            s = dict(row)
            if s["revoked"]:
                return "revoked", s
            if datetime.fromisoformat(s["expires_at"]) <= at:
                return "expired", s
            if s["views"] >= s["max_views"] or not s["ciphertext"]:
                return "used", s
            s["views"] += 1
            if s["views"] >= s["max_views"]:
                self.db.execute("UPDATE shares SET views = ?, ciphertext = NULL, iv = NULL, salt = NULL WHERE id = ?",
                                (s["views"], share_id))
            else:
                self.db.execute("UPDATE shares SET views = ? WHERE id = ?", (s["views"], share_id))
            self.db.commit()
            return "ok", s

    def share_revoke(self, share_id: str, token: str) -> tuple[str, Optional[dict]]:
        """Returns ('revoked' | 'forbidden' | 'missing', row). Revoking wipes the ciphertext."""
        with self.lock:
            row = self.db.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
            if not row:
                return "missing", None
            if not hmac.compare_digest(row["delete_hash"], hashlib.sha256(token.encode()).hexdigest()):
                return "forbidden", dict(row)
            self.db.execute("UPDATE shares SET revoked = 1, ciphertext = NULL, iv = NULL, salt = NULL WHERE id = ?",
                            (share_id,))
            self.db.commit()
            return "revoked", dict(row)

    def purge_shares(self, at: datetime) -> int:
        """Delete every share that can no longer be opened: expired, revoked or out of views."""
        with self.lock:
            cur = self.db.execute("DELETE FROM shares WHERE expires_at <= ? OR revoked = 1 OR views >= max_views",
                                  (iso(at),))
            self.db.commit()
            return cur.rowcount


store = Store(DB_PATH)


def purge_expired(force: bool = False) -> int:
    """Retention: purge old reviewed cases and dead share links. Returns how many rows went."""
    if not force and store.last_purge and now() - store.last_purge < timedelta(hours=1):
        return 0
    store.last_purge = now()
    ids = store.purge_reviewed_before(now() - timedelta(days=RETENTION_DAYS))
    for i in ids:
        store.audit("system", "retention_purge", i, f"reviewed more than {RETENTION_DAYS} days ago")
    shares = store.purge_shares(now())
    if shares:
        store.audit("system", "share_purge", None, f"{shares} expired, revoked or used-up share links deleted")
    return len(ids) + shares


def seed_if_empty() -> int:
    if not SEED or store.count() or not SEED_FILE.exists():
        return 0
    seeds = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    t0 = now()
    for s in seeds:
        received = t0 - timedelta(minutes=s.get("receivedMinutesAgo", 30))
        review = s.get("review")
        if review:
            review = {**review, "reviewedAt": iso(received + timedelta(minutes=review.pop("afterMinutes", 20)))}
        store.insert(s["case"], received, review)
    store.audit("system", "seeded", None, f"{len(seeds)} synthetic demo cases")
    return len(seeds)


# ---------------------------------------------------------------- models
class CaseIn(BaseModel):
    model_config = {"extra": "allow"}
    id: str = Field(min_length=8, max_length=64)
    createdAt: str
    lang: Literal["en", "hi", "ta", "te", "mr", "kn", "bn"]
    site: dict
    patient: dict
    consent: dict
    interview: dict
    measurements: dict = Field(default_factory=dict)
    profile: dict
    passport: dict = Field(default_factory=dict)
    operator: Optional[str] = None
    appVersion: Optional[str] = None
    demo: bool = False


class Reviewer(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    regNo: Optional[str] = Field(default=None, max_length=40)


class ReviewIn(BaseModel):
    reviewer: Reviewer
    decision: Literal["approve", "modify", "in_person", "urgent", "other"]
    decisionText: str = Field(default="", max_length=120)  # the reviewer's own wording for "other"
    lensCategory: Optional[str] = None
    designEmphasis: Optional[Literal["Balanced", "Intermediate", "Near"]] = None
    addD: Optional[float] = Field(default=None, ge=0, le=4)
    nextStep: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=2000)  # private: stays on the hub
    comments: str = Field(default="", max_length=2000)  # shown to the store / camp and in the referral letter
    findingNotes: dict[str, str] = Field(default_factory=dict)  # rule code -> the reviewer's comment on that finding
    messageToPatient: str = Field(default="", max_length=600)

    @field_validator("findingNotes")
    @classmethod
    def _finding_notes(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 60:
            raise ValueError("too many finding notes")
        out = {}
        for k, t in v.items():
            if not re.fullmatch(r"[A-Za-z0-9_]{2,40}", k) or len(t) > 500:
                raise ValueError("bad finding note")
            if t.strip():
                out[k] = t.strip()
        return out


class HubKeyIn(BaseModel):
    jwk: dict


# -- encrypted share links: the record a sender's browser uploads (ciphertext only)
SHARE_ID = r"^[A-Za-z0-9_-]{22}$"          # 16 random bytes, base64url, chosen by the client (it is the AAD)
MAX_SHARE_CIPHERTEXT = 65_536              # bytes after base64 decoding
MAX_SHARE_BODY = 128_000                   # raw request bytes


def _unb64(value: str, what: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except ValueError as e:  # binascii.Error is a ValueError
        raise ValueError(f"{what} must be base64") from e


class ShareIn(BaseModel):
    model_config = {"extra": "forbid"}  # no room for plaintext fields
    id: str = Field(pattern=SHARE_ID)
    kind: Literal["passport", "referral", "case"] = "case"
    ciphertext: str = Field(min_length=24, max_length=4 * ((MAX_SHARE_CIPHERTEXT + 2) // 3))
    iv: str = Field(max_length=24)
    salt: Optional[str] = Field(default=None, max_length=88)
    iterations: Optional[int] = Field(default=None, ge=100_000, le=10_000_000)
    expiresDays: float = Field(default=7, gt=0, le=30)
    maxViews: int = Field(default=20, ge=1, le=100)
    caseRef: Optional[str] = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")

    @field_validator("id")
    @classmethod
    def _canonical_id(cls, v: str) -> str:
        if b64url(base64.urlsafe_b64decode(v + "==")) != v:
            raise ValueError("id must be 16 bytes, base64url")
        return v

    @field_validator("ciphertext")
    @classmethod
    def _ciphertext(cls, v: str) -> str:
        n = len(_unb64(v, "ciphertext"))
        if not 17 <= n <= MAX_SHARE_CIPHERTEXT:
            raise ValueError(f"ciphertext must be 17 to {MAX_SHARE_CIPHERTEXT} bytes")
        return v

    @field_validator("iv")
    @classmethod
    def _iv(cls, v: str) -> str:
        if len(_unb64(v, "iv")) != 12:
            raise ValueError("iv must be 12 bytes")
        return v

    @field_validator("salt")
    @classmethod
    def _salt(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not 16 <= len(_unb64(v, "salt")) <= 64:
            raise ValueError("salt must be 16 to 64 bytes")
        return v

    @model_validator(mode="after")
    def _pin_fields_together(self) -> "ShareIn":
        if (self.salt is None) != (self.iterations is None):
            raise ValueError("salt and iterations go together (PIN-protected shares)")
        return self


# ---------------------------------------------------------------- helpers
IDENTITY_FIELDS = ("name", "phone", "village")


def review_hours(lane: str, triage: dict) -> int:
    """Review deadline: the case's own (from its most urgent finding) if valid, else the lane's."""
    h = triage.get("reviewWithinHours")
    if isinstance(h, (int, float)) and 1 <= h <= 72:
        return int(min(h, SLA_HOURS.get(lane, 72)))
    return SLA_HOURS.get(lane, 72)


def row_summary(r: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(r["payload"])
    review = json.loads(r["review"]) if r["review"] else None
    received = datetime.fromisoformat(r["received_at"])
    prof = payload.get("profile", {})
    tri = prof.get("triage", {}) or {}
    due = received + timedelta(hours=review_hours(r["lane"], tri))
    p = payload.get("patient", {}) or {}
    return {
        "id": r["id"],
        "createdAt": r["created_at"],
        "receivedAt": r["received_at"],
        "lane": r["lane"],
        "status": r["status"],
        "slaDueAt": iso(due),
        "overdue": r["status"] != "reviewed" and now() > due,
        "patient": {"name": p.get("name"), "age": p.get("age"), "sex": p.get("sex"), "pin": p.get("pin") or pin_of(p.get("village")),
                    "sealed": p.get("sealed")},
        "site": payload.get("site"),
        "lang": payload.get("lang"),
        "demo": bool(r["demo"]),
        "summary": prof.get("summary"),
        "dominance": prof.get("vision", {}).get("dominance"),
        "urgency": tri.get("urgency"),
        "within": tri.get("within"),
        "flags": [f.get("title") for f in tri.get("flags", [])],
        "review": {"decision": review["decision"], "decisionLabel": review.get("decisionLabel"), "reviewer": review["reviewer"]["name"]} if review else None,
    }


def full_case(r: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(r["payload"])
    payload["review"] = json.loads(r["review"]) if r["review"] else None
    payload["server"] = row_summary(r)
    return payload


def pin_of(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    return next((tok for tok in str(text).replace(",", " ").split() if tok.isdigit() and len(tok) == 6), None)


def require_token(token: Optional[str]) -> None:
    if PORTAL_TOKEN and token != PORTAL_TOKEN:
        raise HTTPException(401, "portal token required")


def actor_of(request: Request) -> str:
    return (request.headers.get("x-actor") or "anonymous")[:80]


# ---------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(_app: FastAPI):
    seed_if_empty()
    purge_expired(force=True)
    yield


app = FastAPI(
    title="DivyaDrishti bridge",
    version=VERSION,
    description="Store-and-forward bridge between field phones and remote optometrists.",
    lifespan=lifespan,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h["Content-Security-Policy"] = CSP
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "no-referrer"
    h["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(), payment=()"
    h["Strict-Transport-Security"] = "max-age=31536000"
    h["Cross-Origin-Opener-Policy"] = "same-origin"
    if request.url.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": VERSION, "cases": store.count(), "hubKey": bool(store.get_meta("hub_key")), "time": iso(now())}


# ---------------------------------------------------------------- hub key (end-to-end identity encryption)
@app.get("/api/hub/key")
def get_hub_key() -> dict:
    raw = store.get_meta("hub_key")
    if not raw:
        raise HTTPException(404, "no hub key set up yet")
    return json.loads(raw)


@app.put("/api/hub/key")
def put_hub_key(body: HubKeyIn, request: Request, replace: bool = Query(False), x_portal_token: Optional[str] = Header(None)) -> dict:
    require_token(x_portal_token)
    jwk = body.jwk
    if "d" in jwk:
        raise HTTPException(422, "that is a private key: never upload it")
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256" or not jwk.get("x") or not jwk.get("y"):
        raise HTTPException(422, "expected an EC P-256 public key (JWK)")
    public = {"kty": "EC", "crv": "P-256", "x": jwk["x"], "y": jwk["y"]}
    kid = jwk_thumbprint(public)
    existing = store.get_meta("hub_key")
    if existing and json.loads(existing)["kid"] != kid and not replace:
        raise HTTPException(409, "a different hub key is already set; replacing it makes older sealed identities unreadable without the old key")
    record = {"kid": kid, "jwk": public, "createdAt": iso(now())}
    store.set_meta("hub_key", json.dumps(record))
    store.audit(actor_of(request), "hub_key_set", None, f"kid {kid}")
    return record


# ---------------------------------------------------------------- cases
@app.post("/api/cases", status_code=201)
async def create_case(request: Request) -> JSONResponse:
    body = await request.body()
    if len(body) > MAX_CASE_BYTES:
        raise HTTPException(413, "case too large")
    try:
        case = CaseIn.model_validate_json(body)
    except Exception as e:  # pydantic validation error
        raise HTTPException(422, f"invalid case: {e}") from e
    if not case.consent.get("given"):
        raise HTTPException(422, "no recorded consent: case not stored")
    lane = (case.profile.get("triage") or {}).get("lane")
    if lane not in SLA_HOURS:
        raise HTTPException(422, "profile.triage.lane must be red, amber or green")
    actor = actor_of(request)
    if store.get(case.id):  # idempotent retry from a phone on a flaky network
        store.audit(actor, "case_duplicate", case.id)
        return JSONResponse({"id": case.id, "status": "duplicate"}, status_code=200)
    data = case.model_dump()
    patient = dict(data.get("patient") or {})
    # Defence in depth: a real case must not carry identity in clear text.
    if not case.demo and any(patient.get(k) for k in IDENTITY_FIELDS):
        patient["pin"] = patient.get("pin") or pin_of(patient.get("village"))
        for k in IDENTITY_FIELDS:
            patient.pop(k, None)
        store.audit(actor, "identity_stripped", case.id, "plaintext name/phone/village removed on arrival")
    data["patient"] = patient
    store.insert(data, now())
    store.audit(actor, "case_received", case.id, f"lane {lane}; identity {'sealed' if patient.get('sealed') else 'not sent'}")
    return JSONResponse({"id": case.id, "status": "stored", "lane": lane, "slaHours": SLA_HOURS[lane]}, status_code=201)


@app.get("/api/cases")
def list_cases(
    lane: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=80),
) -> list[dict]:
    purge_expired()
    rows = [row_summary(r) for r in store.all()]
    if lane:
        rows = [r for r in rows if r["lane"] == lane]
    if status:
        rows = [r for r in rows if r["status"] == status]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in json.dumps(r, ensure_ascii=False).lower()]
    # open cases first, by lane then by deadline; reviewed cases last
    rows.sort(key=lambda r: (r["status"] == "reviewed", LANE_ORDER.get(r["lane"], 9), r["slaDueAt"]))
    live = live_calls()
    for r in rows:
        if r["id"] in live:
            r["call"] = live[r["id"]]
    return rows


@app.get("/api/cases/{case_id}")
def get_case(case_id: str, request: Request, x_clin_token: Optional[str] = Header(None)) -> dict:
    r = store.get(case_id)
    if not r:
        raise HTTPException(404, "case not found")
    from . import network
    network.clin_may_open(x_clin_token, r)
    store.audit(actor_of(request), "case_viewed", case_id)
    return full_case(r)


@app.post("/api/cases/{case_id}/review")
def review_case(case_id: str, review: ReviewIn, request: Request, x_portal_token: Optional[str] = Header(None),
                x_clin_token: Optional[str] = Header(None)) -> dict:
    require_token(x_portal_token)
    r = store.get(case_id)
    if not r:
        raise HTTPException(404, "case not found")
    rv = review.model_dump()
    if x_clin_token:  # a signed-in clinician signs as themselves, and only once verified
        from . import network
        c = network.clin_session(x_clin_token)
        if c["status"] != "verified":
            raise HTTPException(403, "your registration is still being verified: you can review, but not sign off yet")
        rv["reviewer"] = {"name": c["name"], "regNo": c["reg_no"], "code": c["code"], "role": c["role"], "demo": bool(c["session_demo"])}
    own = review.decisionText.strip()
    rv["decisionLabel"] = own if review.decision == "other" and own else DECISIONS[review.decision]
    rv["reviewedAt"] = iso(now())
    store.set_review(case_id, rv)
    from . import patients
    patients.add_review(case_id, rv)
    store.audit(f"{rv['reviewer']['name']} ({rv['reviewer'].get('regNo') or 'no reg. no.'})", "case_reviewed", case_id, rv["decisionLabel"])
    return {"id": case_id, "status": "reviewed", "review": rv}


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: str, request: Request, x_portal_token: Optional[str] = Header(None)) -> dict:
    """Erasure on the patient's request (DPDP Act 2023, right to erasure)."""
    require_token(x_portal_token)
    if not store.delete(case_id):
        raise HTTPException(404, "case not found")
    store.audit(actor_of(request), "case_erased", case_id, "erased on request")
    return {"id": case_id, "status": "deleted"}


@app.get("/api/cases/{case_id}/fhir")
def case_fhir(case_id: str, request: Request) -> JSONResponse:
    r = store.get(case_id)
    if not r:
        raise HTTPException(404, "case not found")
    store.audit(actor_of(request), "fhir_exported", case_id)
    return JSONResponse(case_to_bundle(full_case(r)), media_type="application/fhir+json")


@app.get("/api/audit")
def audit(case_id: Optional[str] = Query(None, max_length=64), limit: int = Query(100, ge=1, le=1000)) -> list[dict]:
    return store.audit_list(case_id, limit)


@app.get("/api/stats")
def stats() -> dict:
    """Pooled, de-identified counts for planning camps and specialist visits."""
    cases = [full_case(r) for r in store.all()]
    by_lane = {k: 0 for k in SLA_HOURS}
    flags: dict[str, int] = {}
    recs: dict[str, int] = {}
    dominance: dict[str, int] = {}
    places: dict[str, dict[str, int]] = {}
    langs: dict[str, int] = {}
    asked, review_mins = [], []
    by_urgency: dict[str, int] = {}
    for c in cases:
        prof = c.get("profile", {})
        lane = prof.get("triage", {}).get("lane", "green")
        by_lane[lane] = by_lane.get(lane, 0) + 1
        u = prof.get("triage", {}).get("urgency") or "none"
        by_urgency[u] = by_urgency.get(u, 0) + 1
        for f in prof.get("triage", {}).get("flags", []):
            flags[f["title"]] = flags.get(f["title"], 0) + 1
        rc = prof.get("recommendation", {}).get("category")
        if rc:
            recs[rc] = recs.get(rc, 0) + 1
        dm = prof.get("vision", {}).get("dominance")
        if dm:
            dominance[dm] = dominance.get(dm, 0) + 1
        langs[c.get("lang", "?")] = langs.get(c.get("lang", "?"), 0) + 1
        pin = c["server"]["patient"].get("pin") or "unknown"
        pl = places.setdefault(pin, {"cases": 0, "amber": 0, "red": 0})
        pl["cases"] += 1
        if lane in ("amber", "red"):
            pl[lane] += 1
        if c.get("interview", {}).get("asked"):
            asked.append(c["interview"]["asked"])
        rv = c.get("review")
        if rv and rv.get("reviewedAt"):
            rec = datetime.fromisoformat(c["server"]["receivedAt"])
            review_mins.append((datetime.fromisoformat(rv["reviewedAt"]) - rec).total_seconds() / 60)
    return {
        "cases": len(cases),
        "byLane": by_lane,
        "byUrgency": by_urgency,
        "reviewed": sum(1 for c in cases if c.get("review")),
        "overdue": sum(1 for c in cases if c["server"]["overdue"]),
        "topFlags": sorted(flags.items(), key=lambda x: -x[1])[:8],
        "recommendations": recs,
        "dominance": dominance,
        "byPlace": places,
        "byLanguage": langs,
        "medianQuestionsAsked": median(asked) if asked else None,
        "medianReviewMinutes": round(median(review_mins)) if review_mins else None,
        "retentionDays": RETENTION_DAYS,
    }


# ---------------------------------------------------------------- encrypted share links
# The sender's browser encrypts a patient file (web/js/share.js) and uploads only
# the ciphertext. The key stays in the link's URL fragment (share.html#<id>.<key>),
# which browsers never send, so this server cannot read what it stores. Links
# expire, run out of views or are revoked; dead links are wiped and purged.
# The audit log records each create / view / revoke with an id prefix only.
SHARE_REFUSAL = {"revoked": "revoked", "expired": "expired", "used": "no views left"}


def _share_ref(share_id: str) -> str:
    return f"share {share_id[:6]}"


def _validation_brief(e: ValidationError) -> str:
    """Field and message only: never echo the submitted values."""
    return "; ".join(f"{'.'.join(str(p) for p in err['loc']) or 'body'}: {err['msg']}" for err in e.errors()[:5])


# ---------------------------------------------------------------- referral rules: hub edits
# The reviewing optometrists can change a rule's tier, time to care and action,
# or switch a rule off, with a reason. The clinical test itself is not editable.
# Phones pull these edits (GET is public: it holds no patient data) and the
# engine applies them; the engine also refuses to switch off an emergency rule.
RULE_CODE = re.compile(r"^[A-Za-z0-9_]{2,40}$")


class RuleEditIn(BaseModel):
    tier: Optional[Literal["emergency", "urgent", "soon", "routine", "info"]] = None
    within: Optional[str] = Field(default=None, max_length=120)
    action: Optional[str] = Field(default=None, max_length=400)
    off: bool = False
    reason: str = Field(min_length=5, max_length=500)
    by: Reviewer


class RuleResetIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)
    by: Reviewer


def rule_overrides() -> dict:
    raw = store.get_meta("rule_overrides")
    return json.loads(raw) if raw else {"version": 0, "rules": {}, "updatedAt": None}


def save_rule_overrides(o: dict, actor: Reviewer, action: str, detail: dict) -> dict:
    o["version"] = int(o.get("version", 0)) + 1
    o["updatedAt"] = iso(now())
    store.set_meta("rule_overrides", json.dumps(o, ensure_ascii=False))
    store.audit(f"{actor.name} ({actor.regNo or 'no reg. no.'})", action, None, json.dumps(detail, ensure_ascii=False))
    return o


@app.get("/api/rules")
def get_rules() -> dict:
    return rule_overrides()


@app.get("/api/rules/history")
def rules_history(x_portal_token: Optional[str] = Header(None)) -> list[dict]:
    require_token(x_portal_token)
    with store.lock:
        rows = store.db.execute(
            "SELECT at, actor, action, detail FROM audit WHERE action IN ('rule_edited', 'rule_reset') ORDER BY id DESC LIMIT 200").fetchall()
    return [{"at": r["at"], "actor": r["actor"], "action": r["action"], **json.loads(r["detail"] or "{}")} for r in rows]


@app.put("/api/rules/{code}")
def edit_rule(code: str, body: RuleEditIn, x_portal_token: Optional[str] = Header(None),
              x_clin_token: Optional[str] = Header(None)) -> dict:
    require_token(x_portal_token)
    from . import network
    network.clin_must_be_verified(x_clin_token)
    if not RULE_CODE.match(code):
        raise HTTPException(400, "bad rule code")
    o = rule_overrides()
    before = o["rules"].get(code)
    edit: dict[str, Any] = {k: v for k, v in {"tier": body.tier, "within": (body.within or "").strip(), "action": (body.action or "").strip()}.items() if v}
    if body.off:
        edit["off"] = True
    if not edit:
        raise HTTPException(400, "nothing changed")
    edit.update({"reason": body.reason.strip(), "by": body.by.name, "regNo": body.by.regNo, "at": iso(now())})
    o["rules"][code] = edit
    return save_rule_overrides(o, body.by, "rule_edited", {"code": code, "before": before, "after": edit})


@app.post("/api/rules/{code}/reset")
def reset_rule(code: str, body: RuleResetIn, x_portal_token: Optional[str] = Header(None),
               x_clin_token: Optional[str] = Header(None)) -> dict:
    require_token(x_portal_token)
    from . import network
    network.clin_must_be_verified(x_clin_token)
    o = rule_overrides()
    before = o["rules"].pop(code, None)
    if before is None:
        raise HTTPException(404, "rule has no edits")
    return save_rule_overrides(o, body.by, "rule_reset", {"code": code, "before": before, "reason": body.reason.strip()})


# ---------------------------------------------------------------- chart screen pairing
# A laptop or TV shows the test charts full size at 3 or 6 m, like the chart
# screen in an optical store; the shop phone drives it like the chart remote and
# records the answers. Only chart instructions pass through here (which chart,
# size, direction), never patient data. Held in memory: pairings end when the
# server restarts, and the phone then asks to pair again.
DISPLAY_TTL = timedelta(hours=12)
PAIR_CODE_TTL = timedelta(minutes=10)
displays: dict[str, dict] = {}
display_lock = threading.Lock()


class ClaimIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class ChartCmd(BaseModel):
    chart: Literal["idle", "acuity", "contrast", "plate", "near", "duochrome", "astigmatism", "amsler", "lenso"]
    optotype: Optional[Literal["E", "C"]] = None
    level: Optional[float] = Field(default=None, ge=-0.3, le=1.3)
    dir: Optional[Literal["up", "down", "left", "right"]] = None
    distanceM: Optional[float] = Field(default=None, ge=0.25, le=6.5)
    mirror: bool = False
    eye: Optional[Literal["R", "L"]] = None
    grey: Optional[int] = Field(default=None, ge=0, le=255)  # contrast ring grey level (sRGB 0-255)
    index: Optional[int] = Field(default=None, ge=0, le=30)  # colour plate number
    lang: Optional[str] = Field(default=None, pattern=r"^[a-z]{2,3}$")  # near chart text
    n: Optional[int] = Field(default=None, ge=0, le=10_000_000)  # instruction number from the phone


def _purge_displays(t: datetime) -> None:
    for k in [k for k, d in displays.items()
              if (d["controller"] is None and t - d["created"] > PAIR_CODE_TTL) or t - d["seen"] > DISPLAY_TTL]:
        displays.pop(k, None)


def _controlled(ctl: Optional[str]) -> dict:
    d = next((d for d in displays.values() if ctl and d["controller"] and hmac.compare_digest(d["controller"], ctl)), None)
    if not d:
        raise HTTPException(404, "screen not paired")
    return d


@app.post("/api/display", status_code=201)
def display_create(x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    """A chart screen. Opened with the shop's sign-in (or as a demo shop) it belongs to
    that shop at once: the shop's own phones find it with no code. Without a shop it
    shows a one-time pairing code instead (older phones)."""
    shop = None
    if x_shop_token or x_shop_code:
        from . import network
        shop = network.shop_of(x_shop_token, x_shop_code)
    with display_lock:
        _purge_displays(now())
        if len(displays) > 500:
            raise HTTPException(503, "too many screens")
        token = secrets.token_urlsafe(24)
        if shop:
            displays[token] = {"code": None, "created": now(), "seen": now(), "controller": secrets.token_urlsafe(24), "seq": 0,
                               "cmd": {"chart": "idle"}, "shop": {"code": shop["code"], "name": shop["name"]}, "driven": None}
            return {"token": token, "shop": {"code": shop["code"], "name": shop["name"]}}
        live = {d["code"] for d in displays.values() if d["code"]}
        code = f"{secrets.randbelow(10 ** 6):06d}"
        while code in live:
            code = f"{secrets.randbelow(10 ** 6):06d}"
        displays[token] = {"code": code, "created": now(), "seen": now(), "controller": None, "seq": 0, "cmd": {"chart": "idle"}}
    return {"code": code, "token": token, "expiresInSec": int(PAIR_CODE_TTL.total_seconds())}


@app.post("/api/display/self")
def display_self(x_display_token: Optional[str] = Header(None)) -> dict:
    """A demo shop's screen runs a demo patient by itself (judges with one device):
    it takes its own remote. Real shops' screens never can."""
    from . import network
    with display_lock:
        d = displays.get(x_display_token or "")
        if not d or not d.get("shop"):
            raise HTTPException(404, "screen not found")
        code = d["shop"]["code"]
    with network.lock():
        demo = network.db().execute("SELECT demo FROM shops WHERE code = ?", (code,)).fetchone()
    if not demo or not demo["demo"]:
        raise HTTPException(403, "the self-run demo is only for demo shops")
    return {"controller": d["controller"]}


@app.post("/api/display/connect")
def display_connect(x_shop_token: Optional[str] = Header(None), x_shop_code: Optional[str] = Header(None)) -> dict:
    """The shop's phone takes the remote of the shop's own chart screen (the one most recently online)."""
    from . import network
    shop = network.shop_of(x_shop_token, x_shop_code)
    with display_lock:
        _purge_displays(now())
        mine = [d for d in displays.values() if (d.get("shop") or {}).get("code") == shop["code"] and now() - d["seen"] < timedelta(minutes=2)]
        if not mine:
            return {"found": False}  # not an error: the shop has not opened its test screen
        d = max(mine, key=lambda x: x["seen"])
        d["driven"] = now()
        d["seq"] += 1
        return {"found": True, "controller": d["controller"], "shop": d["shop"]}


@app.post("/api/display/claim")
def display_claim(body: ClaimIn) -> dict:
    with display_lock:
        _purge_displays(now())
        d = next((d for d in displays.values() if d["code"] == body.code and d["controller"] is None), None)
        if not d:
            raise HTTPException(404, "code not found or expired")
        d["controller"] = secrets.token_urlsafe(24)
        d["code"] = None  # single use
        d["seen"] = now()
        return {"controller": d["controller"]}


@app.get("/api/display/ping")
def display_ping(x_display_controller: Optional[str] = Header(None)) -> dict:
    with display_lock:
        d = _controlled(x_display_controller)
        d["seen"] = now()
        if d.get("shop"):
            d["driven"] = now()
    return {"ok": True}


@app.post("/api/display/cmd")
def display_cmd(cmd: ChartCmd, x_display_controller: Optional[str] = Header(None)) -> dict:
    with display_lock:
        d = _controlled(x_display_controller)
        d["seq"] += 1
        d["cmd"] = cmd.model_dump(exclude_none=True)
        d["seen"] = now()
        if d.get("shop"):
            d["driven"] = now()
        return {"seq": d["seq"]}


@app.get("/api/display/state")
def display_state(since: int = Query(0, ge=0), x_display_token: Optional[str] = Header(None)) -> dict:
    with display_lock:
        d = displays.get(x_display_token or "")
        if not d:
            raise HTTPException(404, "screen not found")
        d["seen"] = now()
        a = d.get("answer")
        shop = d.get("shop")
        out: dict[str, Any] = {"paired": d["controller"] is not None, "seq": d["seq"], "code": d["code"], "shop": shop,
                               "phoneConnected": bool(d.get("driven") and now() - d["driven"] < timedelta(minutes=5)) if shop else d["controller"] is not None,
                               "answerToken": a["token"] if a else None, "answerJoined": bool(a and a["joined"])}
        if d["seq"] != since:
            out["cmd"] = d["cmd"]
        return out


# ---------------------------------------------------------------- patient's phone as the answer pad
# While the shop runs the screen tests for one patient, the chart screen shows a
# QR code. The patient scans it with their own phone (no app: a web page) and
# taps their answers; the shop phone receives them as if tapped there. The code
# belongs to this one patient's session: it stops working when the shop ends the
# session (the tests are done) or after an hour. Only answers travel (a
# direction, a number, a choice), never patient data.
ANSWER_TTL = timedelta(hours=1)


class AnswerIn(BaseModel):
    value: str = Field(min_length=1, max_length=12, pattern=r"^[A-Za-z0-9_-]+$")


def _answer_display(tok: Optional[str]) -> dict:
    d = next((d for d in displays.values() if tok and d.get("answer") and hmac.compare_digest(d["answer"]["token"], tok)), None)
    if not d or now() - d["answer"]["seen"] > ANSWER_TTL:
        raise HTTPException(410, "this answer code has ended: ask the shop for the new one")
    return d


@app.post("/api/display/answers/session")
def answer_session(x_display_controller: Optional[str] = Header(None)) -> dict:
    """A fresh answer code for the next patient; the previous patient's code stops working."""
    with display_lock:
        d = _controlled(x_display_controller)
        d["answer"] = {"token": secrets.token_urlsafe(18), "seen": now(), "answers": [], "seq": 0, "joined": False}
        d["seq"] += 1  # the screen redraws with the new QR code
        return {"token": d["answer"]["token"]}


@app.delete("/api/display/answers/session")
def answer_session_end(x_display_controller: Optional[str] = Header(None)) -> dict:
    with display_lock:
        d = _controlled(x_display_controller)
        if d.get("answer"):
            d["answer"] = None
            d["seq"] += 1
    return {"ok": True}


@app.get("/api/display/answers")
def answers_poll(since: int = Query(0, ge=0), x_display_controller: Optional[str] = Header(None)) -> dict:
    with display_lock:
        d = _controlled(x_display_controller)
        a = d.get("answer")
        if not a:
            return {"active": False, "joined": False, "answers": [], "seq": since}
        return {"active": True, "joined": a["joined"], "answers": [x for x in a["answers"] if x["seq"] > since], "seq": a["seq"]}


@app.get("/api/answer/state")
def answer_state(x_answer_token: Optional[str] = Header(None)) -> dict:
    with display_lock:
        try:
            d = _answer_display(x_answer_token)
        except HTTPException:
            return {"active": False}  # the tests are done or the code was replaced: the pad says so
        d["answer"]["joined"] = True
        d["answer"]["seen"] = now()
        cmd = d["cmd"] or {"chart": "idle"}
        return {"active": True, "chart": cmd.get("chart", "idle"), "eye": cmd.get("eye"), "optotype": cmd.get("optotype"),
                "index": cmd.get("index"), "n": cmd.get("n"), "lang": cmd.get("lang"), "answered": d["answer"]["seq"]}


@app.post("/api/answer")
def answer_send(body: AnswerIn, x_answer_token: Optional[str] = Header(None)) -> dict:
    with display_lock:
        d = _answer_display(x_answer_token)
        a = d["answer"]
        a["seq"] += 1
        a["seen"] = now()
        a["answers"] = (a["answers"] + [{"seq": a["seq"], "value": body.value, "chart": (d["cmd"] or {}).get("chart")}])[-50:]
        return {"ok": True, "seq": a["seq"]}


@app.delete("/api/display")
def display_end(x_display_token: Optional[str] = Header(None), x_display_controller: Optional[str] = Header(None)) -> dict:
    with display_lock:
        for k, d in list(displays.items()):
            if (x_display_token and k == x_display_token) or (x_display_controller and d["controller"] and hmac.compare_digest(d["controller"], x_display_controller)):
                displays.pop(k, None)
    return {"ok": True}


# ---------------------------------------------------------------- video consult signalling
# The optometrist (role 'hub') and the store or camp phone (role 'store') talk
# by WebRTC: audio and video go directly between the two browsers, encrypted.
# This only relays the set-up messages (offer, answer, network candidates).
# A call is tied to a case; the hub needs the portal token to start one, the
# store needs the case id, which only that phone and the hub hold. In memory.
CALL_TTL = timedelta(hours=2)
calls: dict[str, dict] = {}
call_lock = threading.Lock()


class CallIn(BaseModel):
    caseId: str = Field(min_length=8, max_length=64)
    by: Literal["hub", "store"]


class SignalIn(BaseModel):
    role: Literal["hub", "store"]
    type: Literal["join", "offer", "answer", "ice", "end", "ctrl"]
    data: Optional[dict] = None


def _purge_calls(t: datetime) -> None:
    for k in [k for k, c in calls.items() if t - c["created"] > CALL_TTL or (c["status"] == "ended" and t - c["seen"] > timedelta(minutes=2))]:
        calls.pop(k, None)


def live_calls() -> dict[str, dict]:
    with call_lock:
        _purge_calls(now())
        return {c["caseId"]: {"id": k, "by": c["by"], "status": c["status"], "since": iso(c["created"])}
                for k, c in calls.items() if c["status"] in ("ringing", "active")}


@app.post("/api/calls", status_code=201)
def call_create(body: CallIn, x_portal_token: Optional[str] = Header(None)) -> dict:
    if body.by == "hub":
        require_token(x_portal_token)
    if not store.get(body.caseId):
        raise HTTPException(404, "case not found")
    with call_lock:
        _purge_calls(now())
        for c in calls.values():
            if c["caseId"] == body.caseId and c["status"] in ("ringing", "active"):
                c["status"] = "ended"
        cid = secrets.token_urlsafe(16)
        calls[cid] = {"caseId": body.caseId, "by": body.by, "status": "ringing", "created": now(), "seen": now(), "msgs": {"hub": [], "store": []}}
    store.audit("optometrist" if body.by == "hub" else "store / camp", "call_started", body.caseId, body.by)
    return {"id": cid}


@app.get("/api/calls")
def call_list(cases: str = Query("", max_length=8000)) -> list[dict]:
    """The store phone asks: is the optometrist calling about any of my cases?"""
    ids = {c for c in cases.split(",") if c}
    live = live_calls()
    return [{"caseId": cid, **c} for cid, c in live.items() if cid in ids and c["by"] == "hub" and c["status"] == "ringing"]


@app.post("/api/calls/{call_id}/signal")
def call_signal(call_id: str, body: SignalIn) -> dict:
    if body.data is not None and len(json.dumps(body.data)) > 20000:
        raise HTTPException(413, "message too large")
    with call_lock:
        c = calls.get(call_id)
        if not c or c["status"] == "ended":
            raise HTTPException(404, "call not found")
        other = "store" if body.role == "hub" else "hub"
        c["msgs"][other].append({"type": body.type, "data": body.data})
        c["seen"] = now()
        if body.type in ("join", "answer"):
            c["status"] = "active"
        if body.type == "end":
            c["status"] = "ended"
    if body.type == "end":
        store.audit(body.role, "call_ended", c["caseId"], "")
    return {"ok": True}


@app.get("/api/calls/{call_id}/signal")
def call_poll(call_id: str, role: Literal["hub", "store"], since: int = Query(0, ge=0)) -> dict:
    with call_lock:
        c = calls.get(call_id)
        if not c:
            raise HTTPException(404, "call not found")
        c["seen"] = now()
        msgs = c["msgs"][role]
        return {"status": c["status"], "msgs": msgs[since:], "next": len(msgs)}


# ---------------------------------------------------------------- shop accounts and encrypted sync
# One account per shop or camp team, usable from any phone or computer. The
# password never reaches the server: the browser stretches it (PBKDF2, 310k)
# and splits it into an auth key, which the server hashes again, and a wrap key
# that encrypts the shop's data key. Synced records are ciphertext under that
# data key, so the hub cannot read the shop's patient names or records.
# Sessions are random tokens stored only as hashes. A shared or camp computer
# gets a 12-hour session; five wrong passwords lock a login for 15 minutes.
SESSION_TTL = timedelta(days=30)
SHARED_TTL = timedelta(hours=12)
LOCKOUT_WINDOW = timedelta(minutes=15)
SYNC_KINDS = {"case", "settings", "shop"}
with store.lock:
    store.db.executescript(
        """CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, shop_name TEXT NOT NULL, kdf_salt TEXT NOT NULL,
            iterations INTEGER NOT NULL, auth_salt TEXT NOT NULL, auth_hash TEXT NOT NULL, wrapped_key TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, device TEXT, shared INTEGER NOT NULL,
            created_at TEXT NOT NULL, last_seen TEXT NOT NULL, expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync (
            account_id TEXT NOT NULL, kind TEXT NOT NULL, rid TEXT NOT NULL, box TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY (account_id, kind, rid));"""
    )
    store.db.commit()
login_failures: dict[str, list[datetime]] = {}
fail_lock = threading.Lock()


def norm_login(v: str) -> str:
    v = v.strip().lower()
    digits = re.sub(r"[\s()-]", "", v)
    if re.fullmatch(r"\+?\d{10,13}", digits):
        return digits[-10:]  # Indian mobile numbers: the last 10 digits
    if re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}", v):
        return v
    raise HTTPException(422, "enter a 10-digit phone number or an email")


def server_secret() -> bytes:
    sec = store.get_meta("server_secret")
    if not sec:
        sec = secrets.token_hex(32)
        store.set_meta("server_secret", sec)
    return bytes.fromhex(sec)


def auth_hash(auth_key_b64: str, salt_hex: str) -> str:
    try:
        raw = base64.b64decode(auth_key_b64, validate=True)
    except Exception:
        raise HTTPException(422, "bad auth key")
    if len(raw) != 32:
        raise HTTPException(422, "bad auth key")
    return hashlib.pbkdf2_hmac("sha256", raw, bytes.fromhex(salt_hex), 100_000).hex()


class BoxIn(BaseModel):
    alg: str = Field(default="A256GCM", max_length=16)
    iv: str = Field(min_length=8, max_length=32)
    ct: str = Field(min_length=8, max_length=4_000_000)


class SignupIn(BaseModel):
    login: str = Field(min_length=5, max_length=254)
    shopName: str = Field(min_length=2, max_length=80)
    kdfSalt: str = Field(min_length=16, max_length=64)
    iterations: int = Field(ge=100_000, le=5_000_000)
    authKey: str = Field(min_length=40, max_length=64)
    wrappedKey: BoxIn
    device: str = Field(default="", max_length=80)
    shared: bool = False


class LoginIn(BaseModel):
    login: str = Field(min_length=5, max_length=254)
    authKey: str = Field(min_length=40, max_length=64)
    device: str = Field(default="", max_length=80)
    shared: bool = False


class SyncIn(BaseModel):
    box: BoxIn
    updatedAt: str = Field(min_length=10, max_length=40)


def new_session(account_id: str, device: str, shared: bool) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    t = now()
    exp = t + (SHARED_TTL if shared else SESSION_TTL)
    with store.lock:
        store.db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)",
                         (secrets.token_hex(8), account_id, hashlib.sha256(token.encode()).hexdigest(), device[:80], int(shared), iso(t), iso(t), iso(exp)))
        store.db.commit()
    return token, iso(exp)


def shop_session(token: Optional[str]) -> sqlite3.Row:
    if not token:
        raise HTTPException(401, "sign in first")
    th = hashlib.sha256(token.encode()).hexdigest()
    with store.lock:
        row = store.db.execute("SELECT s.*, a.shop_name, a.login FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?", (th,)).fetchone()
        if not row or row["expires_at"] < iso(now()):
            if row:
                store.db.execute("DELETE FROM sessions WHERE id = ?", (row["id"],))
                store.db.commit()
            raise HTTPException(401, "session expired: sign in again")
        if row["last_seen"] < iso(now() - timedelta(minutes=5)):
            store.db.execute("UPDATE sessions SET last_seen = ? WHERE id = ?", (iso(now()), row["id"]))
            store.db.commit()
    return row


def shop_out(acc: Any) -> dict:
    return {"id": acc["id"] if "id" in acc.keys() and "account_id" not in acc.keys() else acc["account_id"], "name": acc["shop_name"], "login": acc["login"]}


@app.get("/api/auth/prelogin")
def prelogin(login: str = Query(min_length=5, max_length=254)) -> dict:
    lg = norm_login(login)
    with store.lock:
        row = store.db.execute("SELECT kdf_salt, iterations FROM accounts WHERE login = ?", (lg,)).fetchone()
    if row:
        return {"kdfSalt": row["kdf_salt"], "iterations": row["iterations"]}
    # unknown login: a stable fake salt, so the reply does not reveal who has an account
    fake = hmac.new(server_secret(), lg.encode(), hashlib.sha256).digest()[:16]
    return {"kdfSalt": base64.b64encode(fake).decode(), "iterations": 310000}


@app.post("/api/auth/signup", status_code=201)
def signup(body: SignupIn) -> dict:
    lg = norm_login(body.login)
    salt = secrets.token_hex(16)
    acc_id = secrets.token_hex(10)
    with store.lock:
        if store.db.execute("SELECT 1 FROM accounts WHERE login = ?", (lg,)).fetchone():
            raise HTTPException(409, "account exists")
        store.db.execute("INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?)",
                         (acc_id, lg, body.shopName.strip(), body.kdfSalt, body.iterations, salt, auth_hash(body.authKey, salt),
                          json.dumps(body.wrappedKey.model_dump()), iso(now())))
        store.db.commit()
    store.audit(f"shop {acc_id}", "account_created", None, body.shopName.strip())
    token, exp = new_session(acc_id, body.device, body.shared)
    return {"token": token, "expiresAt": exp, "shop": {"id": acc_id, "name": body.shopName.strip(), "login": lg}}


@app.post("/api/auth/login")
def login(body: LoginIn) -> dict:
    lg = norm_login(body.login)
    t = now()
    with fail_lock:
        recent = [x for x in login_failures.get(lg, []) if t - x < LOCKOUT_WINDOW]
        login_failures[lg] = recent
        if len(recent) >= 5:
            raise HTTPException(429, "too many attempts: wait 15 minutes")
    with store.lock:
        acc = store.db.execute("SELECT * FROM accounts WHERE login = ?", (lg,)).fetchone()
    if not acc or not hmac.compare_digest(acc["auth_hash"], auth_hash(body.authKey, acc["auth_salt"])):
        with fail_lock:
            login_failures.setdefault(lg, []).append(t)
        raise HTTPException(401, "wrong login or password")
    with fail_lock:
        login_failures.pop(lg, None)
    token, exp = new_session(acc["id"], body.device, body.shared)
    store.audit(f"shop {acc['id']}", "signed_in", None, f"{body.device[:60]}{' (shared computer)' if body.shared else ''}")
    return {"token": token, "expiresAt": exp, "wrappedKey": json.loads(acc["wrapped_key"]),
            "shop": {"id": acc["id"], "name": acc["shop_name"], "login": acc["login"]}}


@app.get("/api/auth/me")
def me(x_shop_token: Optional[str] = Header(None)) -> dict:
    s = shop_session(x_shop_token)
    return {"shop": {"id": s["account_id"], "name": s["shop_name"], "login": s["login"]},
            "session": {"id": s["id"], "device": s["device"], "shared": bool(s["shared"]), "expiresAt": s["expires_at"]}}


@app.post("/api/auth/logout")
def logout(x_shop_token: Optional[str] = Header(None)) -> dict:
    s = shop_session(x_shop_token)
    with store.lock:
        store.db.execute("DELETE FROM sessions WHERE id = ?", (s["id"],))
        store.db.commit()
    return {"ok": True}


@app.get("/api/auth/sessions")
def sessions(x_shop_token: Optional[str] = Header(None)) -> list[dict]:
    s = shop_session(x_shop_token)
    with store.lock:
        rows = store.db.execute("SELECT * FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY last_seen DESC",
                                (s["account_id"], iso(now()))).fetchall()
    return [{"id": r["id"], "device": r["device"], "shared": bool(r["shared"]), "createdAt": r["created_at"],
             "lastSeen": r["last_seen"], "expiresAt": r["expires_at"], "current": r["id"] == s["id"]} for r in rows]


@app.delete("/api/auth/sessions/{sid}")
def revoke_session(sid: str, x_shop_token: Optional[str] = Header(None)) -> dict:
    s = shop_session(x_shop_token)
    with store.lock:
        n = store.db.execute("DELETE FROM sessions WHERE id = ? AND account_id = ?", (sid, s["account_id"])).rowcount
        store.db.commit()
    if not n:
        raise HTTPException(404, "device not found")
    return {"ok": True}


@app.put("/api/sync/{kind}/{rid}")
def sync_put(kind: str, rid: str, body: SyncIn, x_shop_token: Optional[str] = Header(None)) -> dict:
    s = shop_session(x_shop_token)
    if kind not in SYNC_KINDS or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", rid):
        raise HTTPException(400, "bad record")
    with store.lock:
        n = store.db.execute("SELECT COUNT(*) FROM sync WHERE account_id = ?", (s["account_id"],)).fetchone()[0]
        exists = store.db.execute("SELECT 1 FROM sync WHERE account_id = ? AND kind = ? AND rid = ?", (s["account_id"], kind, rid)).fetchone()
        if n >= 20000 and not exists:
            raise HTTPException(507, "sync storage full")
        stamp = iso(now())  # server time orders the sync feed
        store.db.execute("INSERT OR REPLACE INTO sync VALUES (?,?,?,?,?)", (s["account_id"], kind, rid, json.dumps(body.box.model_dump()), stamp))
        store.db.commit()
    return {"ok": True, "serverTime": stamp}


@app.get("/api/sync")
def sync_get(since: str = Query("", max_length=40), x_shop_token: Optional[str] = Header(None)) -> dict:
    s = shop_session(x_shop_token)
    since = since.replace(" ", "+")  # an unencoded "+00:00" arrives as a space
    with store.lock:
        rows = store.db.execute("SELECT kind, rid, box, updated_at FROM sync WHERE account_id = ? AND updated_at > ? ORDER BY updated_at LIMIT 2000",
                                (s["account_id"], since)).fetchall()
    return {"records": [{"kind": r["kind"], "rid": r["rid"], "box": json.loads(r["box"]), "updatedAt": r["updated_at"]} for r in rows],
            "serverTime": iso(now())}


@app.post("/api/shares", status_code=201)
async def create_share(request: Request) -> JSONResponse:
    body = await request.body()
    if len(body) > MAX_SHARE_BODY:
        raise HTTPException(413, "share too large")
    try:
        share = ShareIn.model_validate_json(body)
    except ValidationError as e:
        raise HTTPException(422, f"invalid share: {_validation_brief(e)}") from None
    purge_expired()  # rate-limited; keeps dead links from piling up
    created = now()
    expires = created + timedelta(days=share.expiresDays)
    token = secrets.token_urlsafe(32)
    stored = store.share_insert({
        "id": share.id, "kind": share.kind, "ciphertext": share.ciphertext, "iv": share.iv, "salt": share.salt,
        "iterations": share.iterations, "created_at": iso(created), "expires_at": iso(expires),
        "max_views": share.maxViews, "delete_hash": hashlib.sha256(token.encode()).hexdigest(), "case_ref": share.caseRef,
    })
    if not stored:
        raise HTTPException(409, "share id already in use")
    store.audit(actor_of(request), "share_created", share.caseRef,
                f"{_share_ref(share.id)}; {share.kind}; {'PIN' if share.salt else 'no PIN'}; "
                f"expires {iso(expires)}; max {share.maxViews} views")
    return JSONResponse({"id": share.id, "expiresAt": iso(expires), "maxViews": share.maxViews, "deleteToken": token},
                        status_code=201)


@app.get("/api/shares/{share_id}")
def view_share(share_id: str, request: Request) -> dict:
    """Counts one view. Cache-Control: no-store and Referrer-Policy: no-referrer come from the middleware."""
    if not re.fullmatch(SHARE_ID, share_id):
        raise HTTPException(404, "share not found")
    status, s = store.share_open(share_id, now())
    if status == "missing":
        raise HTTPException(404, "share not found")
    if status != "ok":
        store.audit(actor_of(request), "share_refused", s["case_ref"], f"{_share_ref(share_id)}; {SHARE_REFUSAL[status]}")
        raise HTTPException(410, SHARE_REFUSAL[status])
    left = s["max_views"] - s["views"]
    store.audit(actor_of(request), "share_viewed", s["case_ref"], f"{_share_ref(share_id)}; {left} views left")
    return {
        "ciphertext": s["ciphertext"], "iv": s["iv"], "salt": s["salt"], "iterations": s["iterations"], "kind": s["kind"],
        "expiresAt": s["expires_at"], "viewsLeft": left, "pin": s["salt"] is not None,
    }


@app.delete("/api/shares/{share_id}")
def revoke_share(share_id: str, request: Request, x_delete_token: Optional[str] = Header(None)) -> dict:
    if not re.fullmatch(SHARE_ID, share_id):
        raise HTTPException(404, "share not found")
    status, s = store.share_revoke(share_id, x_delete_token or "")
    if status == "missing":
        raise HTTPException(404, "share not found")
    if status == "forbidden":
        store.audit(actor_of(request), "share_revoke_denied", s["case_ref"], f"{_share_ref(share_id)}; wrong delete token")
        raise HTTPException(403, "wrong delete token")
    store.audit(actor_of(request), "share_revoked", s["case_ref"], f"{_share_ref(share_id)}; ciphertext wiped")
    return {"id": share_id, "status": "revoked"}


# ---------------------------------------------------------------- care network: clinicians, links, calendar, requests, ZEISS dashboard
from . import network  # noqa: E402

network.init(store, now_fn=now, iso_fn=iso, full_case=full_case, row_summary=row_summary, norm_login=norm_login,
             shop_session=shop_session, seed=SEED)
app.include_router(network.router)
from . import patients  # noqa: E402

patients.init(seed=SEED)
app.include_router(patients.router)

# static web apps (field app at /, portal at /portal.html); mounted last
app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")
