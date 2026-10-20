"""Short-lived, session-scoped SMB connection reuse.

Connections are never shared simultaneously, across sessions or across SMB users.
Abnormal operations invalidate the connection. Idle connections are closed
quickly and expire independently of the Home Assistant session cookie.
"""
import logging
import threading
import time
from .smb_compat import SMBConnection

log = logging.getLogger("nasweb")
_LOCK = threading.RLock()
_IDLE = []
_IDLE_SECONDS = 35
_MAX_IDLE = 12
_MAX_PER_SESSION = 3

def _close(conn):
    try:
        conn.close()
    except Exception:
        pass

def _purge(now):
    expired = []
    retained = []
    for key, conn, saved in _IDLE:
        if now - saved > _IDLE_SECONDS:
            expired.append(conn)
        else:
            retained.append((key, conn, saved))
    _IDLE[:] = retained
    return expired

def acquire(key, username, password, hostname, port, remote):
    now = time.monotonic()
    with _LOCK:
        old = _purge(now)
        conn = None
        for i in range(len(_IDLE)-1, -1, -1):
            if _IDLE[i][0] == key:
                _, conn, _ = _IDLE.pop(i)
                break
    for c in old:
        _close(c)
    if conn is not None:
        return conn, True
    conn = SMBConnection(username, password, "NASWEB", remote, use_ntlm_v2=True, is_direct_tcp=True)
    try:
        if not conn.connect(hostname, port, timeout=12):
            raise ConnectionError("SMB connection failed")
        return conn, False
    except BaseException:
        _close(conn)
        raise

def release(key, conn, healthy):
    if not healthy:
        _close(conn)
        return
    now = time.monotonic()
    with _LOCK:
        old = _purge(now)
        session_count = sum(1 for k, _, _ in _IDLE if k == key)
        if session_count < _MAX_PER_SESSION:
            _IDLE.append((key, conn, now))
        else:
            old.append(conn)
        while len(_IDLE) > _MAX_IDLE:
            _, evicted, _ = _IDLE.pop(0)
            old.append(evicted)
    for c in old:
        _close(c)

def revoke(key):
    with _LOCK:
        doomed = [conn for k, conn, _ in _IDLE if k == key]
        _IDLE[:] = [(k, conn, ts) for k, conn, ts in _IDLE if k != key]
    for c in doomed:
        _close(c)

def close_all():
    with _LOCK:
        conns = [conn for _, conn, _ in _IDLE]
        _IDLE.clear()
    for conn in conns:
        _close(conn)
