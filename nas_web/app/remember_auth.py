"""Encrypted, restart-surviving remember-me cookies and durable logout revocation."""
import hashlib
import json
import os
import sqlite3
import threading
import time
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

ROOT = Path("/data/nasweb-auth")
KEY = ROOT / "secret.key"
DB = ROOT / "revoked.sqlite3"
DAYS = 90
LIFETIME = DAYS * 24 * 3600
_lock = threading.RLock()
_cipher = None


def _store():
    global _cipher
    if _cipher is not None:
        return _cipher
    with _lock:
        if _cipher is not None:
            return _cipher
        ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(ROOT, 0o700)
        try:
            fd = os.open(KEY, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "wb") as out:
                out.write(Fernet.generate_key())
        _cipher = Fernet(KEY.read_bytes())
        with sqlite3.connect(DB) as con:
            con.execute("CREATE TABLE IF NOT EXISTS revoked (digest TEXT PRIMARY KEY, until REAL NOT NULL)")
        os.chmod(DB, 0o600)
        return _cipher


def issue(user):
    cipher = _store()
    data = {
        "name": user["name"],
        "password": user["password"],
        "csrf": user["csrf"],
        "shares": user["shares"],
        "expires": time.time() + LIFETIME,
    }
    return cipher.encrypt(json.dumps(data, ensure_ascii=False).encode()).decode()


def restore(token):
    if not token or len(token) > 8192:
        return None
    cipher = _store()
    digest = hashlib.sha256(token.encode()).hexdigest()
    try:
        with _lock, sqlite3.connect(DB) as con:
            if con.execute("SELECT 1 FROM revoked WHERE digest=?", (digest,)).fetchone():
                return None
        data = json.loads(cipher.decrypt(token.encode(), ttl=LIFETIME))
        if not isinstance(data, dict) or data.get("expires", 0) <= time.time():
            return None
        if not all(isinstance(data.get(field), str) for field in ("name", "password", "csrf")):
            return None
        if not isinstance(data.get("shares"), list):
            return None
        return data
    except (InvalidToken, ValueError, TypeError, KeyError):
        return None


def revoke(token):
    if not token:
        return
    _store()
    digest = hashlib.sha256(token.encode()).hexdigest()
    with _lock, sqlite3.connect(DB) as con:
        now = time.time()
        con.execute("DELETE FROM revoked WHERE until < ?", (now,))
        con.execute("INSERT OR REPLACE INTO revoked VALUES (?, ?)", (digest, now + LIFETIME))
