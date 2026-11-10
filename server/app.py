"""DivyaDrishti bridge server: the link between field phones and remote optometrists.

Field phones POST cases (store-and-forward, idempotent on the client case id).
Optometrists review them in the portal by triage lane, with a response-time
target per lane. Reviews flow back to the phone and on to the patient's Vision
Passport. Every case can be exported as a FHIR R4 bundle for hospital or ABDM
systems.

Run:  uvicorn server.app:app --reload --port 8000   (from the repo root)
"""
from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .fhir import case_to_bundle

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DB_PATH = Path(os.environ.get("DD_DB", ROOT / "server" / "data" / "divyadrishti.db"))
SEED_FILE = ROOT / "server" / "seed_cases.json"
SEED = os.environ.get("DD_SEED", "1") == "1"
PORTAL_TOKEN = os.environ.get("DD_PORTAL_TOKEN")  # set in production: required for review / delete
MAX_CASE_BYTES = 512_000

SLA_HOURS = {"red": 2, "amber": 24, "green": 72}
LANE_ORDER = {"red": 0, "amber": 1, "green": 2}
DECISIONS = {
    "approve": "Approved",
    "modify": "Approved with changes",
    "in_person": "In-person examination",
    "urgent": "Urgent referral",
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


# ---------------------------------------------------------------- storage
class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY, created_at TEXT, received_at TEXT, lane TEXT, status TEXT,
                patient_name TEXT, age INTEGER, village TEXT, site_name TEXT, demo INTEGER,
                payload TEXT NOT NULL, review TEXT, reviewed_at TEXT)"""
        )
        self.db.commit()

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
                    "reviewed" if review else "new", p.get("name"), p.get("age"), p.get("village"),
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


store = Store(DB_PATH)


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
    return len(seeds)


# ---------------------------------------------------------------- models
class CaseIn(BaseModel):
    model_config = {"extra": "allow"}
    id: str = Field(min_length=8, max_length=64)
    createdAt: str
    lang: Literal["en", "hi", "ta"]
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
    decision: Literal["approve", "modify", "in_person", "urgent"]
    lensCategory: Optional[str] = None
    designEmphasis: Optional[Literal["Balanced", "Intermediate", "Near"]] = None
    addD: Optional[float] = Field(default=None, ge=0, le=4)
    nextStep: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=2000)
    messageToPatient: str = Field(default="", max_length=600)


# ---------------------------------------------------------------- helpers
def row_summary(r: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(r["payload"])
    review = json.loads(r["review"]) if r["review"] else None
    received = datetime.fromisoformat(r["received_at"])
    due = received + timedelta(hours=SLA_HOURS.get(r["lane"], 72))
    prof = payload.get("profile", {})
    return {
        "id": r["id"],
        "createdAt": r["created_at"],
        "receivedAt": r["received_at"],
        "lane": r["lane"],
        "status": r["status"],
        "slaDueAt": iso(due),
        "overdue": r["status"] != "reviewed" and now() > due,
        "patient": {k: payload.get("patient", {}).get(k) for k in ("name", "age", "sex", "village")},
        "site": payload.get("site"),
        "lang": payload.get("lang"),
        "demo": bool(r["demo"]),
        "summary": prof.get("summary"),
        "dominance": prof.get("vision", {}).get("dominance"),
        "flags": [f.get("title") for f in prof.get("triage", {}).get("flags", [])],
        "review": {"decision": review["decision"], "decisionLabel": review.get("decisionLabel"), "reviewer": review["reviewer"]["name"]} if review else None,
    }


def full_case(r: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(r["payload"])
    payload["review"] = json.loads(r["review"]) if r["review"] else None
    payload["server"] = row_summary(r)
    return payload


def require_token(token: Optional[str]) -> None:
    if PORTAL_TOKEN and token != PORTAL_TOKEN:
        raise HTTPException(401, "portal token required")


# ---------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(_app: FastAPI):
    seed_if_empty()
    yield


app = FastAPI(
    title="DivyaDrishti bridge",
    version="0.2.0",
    description="Store-and-forward bridge between field phones and remote optometrists.",
    lifespan=lifespan,
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "cases": store.count(), "time": iso(now())}


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
    existing = store.get(case.id)
    if existing:  # idempotent retry from a phone on a flaky network
        return JSONResponse({"id": case.id, "status": "duplicate"}, status_code=200)
    store.insert(case.model_dump(), now())
    return JSONResponse({"id": case.id, "status": "stored", "lane": lane, "slaHours": SLA_HOURS[lane]}, status_code=201)


@app.get("/api/cases")
def list_cases(
    lane: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=80),
) -> list[dict]:
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
    return rows


@app.get("/api/cases/{case_id}")
def get_case(case_id: str) -> dict:
    r = store.get(case_id)
    if not r:
        raise HTTPException(404, "case not found")
    return full_case(r)


@app.post("/api/cases/{case_id}/review")
def review_case(case_id: str, review: ReviewIn, x_portal_token: Optional[str] = Header(None)) -> dict:
    require_token(x_portal_token)
    r = store.get(case_id)
    if not r:
        raise HTTPException(404, "case not found")
    rv = review.model_dump()
    rv["decisionLabel"] = DECISIONS[review.decision]
    rv["reviewedAt"] = iso(now())
    store.set_review(case_id, rv)
    return {"id": case_id, "status": "reviewed", "review": rv}


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: str, x_portal_token: Optional[str] = Header(None)) -> dict:
    """Erasure on the patient's request (DPDP Act 2023, right to erasure)."""
    require_token(x_portal_token)
    if not store.delete(case_id):
        raise HTTPException(404, "case not found")
    return {"id": case_id, "status": "deleted"}


@app.get("/api/cases/{case_id}/fhir")
def case_fhir(case_id: str) -> JSONResponse:
    r = store.get(case_id)
    if not r:
        raise HTTPException(404, "case not found")
    return JSONResponse(case_to_bundle(full_case(r)), media_type="application/fhir+json")


@app.get("/api/stats")
def stats() -> dict:
    """Pooled, de-identified counts for planning camps and specialist visits."""
    cases = [full_case(r) for r in store.all()]
    by_lane = {k: 0 for k in SLA_HOURS}
    flags: dict[str, int] = {}
    recs: dict[str, int] = {}
    dominance: dict[str, int] = {}
    places: dict[str, dict[str, int]] = {}
    asked, review_mins = [], []
    for c in cases:
        prof = c.get("profile", {})
        lane = prof.get("triage", {}).get("lane", "green")
        by_lane[lane] = by_lane.get(lane, 0) + 1
        for f in prof.get("triage", {}).get("flags", []):
            flags[f["title"]] = flags.get(f["title"], 0) + 1
        rc = prof.get("recommendation", {}).get("category")
        if rc:
            recs[rc] = recs.get(rc, 0) + 1
        dm = prof.get("vision", {}).get("dominance")
        if dm:
            dominance[dm] = dominance.get(dm, 0) + 1
        village = (c.get("patient") or {}).get("village") or "unknown"
        pin = next((tok for tok in village.replace(",", " ").split() if tok.isdigit() and len(tok) == 6), village)
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
        "reviewed": sum(1 for c in cases if c.get("review")),
        "overdue": sum(1 for c in cases if c["server"]["overdue"]),
        "topFlags": sorted(flags.items(), key=lambda x: -x[1])[:8],
        "recommendations": recs,
        "dominance": dominance,
        "byPlace": places,
        "medianQuestionsAsked": median(asked) if asked else None,
        "medianReviewMinutes": round(median(review_mins)) if review_mins else None,
    }


# static web apps (field app at /, portal at /portal.html); mounted last
app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")
