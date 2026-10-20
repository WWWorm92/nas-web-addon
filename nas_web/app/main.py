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
from contextlib import contextmanager, nullcontext
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from PIL import UnidentifiedImageError
from . import thumb_cache, media_convert, smb_pool, remember_auth, photo_dates, gallery_index
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

# Prioritize foreground photo transfers over new thumbnail SMB reads.
PHOTO_TRANSFER_CONDITION = threading.Condition()
ACTIVE_PHOTO_TRANSFERS = 0

@contextmanager
def foreground_photo_transfer():
    global ACTIVE_PHOTO_TRANSFERS
    with PHOTO_TRANSFER_CONDITION:
        ACTIVE_PHOTO_TRANSFERS += 1
    try:
        yield
    finally:
        with PHOTO_TRANSFER_CONDITION:
            ACTIVE_PHOTO_TRANSFERS -= 1
            PHOTO_TRANSFER_CONDITION.notify_all()

def wait_for_photo_transfer():
    # Bounded waiting avoids starving thumbnails during extended viewing.
    with PHOTO_TRANSFER_CONDITION:
        PHOTO_TRANSFER_CONDITION.wait_for(lambda: ACTIVE_PHOTO_TRANSFERS == 0, timeout=4)



@app.on_event("startup")
def report_cache_state():
    try:
        thumb_cache.check_writable()
        info = thumb_cache.statistics()
        logger.warning("NAS Web cache: path=%s writable=yes files=%d size_mb=%.2f",
                       info["path"], info["files"], info["size_mb"])
    except OSError as exc:
        logger.critical("NAS Web cache unavailable at /data/nasweb-thumbs: %s", type(exc).__name__)
        raise


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
        if u and u["expires"] >= time.time():
            return dict(u)
        SESSIONS.pop(token, None)
    # A remembered login can survive add-on restarts without storing plaintext
    # SMB credentials in either localStorage or an unencrypted disk database.
    remembered = remember_auth.restore(request.cookies.get("nas_remember", ""))
    if remembered is None:
        fail(401, "Необходимо войти")
    return remembered

def protected(request, csrf):
    u = user_for(request)
    if not csrf or not secrets.compare_digest(csrf, u["csrf"]):
        fail(403, "CSRF check failed")
    return u

@contextmanager
def smb(u):
    # Sign-in uses a fresh connection; authenticated operations reuse short-
    # lived connections only inside the same login session.
    session_key = u.get("csrf")
    if not session_key:
        conn = SMBConnection(u["name"], u["password"], "NASWEB", REMOTE_NAME, use_ntlm_v2=True, is_direct_tcp=True)
        try:
            if not conn.connect(HOST, PORT, timeout=12):
                fail(401, "Не удалось войти в SMB")
            conn.authorized_shares = u.get("shares", ())
            yield conn
        finally:
            conn.close()
        return
    conn, reused = smb_pool.acquire(session_key, u["name"], u["password"], HOST, PORT, REMOTE_NAME)
    conn._nasweb_reused = reused
    healthy = False
    try:
        conn.authorized_shares = u.get("shares", ())
        yield conn
        healthy = True
    finally:
        smb_pool.release(session_key, conn, healthy)

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


@app.on_event("shutdown")
def close_idle_smb_connections():
    smb_pool.close_all()

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

@app.get("/static/icon.svg")
def favicon_svg():
    return FileResponse(ROOT / "icon.svg", media_type="image/svg+xml")


@app.get("/static/icon-192.png")
def mobile_icon():
    return FileResponse(ROOT / "icon-192.png", media_type="image/png")


@app.post("/api/login")
def login(request: Request, username: str = Form(...), password: str = Form(...), remember: bool = Form(False)):
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
    # A successful SMB login with no readable shares must not create a
    # misleading authenticated session with an empty gallery.
    if not shares:
        logger.warning("SMB login has no readable shares for account")
        fail(503, "SMB не вернул доступных папок. Проверьте доступность NAS и повторите вход.")
    # Revoke any previous remembered token when logging into the same browser.
    remember_auth.revoke(request.cookies.get("nas_remember", ""))
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
    secure_cookie = COOKIE_SECURE or request.url.scheme == "https"
    r.set_cookie("nas_session", token, max_age=LIFETIME, httponly=True,
                 secure=secure_cookie, samesite="strict", path="/")
    if remember:
        # Fernet encrypts credentials/auth metadata; the key is private and
        # persisted in HA /data. HttpOnly prevents JavaScript reading it.
        remembered = remember_auth.issue({**u, "shares": shares, "csrf": csrf})
        r.set_cookie("nas_remember", remembered, max_age=remember_auth.LIFETIME,
                     httponly=True, secure=secure_cookie, samesite="strict", path="/")
    else:
        r.delete_cookie("nas_remember", path="/")
    return r

