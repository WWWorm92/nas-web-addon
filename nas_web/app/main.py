"""NAS Web: simple browser access to existing SMB shares."""
import json
import io
import logging
import mimetypes
import os
import secrets
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from PIL import UnidentifiedImageError
from . import thumb_cache
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from .smb_compat import SMBConnection
from starlette.background import BackgroundTask

logger = logging.getLogger('nasweb')
app = FastAPI(title="NAS Web", docs_url=None, redoc_url=None, openapi_url=None)
ROOT = Path(__file__).parent
try:
    opts = json.loads(Path("/data/options.json").read_text())
except (OSError, ValueError):
    opts = {}
HOST = opts.get("smb_host", "192.168.1.35")
PORT = int(opts.get("smb_port", 445))
REMOTE_NAME = opts.get("smb_server_name", "NAS")
LIMIT = int(opts.get("max_upload_mb", 1024)) * 1024 * 1024
SESSIONS = {}
LOCK = threading.RLock()
LIFETIME = 4 * 3600
MAX_SESSIONS = 64
ATTEMPTS = {}
RATE_WINDOW = 600
RATE_LIMIT = 10
COOKIE_SECURE = bool(opts.get('https_only', False))

def smb_action_error(action, exc):
    """Log server status while keeping internal paths and credentials out of responses."""
    status = ""
    try:
        status = str(exc.getErrorString()) if hasattr(exc, "getErrorString") else ""
    except Exception:
        pass
    if not status:
        status = str(exc)[:160]
    logger.warning("SMB %s failed: %s: %s", action, type(exc).__name__, status)
    if "STATUS_ACCESS_DENIED" in status:
        fail(403, "Нет прав для операции в Simple NAS (SMB: доступ запрещён)")
    if "STATUS_OBJECT_NAME_COLLISION" in status or "STATUS_OBJECT_NAME_EXISTS" in status:
        fail(409, "Файл или папка с таким именем уже существует")
    if "STATUS_DIRECTORY_NOT_EMPTY" in status:
        fail(409, "Папка не пуста. Сначала удалите её содержимое")
    if "STATUS_OBJECT_NAME_NOT_FOUND" in status or "STATUS_OBJECT_PATH_NOT_FOUND" in status:
        fail(404, "Файл или папка не найдены")
    fail(502, "Ошибка SMB при операции: " + action + ". Проверьте журнал NAS Web")

def fail(status, reason):
    raise HTTPException(status_code=status, detail=reason)

def name_ok(name):
    if not isinstance(name, str) or not name or name in (".", "..") or any(c in name for c in '/\\\\\0*?:') or any(ord(c) < 32 for c in name):
        fail(400, "Некорректное имя")
    return name

def path_ok(path):
    if not isinstance(path, str):
        fail(400, "Некорректный путь")
    items = path.replace("\\\\", "/").split("/")
    if any(x in (".", "..") for x in items):
        fail(400, "Некорректный путь")
    return "/".join(name_ok(x) for x in items if x)

def full(path, new=""):
    return "/" + "/".join(x for x in (path_ok(path), name_ok(new) if new else "") if x)

def login_guard(request, username):
    # IP is deliberately taken from the TCP peer, not spoofable X-Forwarded-For.
    peer = request.client.host if request.client else 'unknown'
    key = (peer, username.casefold())
    now = time.monotonic()
    with LOCK:
        for k, values in list(ATTEMPTS.items()):
            ATTEMPTS[k] = [t for t in values if now - t < RATE_WINDOW]
            if not ATTEMPTS[k]:
                del ATTEMPTS[k]
        if len(ATTEMPTS.get(key, [])) >= RATE_LIMIT:
            fail(429, "Слишком много попыток. Повторите вход через 10 минут.")
    return key

def record_failure(key):
    with LOCK:
        ATTEMPTS.setdefault(key, []).append(time.monotonic())

