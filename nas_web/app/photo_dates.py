"""Small persistent EXIF date index. JPEG metadata is read from file headers only."""
import hashlib
import io
import re
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from PIL import Image

DB = Path("/data/nasweb-auth/photo-dates.sqlite3")
LOCK = threading.RLock()
JPEG_HEADER_LIMIT = 128 * 1024


def _db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=10)
    con.execute("CREATE TABLE IF NOT EXISTS dates (key TEXT PRIMARY KEY, taken REAL, checked INTEGER NOT NULL DEFAULT 1)")
    return con


def _key(user, share, path, modified, size):
    raw = "\0".join((share, path, str(modified), str(size)))
    return hashlib.sha256(raw.encode()).hexdigest()


def lookup(user, share, path, modified, size):
    with LOCK, _db() as db:
        record = db.execute("SELECT taken FROM dates WHERE key=?", (_key(user, share, path, modified, size),)).fetchone()
    return (True, record[0]) if record is not None else (False, None)


def save(user, share, path, modified, size, taken):
    with LOCK, _db() as db:
        db.execute("INSERT OR REPLACE INTO dates (key,taken) VALUES (?,?)",
                   (_key(user, share, path, modified, size), taken))


# Bounded SMB header reads; never download entire photo for metadata.
HEADER_LIMIT = 1024 * 1024
DATE_TAGS = (36867, 36868, 306)

def _normalize_date(value):
    if isinstance(value, bytes):
        value = value.decode("utf-8", "ignore")
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})", value)
    if not match:
        return None
    try:
        dt = datetime(*(int(x) for x in match.groups()))
    except ValueError:
        return None
    if 1970 <= dt.year <= 2100:
        return dt.strftime("%Y-%m-%dT%H:%M:%S")
    return None

def parse_exif(buffer):
    try:
        with Image.open(buffer) as image:
            data = image.getexif()
            nested = data.get_ifd(34665) if 34665 in data else {}
            for tag in DATE_TAGS:
                value = nested.get(tag) or data.get(tag)
                date = _normalize_date(value)
                if date:
                    return date
            # PNG eXIf / tEXt, WebP EXIF and image metadata fallbacks.
            for name in ("DateTimeOriginal", "DateTimeDigitized", "DateTime",
                         "date:create", "Creation Time", "creation_time", "date:modify"):
                date = _normalize_date(image.info.get(name))
                if date:
                    return date
            exif_bytes = image.info.get("exif")
            if exif_bytes:
                try:
                    from PIL import Image as PILImage
                    exif = PILImage.Exif()
                    exif.load(exif_bytes)
                    nested = exif.get_ifd(34665) if 34665 in exif else {}
                    for tag in DATE_TAGS:
                        date = _normalize_date(nested.get(tag) or exif.get(tag))
                        if date:
                            return date
                except (OSError, ValueError, TypeError, SyntaxError, KeyError):
                    pass
    except (OSError, ValueError, TypeError, SyntaxError, KeyError):
        return None
    return None

def from_jpeg_header(conn, share, path, file_size):
    # Legacy function name retained for existing callers.
    chunks = []
    for block in conn.iter_range(share, "/" + path, 0, min(int(file_size), HEADER_LIMIT)):
        chunks.append(block)
    return parse_exif(io.BytesIO(b"".join(chunks)))
