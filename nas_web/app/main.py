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
from . import thumb_cache, media_convert, smb_pool, remember_auth, photo_dates, gallery_index, collections, admin_auth
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from .smb_compat import SMBConnection
from starlette.background import BackgroundTask

logger = logging.getLogger('nasweb')
from collections import deque
ADMIN_EVENTS=deque(maxlen=200)
def admin_log_event(level,message):
    ADMIN_EVENTS.append({"time":round(time.time()),"level":level.upper(),"message":message[:160]})
app = FastAPI(title="NAS Web", docs_url=None, redoc_url=None, openapi_url=None)
ROOT = Path(__file__).parent
try:
    opts = json.loads(Path("/data/nasweb-auth/options.json").read_text())
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


# Independent service administrator. The admin cookie is never accepted by
# user_for(), and the admin account has no SMB identity or file privileges.
def admin_user(request: Request):
    csrf=admin_auth.session(request.cookies.get("nas_admin",""))
    if csrf is None:fail(401,"Требуется вход администратора")
    return csrf

def admin_protected(request: Request,csrf: str):
    expected=admin_user(request)
    if not csrf or not secrets.compare_digest(csrf,expected):fail(403,"CSRF check failed")

@app.get("/admin")
def admin_page():
    return FileResponse(ROOT/"admin.html",media_type="text/html")

def admin_options_diagnostic():
    """Safe diagnostics: expose option names, never option values."""
    path=Path("/data/nasweb-auth/options.json")
    try:
        data=json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data,dict):
            return {"state":"invalid_format","keys":[],"setup_key_ready":False}
        key=data.get("admin_setup_key")
        return {"state":"readable","keys":sorted(str(k) for k in data.keys()),
                "setup_key_ready":isinstance(key,str) and len(key)>=24,
                "key_present":"admin_setup_key" in data,
                "key_type":type(key).__name__ if key is not None else "missing",
                "key_length":len(key) if isinstance(key,str) else 0}
    except PermissionError:
        return {"state":"permission_denied","keys":[],"setup_key_ready":False}
    except FileNotFoundError:
        return {"state":"missing_file","keys":[],"setup_key_ready":False}
    except (OSError,ValueError,TypeError):
        return {"state":"invalid_or_unreadable","keys":[],"setup_key_ready":False}

def admin_setup_secret():
    try:
        data=json.loads(Path("/data/nasweb-auth/options.json").read_text(encoding="utf-8"))
        value=data.get("admin_setup_key","") if isinstance(data,dict) else ""
        return value if isinstance(value,str) else ""
    except (OSError,ValueError,TypeError):
        return ""

@app.get("/api/admin/status")
def admin_status(request: Request):
    return {"configured":admin_auth.configured(),"authenticated":bool(admin_auth.session(request.cookies.get("nas_admin",""))),
            "setup_key_ready":len(admin_setup_secret())>=24,
            "options_file_present":Path("/data/nasweb-auth/options.json").is_file(),
            "options_diagnostic":admin_options_diagnostic()}

@app.post("/api/admin/setup")
def admin_setup(request: Request,payload: dict):
    check_origin(request)
    secret=admin_setup_secret()
    if len(secret)<24:fail(503,"Задайте admin_setup_key (минимум 24 символа) в настройках аддона")
    guard=login_guard(request,"__admin_setup__")
    if admin_auth.configured():fail(409,"Администратор уже создан")
    if not secrets.compare_digest(str(payload.get("setup_key","")),secret):
        record_failure(guard);fail(403,"Неверный ключ первоначальной настройки")
    try:created=admin_auth.setup(str(payload.get("password","")))
    except ValueError as exc:fail(400,str(exc))
    if not created:fail(409,"Администратор уже создан")
    return {"ok":True}

@app.post("/api/admin/login")
def admin_login(request: Request,payload: dict):
    check_origin(request)
    guard=login_guard(request,"__admin__")
    result=admin_auth.login(str(payload.get("password","")))
    if result is None:
        record_failure(guard);fail(401,"Неверный пароль")
    with LOCK:ATTEMPTS.pop(guard,None)
    token,csrf=result
    response=JSONResponse({"ok":True,"csrf":csrf})
    response.set_cookie("nas_admin",token,max_age=14400,httponly=True,
                        secure=COOKIE_SECURE or request.url.scheme=="https",samesite="strict",path="/")
    return response