def check_origin(request):
    origin = request.headers.get("origin")
    if origin:
        parts = urlsplit(origin)
        if parts.scheme not in ('http', 'https') or parts.netloc.lower() != request.headers.get('host', '').lower():
            fail(403, "Недопустимый Origin")
    elif request.headers.get('sec-fetch-site', '').lower() == 'cross-site':
        fail(403, "Недопустимый источник запроса")

def user_for(request):
    token = request.cookies.get("nas_session", "")
    with LOCK:
        u = SESSIONS.get(token)
        if not u or u["expires"] < time.time():
            SESSIONS.pop(token, None)
            fail(401, "Необходимо войти")
        return dict(u)

def protected(request, csrf):
    u = user_for(request)
    if not csrf or not secrets.compare_digest(csrf, u["csrf"]):
        fail(403, "CSRF check failed")
    return u

@contextmanager
def smb(u):
    conn = SMBConnection(u["name"], u["password"], "NASWEB", REMOTE_NAME, use_ntlm_v2=True, is_direct_tcp=True)
    try:
        if not conn.connect(HOST, PORT, timeout=12):
            fail(401, "Не удалось войти в SMB")
        conn.authorized_shares = u.get("shares", ())
        yield conn
    finally:
        conn.close()

def visible_shares(conn):
    result = []
    for s in conn.listShares(timeout=15):
        if s.isSpecial or s.name.endswith("$"):
            continue
        try:
            conn.listPath(s.name, "/", timeout=12)
        except Exception:
            continue
        result.append(s.name)
    return result

def check_share(conn, share):
    """Avoid re-enumerating every SMB share for each file operation.

    The list was verified at sign-in; Samba itself enforces permissions for
    every individual request even when a share is later revoked.
    """
    name_ok(share)
    if share not in getattr(conn, "authorized_shares", ()):
        fail(403, "Нет доступа к этой шаре")

@app.middleware("http")
async def headers(request, call_next):
    started = time.perf_counter()
    r = await call_next(request)
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    if elapsed_ms >= 1500 and request.url.path in ("/api/thumb", "/api/list", "/api/video"):
        logger.warning("Slow request: route=%s ms=%s status=%s", request.url.path, elapsed_ms, r.status_code)
    r.headers["Server-Timing"] = f"app;dur={elapsed_ms}"
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["Referrer-Policy"] = "no-referrer"
    r.headers["X-Frame-Options"] = "DENY"
    r.headers["Cache-Control"] = "no-store"
    r.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    return r

@app.get("/", response_class=HTMLResponse)
def home():
    return (ROOT / "index.html").read_text(encoding="utf-8")

@app.get("/static/app.js")
def js():
    return Response((ROOT / "app.js").read_text(encoding="utf-8"), media_type="application/javascript")