@app.get("/api/me")
def me(request: Request):
    u = user_for(request)
    # A transient SMB listing failure must not overwrite a previously
    # authorized share list with [] in the browser. Actual SMB permissions
    # continue to be enforced on each file request.
    with smb(u) as conn:
        current_shares = visible_shares(conn)
    if not current_shares:
        logger.warning("SMB share enumeration returned no readable shares during session restore")
        fail(503, "Не удалось получить список SMB-папок. Повторите запрос позже.")
    authorized = set(u.get("shares", []))
    current_shares = [name for name in current_shares if name in authorized]
    if not current_shares:
        fail(403, "У текущей сессии нет доступа к доступным SMB-папкам. Войдите заново.")
    return {"username": u["name"], "shares": current_shares, "csrf": u["csrf"]}

@app.post("/api/logout")
def logout(request: Request, x_csrf_token: str = Header(default="")):
    check_origin(request)
    u = protected(request, x_csrf_token)
    with LOCK:
        SESSIONS.pop(request.cookies.get("nas_session"), None)
    smb_pool.revoke(u["csrf"])
    remember_auth.revoke(request.cookies.get("nas_remember", ""))
    r = JSONResponse({"ok": True})
    r.delete_cookie("nas_session", path="/")
    r.delete_cookie("nas_remember", path="/")
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

PHOTO_DATE_WORKERS = threading.BoundedSemaphore(1)

