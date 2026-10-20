"""Independent NAS Web admin authentication. No SMB credentials or shares."""
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from pathlib import Path

DB=Path("/data/nasweb-auth/admin.sqlite3")
ITERATIONS=450000

def connect():
    DB.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    db=sqlite3.connect(DB,timeout=15)
    db.execute("CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1),salt BLOB NOT NULL,hash BLOB NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY,expires REAL NOT NULL,csrf TEXT NOT NULL)")
    return db

def configured():
    with connect() as db:return db.execute("SELECT 1 FROM admin WHERE id=1").fetchone() is not None

def _hash(password,salt):
    return hashlib.pbkdf2_hmac("sha256",password.encode(),salt,ITERATIONS)

def setup(password):
    if len(password)<12 or len(password)>256:raise ValueError("Пароль администратора: от 12 до 256 символов")
    salt=os.urandom(32)
    with connect() as db,db:
        # Never overwrite an existing administrator through setup.
        result=db.execute("INSERT OR IGNORE INTO admin VALUES (1,?,?)",(salt,_hash(password,salt)))
        return result.rowcount==1

def login(password):
    with connect() as db:
        row=db.execute("SELECT salt,hash FROM admin WHERE id=1").fetchone()
        if row is None or not hmac.compare_digest(_hash(password,row[0]),row[1]):return None
        token=secrets.token_urlsafe(40);csrf=secrets.token_urlsafe(32)
        with db:
            db.execute("DELETE FROM sessions WHERE expires<?",(time.time(),))
            db.execute("INSERT INTO sessions VALUES (?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),time.time()+14400,csrf))
        return token,csrf

def session(token):
    if not token:return None
    with connect() as db:
        row=db.execute("SELECT csrf FROM sessions WHERE digest=? AND expires>?",
            (hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
        return row[0] if row else None

def logout(token):
    if not token:return
    with connect() as db,db:
        db.execute("DELETE FROM sessions WHERE digest=?",(hashlib.sha256(token.encode()).hexdigest(),))

def change_password(token,old_password,new_password):
    if len(new_password)<12 or len(new_password)>256:
        raise ValueError("Новый пароль: от 12 до 256 символов")
    salt=os.urandom(32)
    with connect() as db,db:
        row=db.execute("SELECT salt,hash FROM admin WHERE id=1").fetchone()
        if row is None or not hmac.compare_digest(_hash(old_password,row[0]),row[1]):
            raise ValueError("Неверный текущий пароль")
        db.execute("UPDATE admin SET salt=?,hash=? WHERE id=1",(salt,_hash(new_password,salt)))
        db.execute("DELETE FROM sessions WHERE digest<>?",(hashlib.sha256(token.encode()).hexdigest(),))