@app.post("/api/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    if not username or not password or len(username) > 128 or len(password) > 1024:
        fail(400, "Проверьте логин и пароль")
    check_origin(request)
    key = login_guard(request, username)
    u = {"name": username, "password": password}
    stage = "SMB connection/authentication"
    try:
        with smb(u) as conn:
            stage = "share enumeration"
            shares = visible_shares(conn)
    except HTTPException:
        record_failure(key)
        logger.warning("SMB login failed at stage: %s", stage)
        fail(401, "Неверные данные входа или SMB недоступен")
    except Exception as exc:
        record_failure(key)
        logger.warning("SMB login failed: stage=%s exception=%s", stage, type(exc).__name__)
        fail(401, "Неверные данные входа или SMB недоступен")
    token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(32)
    with LOCK:
        for session_id in list(SESSIONS):
            if SESSIONS[session_id]["expires"] < time.time():
                del SESSIONS[session_id]
        ATTEMPTS.pop(key, None)
        if len(SESSIONS) >= MAX_SESSIONS:
            oldest = min(SESSIONS, key=lambda k: SESSIONS[k]["expires"])
            del SESSIONS[oldest]
        SESSIONS[token] = {**u, "shares": shares, "expires": time.time() + LIFETIME, "csrf": csrf}
    r = JSONResponse({"username": username, "shares": shares, "csrf": csrf})
    r.set_cookie("nas_session", token, max_age=LIFETIME, httponly=True,
                 secure=COOKIE_SECURE or request.url.scheme == "https", samesite="strict", path="/")
    return r

@app.get("/api/me")
def me(request: Request):
    u = user_for(request)
    with smb(u) as conn:
        return {"username": u["name"], "shares": visible_shares(conn), "csrf": u["csrf"]}

@app.post("/api/logout")
def logout(request: Request, x_csrf_token: str = Header(default="")):
    check_origin(request)
    protected(request, x_csrf_token)
    with LOCK:
        SESSIONS.pop(request.cookies.get("nas_session"), None)
    r = JSONResponse({"ok": True})
    r.delete_cookie("nas_session")
    return r

@app.get("/api/list")
def list_files(request: Request, share: str, path: str = ""):
    with smb(user_for(request)) as conn:
        check_share(conn, share)
        try:
            files = conn.listPath(share, full(path), timeout=30)
        except Exception:
            fail(403, "Не удалось прочитать папку")
    return {"items": [{"name": f.filename, "directory": f.isDirectory, "size": f.file_size,
                       "modified": f.last_write_time} for f in files if f.filename not in (".", "..")]}

@app.get("/api/thumb")
def thumbnail(request: Request, share: str, path: str, v: str = "", large: bool = False):
    """Fast persistent user-scoped preview, checked against live SMB permissions."""
    u = user_for(request)
    p = path_ok(path)
    name_ok(share)
    if share not in u.get("shares", []) or not p:
        fail(403, "Нет доступа")
    if p.rsplit(".", 1)[-1].lower() not in {"jpg", "jpeg", "png", "webp", "gif"}:
        fail(404, "Unsupported image")
    key = thumb_cache.key_for(u["name"], share, p, v[:80] + (":large" if large else ":small"))
    class LimitedBuffer(io.BytesIO):
        def write(self, data):
            if self.tell() + len(data) > 25 * 1024 * 1024:
                raise ValueError("Image too large")
            return super().write(data)
    try:
        cached = thumb_cache.get(key)
        if cached is not None:
            # Do not allow access to cached bytes after SMB rights were revoked.
            with smb(u) as conn:
                conn.can_read(share, "/" + p)
            return Response(cached, media_type="image/webp")
        with thumb_cache.WORKERS:
            cached = thumb_cache.get(key)
            with smb(u) as conn:
                if cached is not None:
                    conn.can_read(share, "/" + p)
                    return Response(cached, media_type="image/webp")
                buffer = LimitedBuffer()
                conn.retrieveFile(share, "/" + p, buffer, timeout=40)
            small, fullsize = thumb_cache.render_pair(buffer)
            version = v[:80]
            small_key = thumb_cache.key_for(u["name"], share, p, version + ":small")
            big_key = thumb_cache.key_for(u["name"], share, p, version + ":large")
            thumb_cache.put(small_key, small)
            thumb_cache.put(big_key, fullsize)
            result = fullsize if large else small
        return Response(result, media_type="image/webp")
    except HTTPException:
        raise
    except (ValueError, UnidentifiedImageError, OSError):
        fail(415, "Миниатюра недоступна")
    except Exception as exc:
        logger.warning("Thumbnail unavailable: %s", type(exc).__name__)
        fail(403, "Нет доступа или ошибка чтения SMB")

@app.get("/api/video")
def video_stream(request: Request, share: str, path: str):
    """HTTP byte ranges backed by SMB random reads, without staging full videos."""
    u = user_for(request)
    p = path_ok(path)
    name_ok(share)
    if not p or p.rsplit(".", 1)[-1].lower() not in {"mp4", "webm", "m4v", "mov", "mp3", "ogg"}:
        fail(404, "Unsupported media")
    try:
        with smb(u) as conn:
            check_share(conn, share)
            total = conn.file_size(share, "/" + p)
    except HTTPException:
        raise
    except Exception:
        fail(403, "Media unavailable")
    if total == 0:
        return Response(b"", media_type=mimetypes.guess_type(p)[0] or "application/octet-stream",
                        headers={"Accept-Ranges": "bytes"})
    range_header = request.headers.get("range")
    first, last = 0, total - 1
    if range_header:
        import re
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        if not match or not any(match.groups()):
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        low, high = match.groups()
        if low:
            first = int(low)
            last = min(int(high), last) if high else last
        else:
            suffix = int(high)
            first = max(0, total - suffix)
        if first > last or first >= total:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
    status = 206 if range_header else 200
    length = last - first + 1
    def stream():
        with smb(u) as conn:
            yield from conn.iter_range(share, "/" + p, first, length)
    headers = {"Accept-Ranges": "bytes", "Content-Length": str(length),
               "Cache-Control": "private, no-store"}
    if status == 206:
        headers["Content-Range"] = f"bytes {first}-{last}/{total}"
    return StreamingResponse(stream(), status_code=status,
        media_type=mimetypes.guess_type(p)[0] or "application/octet-stream",
        headers=headers)

@app.get("/api/file")
def get_file(request: Request, share: str, path: str, inline: bool = False):
    p = path_ok(path)
    if not p:
        fail(400, "Выберите файл")
    filename = p.split("/")[-1]
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    tmp = tempfile.NamedTemporaryFile(prefix="nasweb_", delete=False)
    try:
        with tmp, smb(user_for(request)) as conn:
            check_share(conn, share)
            conn.retrieveFile(share, "/" + p, tmp, timeout=300)
        disposition = "inline" if inline and suffix in {"jpg", "jpeg", "png", "gif", "webp", "pdf", "txt", "mp4", "webm", "mp3", "ogg"} else "attachment"
        return FileResponse(tmp.name, media_type=mime,
            headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename)}"},
            background=BackgroundTask(lambda: os.unlink(tmp.name)))
    except Exception:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        fail(403, "Не удалось скачать файл")

