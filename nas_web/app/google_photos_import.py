"""Google Photos import for NAS Web.

Takeout archives are streamed from the browser and read entry-by-entry. Picker
uses user-consented OAuth and a selected-media session; the API cannot enumerate
an entire Google library. All SMB writes use the authenticated NAS user's ACL.
No Google tokens, SMB passwords or media are stored in the web frontend.
"""
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet
from . import gallery_index

DB = Path("/data/nasweb-auth/google-import.sqlite3")
KEY = Path("/data/nasweb-auth/google-import.key")
ARCHIVES = Path("/data/nasweb-import")
OAUTH_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"
API = "https://photospicker.googleapis.com/v1"
PHOTO_EXTS = frozenset((".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif",
                         ".tif", ".tiff", ".bmp", ".avif"))
VIDEO_EXTS = frozenset((".mp4", ".mov", ".m4v", ".webm", ".avi", ".3gp", ".mkv"))
MAX_ENTRIES = 50000
MAX_JSON = 1024 * 1024
MAX_MEDIA = 4 * 1024 * 1024 * 1024
MAX_UNCOMPRESSED = 40 * 1024 * 1024 * 1024
GUARD = threading.RLock()
ACTIVE = set()
ACCESS_CACHE = {}


def owner_of(user):
    return gallery_index.key(user)


