"""Encrypted, expiring share links: the server only ever holds ciphertext."""
import base64
import json
import os
import secrets
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("DD_DB", str(Path(tempfile.mkdtemp()) / "test.db"))
os.environ.setdefault("DD_SEED", "0")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from server import app as server  # noqa: E402

client = TestClient(server.app)


def b64(n: int) -> str:
    return base64.b64encode(secrets.token_bytes(n)).decode()


def new_id() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(16)).rstrip(b"=").decode()


def record(**over) -> dict:
    r = {"id": new_id(), "kind": "passport", "ciphertext": b64(300), "iv": b64(12)}
    r.update(over)
    return r


def create(**over) -> tuple[dict, dict]:
    rec = record(**over)
    res = client.post("/api/shares", json=rec, headers={"X-Actor": "field:test-store"})
    assert res.status_code == 201, res.text
    return rec, res.json()


def db_row(share_id: str):
    with server.store.lock:
        return server.store.db.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()


def test_create_view_count_down_then_gone():
    rec, out = create(maxViews=3)
    assert out["id"] == rec["id"] and out["maxViews"] == 3 and len(out["deleteToken"]) >= 40
    r = client.get(f"/api/shares/{rec['id']}")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["referrer-policy"] == "no-referrer"
    body = r.json()
    assert body == {"ciphertext": rec["ciphertext"], "iv": rec["iv"], "salt": None, "iterations": None, "kind": "passport",
                    "expiresAt": out["expiresAt"], "viewsLeft": 2, "pin": False}
    assert client.get(f"/api/shares/{rec['id']}").json()["viewsLeft"] == 1
    last = client.get(f"/api/shares/{rec['id']}").json()
    assert last["viewsLeft"] == 0 and last["ciphertext"] == rec["ciphertext"]
    assert db_row(rec["id"])["ciphertext"] is None, "ciphertext wiped once the last view is served"
    gone = client.get(f"/api/shares/{rec['id']}")
    assert gone.status_code == 410 and gone.json()["detail"] == "no views left"
    assert db_row(rec["id"])["views"] == 3, "refused requests do not count"


def test_defaults_and_pin_fields():
    rec, out = create()
    assert out["maxViews"] == 20
    expires = datetime.fromisoformat(out["expiresAt"])
    assert timedelta(days=6, hours=23) < expires - server.now() <= timedelta(days=7)
    pinned, _ = create(salt=b64(16), iterations=310000, kind="referral")
    body = client.get(f"/api/shares/{pinned['id']}").json()
    assert body["pin"] is True and body["salt"] == pinned["salt"] and body["iterations"] == 310000 and body["kind"] == "referral"


def test_expiry_then_purge(monkeypatch):
    rec, _ = create(expiresDays=1)
    assert client.get(f"/api/shares/{rec['id']}").status_code == 200
    later = server.now() + timedelta(days=1, minutes=1)
    monkeypatch.setattr(server, "now", lambda: later)
    r = client.get(f"/api/shares/{rec['id']}")
    assert r.status_code == 410 and r.json()["detail"] == "expired"
    assert server.purge_expired(force=True) >= 1
    monkeypatch.undo()
    assert db_row(rec["id"]) is None
    assert client.get(f"/api/shares/{rec['id']}").status_code == 404


def test_revoke_needs_the_delete_token_and_wipes_ciphertext():
    rec, out = create(caseRef="case-revoke-1")
    sid = rec["id"]
    assert client.delete(f"/api/shares/{sid}").status_code == 403
    assert client.delete(f"/api/shares/{sid}", headers={"X-Delete-Token": "not-the-token"}).status_code == 403
    assert client.get(f"/api/shares/{sid}").status_code == 200, "a failed revoke changes nothing"
    r = client.delete(f"/api/shares/{sid}", headers={"X-Delete-Token": out["deleteToken"]})
    assert r.status_code == 200 and r.json() == {"id": sid, "status": "revoked"}
    row = db_row(sid)
    assert row["revoked"] == 1 and row["ciphertext"] is None and row["iv"] is None
    gone = client.get(f"/api/shares/{sid}")
    assert gone.status_code == 410 and gone.json()["detail"] == "revoked"
    assert client.delete(f"/api/shares/{sid}", headers={"X-Delete-Token": out["deleteToken"]}).status_code == 200, "idempotent"
    server.purge_expired(force=True)
    assert client.get(f"/api/shares/{sid}").status_code == 404
    assert client.delete(f"/api/shares/{new_id()}", headers={"X-Delete-Token": "x"}).status_code == 404
    assert client.get("/api/shares/not-a-share-id").status_code == 404


def test_validation_and_size_limit():
    limit = server.MAX_SHARE_CIPHERTEXT
    too_big = base64.b64encode(b"\0" * (limit + 1)).decode()
    assert client.post("/api/shares", json=record(ciphertext=too_big)).status_code == 422
    just_fits = base64.b64encode(b"\0" * limit).decode()
    assert client.post("/api/shares", json=record(ciphertext=just_fits)).status_code == 201
    bad = [
        {"ciphertext": "not base64!!"},
        {"ciphertext": b64(8)},                     # shorter than a GCM tag
        {"iv": b64(16)},                            # GCM iv is 12 bytes
        {"id": "short"},
        {"id": "a" * 22},                           # not canonical base64url of 16 bytes
        {"kind": "letter"},
        {"maxViews": 0}, {"maxViews": 101},
        {"expiresDays": 0}, {"expiresDays": 31},
        {"salt": b64(16)},                          # salt without iterations
        {"iterations": 310000},                     # iterations without salt
        {"salt": b64(16), "iterations": 1000},      # too few iterations
        {"caseRef": "has spaces"},
        {"patient": {"name": "R. Lakshmi"}},        # plaintext fields are refused outright
    ]
    for over in bad:
        r = client.post("/api/shares", json=record(**over))
        assert r.status_code == 422, (over, r.status_code)
        assert "Lakshmi" not in r.text
    rec, _ = create()
    assert client.post("/api/shares", json=rec).status_code == 409, "an id cannot be reused"
    assert client.post("/api/shares", content=b"{" + b" " * 130_000 + b"}",
                       headers={"Content-Type": "application/json"}).status_code == 413


def test_audit_trail_without_secrets():
    rec, out = create(caseRef="case-audit-77")
    client.get(f"/api/shares/{rec['id']}")
    client.delete(f"/api/shares/{rec['id']}", headers={"X-Delete-Token": "wrong"})
    client.delete(f"/api/shares/{rec['id']}", headers={"X-Delete-Token": out["deleteToken"]})
    client.get(f"/api/shares/{rec['id']}")
    entries = client.get("/api/audit?case_id=case-audit-77").json()
    actions = [a["action"] for a in entries]
    for a in ("share_created", "share_viewed", "share_revoke_denied", "share_revoked", "share_refused"):
        assert a in actions, a
    log = json.dumps(entries)
    assert rec["id"][:6] in log
    assert rec["id"] not in log, "only an id prefix is logged"
    assert out["deleteToken"] not in log and rec["ciphertext"] not in log and rec["iv"] not in log
    assert next(a for a in entries if a["action"] == "share_created")["actor"] == "field:test-store"
