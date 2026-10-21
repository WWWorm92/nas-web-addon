"""Per-SMB-user searchable filename index, independent of the photo/EXIF database.

Only names and metadata are persisted. SMB credentials stay in the caller's
memory. Every search result still requires live SMB permission verification.
"""
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

DB = Path("/data/nasweb-auth/files.sqlite3")
LOCK = threading.RLock()
MAX_ENTRIES = 150000
MAX_FOLDERS = 20000
SKIP_DIRS = {".recycle"}


@contextmanager
def connect():
    DB.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=15000")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS entries(
          owner TEXT NOT NULL, share TEXT NOT NULL, path TEXT NOT NULL,
          folder TEXT NOT NULL, name TEXT NOT NULL, name_fold TEXT NOT NULL,
          directory INTEGER NOT NULL, size INTEGER NOT NULL, modified REAL NOT NULL,
          seen INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(owner,share,path)
        );
        CREATE INDEX IF NOT EXISTS entry_folder ON entries(owner,share,folder);
        CREATE TABLE IF NOT EXISTS folders(
          owner TEXT NOT NULL, share TEXT NOT NULL, path TEXT NOT NULL,
          parent TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(owner,share,path)
        );
        CREATE INDEX IF NOT EXISTS folder_pending ON folders(owner,done);
        CREATE TABLE IF NOT EXISTS jobs(
          owner TEXT PRIMARY KEY, started REAL NOT NULL, complete INTEGER NOT NULL DEFAULT 0,
          limited INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0
        );
    """)
    try:
        with db:
            yield db
    finally:
        db.close()


def begin(db, owner, shares):
    db.execute("INSERT OR IGNORE INTO jobs(owner,started) VALUES (?,?)", (owner,time.time()))
    for share in shares:
        if not isinstance(share,str) or not share:
            continue
        created = db.execute(
            "INSERT OR IGNORE INTO folders(owner,share,path,parent) VALUES (?,?, '', '')",
            (owner,share))
        if created.rowcount:
            db.execute("UPDATE jobs SET complete=0 WHERE owner=?", (owner,))


def refresh(owner, shares):
    """Incremental refresh: keep existing hits until their folder is relisted."""
    with LOCK,connect() as db:
        begin(db,owner,shares)
        if shares:
            where="share IN ("+",".join("?" for _ in shares)+")"
            db.execute("UPDATE folders SET done=0 WHERE owner=? AND "+where,(owner,*shares))
            db.execute("UPDATE jobs SET complete=0,limited=0,errors=0 WHERE owner=?",(owner,))


def pending(owner, shares):
    with LOCK,connect() as db:
        begin(db,owner,shares)
        if not shares:return None
        return db.execute(
            "SELECT share,path FROM folders WHERE owner=? AND done=0 "
            "AND share IN ("+",".join("?" for _ in shares)+") "
            "ORDER BY LENGTH(path),path LIMIT 1",(owner,*shares)).fetchone()


def finish_if_done(owner, shares):
    with LOCK,connect() as db:
        begin(db,owner,shares)
        if not shares:return True
        unfinished=db.execute(
            "SELECT 1 FROM folders WHERE owner=? AND done=0 AND share IN ("+
            ",".join("?" for _ in shares)+") LIMIT 1",(owner,*shares)).fetchone()
        if unfinished is None:
            db.execute("UPDATE jobs SET complete=1 WHERE owner=?",(owner,))
        return unfinished is None


def state(owner, shares):
    with LOCK,connect() as db:
        begin(db,owner,shares)
        if shares:
            where="share IN ("+",".join("?" for _ in shares)+")"
            args=(owner,*shares)
            total=db.execute("SELECT COUNT(*) FROM entries WHERE owner=? AND "+where,args).fetchone()[0]
            scanned=db.execute("SELECT COUNT(*) FROM folders WHERE owner=? AND done=1 AND "+where,args).fetchone()[0]
            pending_count=db.execute("SELECT COUNT(*) FROM folders WHERE owner=? AND done=0 AND "+where,args).fetchone()[0]
        else:total=scanned=pending_count=0
        row=db.execute("SELECT complete,limited,errors FROM jobs WHERE owner=?",(owner,)).fetchone()
        return {"total":total,"scanned":scanned,"pending":pending_count,
                "complete":bool(row["complete"]) and pending_count==0,
                "limited":bool(row["limited"]),"errors":row["errors"]}


def _valid(name):
    return bool(name) and name not in (".","..") and not any(
        c in name for c in ("/","\\","\x00")) and not any(ord(c)<32 for c in name)


def record_folder(owner, share, folder, items=None, failed=False):
    """Atomic folder update; an SMB failure must never wipe indexed rows."""
    with LOCK,connect() as db:
        if failed:
            db.execute("UPDATE folders SET done=1 WHERE owner=? AND share=? AND path=?",
                       (owner,share,folder))
            db.execute("UPDATE jobs SET errors=errors+1 WHERE owner=?",(owner,))
            return
        entries=list(items or ())
        # Scan a folder in a single metadata-only transaction.
        stamp=time.time_ns()
        count=db.execute("SELECT COUNT(*) FROM entries WHERE owner=?",(owner,)).fetchone()[0]
        folders=db.execute("SELECT COUNT(*) FROM folders WHERE owner=?",(owner,)).fetchone()[0]
        for item in entries:
            name=str(item.filename)
            if not _valid(name):continue
            path="/".join(filter(None,(folder,name)))
            is_dir=bool(item.isDirectory)
            if is_dir and (name in SKIP_DIRS or getattr(item,"isReparsePoint",False)):
                continue
            exists=db.execute("SELECT 1 FROM entries WHERE owner=? AND share=? AND path=?",
                              (owner,share,path)).fetchone()
            if not exists and count>=MAX_ENTRIES:
                db.execute("UPDATE jobs SET limited=1 WHERE owner=?",(owner,))
                continue
            db.execute(
                "INSERT INTO entries(owner,share,path,folder,name,name_fold,directory,size,modified,seen) "
                "VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,share,path) DO UPDATE SET "
                "folder=excluded.folder,name=excluded.name,name_fold=excluded.name_fold,"
                "directory=excluded.directory,size=excluded.size,modified=excluded.modified,seen=excluded.seen",
                (owner,share,path,folder,name,name.casefold(),int(is_dir),
                 max(0,int(item.file_size or 0)),float(item.last_write_time or 0),stamp))
            count+=0 if exists else 1
            if is_dir:
                added=db.execute(
                    "INSERT OR IGNORE INTO folders(owner,share,path,parent) VALUES (?,?,?,?)",
                    (owner,share,path,folder))
                folders+=max(0,added.rowcount)
                if folders>=MAX_FOLDERS:
                    db.execute("UPDATE jobs SET limited=1 WHERE owner=?",(owner,))
        # Entries missing from a successfully relisted folder are stale.
        missing=db.execute(
            "SELECT path,directory FROM entries WHERE owner=? AND share=? AND folder=? AND seen<>?",
            (owner,share,folder,stamp)).fetchall()
        for old in missing:
            if old["directory"]:
                prefix=old["path"]+"/"
                # SQLite substr avoids LIKE wildcard escaping in folder names.
                db.execute("DELETE FROM entries WHERE owner=? AND share=? AND substr(path,1,?)=?",
                           (owner,share,len(prefix),prefix))
                db.execute("DELETE FROM folders WHERE owner=? AND share=? AND "
                           "(path=? OR substr(path,1,?)=?)",
                           (owner,share,old["path"],len(prefix),prefix))
            db.execute("DELETE FROM entries WHERE owner=? AND share=? AND path=?",
                       (owner,share,old["path"]))
        db.execute("UPDATE folders SET done=1 WHERE owner=? AND share=? AND path=?",
                   (owner,share,folder))


def search(owner, shares, term, kind="all", offset=0, limit=20):
    """Return candidate paths, not authorized hits. Caller must check live SMB ACL."""
    if not shares or not term or offset<0 or limit<1:return []
    kinds={
        "all":("1=1",()),"folder":("directory=1",()),
        "photo":("directory=0 AND (name_fold LIKE '%.jpg' OR name_fold LIKE '%.jpeg' "
                 "OR name_fold LIKE '%.png' OR name_fold LIKE '%.webp' OR name_fold LIKE '%.gif')",()),
        "video":("directory=0 AND (name_fold LIKE '%.mp4' OR name_fold LIKE '%.mov' "
                 "OR name_fold LIKE '%.m4v' OR name_fold LIKE '%.webm')",()),
        "document":("directory=0 AND (name_fold LIKE '%.pdf' OR name_fold LIKE '%.doc' "
                    "OR name_fold LIKE '%.docx' OR name_fold LIKE '%.txt' "
                    "OR name_fold LIKE '%.xls' OR name_fold LIKE '%.xlsx')",())
    }
    where,extra=kinds[kind]
    pattern="%"+term.casefold().replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
    with LOCK,connect() as db:
        return [dict(row) for row in db.execute(
            "SELECT share,path,folder,name,directory,size,modified FROM entries "
            "WHERE owner=? AND share IN ("+",".join("?" for _ in shares)+") "
            "AND name_fold LIKE ? ESCAPE '\\' AND "+where+" "
            "ORDER BY directory DESC,name_fold,share,path LIMIT ? OFFSET ?",
            (owner,*shares,pattern,*extra,limit,offset)).fetchall()]
