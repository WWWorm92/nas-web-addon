"""User profiles and shared gallery folder visibility.

Ownership/visibility only changes the NAS Web gallery. SMB ACLs remain the
source of truth for file reads, writes, and access to individual shares.
"""
import time

from . import gallery_index

COLORS = frozenset(("#4b80db", "#64748b", "#7a72cf", "#208b91", "#ad698d", "#bd834b"))
DEFAULT_COLOR = "#4b80db"
MAX_FOLDERS_PER_USER = 100


def owner_key(username):
    return gallery_index.key(username)


def _child(path, parent):
    return path == parent or path.startswith(parent + "/")


def _ensure_profile(db, username):
    owner = owner_key(username)
    db.execute(
        "INSERT OR IGNORE INTO profiles(owner,username,display_name,avatar_color,updated) "
        "VALUES (?,?,?,?,?)",
        (owner, username, username, DEFAULT_COLOR, time.time()),
    )
    return owner


def get(username, shares):
    with gallery_index.LOCK, gallery_index.connect() as db:
        owner = _ensure_profile(db, username)
        row = db.execute(
            "SELECT username,display_name,avatar_color FROM profiles WHERE owner=?", (owner,)
        ).fetchone()
        folders = [
            dict(r) for r in db.execute(
                "SELECT share,path,visible FROM profile_folders WHERE owner=? "
                "ORDER BY share,path", (owner,)
            ).fetchall() if r["share"] in shares
        ]
        return {"username": row["username"], "display_name": row["display_name"],
                "avatar_color": row["avatar_color"],
                "folders": [{**folder, "visible": bool(folder["visible"])} for folder in folders]}


def update(username, display_name, avatar_color):
    if not isinstance(display_name, str):
        raise ValueError("Некорректное имя профиля")
    display_name = display_name.strip()
    if not 1 <= len(display_name) <= 60 or any(ord(c) < 32 for c in display_name):
        raise ValueError("Имя профиля: от 1 до 60 символов")
    if avatar_color not in COLORS:
        raise ValueError("Неизвестный цвет аватара")
    with gallery_index.LOCK, gallery_index.connect() as db:
        owner = _ensure_profile(db, username)
        db.execute(
            "UPDATE profiles SET display_name=?,avatar_color=?,updated=? WHERE owner=?",
            (display_name, avatar_color, time.time(), owner),
        )


def bind(username, share, path):
    if not path or path == ".recycle" or path.startswith(".recycle/"):
        raise ValueError("Выберите обычную папку, не корень шары и не корзину")
    owner = owner_key(username)
    with gallery_index.LOCK, gallery_index.connect() as db:
        _ensure_profile(db, username)
        total = db.execute("SELECT COUNT(*) FROM profile_folders WHERE owner=?", (owner,)).fetchone()[0]
        if total >= MAX_FOLDERS_PER_USER:
            raise ValueError("Достигнут лимит привязанных папок")
        # Nested claims would make the owner of a parent folder able to hide
        # another user's folder. Reject overlaps, even for the same user.
        for row in db.execute("SELECT share,path FROM profile_folders WHERE share=?", (share,)):
            if _child(path, row["path"]) or _child(row["path"], path):
                raise ValueError("Эта папка или её родитель уже привязаны к профилю")
        db.execute(
            "INSERT INTO profile_folders(share,path,owner,visible,created) VALUES (?,?,?,1,?)",
            (share, path, owner, time.time()),
        )
        gallery_index.bump_all_revisions(db)


def set_visibility(username, share, path, visible):
    if type(visible) is not bool:
        raise ValueError("Укажите true или false")
    with gallery_index.LOCK, gallery_index.connect() as db:
        cur = db.execute(
            "UPDATE profile_folders SET visible=? WHERE owner=? AND share=? AND path=?",
            (int(visible), owner_key(username), share, path),
        )
        if not cur.rowcount:
            raise PermissionError("Папка не привязана к вашему профилю")
        gallery_index.bump_all_revisions(db)


def unbind(username, share, path):
    with gallery_index.LOCK, gallery_index.connect() as db:
        cur = db.execute(
            "DELETE FROM profile_folders WHERE owner=? AND share=? AND path=?",
            (owner_key(username), share, path),
        )
        if not cur.rowcount:
            raise PermissionError("Папка не привязана к вашему профилю")
        gallery_index.bump_all_revisions(db)
