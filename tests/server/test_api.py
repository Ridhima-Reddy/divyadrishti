"""API tests for the bridge server. Run from the repo root: python -m pytest tests/server"""
import copy
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ["DD_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ["DD_SEED"] = "0"
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from server.app import app  # noqa: E402

SEEDS = json.loads((ROOT / "server" / "seed_cases.json").read_text(encoding="utf-8"))
BY_NAME = {s["case"]["patient"]["name"]: s["case"] for s in SEEDS}
client = TestClient(app)


def case(name: str, **override) -> dict:
    c = copy.deepcopy(BY_NAME[name])
    c.update(override)
    return c


def test_health_and_static():
    assert client.get("/api/health").json()["ok"] is True
    assert "DivyaDrishti" in client.get("/").text
    assert client.get("/portal.html").status_code == 200


def test_create_is_idempotent():
    c = case("S. Kumar")
    r1 = client.post("/api/cases", json=c)
    assert r1.status_code == 201 and r1.json()["lane"] == "green"
    r2 = client.post("/api/cases", json=c)
    assert r2.status_code == 200 and r2.json()["status"] == "duplicate"


def test_rejects_missing_consent_and_bad_lane():
    c = case("R. Lakshmi", id="no-consent-0001")
    c["consent"] = {"given": False}
    assert client.post("/api/cases", json=c).status_code == 422
    c = case("R. Lakshmi", id="bad-lane-00001")
    c["profile"]["triage"]["lane"] = "purple"
    assert client.post("/api/cases", json=c).status_code == 422


def test_queue_puts_red_first_and_has_sla():
    for name in ("K. Murugan", "M. Ravi", "V. Arjun"):
        client.post("/api/cases", json=case(name))
    rows = client.get("/api/cases").json()
    open_rows = [r for r in rows if r["status"] != "reviewed"]
    assert open_rows[0]["lane"] == "red"
    assert all("slaDueAt" in r for r in rows)
    assert {r["lane"] for r in client.get("/api/cases?lane=amber").json()} == {"amber"}


def test_review_round_trip_and_fhir():
    c = case("R. Lakshmi")
    client.post("/api/cases", json=c)
    review = {
        "reviewer": {"name": "Optom. Test", "regNo": "T-1"},
        "decision": "in_person",
        "lensCategory": "readers",
        "addD": 1.75,
        "nextStep": "Retina photo at Saturday camp",
        "messageToPatient": "Please come to the camp on Saturday.",
    }
    r = client.post(f"/api/cases/{c['id']}/review", json=review)
    assert r.status_code == 200
    full = client.get(f"/api/cases/{c['id']}").json()
    assert full["review"]["decisionLabel"] == "In-person examination"
    assert full["server"]["status"] == "reviewed"
    bundle = client.get(f"/api/cases/{c['id']}/fhir").json()
    types = [e["resource"]["resourceType"] for e in bundle["entry"]]
    for t in ("Patient", "QuestionnaireResponse", "Observation", "Flag", "ServiceRequest", "Practitioner", "ClinicalImpression"):
        assert t in types, t
    qr = next(e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "QuestionnaireResponse")
    assert any("[ta]" in x.get("valueString", "") for i in qr["item"] for x in i.get("extension", []))


def test_review_validation():
    c = case("P. Selvi")
    client.post("/api/cases", json=c)
    bad = {"reviewer": {"name": "X"}, "decision": "approve"}
    assert client.post(f"/api/cases/{c['id']}/review", json=bad).status_code == 422
    assert client.post("/api/cases/does-not-exist/review", json={"reviewer": {"name": "Optom"}, "decision": "approve"}).status_code == 404


def test_vision_prescription_in_fhir():
    c = case("V. Arjun")
    client.post("/api/cases", json=c)
    bundle = client.get(f"/api/cases/{c['id']}/fhir").json()
    vp = [e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "VisionPrescription"]
    assert vp and {s["eye"] for s in vp[0]["lensSpecification"]} == {"right", "left"}


def test_erasure_and_stats():
    c = case("A. Fatima")
    client.post("/api/cases", json=c)
    s = client.get("/api/stats").json()
    assert s["cases"] >= 1 and set(s["byLane"]) == {"red", "amber", "green"}
    assert client.delete(f"/api/cases/{c['id']}").status_code == 200
    assert client.get(f"/api/cases/{c['id']}").status_code == 404