@app.post("/api/admin/logout")
def admin_logout(request: Request,x_csrf_token: str=Header(default="")):
    check_origin(request);admin_protected(request,x_csrf_token)
    admin_auth.logout(request.cookies.get("nas_admin",""))
    response=JSONResponse({"ok":True});response.delete_cookie("nas_admin",path="/")
    return response

@app.get("/static/admin.js")
def admin_script():
    return Response((ROOT/"admin.js").read_text(encoding="utf-8"),media_type="application/javascript")

@app.get("/api/admin/diagnostics")
def admin_diagnostics(request: Request):
    admin_user(request)
    from datetime import datetime,timezone
    import shutil
    cache=thumb_cache.statistics()
    with gallery_index.LOCK,gallery_index.connect() as db:
        totals=db.execute("SELECT COUNT(*),COALESCE(SUM(size),0),COUNT(taken) FROM photos").fetchone()
        owners=db.execute("SELECT COUNT(DISTINCT owner) FROM photos").fetchone()[0]
        jobs=db.execute("SELECT COUNT(*),SUM(CASE WHEN complete=1 THEN 1 ELSE 0 END),SUM(CASE WHEN limited=1 THEN 1 ELSE 0 END) FROM jobs").fetchone()
        pending=db.execute("SELECT COUNT(*) FROM folders WHERE done=0").fetchone()[0]
        date_exts="(lower(name) LIKE '%.jpg' OR lower(name) LIKE '%.jpeg' OR lower(name) LIKE '%.png' OR lower(name) LIKE '%.webp')"
        dates=db.execute("SELECT COUNT(*) FROM photos WHERE exif_checked=0 AND "+date_exts).fetchone()[0]
        checked_without=db.execute("SELECT COUNT(*) FROM photos WHERE exif_checked=1 AND taken IS NULL AND "+date_exts).fetchone()[0]
        denied=db.execute("""SELECT COUNT(*) FROM exif_denied d JOIN photos p
                ON p.owner=d.owner AND p.share=d.share AND p.path=d.path
                WHERE p.exif_checked=0 AND d.size=p.size AND d.modified=p.modified
                AND d.retry_after>? AND (lower(p.name) LIKE '%.jpg' OR lower(p.name) LIKE '%.jpeg'
                OR lower(p.name) LIKE '%.png' OR lower(p.name) LIKE '%.webp')""",
                (time.time(),)).fetchone()[0]
        unique=db.execute("SELECT COUNT(*) FROM (SELECT 1 FROM photos GROUP BY share,path,size,modified)").fetchone()[0]
        per_owner=gallery_index.summaries_by_owner(db)
    try:
        current_owner=gallery_index.key(user_for(request)["name"])
    except HTTPException:
        current_owner=None
    owner_rows=sorted(per_owner,key=lambda row:(row["owner"]!=current_owner,row["owner"]))
    user_indexes=[]
    for index,row in enumerate(owner_rows,1):
        blocked=row["blocked"]
        user_indexes.append({
            "label":"Текущий SMB-пользователь" if row["owner"]==current_owner else f"Индекс пользователя {index}",
            "current":row["owner"]==current_owner,
            "photos":row["photos"],"dated":row["dated"],
            "checked_without_date":row["checked_without_date"],
            "pending":row["pending"],
            "blocked":blocked,"actionable":max(0,row["pending"]-blocked)
        })
    disk=shutil.disk_usage("/data")
    return {"service":"NAS Web","gallery_index_rows":totals[0],"gallery_index_bytes":totals[1],
            "gallery_dated":totals[2],"indexed_users":owners,"scan_jobs":jobs[0],
            "completed_jobs":jobs[1] or 0,"limited_jobs":jobs[2] or 0,
            "pending_folders":pending,"pending_exif":dates,
            "pending_exif_available":max(0,dates-denied),"pending_exif_denied":denied,
            "checked_exif_without_date":checked_without,
            "unique_photo_files":unique,
            "user_indexes":user_indexes,
            "thumbnail_cache":{"files":cache["files"],"size_mb":cache["size_mb"]},
            "data_disk":{"total":disk.total,"used":disk.used,"free":disk.free},
            "smb_host_configured":bool(HOST),"server_time":datetime.now(timezone.utc).isoformat()}

