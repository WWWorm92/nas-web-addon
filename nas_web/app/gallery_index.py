"""Persistent, bounded, per-user SMB photo index for the unified gallery."""
import hashlib
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB = Path("/data/nasweb-auth/gallery.sqlite3")
LOCK = threading.RLock()
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif")
MAX_PHOTOS = 100000
MAX_FOLDERS = 20000


def key(username):
    return hashlib.sha256(username.casefold().encode("utf-8")).hexdigest()


@contextmanager
def connect():
    DB.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=20000")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS photos (
        owner TEXT NOT NULL, share TEXT NOT NULL, path TEXT NOT NULL,
        folder TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL,
        modified REAL NOT NULL, taken TEXT, exif_checked INTEGER NOT NULL DEFAULT 0,
        sort_key TEXT NOT NULL,
        PRIMARY KEY (owner, share, path)
      );
      CREATE TABLE IF NOT EXISTS shared_metadata (
        share TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL,
        modified REAL NOT NULL, taken TEXT, exif_checked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (share,path,size,modified)
      );
      CREATE INDEX IF NOT EXISTS photo_order ON photos(owner, sort_key DESC, share, path);
      CREATE INDEX IF NOT EXISTS photo_identity ON photos(share,path,size,modified,exif_checked);
      CREATE TABLE IF NOT EXISTS exif_denied (
        owner TEXT NOT NULL, share TEXT NOT NULL, path TEXT NOT NULL,
        size INTEGER NOT NULL, modified REAL NOT NULL,
        retry_after REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(owner,share,path)
      );
      CREATE INDEX IF NOT EXISTS exif_denied_retry ON exif_denied(owner,retry_after);
      CREATE TABLE IF NOT EXISTS folders (
        owner TEXT NOT NULL, share TEXT NOT NULL, path TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner, share, path)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        owner TEXT PRIMARY KEY, started REAL NOT NULL,
        complete INTEGER NOT NULL DEFAULT 0, limited INTEGER NOT NULL DEFAULT 0
      );
    """)
    try:
        with db:
            # One-time migration for the read-only SMB open fix. Earlier EXIF
            # attempts requested write permission, so their ACCESS_DENIED
            # cooldowns may be false positives. Expire ONLY those cooldowns
            # once; never reset photos, known EXIF dates or other metadata.
            db.execute("CREATE TABLE IF NOT EXISTS index_migrations (name TEXT PRIMARY KEY)")
            name = "exif_readonly_smb_open_0229"
            if db.execute("SELECT 1 FROM index_migrations WHERE name=?", (name,)).fetchone() is None:
                added = db.execute("INSERT OR IGNORE INTO index_migrations(name) VALUES (?)", (name,))
                if added.rowcount:
                    db.execute("UPDATE exif_denied SET retry_after=0")
            yield db
    finally:
        db.close()


def begin(db, owner, shares):
    exists = db.execute("SELECT 1 FROM jobs WHERE owner=?", (owner,)).fetchone()
    if not exists:
        db.execute("INSERT INTO jobs(owner,started) VALUES (?,?)", (owner, time.time()))
    # Reuse shared EXIF only when this owner's rows still need it.
    # Avoid costly whole-library UPDATEs on every gallery status poll.
    needs_metadata = db.execute("SELECT 1 FROM photos WHERE owner=? AND exif_checked=0 LIMIT 1",
                                (owner,)).fetchone()
    if needs_metadata:
        reuse_shared(db, owner, shares)
    for share in shares:
        present = db.execute("SELECT 1 FROM folders WHERE owner=? AND share=? AND path=''",
                             (owner, share)).fetchone()
        if not present:
            db.execute("INSERT INTO folders(owner,share,path) VALUES (?,?, '')", (owner, share))
            db.execute("UPDATE jobs SET complete=0 WHERE owner=?", (owner,))
    refresh_due(db, owner, shares)


def reset(owner, shares):
    with LOCK, connect() as db:
        for table in ("photos", "folders", "jobs"):
            db.execute("DELETE FROM " + table + " WHERE owner=?", (owner,))
        begin(db, owner, shares)


def state(owner, shares):
    with LOCK, connect() as db:
        begin(db, owner, shares)
        job = db.execute("SELECT complete,limited FROM jobs WHERE owner=?", (owner,)).fetchone()
        scanned = db.execute("SELECT COUNT(*) FROM folders WHERE owner=? AND done=1", (owner,)).fetchone()[0]
        pending = db.execute("SELECT COUNT(*) FROM folders WHERE owner=? AND done=0", (owner,)).fetchone()[0]
        total = db.execute("SELECT COUNT(*) FROM photos WHERE owner=? AND share IN (" + ",".join("?" for _ in shares) + ")", (owner, *shares)).fetchone()[0] if shares else 0
        dates_pending = db.execute("SELECT COUNT(*) FROM photos WHERE owner=? AND share IN (" + ",".join("?" for _ in shares) + ") AND exif_checked=0 AND (lower(name) LIKE '%.jpg' OR lower(name) LIKE '%.jpeg' OR lower(name) LIKE '%.png' OR lower(name) LIKE '%.webp')", (owner, *shares)).fetchone()[0] if shares else 0
        # Shared EXIF progress is deduplicated by file identity. Only include
        # files already discovered in shares this user can access.
        shared_remaining = db.execute(
            "SELECT COUNT(*) FROM (SELECT share,path,size,modified FROM photos "
            "WHERE owner=? AND share IN (" + ",".join("?" for _ in shares) + ") "
            "AND exif_checked=0 AND (lower(name) LIKE '%.jpg' OR lower(name) LIKE '%.jpeg' OR lower(name) LIKE '%.png' OR lower(name) LIKE '%.webp') "
            "GROUP BY share,path,size,modified)", (owner, *shares)).fetchone()[0] if shares else 0
        dated = db.execute("SELECT COUNT(*) FROM photos WHERE owner=? AND share IN (" +
                           ",".join("?" for _ in shares) + ") AND taken IS NOT NULL",
                           (owner, *shares)).fetchone()[0] if shares else 0
        checked_no_date = db.execute("SELECT COUNT(*) FROM photos WHERE owner=? AND share IN (" +
                                     ",".join("?" for _ in shares) + ") AND exif_checked=1 AND taken IS NULL",
                                     (owner, *shares)).fetchone()[0] if shares else 0
        blocked = denied_count(db, owner, shares)
        return {"complete": bool(job["complete"]), "limited": bool(job["limited"]),
                "scanned": scanned, "pending": pending, "total": total,
                "dates_pending": dates_pending, "dates_blocked": blocked,
                "dates_available": max(0, dates_pending-blocked),
                "shared_dates_pending": shared_remaining,
                "dated": dated, "checked_no_date": checked_no_date}


def page(owner, shares, offset, limit, order='taken'):
    if not shares:
        return []
    with LOCK, connect() as db:
        rows = db.execute(
            "SELECT share,path,folder,name,size,modified,taken FROM photos "
            "WHERE owner=? AND share IN (" + ",".join("?" for _ in shares) + ") " +
            ("ORDER BY CASE WHEN taken IS NULL THEN 1 ELSE 0 END, taken DESC, share, path LIMIT ? OFFSET ?" if order == 'taken' else "ORDER BY modified DESC, share, path LIMIT ? OFFSET ?"),
            (owner, *shares, limit, offset)).fetchall()
        return [dict(row) for row in rows]


def pending_folder(db, owner):
    return db.execute("SELECT share,path FROM folders WHERE owner=? AND done=0 ORDER BY LENGTH(path),path LIMIT 1", (owner,)).fetchone()


def add_folder_contents(db, owner, share, folder, entries):
    # Failed SMB listings are passed as empty collections; never prune on failure.
    if entries:
        prune_missing(db, owner, share, folder, entries)
    folders_count = db.execute("SELECT COUNT(*) FROM folders WHERE owner=?", (owner,)).fetchone()[0]
    photos_count = db.execute("SELECT COUNT(*) FROM photos WHERE owner=?", (owner,)).fetchone()[0]
    for entry in entries:
        name = entry.filename
        if name in (".", "..") or "/" in name or "\\" in name or not name:
            continue
        path = "/".join(x for x in (folder, name) if x)
        if entry.isDirectory:
            if folders_count >= MAX_FOLDERS:
                db.execute("UPDATE jobs SET limited=1 WHERE owner=?", (owner,))
                continue
            result = db.execute("INSERT OR IGNORE INTO folders(owner,share,path) VALUES (?,?,?)", (owner, share, path))
            folders_count += max(0, result.rowcount)
        elif name.lower().endswith(IMAGE_EXTS):
            if photos_count >= MAX_PHOTOS:
                db.execute("UPDATE jobs SET limited=1 WHERE owner=?", (owner,))
                continue
            modified = float(entry.last_write_time or 0)
            sort_key = datetime.fromtimestamp(max(0, min(modified, 4102444800)), timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
            old = db.execute("SELECT size,modified,taken,exif_checked,sort_key FROM photos WHERE owner=? AND share=? AND path=?", (owner,share,path)).fetchone()
            if old and old["size"] == int(entry.file_size) and old["modified"] == modified:
                continue
            shared = db.execute("SELECT taken,exif_checked FROM shared_metadata WHERE share=? AND path=? AND size=? AND modified=?",
                                (share,path,int(entry.file_size),modified)).fetchone()
            taken = shared["taken"] if shared else None
            checked = shared["exif_checked"] if shared else 0
            db.execute("INSERT OR REPLACE INTO photos(owner,share,path,folder,name,size,modified,taken,exif_checked,sort_key) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (owner,share,path,folder,name,int(entry.file_size),modified,taken,checked,taken or sort_key))
            photos_count += 1
    db.execute("UPDATE folders SET done=1 WHERE owner=? AND share=? AND path=?", (owner, share, folder))



def record_upload(owner, share, path, size, modified):
    """Insert a successfully uploaded image without resetting a scan in progress."""
    if not path.lower().endswith(IMAGE_EXTS):
        return False
    folder, _, name = path.rpartition("/")
    modified = float(modified)
    size = int(size)
    stamp = datetime.fromtimestamp(max(0, min(modified, 4102444800)), timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    with LOCK, connect() as db:
        count = db.execute("SELECT COUNT(*) FROM photos WHERE owner=?", (owner,)).fetchone()[0]
        existing = db.execute("SELECT 1 FROM photos WHERE owner=? AND share=? AND path=?",
                              (owner, share, path)).fetchone()
        if not existing and count >= MAX_PHOTOS:
            return False
        shared = db.execute("SELECT taken,exif_checked FROM shared_metadata WHERE share=? AND path=? AND size=? AND modified=?",
                            (share, path, size, modified)).fetchone()
        taken = shared["taken"] if shared else None
        checked = shared["exif_checked"] if shared else 0
        db.execute("INSERT OR REPLACE INTO photos(owner,share,path,folder,name,size,modified,taken,exif_checked,sort_key) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (owner, share, path, folder, name, size, modified, taken, checked, taken or stamp))
    return True


def retry_missing_dates(db, owner, shares):
    """Resume only never-checked photos; DO NOT reset known no-date results.

    Prior versions reset exif_checked=0 for every photo without a capture date,
    inflating the queue and repeating expensive SMB reads. This maintenance
    action must not erase either positive or negative EXIF results.
    """
    if not shares:
        return 0
    where = "share IN (" + ",".join("?" for _ in shares) + ")"
    allowed = "(lower(name) LIKE '%.jpg' OR lower(name) LIKE '%.jpeg' OR lower(name) LIKE '%.png' OR lower(name) LIKE '%.webp')"
    return db.execute(
        "SELECT COUNT(*) FROM photos WHERE owner=? AND " + where +
        " AND exif_checked=0 AND " + allowed, (owner, *shares)
    ).fetchone()[0]


def mark_exif_denied(db, owner, row):
    """Record ACL failure without changing photo or EXIF state."""
    db.execute("""INSERT INTO exif_denied(owner,share,path,size,modified,retry_after,attempts)
                  VALUES (?,?,?,?,?,?,1)
                  ON CONFLICT(owner,share,path) DO UPDATE SET
                    size=excluded.size,modified=excluded.modified,
                    retry_after=excluded.retry_after,attempts=exif_denied.attempts+1""",
               (owner,row["share"],row["path"],row["size"],row["modified"],time.time()+86400))


def clear_exif_denied(db, owner, share, path):
    db.execute("DELETE FROM exif_denied WHERE owner=? AND share=? AND path=?",(owner,share,path))


def denied_count(db, owner, shares):
    """Access-denied photos cooling down within this SMB user's visible shares."""
    if not shares:
        return 0
    return db.execute(
        "SELECT COUNT(*) FROM exif_denied d JOIN photos p "
        "ON p.owner=d.owner AND p.share=d.share AND p.path=d.path "
        "WHERE d.owner=? AND p.share IN (" + ",".join("?" for _ in shares) + ") "
        "AND p.exif_checked=0 AND p.size=d.size AND p.modified=d.modified "
        "AND d.retry_after>? "
        "AND (lower(p.name) LIKE '%.jpg' OR lower(p.name) LIKE '%.jpeg' "
        "OR lower(p.name) LIKE '%.png' OR lower(p.name) LIKE '%.webp')",
        (owner, *shares, time.time())
    ).fetchone()[0]


