"""Shared user-scoped thumbnail cache.

Cached files are scoped to a SMB username, share and version. Every cache
read still requires an authenticated session and SMB file-read permission.
"""
import hashlib
import io
import os
import threading
import time
from pathlib import Path
from PIL import Image, ImageOps

CACHE_ROOT = Path("/data/nasweb-thumbs")
CACHE_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
MAX_BYTES = 384 * 1024 * 1024
TTL = 14 * 24 * 3600
WORKERS = threading.BoundedSemaphore(2)
FILES_LOCK = threading.RLock()
OPS = 0

def key_for(username, share, path, version):
    text = "\0".join((username.casefold(), share, path, version))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def get(key):
    filename = CACHE_ROOT / (key + ".webp")
    try:
        st = filename.stat()
        if time.time() - st.st_mtime > TTL:
            filename.unlink(missing_ok=True)
            return None
        os.utime(filename, None)
        return filename.read_bytes()
    except OSError:
        return None

def _prune():
    global OPS
    OPS += 1
    if OPS % 25 != 0:
        return
    files = []
    total = 0
    for p in CACHE_ROOT.glob("*.webp"):
        try:
            st = p.stat()
            if time.time() - st.st_mtime > TTL:
                p.unlink(missing_ok=True)
                continue
            files.append((st.st_mtime, st.st_size, p))
            total += st.st_size
        except OSError:
            pass
    for _, size, p in sorted(files):
        if total <= MAX_BYTES:
            break
        try:
            p.unlink(missing_ok=True)
            total -= size
        except OSError:
            pass

def put(key, content):
    with FILES_LOCK:
        path = CACHE_ROOT / (key + ".webp")
        temp = CACHE_ROOT / (key + "." + str(threading.get_ident()) + ".tmp")
        try:
            with open(temp, "wb") as f:
                os.chmod(temp, 0o600)
                f.write(content)
            os.replace(temp, path)
            _prune()
        finally:
            temp.unlink(missing_ok=True)

def render_image(source, large=False):
    # The bounding upload buffer is enforced by the caller.
    source.seek(0)
    with Image.open(source) as img:
        if img.width * img.height > 30_000_000:
            raise ValueError("Image dimensions too large")
        if img.format == "JPEG":
            img.draft("RGB", (1600, 1200) if large else (480, 360))
        img = ImageOps.exif_transpose(img)
        img.thumbnail((1600, 1200) if large else (256, 192), Image.Resampling.BILINEAR)
        out = io.BytesIO()
        img.convert("RGB").save(out, format="WEBP", quality=78 if large else 68, method=0)
        return out.getvalue()