@app.get("/api/admin/events")
def admin_events(request: Request):
    admin_user(request)
    return {"events":list(ADMIN_EVENTS)[-100:]}

@app.post("/api/admin/cache-maintenance")
def admin_cache_maintenance(request: Request,x_csrf_token: str=Header(default="")):
    check_origin(request);admin_protected(request,x_csrf_token)
    # Evict expired/oversize cache files only, not the photo index or SMB data.
    with thumb_cache.FILES_LOCK:
        thumb_cache.OPS = 24
        thumb_cache._prune()
    admin_log_event("info","Cache maintenance completed")
    return {"ok":True,"cache":thumb_cache.statistics()}

@app.post("/api/admin/password")
def admin_password(request: Request,payload: dict,x_csrf_token: str=Header(default="")):
    check_origin(request);admin_protected(request,x_csrf_token)
    try:admin_auth.change_password(request.cookies.get("nas_admin",""),
                                   str(payload.get("old_password","")),str(payload.get("new_password","")))
    except ValueError as exc:fail(400,str(exc))
    admin_log_event("info","Administrator password changed")
    return {"ok":True}

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
    from . import trash_store
    u = user_for(request)
    folder = path_ok(path)
    with smb(u) as conn:
        check_share(conn, share)
        try:
            files = conn.listPath(share, full(folder), timeout=30)
        except Exception:
            fail(403, "Не удалось прочитать папку")
    if folder == ".recycle":
        # Legacy items have no recorded original path. Give them a fresh,
        # explicit 14-day retention period on their first authenticated view.
        with trash_store.OP_LOCK:
            try:
                trash_store.register_legacy(u, share, files)
            except Exception:
                logger.exception("Unable to register existing recycle-bin items")
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

@app.get("/api/gallery/months")
def unified_gallery_months(request: Request, order: str = "taken", timezone_offset: int = 0):
    """Navigation metadata across ALL indexed photos visible to this SMB user."""
    u = user_for(request)
    if order not in ("taken", "modified") or not -840 <= timezone_offset <= 840:
        fail(400, "Некорректная сортировка или часовой пояс")
    shares = list(u.get("shares", ()))
    owner = gallery_index.key(u["name"])
    months = gallery_index.month_index(owner, shares, order, timezone_offset)
    return {"months": months, "order": order, "total": sum(x["count"] for x in months)}


@app.get("/api/gallery")
def unified_gallery(request: Request, offset: int = 0, limit: int = 90, order: str = "taken"):
    u = user_for(request)
    if order not in ("taken", "modified"):
        fail(400, "Некорректная сортировка")
    if offset < 0 or limit < 1 or limit > 120:
        fail(400, "Некорректная страница галереи")
    shares = list(u.get("shares", []))
    owner = gallery_index.key(u["name"])
    status = gallery_index.state(owner, shares)
    return {"items": gallery_index.page(owner, shares, offset, limit, order), **status}


# Virtual collections are private to each authenticated user. Every photo operation
# checks both the session's allowed shares and the indexed photo identity.
@app.get("/api/collections")
def collection_list(request: Request):
    u=user_for(request)
    return collections.listing(gallery_index.key(u["name"]),list(u.get("shares",[])))

@app.post("/api/collections/album")
def collection_album_create(request: Request, payload: dict, x_csrf_token: str=Header(default="")):
    check_origin(request)
    u=protected(request,x_csrf_token)
    try: album_id=collections.create_album(gallery_index.key(u["name"]),str(payload.get("name","")))
    except ValueError as exc: fail(400,str(exc))
    return {"id":album_id}

@app.delete("/api/collections/album/{album_id}")
def collection_album_delete(request: Request, album_id: int, x_csrf_token: str=Header(default="")):
    check_origin(request)
    u=protected(request,x_csrf_token)
    collections.remove_album(gallery_index.key(u["name"]),album_id)
    return {"ok":True}