@app.post("/api/photo-dates")
def photo_capture_dates(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    """Resolve at most 8 JPEG capture dates per request, using a persistent cache."""
    check_origin(request)
    u = protected(request, x_csrf_token)
    share = name_ok(payload.get("share", ""))
    if share not in u.get("shares", []):
        fail(403, "Нет доступа к этой шаре")
    folder = path_ok(payload.get("path", ""))
    requested = payload.get("files", [])
    if not isinstance(requested, list) or len(requested) > 8:
        fail(400, "Не более восьми фотографий за запрос")
    results = {}
    for file in requested:
        if not isinstance(file, dict):
            fail(400, "Некорректная запись файла")
        name = name_ok(file.get("name", ""))
        if name in results:
            fail(400, "Повторяющийся файл")
        version = file.get("modified")
        size = file.get("size")
        if not isinstance(version, (int, float)) or not isinstance(size, (int, float)) or size < 0:
            fail(400, "Некорректная версия файла")
        p = "/".join(x for x in (folder, name) if x)
        cached, taken = photo_dates.lookup(u["name"], share, p, version, size)
        results[name] = {"taken": taken, "cached": cached}
    missing = [f for f in requested if not results[f["name"]]["cached"]]
    if missing:
        with PHOTO_DATE_WORKERS:
            wait_for_photo_transfer()
            with smb(u) as conn:
                check_share(conn, share)
                # Check the actual SMB directory listing instead of trusting names
                # or metadata supplied by an untrusted browser.
                entries = {e.filename: e for e in conn.listPath(share, full(folder))
                           if not e.isDirectory}
                for file in missing:
                    name = file["name"]
                    entry = entries.get(name)
                    if entry is None:
                        results[name] = {"taken": None, "cached": False}
                        continue
                    if int(entry.file_size) != int(file["size"]) or int(entry.last_write_time) != int(file["modified"]):
                        results[name] = {"taken": None, "cached": False}
                        continue
                    p = "/".join(x for x in (folder, name) if x)
                    taken = None
                    if name.lower().endswith((".jpg", ".jpeg")) and entry.file_size:
                        try:
                            taken = photo_dates.from_jpeg_header(conn, share, p, entry.file_size)
                        except Exception as exc:
                            logger.info("EXIF scan unavailable: %s", type(exc).__name__)
                    photo_dates.save(u["name"], share, p, file["modified"], file["size"], taken)
                    results[name] = {"taken": taken, "cached": True}
    return {"dates": results}

# The unified photo library is indexed incrementally and scoped to each
# authenticated SMB user. A single worker prevents NAS traversal storms.
GALLERY_SCAN_LOCK = threading.Lock()

@app.get("/api/gallery")
def unified_gallery(request: Request, offset: int = 0, limit: int = 90):
    u = user_for(request)
    if offset < 0 or limit < 1 or limit > 120:
        fail(400, "Некорректная страница галереи")
    shares = list(u.get("shares", []))
    owner = gallery_index.key(u["name"])
    status = gallery_index.state(owner, shares)
    return {"items": gallery_index.page(owner, shares, offset, limit), **status}


def _gallery_scan_step(u, owner, shares):
    """One bounded SMB scan batch; existing SQLite index is never reset."""
    with smb(u) as conn:
        for _ in range(3):
            with gallery_index.LOCK, gallery_index.connect() as db:
                gallery_index.begin(db, owner, shares)
                folder = gallery_index.pending_folder(db, owner)
            if folder is None:
                break
            share, path = folder["share"], folder["path"]
            entries = ()
            if share in shares:
                try:
                    check_share(conn, share)
                    entries = conn.listPath(share, full(path), timeout=20)
                except Exception as exc:
                    logger.info("Gallery folder skipped: %s", type(exc).__name__)
            with gallery_index.LOCK, gallery_index.connect() as db:
                gallery_index.add_folder_contents(db, owner, share, path, entries)
        with gallery_index.LOCK, gallery_index.connect() as db:
            complete = gallery_index.pending_folder(db, owner) is None
            if complete:
                db.execute("UPDATE jobs SET complete=1 WHERE owner=?", (owner,))
        if complete:
            for _ in range(3):
                with gallery_index.LOCK, gallery_index.connect() as db:
                    row = gallery_index.next_unchecked(db, owner, shares)
                if row is None:
                    break
                taken = None
                try:
                    wait_for_photo_transfer()
                    cached, taken = photo_dates.lookup(
                        u["name"], row["share"], row["path"],
                        row["modified"], row["size"])
                    if not cached and row["size"]:
                        taken = photo_dates.from_jpeg_header(
                            conn, row["share"], row["path"], row["size"])
                        photo_dates.save(u["name"], row["share"], row["path"],
                                         row["modified"], row["size"], taken)
                except Exception as exc:
                    logger.info("Gallery EXIF skipped: %s", type(exc).__name__)
                with gallery_index.LOCK, gallery_index.connect() as db:
                    gallery_index.save_date(db, owner, row["share"], row["path"], taken)
    

def _gallery_background(u, owner, shares):
    # Keep credentials only in RAM, and never run indefinitely after logout.
    deadline = time.monotonic() + 1800
    try:
        while time.monotonic() < deadline:
            # Credentials come from a successful authenticated /api/gallery/scan
            # request. Remember-me sessions are restored from a signed cookie and
            # are not present in SESSIONS, so checking only SESSIONS would stop
            # their worker immediately. Keep each worker bounded by deadline.
            with GALLERY_SCAN_LOCK:
                _gallery_scan_step(u, owner, shares)
            state = gallery_index.state(owner, shares)
            if state["complete"] and not state["dates_pending"]:
                break
            time.sleep(0.3)
    except Exception:
        logger.exception("Background gallery indexing failed")
    finally:
        with GALLERY_BACKGROUND_LOCK:
            GALLERY_BACKGROUND.pop(owner, None)


GALLERY_BACKGROUND_LOCK = threading.Lock()
GALLERY_BACKGROUND = {}

@app.post("/api/gallery/scan")
def scan_unified_gallery(request: Request, x_csrf_token: str = Header(default="")):
    check_origin(request)
    u = protected(request, x_csrf_token)
    shares = list(u.get("shares", []))
    owner = gallery_index.key(u["name"])
    with GALLERY_BACKGROUND_LOCK:
        active = GALLERY_BACKGROUND.get(owner)
        if active is None or not active.is_alive():
            worker = threading.Thread(target=_gallery_background, args=(dict(u), owner, tuple(shares)),
                                      daemon=True, name="nas-gallery-index")
            GALLERY_BACKGROUND[owner] = worker
            worker.start()
    return {"busy": True, **gallery_index.state(owner, shares)}


@app.post("/api/gallery/reindex")
def reindex_unified_gallery(request: Request, x_csrf_token: str = Header(default="")):
    check_origin(request)
    u = protected(request, x_csrf_token)
    owner = gallery_index.key(u["name"])
    if not GALLERY_SCAN_LOCK.acquire(blocking=False):
        fail(409, "Индексация уже выполняется")
    try:
        gallery_index.reset(owner, list(u.get("shares", [])))
    finally:
        GALLERY_SCAN_LOCK.release()
    return {"ok": True}


@app.get("/api/thumb")
def thumbnail(request: Request, share: str, path: str, v: str = "", large: bool = False):
    """Serve small images quickly, with cache hit and stage latency diagnostics."""
    u = user_for(request)
    p = path_ok(path)
    name_ok(share)
    if share not in u.get("shares", []) or not p:
        fail(403, "Нет доступа")
    if p.rsplit(".", 1)[-1].lower() not in {"jpg", "jpeg", "png", "webp", "gif"}:
        fail(404, "Unsupported image")
    key = thumb_cache.key_for(u["name"], share, p, v[:80] + (":large" if large else ":small"))
    start = time.perf_counter()
    timings = {"queue": 0, "smb": 0, "connect": 0, "read": 0, "decode": 0, "cache": 0, "reused": False}
    def ms(since):
        return int((time.perf_counter() - since) * 1000)
    def finish(data, cache_status):
        elapsed = ms(start)
        if elapsed > 1200:
            logger.warning(
                "Thumbnail performance: state=%s size=%s total=%dms queue=%dms smb=%dms connect=%dms read=%dms reused=%s decode=%dms cache=%dms storage=%s",
                cache_status, "large" if large else "small", elapsed,
                timings["queue"], timings["smb"], timings["connect"], timings["read"], timings["reused"], timings["decode"], timings["cache"],
                thumb_cache.CACHE_ROOT
            )
        return Response(data, media_type="image/webp", headers={
            "X-Thumbnail-Cache": cache_status,
            "Server-Timing": "thumb;dur=" + str(elapsed),
        })
    class LimitedBuffer(io.BytesIO):
        def write(self, data):
            if self.tell() + len(data) > 25 * 1024 * 1024:
                raise ValueError("Image too large")
            return super().write(data)
    try:
        cached = thumb_cache.get(key)
        if cached is not None:
            tick = time.perf_counter()
            with smb(u) as conn:
                conn.can_read(share, "/" + p)
            timings["smb"] += ms(tick)
            return finish(cached, "HIT")
        tick = time.perf_counter()
        # The viewer has a dedicated slot; thumbnail backlogs cannot block it.
        with (thumb_cache.LARGE_WORKERS if large else thumb_cache.WORKERS):
            timings["queue"] = ms(tick)
            cached = thumb_cache.get(key)
            if cached is not None:
                tick = time.perf_counter()
                with smb(u) as conn:
                    conn.can_read(share, "/" + p)
                timings["smb"] += ms(tick)
                return finish(cached, "HIT-WAIT")
            if not large:
                wait_for_photo_transfer()
            tick = time.perf_counter()
            with smb(u) as conn:
                timings["connect"] = ms(tick)
                timings["reused"] = bool(getattr(conn, "_nasweb_reused", False))
                read_started = time.perf_counter()
                buffer = LimitedBuffer()
                conn.retrieveFile(share, "/" + p, buffer, timeout=40)
                timings["read"] = ms(read_started)
            timings["smb"] += ms(tick)
            tick = time.perf_counter()
            result = thumb_cache.render_image(buffer, large=large)
            timings["decode"] = ms(tick)
            tick = time.perf_counter()
            thumb_cache.put(key, result)
            timings["cache"] = ms(tick)
        return finish(result, "MISS")
    except HTTPException:
        raise
    except (ValueError, UnidentifiedImageError, OSError):
        fail(415, "Миниатюра недоступна")
    except Exception as exc:
        logger.warning("Thumbnail unavailable: %s", type(exc).__name__)
        fail(403, "Нет доступа или ошибка чтения SMB")

@app.get("/api/mov-mp4")
def converted_mov(request: Request, share: str, path: str, v: str = ""):
    """Explicit, bounded MOV compatibility fallback for browser playback."""
    u = user_for(request)
    p = path_ok(path)
    if not p.lower().endswith(".mov"):
        fail(404, "Only MOV conversion supported")
    name_ok(share)
    if share not in u.get("shares", []):
        fail(403, "Нет доступа к шаре")
    try:
        with smb(u) as conn:
            size = conn.file_size(share, "/" + p)
            conn.can_read(share, "/" + p)
        key = media_convert.key(u["name"], share, p, v[:80])
        def fetch(destination):
            with destination.open("wb") as out:
                with smb(u) as conn:
                    conn.retrieveFile(share, "/" + p, out, timeout=300)
        output = media_convert.prepare(key, size, fetch)
        return FileResponse(output, media_type="video/mp4",
            headers={"Cache-Control": "private, no-store", "Accept-Ranges": "bytes"})
    except media_convert.ConversionError as exc:
        fail(422, str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("MOV fallback error: %s", type(exc).__name__)
        fail(502, "Не удалось подготовить видео. Проверьте журнал NAS Web")

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

# Bounded in-memory path for ordinary camera JPEGs. Impacket getFile can
# transfer these in one operation, avoiding StreamingResponse per-block yields.
PHOTO_FAST_LIMIT = 16 * 1024 * 1024
PHOTO_FAST_WORKERS = threading.BoundedSemaphore(2)

@app.get("/api/photo")
def fast_photo(request: Request, share: str, path: str):
    u = user_for(request)
    p = path_ok(path)
    name_ok(share)
    if not p or p.rsplit(".", 1)[-1].lower() not in {"jpg", "jpeg"}:
        fail(404, "Unsupported image")
    started = time.perf_counter()
    with foreground_photo_transfer():
        with PHOTO_FAST_WORKERS:
            try:
                with smb(u) as conn:
                    check_share(conn, share)
                    metadata_start = time.perf_counter()
                    size = conn.file_size(share, "/" + p)
                    metadata_ms = round((time.perf_counter() - metadata_start) * 1000)
                    if size > PHOTO_FAST_LIMIT:
                        logger.info("Fast photo oversized: size_kb=%s; falling back to streaming", round(size/1024))
                    else:
                        class BoundedJPEG(io.BytesIO):
                            def write(self, chunk):
                                if self.tell() + len(chunk) > PHOTO_FAST_LIMIT:
                                    raise ValueError("Photo exceeds memory limit")
                                return super().write(chunk)
                        output = BoundedJPEG()
                        read_start = time.perf_counter()
                        conn.retrieveFile(share, "/" + p, output, timeout=40)
                        read_ms = round((time.perf_counter() - read_start) * 1000)
                        image_bytes = output.getvalue()
                        if len(image_bytes) != size:
                            raise IOError("Photo transfer incomplete")
                        logger.warning(
                            "Fast photo: size_kb=%d metadata=%dms read=%dms total=%dms",
                            round(size / 1024), metadata_ms, read_ms,
                            round((time.perf_counter() - started) * 1000)
                        )
                        return Response(image_bytes, media_type="image/jpeg",
                                        headers={"Cache-Control": "private, no-store",
                                                 "Content-Disposition": "inline"})
            except HTTPException:
                raise
            except Exception as exc:
                logger.warning("Fast photo failed: %s", type(exc).__name__)
                fail(502, "Не удалось загрузить фотографию")
    # Very large originals retain existing bounded-memory streaming behavior.
    return get_file(request, share, p, inline=True)

@app.get("/api/file")
def get_file(request: Request, share: str, path: str, inline: bool = False):
    """Stream SMB directly to the browser; never stage multi-GB files in /tmp."""
    p = path_ok(path)
    if not p:
        fail(400, "Выберите файл")
    u = user_for(request)
    filename = p.split("/")[-1]
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    file_started = time.perf_counter()
    with smb(u) as conn:
        check_share(conn, share)
        try:
            total = conn.file_size(share, "/" + p)
        except Exception:
            fail(404, "Файл не найден")
    metadata_ms = round((time.perf_counter() - file_started) * 1000)
    import re
    first, last = 0, max(0, total - 1)
    requested_range = request.headers.get("range")
    if requested_range and total:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested_range.strip())
        if not match or not any(match.groups()):
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        low, high = match.groups()
        if low:
            first = int(low)
            last = min(last, int(high)) if high else last
        else:
            first = max(0, total - int(high))
        if first > last or first >= total:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
    code = 206 if requested_range and total else 200
    size = last - first + 1 if total else 0
    disposition = "inline" if inline and suffix in {"jpg","jpeg","png","gif","webp","pdf","txt","mp4","webm","mp3","ogg"} else "attachment"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename)}",
               "Accept-Ranges": "bytes", "Content-Length": str(size),
               "Cache-Control": "private, no-store"}
    if code == 206:
        headers["Content-Range"] = f"bytes {first}-{last}/{total}"
    def stream():
        stream_started = time.perf_counter()
        first_byte_ms = None
        bytes_sent = 0
        chunks = 0
        finished = False
        try:
            with (foreground_photo_transfer() if inline and suffix in {"jpg", "jpeg", "png", "webp", "gif"} else nullcontext()):
                with smb(u) as conn:
                    for block in conn.iter_range(share, "/" + p, first, size):
                        if first_byte_ms is None:
                            first_byte_ms = round((time.perf_counter() - stream_started) * 1000)
                        bytes_sent += len(block)
                        chunks += 1
                        yield block
            finished = True
        finally:
            elapsed_ms = round((time.perf_counter() - stream_started) * 1000)
            if inline and suffix in {"jpg", "jpeg", "png", "webp", "gif"}:
                logger.warning(
                    "Original photo stream: status=%s size_kb=%d metadata=%dms first_byte=%sms transfer=%dms blocks=%d bytes=%d complete=%s",
                    code, round(size / 1024), metadata_ms, first_byte_ms,
                    elapsed_ms, chunks, bytes_sent, finished
                )
    return StreamingResponse(stream(), status_code=code, media_type=mime, headers=headers)

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
                if filename.lower().endswith(gallery_index.IMAGE_EXTS):
                    try:
                        parent = path_ok(path)
                        item = entry_in_folder(conn, share, parent, filename)
                        if item is not None and not item.isDirectory:
                            gallery_index.record_upload(
                                gallery_index.key(u["name"]), share,
                                "/".join(x for x in (parent, filename) if x),
                                item.file_size, item.last_write_time)
                    except Exception:
                        logger.exception("Unable to update gallery after upload")
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

