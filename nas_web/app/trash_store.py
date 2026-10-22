"""Persistent recycle-bin metadata and encrypted SMB credentials for 14-day cleanup.

Only items inside <share>/.recycle are registered here. Existing untracked
trash is registered at first authenticated listing (14 days start then).
No photo-index tables or Simple NAS ACLs are modified.
"""
import json
import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from . import remember_auth

DB = Path("/data/nasweb-auth/trash.sqlite3")
RETENTION_SECONDS = 14 * 24 * 60 * 60
LOCK = threading.RLock()
OP_LOCK = threading.RLock()
log = logging.getLogger("nasweb")


@contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(DB, timeout=20)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=20000")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS trash_items(
                share TEXT NOT NULL,
                trash_name TEXT NOT NULL,
                original_path TEXT,
                deleted_at REAL NOT NULL,
                directory INTEGER NOT NULL,
                owner TEXT NOT NULL,
                PRIMARY KEY (share,trash_name)
            );
            CREATE INDEX IF NOT EXISTS idx_trash_expiration ON trash_items(deleted_at);
            CREATE TABLE IF NOT EXISTS cleanup_credentials(
                owner TEXT PRIMARY KEY,
                encrypted BLOB NOT NULL
            );
        """)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        with db:
            yield db
    finally:
        db.close()


def owner_id(username):
    import hashlib
    return hashlib.sha256(username.casefold().encode("utf-8")).hexdigest()


def _cipher():
    # This key is already used for encrypted remember-me authentication.
    # It is stored with permissions 0600 under the private NAS Web directory.
    remember_auth._store()
    return Fernet(remember_auth.KEY.read_bytes())


def remember_user(db, user):
    identity = owner_id(user["name"])
    encoded = json.dumps({"name": user["name"], "password": user["password"]},
                         ensure_ascii=False).encode("utf-8")
    encrypted = _cipher().encrypt(encoded)
    db.execute("INSERT INTO cleanup_credentials(owner,encrypted) VALUES(?,?) "
               "ON CONFLICT(owner) DO UPDATE SET encrypted=excluded.encrypted",
               (identity, encrypted))
    return identity


def record_move(user, share, trash_name, original_path, directory, now=None):
    now = time.time() if now is None else float(now)
    with LOCK, connect() as db:
        owner = remember_user(db, user)
        db.execute("""
            INSERT INTO trash_items
                (share,trash_name,original_path,deleted_at,directory,owner)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(share,trash_name) DO UPDATE SET
                original_path=excluded.original_path,
                deleted_at=excluded.deleted_at,
                directory=excluded.directory,
                owner=excluded.owner
        """, (share,trash_name,original_path,now,int(bool(directory)),owner))
        db.execute("DELETE FROM cleanup_credentials WHERE owner NOT IN "
                   "(SELECT DISTINCT owner FROM trash_items)")


def record_moves(user, share, moves):
    """Record one bulk operation in one SQLite transaction and one encryption."""
    if not moves:
        return
    now = time.time()
    with LOCK, connect() as db:
        owner = remember_user(db, user)
        db.executemany("""
            INSERT INTO trash_items
                (share,trash_name,original_path,deleted_at,directory,owner)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(share,trash_name) DO UPDATE SET
                original_path=excluded.original_path,
                deleted_at=excluded.deleted_at,
                directory=excluded.directory,
                owner=excluded.owner
        """, [(share, m["trash_name"], m["path"], now,
                int(m["directory"]), owner) for m in moves])
        db.execute("DELETE FROM cleanup_credentials WHERE owner NOT IN "
                   "(SELECT DISTINCT owner FROM trash_items)")


def register_legacy(user, share, entries, now=None):
    """Track old bin items at first view, without guessing old deletion times."""
    now = time.time() if now is None else float(now)
    visible = [entry for entry in entries
               if entry.filename not in (".", "..") and entry.filename]
    if not visible:
        return
    identity = owner_id(user["name"])
    with LOCK, connect() as db:
        needs_credential = False
        for entry in visible:
            previous = db.execute(
                "SELECT owner FROM trash_items WHERE share=? AND trash_name=?",
                (share, entry.filename)).fetchone()
            if previous:
                if previous["owner"] == identity:
                    needs_credential = True
                continue
            db.execute("""
                INSERT OR IGNORE INTO trash_items
                    (share,trash_name,original_path,deleted_at,directory,owner)
                VALUES(?,?,NULL,?,?,?)
            """, (share, entry.filename, now, int(bool(entry.isDirectory)), identity))
            needs_credential = True
        # Do not retain an SMB password for browsing an empty bin or someone
        # else's entries. Renew only credentials used by this user's records.
        if needs_credential:
            remember_user(db, user)

def item(share, name):
    with LOCK, connect() as db:
        row=db.execute("SELECT * FROM trash_items WHERE share=? AND trash_name=?",
                       (share,name)).fetchone()
        return dict(row) if row else None


def forget(share, name):
    with LOCK, connect() as db:
        db.execute("DELETE FROM trash_items WHERE share=? AND trash_name=?",(share,name))
        # Keep only credentials needed by outstanding trash items.
        db.execute("DELETE FROM cleanup_credentials WHERE owner NOT IN "
                   "(SELECT DISTINCT owner FROM trash_items)")


def due(now=None):
    now = time.time() if now is None else float(now)
    with LOCK, connect() as db:
        rows=db.execute("""
          SELECT t.*,c.encrypted FROM trash_items t
          JOIN cleanup_credentials c ON c.owner=t.owner
          WHERE t.deleted_at<=?
          ORDER BY t.deleted_at, t.share, t.trash_name
        """,(now-RETENTION_SECONDS,)).fetchall()
    return [dict(row) for row in rows]


def credentials(record):
    try:
        data=json.loads(_cipher().decrypt(record["encrypted"]))
        if isinstance(data,dict) and isinstance(data.get("name"),str) and isinstance(data.get("password"),str):
            return data
    except (InvalidToken,ValueError,TypeError,KeyError):
        pass
    return None