@app.post("/api/collections/item")
def collection_item(request: Request, payload: dict, x_csrf_token: str=Header(default="")):
    check_origin(request)
    u=protected(request,x_csrf_token)
    owner=gallery_index.key(u["name"])
    share=name_ok(str(payload.get("share","")))
    path=path_ok(str(payload.get("path","")))
    if not path or not collections.photo_exists(owner,list(u.get("shares",[])),share,path):
        fail(404,"Фотография недоступна")
    enabled=payload.get("enabled") is True
    if payload.get("album_id") is None:
        collections.set_favorite(owner,share,path,enabled)
    else:
        try: collections.set_album_item(owner,int(payload["album_id"]),share,path,enabled)
        except (ValueError,TypeError) as exc: fail(400,str(exc))
    return {"ok":True}

@app.get("/api/collections/photos")
def collection_photos(request: Request, album_id: int=None, favorites: bool=False, offset: int=0, limit: int=90):
    u=user_for(request)
    if offset<0 or limit<1 or limit>120 or (not favorites and album_id is None):
        fail(400,"Некорректный запрос")
    return {"items":collections.photos(gallery_index.key(u["name"]),list(u.get("shares",[])),album_id,favorites,limit,offset)}

@app.get("/api/gallery/memories")
def gallery_memories(request: Request, month: int=0, day: int=0):
    from datetime import date
    u=user_for(request)
    today=date.today()
    month=month or today.month;day=day or today.day
    try: date(2024,month,day)
    except ValueError: fail(400,"Некорректная дата")
    return {"items":collections.memories(gallery_index.key(u["name"]),list(u.get("shares",[])),month,day)}

@app.get("/api/gallery/statistics")
def gallery_statistics(request: Request):
    u=user_for(request)
    return collections.statistics(gallery_index.key(u["name"]),list(u.get("shares",[])))


def _gallery_scan_step(u, owner, shares, skipped=None):
    """One bounded SMB scan batch; existing SQLite index is never reset."""
    if skipped is None: skipped=set()
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
                    row = gallery_index.next_unchecked(db, owner, shares, skipped)
                if row is None:
                    break
                taken = None
                try:
                    wait_for_photo_transfer()
                    cached, taken = photo_dates.lookup(
                        u["name"], row["share"], row["path"],
                        row["modified"], row["size"])
                    # A cached negative EXIF result is still a completed check.
                    # Reopening it repeatedly defeats the disk cache and doubles
                    # SMB work after an old-style retry.
                    if not cached and row["size"]:
                        taken = photo_dates.from_jpeg_header(
                            conn, row["share"], row["path"], row["size"])
                        photo_dates.save(u["name"], row["share"], row["path"],
                                         row["modified"], row["size"], taken)
                except Exception as exc:
                    # An ACL-denied file must not stop indexing other readable photos.
                    # Keep it pending in SQLite so a later run can retry if permissions change.
                    message=str(exc).upper()
                    if "STATUS_ACCESS_DENIED" in message or "0XC0000022" in message:
                        skipped.add((row["share"],row["path"]))
                        with gallery_index.LOCK, gallery_index.connect() as db:
                            gallery_index.mark_exif_denied(db, owner, row)
                        # Avoid hundreds of identical access-denied log lines.
                        if len(skipped)==1 or len(skipped)%25==0:
                            logger.warning("Gallery EXIF: %d inaccessible SMB files skipped for 24h", len(skipped))
                        if len(skipped)>=100:
                            return
                        continue
                    logger.warning("Gallery EXIF read failed (will retry): %s", type(exc).__name__)
                    raise
                with gallery_index.LOCK, gallery_index.connect() as db:
                    gallery_index.save_date(db, owner, row["share"], row["path"], taken)
                    gallery_index.clear_exif_denied(db, owner, row["share"], row["path"])
    