def next_unchecked(db, owner, shares, excluded=()):
    if not shares:
        return None
    excluded=tuple(excluded)
    sql=("SELECT p.share,p.path,p.name,p.size,p.modified FROM photos p WHERE p.owner=? "
         "AND p.share IN (" + ",".join("?" for _ in shares) + ") "
         "AND p.exif_checked=0 AND (lower(p.name) LIKE '%.jpg' OR lower(p.name) LIKE '%.jpeg' "
         "OR lower(p.name) LIKE '%.png' OR lower(p.name) LIKE '%.webp') "
         "AND NOT EXISTS (SELECT 1 FROM exif_denied d WHERE d.owner=p.owner "
         "AND d.share=p.share AND d.path=p.path AND d.size=p.size "
         "AND d.modified=p.modified AND d.retry_after>?)")
    args=[owner,*shares,time.time()]
    if excluded:
        sql+=" AND (p.share || char(31) || p.path) NOT IN ("+",".join("?" for _ in excluded)+")"
        args.extend(share+chr(31)+path for share,path in excluded)
    return db.execute(sql+" LIMIT 1",args).fetchone()


def save_date(db, owner, share, path, taken):
    """Save once, then distribute EXIF to every indexed matching file identity."""
    row = db.execute("SELECT size,modified FROM photos WHERE owner=? AND share=? AND path=?",
                     (owner, share, path)).fetchone()
    if row is None:
        return
    size, modified = row["size"], row["modified"]
    db.execute("INSERT OR REPLACE INTO shared_metadata(share,path,size,modified,taken,exif_checked) "
               "VALUES (?,?,?,?,?,1)", (share, path, size, modified, taken))
    db.execute(
        "UPDATE photos SET taken=?,exif_checked=1,sort_key=COALESCE(?,sort_key) "
        "WHERE share=? AND path=? AND size=? AND modified=?",
        (taken, taken, share, path, size, modified))