@app.post("/api/upload")
async def upload(request: Request, share: str = Form(...), path: str = Form(""),
                 file: UploadFile = File(...), x_csrf_token: str = Header(default="")):
    check_origin(request)
    u = protected(request, x_csrf_token)
    filename = name_ok(file.filename or "")
    size = 0
    with tempfile.TemporaryFile() as tmp:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > LIMIT:
                fail(413, "Превышен лимит загрузки")
            tmp.write(chunk)
        tmp.seek(0)
        try:
            with smb(u) as conn:
                check_share(conn, share)
                conn.storeFile(share, full(path, filename), tmp, timeout=600)
        except Exception:
            fail(403, "Нет доступа на запись")
    return {"ok": True, "size": size}

@app.post("/api/mkdir")
def mkdir(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    check_origin(request)
    with smb(protected(request, x_csrf_token)) as conn:
        share = payload.get("share", "")
        check_share(conn, share)
        try:
            conn.createDirectory(share, full(payload.get("path", ""), payload.get("name", "")))
        except Exception as exc:
            smb_action_error("mkdir", exc)
    return {"ok": True}

@app.post("/api/rename")
def rename(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    check_origin(request)
    old = path_ok(payload.get("path", ""))
    if not old:
        fail(400, "Выберите файл")
    new = full("/".join(old.split("/")[:-1]), payload.get("name", ""))
    with smb(protected(request, x_csrf_token)) as conn:
        share = payload.get("share", "")
        check_share(conn, share)
        try:
            conn.rename(share, "/" + old, new)
        except Exception as exc:
            smb_action_error("rename", exc)
    return {"ok": True}

@app.post("/api/delete")
def delete(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    check_origin(request)
    path = path_ok(payload.get("path", ""))
    if not path:
        fail(400, "Выберите файл")
    with smb(protected(request, x_csrf_token)) as conn:
        share = payload.get("share", "")
        check_share(conn, share)
        try:
            if payload.get("directory"):
                conn.deleteDirectory(share, "/" + path)
            else:
                conn.deleteFiles(share, "/" + path)
        except Exception as exc:
            smb_action_error("delete", exc)
    return {"ok": True}
