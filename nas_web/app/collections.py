"""User-private virtual albums and favorites; never modifies SMB files or gallery index."""
import sqlite3
from pathlib import Path
from . import gallery_index

DB = Path("/data/nasweb-auth/collections.sqlite3")

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=15000")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS albums (
      owner TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, created REAL NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS album_owner ON albums(owner,id);
    CREATE TABLE IF NOT EXISTS album_items (
      owner TEXT NOT NULL, album_id INTEGER NOT NULL, share TEXT NOT NULL, path TEXT NOT NULL,
      PRIMARY KEY(owner,album_id,share,path)
    );
    CREATE TABLE IF NOT EXISTS favorites (
      owner TEXT NOT NULL, share TEXT NOT NULL, path TEXT NOT NULL,
      PRIMARY KEY(owner,share,path)
    );
    """)
    return db

def photo_exists(owner, shares, share, path):
    if share not in shares:
        return False
    with gallery_index.LOCK, gallery_index.connect() as db:
        return db.execute("SELECT 1 FROM photos WHERE owner=? AND share=? AND path=?",
                          (owner,share,path)).fetchone() is not None

def listing(owner, shares):
    with connect() as db:
        albums=[dict(r) for r in db.execute(
            "SELECT id,name,(SELECT COUNT(*) FROM album_items i WHERE i.owner=a.owner AND i.album_id=a.id) AS count "
            "FROM albums a WHERE owner=? ORDER BY created DESC,id DESC",(owner,))]
        favorites=db.execute("SELECT COUNT(*) FROM favorites WHERE owner=? AND share IN ("+
            ",".join("?" for _ in shares)+")",(owner,*shares)).fetchone()[0] if shares else 0
    return {"albums":albums,"favorites":favorites}

def create_album(owner,name):
    name=name.strip()
    if not 1<=len(name)<=80: raise ValueError("Название альбома: 1–80 символов")
    with connect() as db:
        if db.execute("SELECT COUNT(*) FROM albums WHERE owner=?",(owner,)).fetchone()[0]>=200:
            raise ValueError("Слишком много альбомов")
        with db:
            cur=db.execute("INSERT INTO albums(owner,name) VALUES (?,?)",(owner,name))
        return cur.lastrowid

def set_favorite(owner,share,path,enabled):
    with connect() as db,db:
        if enabled: db.execute("INSERT OR IGNORE INTO favorites VALUES (?,?,?)",(owner,share,path))
        else: db.execute("DELETE FROM favorites WHERE owner=? AND share=? AND path=?",(owner,share,path))

def set_album_item(owner,album_id,share,path,enabled):
    with connect() as db,db:
        if not db.execute("SELECT 1 FROM albums WHERE owner=? AND id=?",(owner,album_id)).fetchone():
            raise ValueError("Альбом не найден")
        if enabled: db.execute("INSERT OR IGNORE INTO album_items VALUES (?,?,?,?)",(owner,album_id,share,path))
        else: db.execute("DELETE FROM album_items WHERE owner=? AND album_id=? AND share=? AND path=?",(owner,album_id,share,path))

def remove_album(owner,album_id):
    with connect() as db,db:
        db.execute("DELETE FROM album_items WHERE owner=? AND album_id=?",(owner,album_id))
        db.execute("DELETE FROM albums WHERE owner=? AND id=?",(owner,album_id))

def photos(owner,shares,album_id=None,favorites=False,limit=120,offset=0):
    if not shares:return []
    table="favorites" if favorites else "album_items"
    join="p.owner=i.owner AND p.share=i.share AND p.path=i.path"
    sql="SELECT p.share,p.path,p.folder,p.name,p.size,p.modified,p.taken FROM "+table+" i JOIN photos p ON "+join+" WHERE i.owner=? AND p.share IN ("+",".join("?" for _ in shares)+")"
    args=[owner,*shares]
    if not favorites:
        sql+=" AND i.album_id=?";args.append(album_id)
    sql+=" ORDER BY p.sort_key DESC,p.share,p.path LIMIT ? OFFSET ?";args.extend([limit,offset])
    # Attach the gallery database read-only; no migrations, resets or writes to photo index.
    with connect() as db:
        db.execute("ATTACH DATABASE ? AS gallery",(str(gallery_index.DB),))
        sql=sql.replace("JOIN photos p","JOIN gallery.photos p")
        return [dict(x) for x in db.execute(sql,args)]

def memories(owner,shares,month,day,limit=100):
    if not shares:return []
    with gallery_index.LOCK,gallery_index.connect() as db:
        rows=db.execute("SELECT share,path,folder,name,size,modified,taken FROM photos WHERE owner=? AND share IN ("+
            ",".join("?" for _ in shares)+") AND taken IS NOT NULL AND substr(taken,6,5)=? "
            "ORDER BY taken DESC LIMIT ?",(owner,*shares,f"{month:02d}-{day:02d}",limit)).fetchall()
        return [dict(x) for x in rows]

def statistics(owner,shares):
    if not shares:return {"photos":0,"bytes":0,"dated":0,"by_share":[],"by_year":[]}
    with gallery_index.LOCK,gallery_index.connect() as db:
        where="owner=? AND share IN ("+",".join("?" for _ in shares)+")"
        args=(owner,*shares)
        totals=db.execute("SELECT COUNT(*),COALESCE(SUM(size),0),COUNT(taken) FROM photos WHERE "+where,args).fetchone()
        by_share=[dict(x) for x in db.execute("SELECT share,COUNT(*) AS photos,SUM(size) AS bytes FROM photos WHERE "+where+" GROUP BY share",args)]
        by_year=[dict(x) for x in db.execute("SELECT substr(taken,1,4) AS year,COUNT(*) AS photos FROM photos WHERE "+where+" AND taken IS NOT NULL GROUP BY substr(taken,1,4) ORDER BY year DESC LIMIT 60",args)]
        return {"photos":totals[0],"bytes":totals[1],"dated":totals[2],"by_share":by_share,"by_year":by_year}