def _gallery_background(u, owner, shares):
    # Keep credentials only in RAM, and never run indefinitely after logout.
    deadline = time.monotonic() + 8 * 3600
    skipped=set()
    try:
        while time.monotonic() < deadline:
            # Credentials come from a successful authenticated /api/gallery/scan
            # request. Remember-me sessions are restored from a signed cookie and
            # are not present in SESSIONS, so checking only SESSIONS would stop
            # their worker immediately. Keep each worker bounded by deadline.
            with GALLERY_SCAN_LOCK:
                _gallery_scan_step(u, owner, shares, skipped)
            state = gallery_index.state(owner, shares)
            if len(skipped)>=100:
                logger.info("Gallery EXIF batch paused after 100 access-denied files")
                break
            if state["complete"] and not state["dates_available"]:
                # Outstanding items under ACL cooldown are NOT actionable;
                # polling should stop until access or cooldown changes.
                logger.info("Gallery EXIF scan finished: %d inaccessible files on cooldown",
                            state["dates_blocked"])
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


@app.post("/api/gallery/retry-dates")
def retry_gallery_dates(request: Request, x_csrf_token: str = Header(default="")):
    check_origin(request)
    u = protected(request, x_csrf_token)
    admin_user(request)
    shares = list(u.get("shares", []))
    owner = gallery_index.key(u["name"])
    with GALLERY_BACKGROUND_LOCK:
        active = GALLERY_BACKGROUND.get(owner)
        if active is not None and active.is_alive():
            fail(409, "Дождитесь завершения текущей индексации")
        if not GALLERY_SCAN_LOCK.acquire(blocking=False):
            fail(409, "Индексация уже выполняется")
        try:
            with gallery_index.LOCK, gallery_index.connect() as db:
                queued = gallery_index.retry_missing_dates(db, owner, shares)
            worker = threading.Thread(target=_gallery_background,
                                      args=(dict(u), owner, tuple(shares)),
                                      daemon=True, name="nas-gallery-date-retry")
            GALLERY_BACKGROUND[owner] = worker
            worker.start()
        finally:
            GALLERY_SCAN_LOCK.release()
    return {"ok": True, "queued": queued, **gallery_index.state(owner, shares)}


@app.post("/api/admin/retry-dates")
def admin_retry_dates(request: Request, x_csrf_token: str=Header(default="")):
    check_origin(request)
    admin_protected(request,x_csrf_token)
    # The admin never gets SMB credentials. An explicitly logged-in SMB user
    # supplies their own access; only their existing photo index is affected.
    u=user_for(request)
    shares=list(u.get("shares",[]))
    owner=gallery_index.key(u["name"])
    with GALLERY_BACKGROUND_LOCK:
        active=GALLERY_BACKGROUND.get(owner)
        if active is not None and active.is_alive():
            fail(409,"Индексация уже выполняется")
        if not GALLERY_SCAN_LOCK.acquire(blocking=False):
            fail(409,"Индексация уже выполняется")
        try:
            with gallery_index.LOCK,gallery_index.connect() as db:
                queued=gallery_index.retry_missing_dates(db,owner,shares)
            worker=threading.Thread(target=_gallery_background,
                         args=(dict(u),owner,tuple(shares)),daemon=True,name="nas-admin-exif-retry")
            GALLERY_BACKGROUND[owner]=worker
            worker.start()
        finally:
            GALLERY_SCAN_LOCK.release()
    admin_log_event("info","EXIF metadata retry queued for authenticated SMB user")
    return {"ok":True,"queued":queued}


@app.post("/api/gallery/reindex")
def reindex_unified_gallery(request: Request, x_csrf_token: str = Header(default="")):
    # Legacy route intentionally disabled: never destroy a live photo index.
    fail(403, "Полная переиндексация отключена для защиты существующей фототеки")


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

def _trash_root_entry(conn, share):
    root = entry_in_folder(conn, share, "", ".recycle")
    if root is None or not root.isDirectory or getattr(root, "isReparsePoint", False):
        fail(409, "Корзина недоступна или не является папкой")
    return root


def _trash_ancestors(conn, share, path):
    current = ""
    for part in path.split("/")[:-1]:
        entry = entry_in_folder(conn, share, current, part)
        if entry is None or not entry.isDirectory:
            fail(404, "Папка корзины не найдена")
        if getattr(entry, "isReparsePoint", False):
            fail(409, "Нельзя выполнять операцию через папку-ссылку")
        current = (current + "/" if current else "") + part