@contextmanager
def connect():
    DB.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=25)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=25000")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS google_tokens (
        owner TEXT PRIMARY KEY, refresh_token BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS picker_sessions (
        owner TEXT PRIMARY KEY, session_id TEXT NOT NULL, picker_uri TEXT NOT NULL,
        created REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL,
        share TEXT NOT NULL, folder TEXT NOT NULL, status TEXT NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '',
        updated REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS import_jobs_owner ON import_jobs(owner,updated DESC);
      CREATE TABLE IF NOT EXISTS imported_media (
        owner TEXT NOT NULL, share TEXT NOT NULL, folder TEXT NOT NULL,
        sha256 TEXT NOT NULL, filename TEXT NOT NULL,
        source_id TEXT NOT NULL DEFAULT '', created REAL NOT NULL,
        PRIMARY KEY(owner,share,folder,sha256)
      );
      CREATE INDEX IF NOT EXISTS imported_media_source ON imported_media(owner,share,folder,source_id);
    """)
    try:
        yield db
    finally:
        db.close()


def cipher():
    KEY.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with GUARD:
        if not KEY.exists():
            fd = os.open(KEY, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.write(fd, Fernet.generate_key())
            finally:
                os.close(fd)
        return Fernet(KEY.read_bytes())


def configured(opts):
    return bool(str(opts.get("google_client_id", "")).strip() and
                str(opts.get("google_client_secret", "")).strip() and
                redirect_uri(opts))


def redirect_uri(opts):
    url = str(opts.get("google_redirect_uri", "")).strip()
    parsed = urllib.parse.urlsplit(url)
    if not parsed.netloc or parsed.username or parsed.password or parsed.fragment or parsed.query:
        return ""
    if parsed.path != "/api/import/google/oauth/callback":
        return ""
    if parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        return url
    return ""


def _state_hash(state):
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def oauth_url(username, opts):
    if not configured(opts):
        raise ValueError("Настройте google_client_id, google_client_secret и HTTPS google_redirect_uri в аддоне")
    state = secrets.token_urlsafe(36)
    with connect() as db, db:
        db.execute("DELETE FROM oauth_states WHERE expires<?", (time.time(),))
        db.execute("INSERT INTO oauth_states VALUES (?,?,?)",
                   (_state_hash(state), owner_of(username), time.time() + 600))
    q = urllib.parse.urlencode({
        "client_id": opts["google_client_id"],
        "redirect_uri": redirect_uri(opts),
        "response_type": "code",
        "scope": OAUTH_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    return "https://accounts.google.com/o/oauth2/v2/auth?" + q


def _http_json(url, token=None, data=None, form=False):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = None
    if data is not None:
        body = (urllib.parse.urlencode(data).encode("utf-8") if form else
                json.dumps(data).encode("utf-8"))
        headers["Content-Type"] = ("application/x-www-form-urlencoded" if form else
                                   "application/json")
    request = urllib.request.Request(url, data=body, headers=headers,
                                     method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as reply:
            return json.loads(reply.read(1024 * 1024))
    except urllib.error.HTTPError as exc:
        raise ValueError("Google API: HTTP " + str(exc.code)) from None


def finish_oauth(state, code, opts):
    if not configured(opts) or not state or not code or len(state) > 200 or len(code) > 4096:
        raise ValueError("Недопустимый ответ Google OAuth")
    with connect() as db, db:
        row = db.execute("SELECT owner,expires FROM oauth_states WHERE state_hash=?",
                         (_state_hash(state),)).fetchone()
        db.execute("DELETE FROM oauth_states WHERE state_hash=?", (_state_hash(state),))
    if not row or row["expires"] < time.time():
        raise ValueError("Срок подключения истёк. Повторите авторизацию из профиля")
    token = _http_json("https://oauth2.googleapis.com/token", data={
        "code": code, "client_id": opts["google_client_id"],
        "client_secret": opts["google_client_secret"],
        "redirect_uri": redirect_uri(opts), "grant_type": "authorization_code",
    }, form=True)
    refresh = token.get("refresh_token")
    if refresh:
        with connect() as db, db:
            db.execute("INSERT OR REPLACE INTO google_tokens VALUES (?,?)",
                       (row["owner"], cipher().encrypt(refresh.encode("utf-8"))))
    elif not is_connected(row["owner"]):
        raise ValueError("Google не выдал refresh token. Повторите согласие на доступ")
    return row["owner"]


def is_connected(owner):
    with connect() as db:
        return db.execute("SELECT 1 FROM google_tokens WHERE owner=?", (owner,)).fetchone() is not None


def disconnect(username):
    owner = owner_of(username)
    with connect() as db, db:
        db.execute("DELETE FROM google_tokens WHERE owner=?", (owner,))
        db.execute("DELETE FROM picker_sessions WHERE owner=?", (owner,))
    with GUARD:
        ACCESS_CACHE.pop(owner, None)


def access_token(username, opts):
    owner = owner_of(username)
    with GUARD:
        token = ACCESS_CACHE.get(owner)
        if token and token[1] > time.time() + 60:
            return token[0]
    with connect() as db:
        row = db.execute("SELECT refresh_token FROM google_tokens WHERE owner=?", (owner,)).fetchone()
    if row is None:
        raise ValueError("Сначала подключите Google Фото в профиле")
    refresh = cipher().decrypt(row["refresh_token"]).decode("utf-8")
    response = _http_json("https://oauth2.googleapis.com/token", data={
        "client_id": opts["google_client_id"],
        "client_secret": opts["google_client_secret"],
        "refresh_token": refresh, "grant_type": "refresh_token",
    }, form=True)
    result = response.get("access_token")
    if not result:
        raise ValueError("Не удалось обновить доступ Google Фото")
    with GUARD:
        ACCESS_CACHE[owner] = (result, time.time() + min(int(response.get("expires_in", 3600)), 3600))
    return result


def _google_json(url, token, data=None, method="GET"):
    if method == "DELETE":
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token},
                                         method="DELETE")
        with urllib.request.urlopen(request, timeout=30):
            return {}
    return _http_json(url, token=token, data=data)


def create_picker(username, opts):
    token = access_token(username, opts)
    old = picker_session(username)
    if old:
        try:
            _google_json(API + "/sessions/" + urllib.parse.quote(old["session_id"], safe=""),
                         token, method="DELETE")
        except Exception:
            pass
    record = _google_json(API + "/sessions", token, data={})
    session_id, uri = record.get("id", ""), record.get("pickerUri", "")
    parsed = urllib.parse.urlsplit(uri)
    if not session_id or not uri.startswith("https://") or not parsed.hostname:
        raise ValueError("Google не вернул ссылку на выбор фотографий")
    with connect() as db, db:
        db.execute("INSERT OR REPLACE INTO picker_sessions VALUES (?,?,?,?)",
                   (owner_of(username), session_id, uri, time.time()))
    return {"picker_uri": uri, "ready": False}


def picker_session(username):
    with connect() as db:
        row = db.execute("SELECT session_id,picker_uri,created FROM picker_sessions WHERE owner=?",
                         (owner_of(username),)).fetchone()
    if not row or row["created"] < time.time() - 3600:
        return None
    return dict(row)


def picker_status(username, opts):
    session = picker_session(username)
    if session is None:
        return {"active": False, "ready": False}
    status = _google_json(API + "/sessions/" +
                          urllib.parse.quote(session["session_id"], safe=""),
                          access_token(username, opts))
    return {"active": True, "ready": bool(status.get("mediaItemsSet")),
            "picker_uri": session["picker_uri"],
            "poll_interval": status.get("pollingConfig", {}).get("pollInterval", "5s")}


def picked_items(username, opts):
    session = picker_session(username)
    if not session:
        raise ValueError("Сначала выберите фотографии в Google Photos Picker")
    token = access_token(username, opts)
    data = _google_json(API + "/sessions/" +
                        urllib.parse.quote(session["session_id"], safe=""), token)
    if not data.get("mediaItemsSet"):
        raise ValueError("Выбор фотографий в Google ещё не завершён")
    items, page = [], ""
    for _ in range(200):
        query = {"sessionId": session["session_id"], "pageSize": 100}
        if page:
            query["pageToken"] = page
        result = _google_json(API + "/mediaItems?" + urllib.parse.urlencode(query), token)
        batch = result.get("mediaItems", [])
        if not isinstance(batch, list):
            raise ValueError("Некорректный ответ Google Фото")
        items.extend(batch)
        if len(items) > 20000:
            raise ValueError("Слишком много выбранных файлов (лимит 20000)")
        page = result.get("nextPageToken", "")
        if not page:
            return items
    raise ValueError("Слишком много страниц Google Фото")


def safe_filename(value):
    name = str(value or "").replace("\\", "/").split("/")[-1].strip()
    if (not name or name in (".", "..") or len(name) > 220 or
            any(c in name for c in '\\/:*?"<>|\x00') or
            any(ord(c) < 32 for c in name)):
        raise ValueError("Недопустимое имя импортируемого файла")
    return name


def is_media(name):
    return Path(name).suffix.casefold() in PHOTO_EXTS | VIDEO_EXTS


def taken_from_json(raw):
    """Parse Takeout's photoTakenTime timestamp as a stable UTC chronology."""
    try:
        data = json.loads(raw)
        seconds = int(data["photoTakenTime"]["timestamp"])
        if not 315532800 <= seconds <= 4102444800:
            return None
        return datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    except (KeyError, ValueError, OverflowError, TypeError):
        return None


def taken_from_picker(value):
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    except (ValueError, TypeError):
        return None


def sidecar_candidates(entry):
    """Google Takeout uses multiple sidecar suffixes and truncation schemes."""
    name = entry.filename
    suffixes = (".supplemental-metadata.json", ".supplemental-m.json", ".json")
    candidates = [name + suffix for suffix in suffixes]
    # Newer Takeout truncates long filenames to 46-51 characters before suffix.
    for limit in (46, 47, 48, 49, 50, 51):
        for suffix in suffixes[:2]:
            candidates.append(name[:limit] + suffix)
    return candidates


class HashReader:
    def __init__(self, stream, max_bytes=MAX_MEDIA):
        self.stream = stream
        self.maximum = max_bytes
        self.count = 0
        self.sha = hashlib.sha256()

    def read(self, size=-1):
        # Avoid unbounded reads from a remote server / malformed zip.
        amount = 1024 * 1024 if size < 0 else min(size, 1024 * 1024)
        chunk = self.stream.read(min(amount, self.maximum - self.count + 1))
        if len(chunk) + self.count > self.maximum:
            raise ValueError("Файл превышает лимит 4 ГБ")
        self.count += len(chunk)
        self.sha.update(chunk)
        return chunk

    @property
    def digest(self):
        return self.sha.hexdigest()


def _known(owner, share, folder, digest, existing):
    with connect() as db:
        row = db.execute(
            "SELECT filename FROM imported_media WHERE owner=? AND share=? AND folder=? AND sha256=?",
            (owner, share, folder, digest)).fetchone()
    return row is not None and row["filename"] in existing


def _source_known(owner, share, folder, source_id, existing):
    if not source_id:
        return False
    with connect() as db:
        row = db.execute(
            "SELECT filename FROM imported_media WHERE owner=? AND share=? AND folder=? AND source_id=?",
            (owner, share, folder, source_id)).fetchone()
    return row is not None and row["filename"] in existing


def _unique_name(name, existing):
    if name not in existing:
        return name
    stem, ext = os.path.splitext(name)
    for i in range(1, 10001):
        suffix = " (" + str(i) + ")"
        candidate = stem[:220 - len(ext) - len(suffix)] + suffix + ext
        if candidate not in existing:
            return candidate
    raise ValueError("Слишком много файлов с совпадающими именами")


def _register(owner, share, folder, digest, final_name, source_id):
    with connect() as db, db:
        db.execute(
            "INSERT OR REPLACE INTO imported_media(owner,share,folder,sha256,filename,source_id,created) "
            "VALUES (?,?,?,?,?,?,?)",
            (owner, share, folder, digest, final_name, source_id, time.time()))


def _record_index(username, share, folder, name, conn, taken):
    if Path(name).suffix.lower() not in gallery_index.IMAGE_EXTS:
        return
    matches = conn.listPath(share, "/" + folder, timeout=30)
    entry = next((e for e in matches if e.filename == name and not e.isDirectory), None)
    if entry is None:
        return
    path = "/".join((folder, name))
    owner = owner_of(username)
    gallery_index.record_upload(owner, share, path, entry.file_size, entry.last_write_time)
    if taken:
        with gallery_index.LOCK, gallery_index.connect() as db:
            gallery_index.save_date(db, owner, share, path, taken)


def upload_media(conn, username, share, folder, original_name, stream, existing,
                 taken=None, source_id="", limit=MAX_MEDIA):
    """SMB write to a random temporary filename; never overwrite real user files.

    Returns 'imported' or 'skipped'. Avoid storing media in a second local copy.
    """
    name = safe_filename(original_name)
    if not is_media(name):
        return "skipped"
    owner = owner_of(username)
    if _source_known(owner, share, folder, source_id, existing):
        return "skipped"
    temp_name = ".nasweb-import-" + secrets.token_hex(12) + ".tmp"
    destination = "/" + "/".join((folder, temp_name))
    reader = HashReader(stream, min(MAX_MEDIA, int(limit)))
    try:
        conn.storeFile(share, destination, reader, timeout=900)
        digest = reader.digest
        if _known(owner, share, folder, digest, existing):
            conn.deleteFiles(share, destination)
            return "skipped"
        final_name = _unique_name(name, existing)
        conn.rename(share, destination, "/" + "/".join((folder, final_name)))
        existing.add(final_name)
    except Exception:
        try:
            conn.deleteFiles(share, destination)
        except Exception:
            pass
        raise
    _register(owner, share, folder, digest, final_name, source_id)
    try:
        _record_index(username, share, folder, final_name, conn, taken)
    except Exception:
        # Scanning can recover metadata later. Do not delete a successfully
        # imported original because an index refresh failed.
        pass
    return "imported"


def new_job(username, source, share, folder):
    identifier = secrets.token_urlsafe(18)
    with connect() as db, db:
        db.execute(
            "INSERT INTO import_jobs(id,owner,source,share,folder,status,updated) "
            "VALUES (?,?,?,?,?,'queued',?)",
            (identifier, owner_of(username), source, share, folder, time.time()))
    return identifier


def job_update(identifier, **values):
    allowed = ("status", "processed", "imported", "skipped", "failed", "total", "detail")
    fields = [key for key in allowed if key in values]
    if not fields:
        return
    with connect() as db, db:
        db.execute("UPDATE import_jobs SET " + ", ".join(key + "=?" for key in fields) +
                   ", updated=? WHERE id=?",
                   (*[values[key] for key in fields], time.time(), identifier))


def jobs(username):
    # Expired running status is not assumed successful after an addon restart.
    owner = owner_of(username)
    with connect() as db:
        rows = db.execute(
            "SELECT id,source,share,folder,status,processed,imported,skipped,failed,total,detail,updated "
            "FROM import_jobs WHERE owner=? ORDER BY updated DESC LIMIT 8", (owner,)).fetchall()
    return [dict(x) for x in rows]


def reserve(username):
    with GUARD:
        owner = owner_of(username)
        if owner in ACTIVE:
            raise ValueError("Импорт уже выполняется для этого пользователя")
        ACTIVE.add(owner)
        return owner


def release(owner):
    with GUARD:
        ACTIVE.discard(owner)


def process_takeout(zip_path, conn, username, share, folder, job):
    """Import a single Takeout ZIP; repeat for each archive part."""
    processed = imported = skipped = failed = 0
    existing = {e.filename for e in conn.listPath(share, "/" + folder, timeout=30)}
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) > MAX_ENTRIES:
            raise ValueError("В архиве слишком много файлов")
        total_size = sum(x.file_size for x in members)
        if total_size > MAX_UNCOMPRESSED:
            raise ValueError("Распакованный архив превышает лимит 40 ГБ")
        sidecars = {x.filename: x for x in members if x.filename.lower().endswith(".json")
                    and 0 < x.file_size <= MAX_JSON}
        media = [x for x in members if not x.is_dir() and is_media(x.filename) and
                 not x.filename.startswith("/") and ".." not in x.filename.replace("\\", "/").split("/")]
        job_update(job, status="running", total=len(media))
        for entry in media:
            try:
                if entry.file_size > MAX_MEDIA:
                    raise ValueError("Файл превышает лимит 4 ГБ")
                base = entry.filename.rpartition("/")[2]
                taken = None
                for candidate in sidecar_candidates(entry):
                    entry_json = sidecars.get(candidate)
                    if entry_json:
                        with archive.open(entry_json) as handle:
                            taken = taken_from_json(handle.read(MAX_JSON + 1))
                        if taken:
                            break
                with archive.open(entry) as stream:
                    result = upload_media(conn, username, share, folder, base, stream,
                                          existing, taken=taken, limit=entry.file_size + 1)
                imported += (result == "imported")
                skipped += (result == "skipped")
            except Exception:
                failed += 1
            processed += 1
            job_update(job, processed=processed, imported=imported, skipped=skipped, failed=failed)
    return {"imported": imported, "skipped": skipped, "failed": failed}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Недопустимая переадресация загрузки Google Фото")