# File transfers are deliberately bounded to avoid exhausting HA OS memory/disk.
TRANSFER_LIMIT = 512 * 1024 * 1024
ZIP_LIMIT = 512 * 1024 * 1024
ZIP_MAX_FILES = 100

def entry_in_folder(conn, share, parent, name):
    entries = conn.listPath(share, full(parent))
    return next((x for x in entries if x.filename == name), None)

@app.post("/api/transfer")
def transfer_file(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    check_origin(request)
    u = protected(request, x_csrf_token)
    source_share = name_ok(payload.get("share", ""))
    target_share = name_ok(payload.get("target_share", source_share))
    source = path_ok(payload.get("path", ""))
    destination_dir = path_ok(payload.get("target_dir", ""))
    operation = payload.get("operation", "copy")
    if not source or operation not in ("copy", "move"):
        fail(400, "Некорректный файл или операция")
    filename = source.split("/")[-1]
    target = "/".join(x for x in (destination_dir, filename) if x)
    if source_share == target_share and source == target:
        fail(409, "Источник и назначение совпадают")
    if target_share == source_share and target.startswith(source + "/"):
        fail(409, "Нельзя переместить папку внутрь себя")
    try:
        with smb(u) as conn:
            check_share(conn, source_share)
            check_share(conn, target_share)
            origin_dir = "/".join(source.split("/")[:-1])
            source_entry = entry_in_folder(conn, source_share, origin_dir, filename)
            if source_entry is None:
                fail(404, "Исходный файл не найден")
            if entry_in_folder(conn, target_share, destination_dir, filename) is not None:
                fail(409, "В папке назначения уже есть элемент с таким именем")
            if source_entry.isDirectory:
                if operation != "move" or source_share != target_share:
                    fail(422, "Копирование папок и перенос папок между шарами пока не поддерживаются")
                conn.rename(source_share, "/" + source, "/" + target)
                return {"ok": True, "operation": "move"}
            if operation == "move" and source_share == target_share:
                conn.rename(source_share, "/" + source, "/" + target)
                return {"ok": True, "operation": "move"}
            if source_entry.file_size > TRANSFER_LIMIT:
                fail(413, "Максимальный размер файла для копирования — 512 МБ")
            # Local temporary staging avoids simultaneous SMB reads and writes on
            # pooled connections. Do not delete the source if upload fails.
            with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b") as temporary:
                conn.retrieveFile(source_share, "/" + source, temporary)
                if temporary.tell() != source_entry.file_size:
                    fail(502, "SMB вернул неполный файл. Источник не изменён")
                temporary.seek(0)
                # putFile could overwrite on a concurrent conflicting write;
                # serialise transfer operations within this add-on.
                conn.storeFile(target_share, "/" + target, temporary)
            if operation == "move":
                conn.deleteFiles(source_share, "/" + source)
    except HTTPException:
        raise
    except Exception as exc:
        smb_action_error("transfer", exc)
    return {"ok": True, "operation": operation}

@app.post("/api/zip")
def download_zip(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    import zipfile
    check_origin(request)
    u = protected(request, x_csrf_token)
    share = name_ok(payload.get("share", ""))
    folder = path_ok(payload.get("path", ""))
    names = payload.get("files")
    if not isinstance(names, list) or not 1 <= len(names) <= ZIP_MAX_FILES:
        fail(400, "Выберите от 1 до 100 файлов")
    names = [name_ok(x) for x in names]
    if len(set(names)) != len(names):
        fail(400, "Повторяющиеся имена файлов")
    temporary = tempfile.TemporaryDirectory(prefix="nasweb-zip-")
    archive = Path(temporary.name) / "selection.zip"
    try:
        with smb(u) as conn:
            check_share(conn, share)
            entries = {x.filename: x for x in conn.listPath(share, full(folder))}
            total = 0
            for name in names:
                entry = entries.get(name)
                if entry is None or entry.isDirectory:
                    fail(422, "ZIP поддерживает только существующие файлы")
                total += entry.file_size
                if total > ZIP_LIMIT:
                    fail(413, "ZIP ограничен суммарным размером 512 МБ")
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zipout:
                for name in names:
                    # Stream each SMB file directly into ZIP without another in-memory copy.
                    with zipout.open(name, "w", force_zip64=True) as member:
                        conn.retrieveFile(share, full(folder, name), member)
        return FileResponse(archive, filename="NAS-Web-files.zip",
                            media_type="application/zip",
                            background=BackgroundTask(temporary.cleanup),
                            headers={"Cache-Control": "private, no-store"})
    except HTTPException:
        temporary.cleanup()
        raise
    except Exception as exc:
        temporary.cleanup()
        smb_action_error("zip", exc)

@app.post("/api/delete")
def delete(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    check_origin(request)
    path = path_ok(payload.get("path", ""))
    if not path:
        fail(400, "Выберите файл")
    with smb(protected(request, x_csrf_token)) as conn:
        share = payload.get("share", "")
        check_share(conn, share)
        # Move the complete object into the share's recycle directory.
        # SMB rename is atomic within a share, so a nonempty directory
        # is moved intact without recursive deletion or path recreation.
        if path == ".recycle" or path.startswith(".recycle/"):
            fail(400, "Удаление объектов внутри корзины пока не поддерживается")
        parent, _, basename = path.rpartition("/")
        try:
            source_entry = entry_in_folder(conn, share, parent, basename)
            if source_entry is None:
                fail(404, "Объект не найден")
            if bool(source_entry.isDirectory) != bool(payload.get("directory")):
                fail(409, "Тип объекта изменился. Обновите папку")
            root_entries = {x.filename for x in conn.listPath(share, "/")}
            if ".recycle" not in root_entries:
                conn.createDirectory(share, "/.recycle")
            else:
                recycle_entry = entry_in_folder(conn, share, "", ".recycle")
                if not recycle_entry or not recycle_entry.isDirectory:
                    fail(409, "Имя .recycle занято файлом")
            from uuid import uuid4
            trash_name = basename
            existing = {x.filename for x in conn.listPath(share, "/.recycle")}
            if trash_name in existing:
                stem, dot, ext = basename.rpartition(".")
                if not stem or not dot:
                    stem, ext = basename, ""
                suffix = uuid4().hex[:8]
                trash_name = stem + " (" + suffix + ")" + ("." + ext if ext else "")
            conn.rename(share, "/" + path, "/.recycle/" + trash_name)
        except HTTPException:
            raise
        except Exception as exc:
            smb_action_error("move to recycle", exc)
    return {"ok": True, "recycled": True}