@app.post("/api/trash/restore")
def restore_trashed_item(request: Request, payload: dict,
                        x_csrf_token: str = Header(default="")):
    """Restore a top-level trash item to its original SMB path."""
    from . import trash_store
    check_origin(request)
    u = protected(request, x_csrf_token)
    path = path_ok(payload.get("path", ""))
    if not path.startswith(".recycle/") or len(path.split("/")) != 2:
        fail(400, "Для восстановления выберите объект непосредственно в корзине")
    share = payload.get("share", "")
    trash_name = path.split("/", 1)[1]
    with trash_store.OP_LOCK, smb(u) as conn:
        check_share(conn, share)
        try:
            _trash_root_entry(conn, share)
            source = entry_in_folder(conn, share, ".recycle", trash_name)
            if source is None:
                fail(404, "Объект отсутствует в корзине")
            metadata = trash_store.item(share, trash_name)
            # Old items predate origin-path tracking. Restore them to the share
            # root rather than guessing or overwriting unrelated directories.
            destination = path_ok(metadata["original_path"]) if metadata and metadata["original_path"] else trash_name
            if not destination or destination.startswith(".recycle/") or destination == ".recycle":
                fail(409, "Некорректное исходное расположение")
            parent, _, name = destination.rpartition("/")
            if parent:
                # SMB rename does not create missing parent directories.
                try:
                    conn.listPath(share, full(parent))
                except Exception:
                    fail(409, "Исходная папка больше не существует. Создайте её перед восстановлением")
            if entry_in_folder(conn, share, parent, name) is not None:
                fail(409, "В исходной папке уже есть файл или папка с таким именем")
            conn.rename(share, "/" + path, "/" + destination)
            trash_store.forget(share, trash_name)
        except HTTPException:
            raise
        except Exception as exc:
            smb_action_error("restore from recycle", exc)
    return {"ok": True, "restored_to": destination}


@app.post("/api/trash/permanent-delete")
def permanently_delete_trashed_item(request: Request, payload: dict,
                                   x_csrf_token: str = Header(default="")):
    """Delete one selected item inside SMB trash, including its contents."""
    from . import trash_delete, trash_store
    check_origin(request)
    u = protected(request, x_csrf_token)
    path = path_ok(payload.get("path", ""))
    if not trash_delete.within_recycle(path):
        fail(403, "Безвозвратное удаление разрешено только внутри корзины")
    directory = payload.get("directory")
    if not isinstance(directory, bool):
        fail(400, "Некорректный тип объекта")
    basename = path.rsplit("/", 1)[-1]
    with trash_store.OP_LOCK, smb(u) as conn:
        share = payload.get("share", "")
        check_share(conn, share)
        parent = path.rpartition("/")[0]
        try:
            _trash_ancestors(conn, share, path)
            entry = entry_in_folder(conn, share, parent, basename)
            if entry is None:
                fail(404, "Объект отсутствует в корзине")
            if bool(entry.isDirectory) != directory:
                fail(409, "Тип объекта изменился. Обновите папку")
            if getattr(entry, "isReparsePoint", False):
                fail(409, "Удаление папок-ссылок не поддерживается")
            count = trash_delete.permanent_delete(conn, share, path, directory)
            if parent == ".recycle":
                trash_store.forget(share, basename)
        except trash_delete.TrashDeletionError as exc:
            fail(409, str(exc))
        except HTTPException:
            raise
        except Exception as exc:
            smb_action_error("permanent trash delete (may be partial)", exc)
    return {"ok": True, "permanent": True, "deleted_entries": count}


@app.post("/api/delete")
def delete(request: Request, payload: dict, x_csrf_token: str = Header(default="")):
    check_origin(request)
    path = path_ok(payload.get("path", ""))
    if not path:
        fail(400, "Выберите файл")
    from . import trash_store
    u = protected(request, x_csrf_token)
    with trash_store.OP_LOCK, smb(u) as conn:
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
            try:
                trash_store.record_move(u, share, trash_name, path,
                                        bool(source_entry.isDirectory))
            except Exception:
                # The SMB rename has succeeded. The item remains recoverable
                # and can be registered as a legacy item on the next listing.
                logger.exception("Unable to record recycle metadata after SMB rename")
        except HTTPException:
            raise
        except Exception as exc:
            smb_action_error("move to recycle", exc)
    return {"ok": True, "recycled": True}
