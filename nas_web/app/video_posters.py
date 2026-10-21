"""Small, bounded first-frame extraction for videos already on SMB.

Never downloads the whole video. Accepts at most 8 MiB of source bytes, never
transcodes the source, and runs a single short ffmpeg process at a time.
Unsupported/non-faststart files simply keep the default video icon.
"""
import io
import subprocess
import threading
import time
from . import thumb_cache

MAX_PREFIX = 8 * 1024 * 1024
MIN_SOURCE = 128
MAX_SECONDS = 12
WORKERS = threading.BoundedSemaphore(1)
BAD = {}
BAD_LOCK = threading.Lock()
BAD_TTL = 3600


class PosterUnavailable(Exception):
    pass


def is_supported(path):
    return path.lower().endswith((".mp4", ".webm", ".m4v", ".mov"))


def blocked(key):
    with BAD_LOCK:
        now = time.monotonic()
        if len(BAD) > 1500:
            for item, expiry in list(BAD.items()):
                if expiry <= now:
                    BAD.pop(item, None)
            if len(BAD) > 1500:
                BAD.clear()
        return BAD.get(key, 0) > now


def mark_unavailable(key):
    with BAD_LOCK:
        BAD[key] = time.monotonic() + BAD_TTL


def extract_prefix(source):
    """Decode a single reduced frame from a bounded in-memory prefix."""
    if not MIN_SOURCE <= len(source) <= MAX_PREFIX:
        raise PosterUnavailable("Invalid video prefix")
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-threads", "1", "-probesize", "3000000", "-analyzeduration", "2000000",
        "-i", "pipe:0", "-map", "0:v:0", "-frames:v", "1",
        "-vf", "scale=320:240:force_original_aspect_ratio=decrease",
        "-f", "image2pipe", "-vcodec", "png", "pipe:1"
    ]
    try:
        proc = subprocess.run(command, input=source, capture_output=True,
                              timeout=MAX_SECONDS, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PosterUnavailable("ffmpeg failed or timed out") from exc
    if proc.returncode != 0 or not 64 < len(proc.stdout) <= 1024 * 1024:
        raise PosterUnavailable("Video metadata or first frame unavailable")
    try:
        return thumb_cache.render_image(io.BytesIO(proc.stdout))
    except (ValueError, OSError, TypeError) as exc:
        raise PosterUnavailable("Frame encoding failed") from exc


def read_prefix(conn, share, path, total):
    """Read only prefix bytes using the authenticated, read-only SMB handle."""
    length = min(int(total), MAX_PREFIX)
    if length < MIN_SOURCE:
        raise PosterUnavailable("Video too small")
    result = bytearray()
    for part in conn.iter_range(share, "/" + path, 0, length):
        if len(result) + len(part) > MAX_PREFIX:
            raise PosterUnavailable("SMB exceeded bounded read")
        result.extend(part)
    return bytes(result)
