"""v0.5 API: hub-edited referral rules, chart-screen pairing, video-consult
signalling and the optometrist's own comments on a review."""
import copy
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("DD_DB", str(Path(tempfile.mkdtemp()) / "test.db"))
os.environ.setdefault("DD_SEED", "0")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from server.app import app  # noqa: E402

client = TestClient(app)
SEEDS = json.loads((ROOT / "server" / "seed_cases.json").read_text(encoding="utf-8"))
KUMAR = next(s["case"] for s in SEEDS if s["case"]["patient"]["name"] == "S. Kumar")
ME = {"name": "Optom. Test", "regNo": "T-1"}


def new_case(cid: str) -> dict:
    c = copy.deepcopy(KUMAR)
    c["id"] = cid
    assert client.post("/api/cases", json=c).status_code in (200, 201)
    return c


# ---------------------------------------------------------------- referral rules
def test_rule_edit_needs_reason_and_valid_tier():
    assert client.put("/api/rules/FLASHES_FLOATERS", json={"tier": "soon", "by": ME}).status_code == 422
    assert client.put("/api/rules/FLASHES_FLOATERS", json={"tier": "whenever", "reason": "hub meeting", "by": ME}).status_code == 422
    assert client.put("/api/rules/FLASHES_FLOATERS", json={"reason": "nothing here", "by": ME}).status_code == 400
    assert client.put("/api/rules/bad code!", json={"tier": "soon", "reason": "hub meeting", "by": ME}).status_code in (400, 404)


def test_rule_edit_versioned_logged_and_resettable():
    v0 = client.get("/api/rules").json()["version"]
    r = client.put("/api/rules/FLASHES_FLOATERS", json={"tier": "soon", "within": "within 1 week", "reason": "partner hospital sees these in 48 h", "by": ME})
    assert r.status_code == 200
    o = client.get("/api/rules").json()
    assert o["version"] == v0 + 1
    assert o["rules"]["FLASHES_FLOATERS"]["tier"] == "soon" and o["rules"]["FLASHES_FLOATERS"]["by"] == ME["name"]
    hist = client.get("/api/rules/history").json()
    assert hist[0]["code"] == "FLASHES_FLOATERS" and hist[0]["after"]["reason"].startswith("partner")
    assert client.post("/api/rules/FLASHES_FLOATERS/reset", json={"reason": "back to default", "by": ME}).status_code == 200
    assert "FLASHES_FLOATERS" not in client.get("/api/rules").json()["rules"]
    assert client.post("/api/rules/FLASHES_FLOATERS/reset", json={"reason": "again please", "by": ME}).status_code == 404


# ---------------------------------------------------------------- chart screen
def test_chart_screen_pairing_and_commands():
    d = client.post("/api/display").json()
    assert len(d["code"]) == 6 and d["code"].isdigit()
    hd = {"X-Display-Token": d["token"]}
    assert client.get("/api/display/state", headers=hd).json()["paired"] is False
    wrong = "000000" if d["code"] != "000000" else "111111"
    assert client.post("/api/display/claim", json={"code": wrong}).status_code == 404
    ctl = client.post("/api/display/claim", json={"code": d["code"]}).json()["controller"]
    assert client.post("/api/display/claim", json={"code": d["code"]}).status_code == 404, "codes are single use"
    hc = {"X-Display-Controller": ctl}
    assert client.get("/api/display/ping", headers=hc).json()["ok"] is True
    assert client.post("/api/display/cmd", headers=hc, json={"chart": "acuity", "optotype": "E", "level": 0.3, "dir": "left", "distanceM": 6, "eye": "R"}).json()["seq"] == 1
    st = client.get("/api/display/state?since=0", headers=hd).json()
    assert st["paired"] and st["cmd"]["chart"] == "acuity" and st["cmd"]["distanceM"] == 6
    assert "cmd" not in client.get("/api/display/state?since=1", headers=hd).json()
    assert client.post("/api/display/cmd", headers=hc, json={"chart": "patient_record"}).status_code == 422, "only chart instructions"
    assert client.post("/api/display/cmd", headers={"X-Display-Controller": "nope"}, json={"chart": "idle"}).status_code == 404
    client.delete("/api/display", headers=hc)
    assert client.get("/api/display/state", headers=hd).status_code == 404


# ---------------------------------------------------------------- video consult
def test_call_signalling_between_hub_and_store():
    assert client.post("/api/calls", json={"caseId": "missing-case-01", "by": "hub"}).status_code == 404
    c = new_case("call-case-000001")
    cid = client.post("/api/calls", json={"caseId": c["id"], "by": "hub"}).json()["id"]
    ringing = client.get(f"/api/calls?cases={c['id']},other-id").json()
    assert [x["id"] for x in ringing] == [cid]
    row = next(r for r in client.get("/api/cases").json() if r["id"] == c["id"])
    assert row["call"]["by"] == "hub"
    assert client.post(f"/api/calls/{cid}/signal", json={"role": "store", "type": "join"}).json()["ok"]
    assert client.post(f"/api/calls/{cid}/signal", json={"role": "hub", "type": "offer", "data": {"type": "offer", "sdp": "v=0"}}).json()["ok"]
    hub = client.get(f"/api/calls/{cid}/signal?role=hub&since=0").json()
    assert hub["status"] == "active" and hub["msgs"][0]["type"] == "join"
    st = client.get(f"/api/calls/{cid}/signal?role=store&since=0").json()
    assert st["msgs"][0]["data"]["sdp"] == "v=0" and st["next"] == 1
    assert client.get(f"/api/calls?cases={c['id']}").json() == [], "no longer ringing"
    client.post(f"/api/calls/{cid}/signal", json={"role": "hub", "type": "end"})
    assert client.post(f"/api/calls/{cid}/signal", json={"role": "store", "type": "ice", "data": {}}).status_code == 404
    big = {"sdp": "x" * 30000}
    cid2 = client.post("/api/calls", json={"caseId": c["id"], "by": "store"}).json()["id"]
    assert client.post(f"/api/calls/{cid2}/signal", json={"role": "store", "type": "offer", "data": big}).status_code == 413


# ---------------------------------------------------------------- review comments
def test_review_takes_own_decision_comments_and_finding_notes():
    c = new_case("review-case-0001")
    body = {"reviewer": ME, "decision": "other", "decisionText": "Glasses now; retina check at next camp",
            "comments": "Advise anti-glare coating; recheck sugar control.", "findingNotes": {"DIABETES_RETINA": "Agree, overdue 3 years", "X1": "  "}}
    r = client.post(f"/api/cases/{c['id']}/review", json=body)
    assert r.status_code == 200
    rv = r.json()["review"]
    assert rv["decisionLabel"] == "Glasses now; retina check at next camp"
    assert rv["comments"].startswith("Advise") and rv["findingNotes"] == {"DIABETES_RETINA": "Agree, overdue 3 years"}
    bad = dict(body, findingNotes={"not a code!": "x"})
    assert client.post(f"/api/cases/{c['id']}/review", json=bad).status_code == 422