def reuse_shared(db, owner, shares):
    """Copy metadata only into already discovered ACL-scoped user rows."""
    if not shares:
        return
    db.execute("""INSERT OR IGNORE INTO shared_metadata(share,path,size,modified,taken,exif_checked)
                  SELECT share,path,size,modified,taken,exif_checked FROM photos
                  WHERE exif_checked=1 AND taken IS NOT NULL AND share IN (""" + ",".join("?" for _ in shares) + ")", tuple(shares))
    db.execute("""UPDATE photos SET
                  taken=(SELECT m.taken FROM shared_metadata m WHERE m.share=photos.share
                         AND m.path=photos.path AND m.size=photos.size AND m.modified=photos.modified),
                  exif_checked=1,
                  sort_key=COALESCE((SELECT m.taken FROM shared_metadata m WHERE m.share=photos.share
                         AND m.path=photos.path AND m.size=photos.size AND m.modified=photos.modified),sort_key)
                  WHERE owner=? AND exif_checked=0 AND EXISTS
                  (SELECT 1 FROM shared_metadata m WHERE m.share=photos.share AND m.path=photos.path
                   AND m.size=photos.size AND m.modified=photos.modified AND m.exif_checked=1 AND m.taken IS NOT NULL)""", (owner,))

def refresh_due(db, owner, shares, interval=6*3600):
    """Refresh completed scans periodically, never restarting unfinished jobs."""
    job = db.execute("SELECT started,complete FROM jobs WHERE owner=?", (owner,)).fetchone()
    if not job or not job["complete"] or time.time()-job["started"] < interval:
        return
    if shares:
        db.execute("UPDATE folders SET done=0 WHERE owner=? AND share IN (" +
                   ",".join("?" for _ in shares) + ")", (owner,*shares))
    db.execute("UPDATE jobs SET complete=0,started=? WHERE owner=?", (time.time(),owner))


def prune_missing(db, owner, share, folder, entries):
    """Only remove stale records after an authorized successful folder listing."""
    present = {e.filename for e in entries}
    for row in db.execute("SELECT path,name FROM photos WHERE owner=? AND share=? AND folder=?",
                          (owner,share,folder)).fetchall():
        if row["name"] not in present:
            db.execute("DELETE FROM photos WHERE owner=? AND share=? AND path=?", (owner,share,row["path"]))
    for row in db.execute("SELECT path FROM folders WHERE owner=? AND share=? AND path!=?",
                          (owner,share,folder)).fetchall():
        path = row["path"]
        if path.rsplit("/",1)[0] == folder and path.rsplit("/",1)[-1] not in present:
            db.execute("DELETE FROM photos WHERE owner=? AND share=? AND (path=? OR path LIKE ?)",
                       (owner,share,path,path+"/%"))
            db.execute("DELETE FROM folders WHERE owner=? AND share=? AND (path=? OR path LIKE ?)",
                       (owner,share,path,path+"/%"))
