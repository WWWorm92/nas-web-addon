"""NAS Web: simple browser access to existing SMB shares."""
import json
import logging
import mimetypes
import os
import secrets
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from smb.SMBConnection import SMBConnection
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
LIFETIME = 8 * 3600

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
    name_ok(share)
    if share not in visible_shares(conn):
        fail(403, "Нет доступа к этой шаре")

@app.middleware("http")
async def headers(request, call_next):
    r = await call_next(request)
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
    u = {"name": username, "password": password}
    stage = "SMB connection/authentication"
    try:
        with smb(u) as conn:
            stage = "share enumeration"
            shares = visible_shares(conn)
    except HTTPException:
        logger.warning("SMB login failed at stage: %s (authentication rejected or transport unavailable)", stage)
        raise
    except Exception as exc:
        # Never log user names, passwords or exception bodies that may contain protocol packets.
        logger.error("SMB error: stage=%s exception=%s detail=%s", stage, type(exc).__name__, str(getattr(exc, "message", ""))[:180].replace("\\n", " "))
        fail(401, "SMB failure during " + stage + "; see add-on logs")
    token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(32)
    with LOCK:
        for key in list(SESSIONS):
            if SESSIONS[key]["expires"] < time.time():
                del SESSIONS[key]
        SESSIONS[token] = {**u, "expires": time.time() + LIFETIME, "csrf": csrf}
    r = JSONResponse({"username": username, "shares": shares, "csrf": csrf})
    r.set_cookie("nas_session", token, max_age=LIFETIME, httponly=True,
                 secure=request.url.scheme == "https", samesite="strict", path="/")
    return r

@app.get("/api/me")
def me(request: Request):
    u = user_for(request)
    with smb(u) as conn:
        return {"username": u["name"], "shares": visible_shares(conn), "csrf": u["csrf"]}

@app.post("/api/logout")
def logout(request: Request, x_csrf_token: str = Header(default="")):
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
    with smb(protected(request, x_csrf_token)) as conn:
        share = payload.get("share", "")
        check_share(conn, share)
        try:
            conn.createDirectory(share, full(payload.get("path", ""), payload.get("name", "")))
        except Exception:
            fail(403, "Не удалось создать папку")
    return {"ok": True}

@app.post("/api/rename")
def rename(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    old = path_ok(payload.get("path", ""))
    if not old:
        fail(400, "Выберите файл")
    new = full("/".join(old.split("/")[:-1]), payload.get("name", ""))
    with smb(protected(request, x_csrf_token)) as conn:
        share = payload.get("share", "")
        check_share(conn, share)
        try:
            conn.rename(share, "/" + old, new)
        except Exception:
            fail(403, "Нет доступа к переименованию")
    return {"ok": True}

@app.post("/api/delete")
def delete(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
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
        except Exception:
            fail(403, "Удаление запрещено или папка не пустая")
    return {"ok": True}