def media_url(base, is_video):
    parsed = urllib.parse.urlsplit(str(base))
    host = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or parsed.port not in (None, 443) or
            parsed.username or parsed.password or
            not (host.endswith(".googleusercontent.com") or host.endswith(".ggpht.com"))):
        raise ValueError("Небезопасная ссылка на файл Google Фото")
    if parsed.query or parsed.fragment:
        raise ValueError("Неожиданные параметры ссылки Google Фото")
    return base + ("=dv" if is_video else "=d")


def process_picked(items, conn, username, opts, share, folder, job):
    token = access_token(username, opts)
    existing = {e.filename for e in conn.listPath(share, "/" + folder, timeout=30)}
    processed = imported = skipped = failed = 0
    job_update(job, status="running", total=len(items))
    opener = urllib.request.build_opener(NoRedirect())
    for item in items:
        try:
            mf = item.get("mediaFile", {})
            name = safe_filename(mf.get("filename"))
            kind = str(item.get("type", "PHOTO"))
            if not is_media(name):
                skipped += 1
            elif _source_known(owner_of(username), share, folder, "picker:" + str(item.get("id", "")), existing):
                skipped += 1
            else:
                url = media_url(mf["baseUrl"], kind == "VIDEO")
                req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
                with opener.open(req, timeout=90) as reply:
                    if int(reply.headers.get("Content-Length", "0")) > MAX_MEDIA:
                        raise ValueError("Слишком большой медиафайл")
                    result = upload_media(conn, username, share, folder, name, reply,
                                          existing, taken=taken_from_picker(item.get("createTime")),
                                          source_id="picker:" + str(item.get("id", "")))
                    imported += (result == "imported")
                    skipped += (result == "skipped")
        except Exception:
            failed += 1
        processed += 1
        job_update(job, processed=processed, imported=imported, skipped=skipped, failed=failed)
    return {"imported": imported, "skipped": skipped, "failed": failed}


def delete_picker(username, opts):
    session = picker_session(username)
    if not session:
        return
    try:
        _google_json(API + "/sessions/" + urllib.parse.quote(session["session_id"], safe=""),
                     access_token(username, opts), method="DELETE")
    finally:
        with connect() as db, db:
            db.execute("DELETE FROM picker_sessions WHERE owner=?", (owner_of(username),))
