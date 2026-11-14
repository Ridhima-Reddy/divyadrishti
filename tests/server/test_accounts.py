"""Shop accounts: zero-knowledge sign-in, sessions, lockout and encrypted sync."""
import base64
import os
import secrets
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
key = lambda: base64.b64encode(secrets.token_bytes(32)).decode()  # noqa: E731
BOX = {"alg": "A256GCM", "iv": base64.b64encode(secrets.token_bytes(12)).decode(), "ct": base64.b64encode(secrets.token_bytes(48)).decode()}


def signup(login: str, auth: str, shared: bool = False):
    return client.post("/api/auth/signup", json={
        "login": login, "shopName": "Test Optics", "kdfSalt": base64.b64encode(secrets.token_bytes(16)).decode(),
        "iterations": 310000, "authKey": auth, "wrappedKey": BOX, "device": "test phone", "shared": shared})


def test_signup_login_and_duplicate():
    auth = key()
    r = signup("98765 43210", auth)
    assert r.status_code == 201 and r.json()["shop"]["login"] == "9876543210"
    assert signup("+91 9876543210", key()).status_code == 409, "same number, different format"
    pre = client.get("/api/auth/prelogin?login=9876543210").json()
    assert pre["iterations"] == 310000
    li = client.post("/api/auth/login", json={"login": "9876543210", "authKey": auth, "device": "camp laptop", "shared": True})
    assert li.status_code == 200
    j = li.json()
    assert j["wrappedKey"] == BOX, "the server hands back the wrapped key it cannot open"
    me = client.get("/api/auth/me", headers={"X-Shop-Token": j["token"]}).json()
    assert me["shop"]["name"] == "Test Optics" and me["session"]["shared"] is True


def test_unknown_login_gets_a_stable_fake_salt():
    a = client.get("/api/auth/prelogin?login=nobody@example.org").json()
    b = client.get("/api/auth/prelogin?login=nobody@example.org").json()
    assert a == b and len(base64.b64decode(a["kdfSalt"])) == 16
    assert client.get("/api/auth/prelogin?login=not-a-login").status_code == 422


def test_wrong_password_locks_after_five_tries():
    auth = key()
    assert signup("lock@example.org", auth).status_code == 201
    for _ in range(5):
        assert client.post("/api/auth/login", json={"login": "lock@example.org", "authKey": key()}).status_code == 401
    assert client.post("/api/auth/login", json={"login": "lock@example.org", "authKey": auth}).status_code == 429


def test_sync_is_per_account_and_sessions_can_be_revoked():
    t1 = signup("sync1@example.org", key()).json()["token"]
    t2 = signup("sync2@example.org", key()).json()["token"]
    h1, h2 = {"X-Shop-Token": t1}, {"X-Shop-Token": t2}
    assert client.put("/api/sync/case/c-1", headers=h1, json={"box": BOX, "updatedAt": "2026-11-14T10:00:00Z"}).status_code == 200
    assert client.put("/api/sync/secret/c-1", headers=h1, json={"box": BOX, "updatedAt": "2026-11-14T10:00:00Z"}).status_code == 400
    assert client.put("/api/sync/case/c-1", json={"box": BOX, "updatedAt": "2026-11-14T10:00:00Z"}).status_code == 401
    got = client.get("/api/sync?since=", headers=h1).json()
    assert [r["rid"] for r in got["records"]] == ["c-1"] and got["records"][0]["box"] == BOX
    assert client.get("/api/sync?since=", headers=h2).json()["records"] == [], "another shop sees nothing"
    later = client.get(f"/api/sync?since={got['records'][0]['updatedAt']}", headers=h1).json()
    assert later["records"] == []
    # a second device, then sign it out from the first
    auth = key()
    t3 = signup("dev@example.org", auth).json()["token"]
    t4 = client.post("/api/auth/login", json={"login": "dev@example.org", "authKey": auth, "device": "camp laptop", "shared": True}).json()["token"]
    devs = client.get("/api/auth/sessions", headers={"X-Shop-Token": t3}).json()
    assert len(devs) == 2 and any(d["shared"] for d in devs)
    other = next(d for d in devs if not d["current"])
    assert client.delete(f"/api/auth/sessions/{other['id']}", headers={"X-Shop-Token": t3}).status_code == 200
    assert client.get("/api/auth/me", headers={"X-Shop-Token": t4}).status_code == 401
    assert client.post("/api/auth/logout", headers={"X-Shop-Token": t3}).status_code == 200
    assert client.get("/api/auth/me", headers={"X-Shop-Token": t3}).status_code == 401
