"""Bounded, on-demand MOV-to-MP4 browser compatibility conversion."""
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path("/data/nasweb-video")
try:
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not os.access(ROOT, os.W_OK):
        raise OSError("cache is not writable")
except OSError:
    ROOT = Path("/tmp/nasweb-video")
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
MAX_SOURCE = 300 * 1024 * 1024
MAX_CACHE = 512 * 1024 * 1024
TTL = 2 * 24 * 3600
CONVERT_LOCK = threading.Lock()

class ConversionError(Exception):
    pass

def key(username, share, path, version):
    raw = "\0".join((username.casefold(), share, path, version))
    return hashlib.sha256(raw.encode()).hexdigest()

def target(keyname):
    return ROOT / (keyname + ".mp4")

def existing(keyname):
    path = target(keyname)
    try:
        if path.is_file() and path.stat().st_size > 0 and time.time() - path.stat().st_mtime < TTL:
            return path
    except OSError:
        pass
    return None

def cleanup():
    files = []
    size = 0
    for f in ROOT.glob("*.mp4"):
        try:
            st = f.stat()
            if time.time() - st.st_mtime > TTL:
                f.unlink(missing_ok=True)
            else:
                files.append((st.st_mtime, st.st_size, f))
                size += st.st_size
        except OSError:
            continue
    for _, length, f in sorted(files):
        if size <= MAX_CACHE:
            break
        try:
            f.unlink(missing_ok=True)
            size -= length
        except OSError:
            pass

def convert(source, dest):
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_type",
             "-of", "json", str(source)], capture_output=True, timeout=20, check=True)
        streams = json.loads(probe.stdout).get("streams", [])
        v = next((x for x in streams if x.get("codec_type") == "video"), None)
        audio = [x for x in streams if x.get("codec_type") == "audio"]
        if not v:
            raise ConversionError("В файле отсутствует видеодорожка")
        fast = v.get("codec_name") == "h264" and all(x.get("codec_name") == "aac" for x in audio)
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
               "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?"]
        if fast:
            cmd += ["-c", "copy"]
        else:
            cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2", "-pix_fmt", "yuv420p",
                    "-threads", "2", "-c:a", "aac", "-b:a", "128k"]
        cmd += ["-movflags", "+faststart", str(dest)]
        subprocess.run(cmd, capture_output=True, timeout=300, check=True)
        if not dest.is_file() or dest.stat().st_size <= 0:
            raise ConversionError("FFmpeg не создал MP4")
    except subprocess.TimeoutExpired as e:
        raise ConversionError("Преобразование занимает слишком много времени") from e
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError) as e:
        raise ConversionError("Неподдерживаемый видеоформат или ошибка FFmpeg") from e

def prepare(keyname, size, fetch):
    if size > MAX_SOURCE:
        raise ConversionError("Видео больше 300 МБ: преобразование на Raspberry Pi ограничено")
    ready = existing(keyname)
    if ready:
        return ready
    # One CPU-heavy transcode at a time. Never hold the SMB connection during encoding.
    with CONVERT_LOCK:
        ready = existing(keyname)
        if ready:
            return ready
        free = shutil.disk_usage(ROOT).free
        if free < max(750 * 1024 * 1024, size * 3):
            raise ConversionError("Недостаточно свободного места для преобразования видео")
        with tempfile.TemporaryDirectory(prefix="transcode-", dir=ROOT) as tmp:
            source = Path(tmp) / "source.mov"
            out = Path(tmp) / "converted.mp4"
            fetch(source)
            convert(source, out)
            os.replace(out, target(keyname))
        cleanup()
        return target(keyname)
