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
JPEG_HEADER_LIMIT = 512 * 1024


def _db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=10)
    con.execute("CREATE TABLE IF NOT EXISTS dates (key TEXT PRIMARY KEY, taken REAL, checked INTEGER NOT NULL DEFAULT 1)")
    return con


def _key(user, share, path, modified, size):
    raw = "\0".join((user.casefold(), share, path, str(modified), str(size)))
    return hashlib.sha256(raw.encode()).hexdigest()


def lookup(user, share, path, modified, size):
    with LOCK, _db() as db:
        record = db.execute("SELECT taken FROM dates WHERE key=?", (_key(user, share, path, modified, size),)).fetchone()
    return (True, record[0]) if record is not None else (False, None)


def save(user, share, path, modified, size, taken):
    with LOCK, _db() as db:
        db.execute("INSERT OR REPLACE INTO dates (key,taken) VALUES (?,?)",
                   (_key(user, share, path, modified, size), taken))


def parse_exif(buffer):
    try:
        with Image.open(buffer) as image:
            data = image.getexif()
            # DateTimeOriginal (36867), DateTimeDigitized, DateTime
            nested = data.get_ifd(34665) if 34665 in data else {}
            for tag in (36867, 36868, 306):
                value = nested.get(tag) or data.get(tag)
                if not isinstance(value, str):
                    continue
                text = value.strip()[:19]
                if not re.fullmatch(r"\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}", text):
                    continue
                taken = datetime.strptime(text, "%Y:%m:%d %H:%M:%S")
                if 1970 <= taken.year <= 2100:
                    # EXIF has no timezone: use local calendar fields, not UTC conversion.
                    return text.replace(":", "-", 2).replace(" ", "T")
    except (OSError, ValueError, TypeError, SyntaxError):
        return None
    return None


def from_jpeg_header(conn, share, path):
    # Read up to 512 KiB, enough for ordinary EXIF blocks without downloading JPEG.
    chunks = []
    for block in conn.iter_range(share, "/" + path, 0, JPEG_HEADER_LIMIT):
        chunks.append(block)
    return parse_exif(io.BytesIO(b"".join(chunks)))
