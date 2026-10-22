"""Fast, ACL-preserving same-share move to the NAS Web recycle bin.

The caller must authorize the SMB share, sanitize the parent path and hold
trash_store.OP_LOCK. This module performs one source listing, one recycle listing,
then one atomic SMB rename per file. No directory contents are recursively read.
"""
import secrets


def _candidate(name, taken):
    if name not in taken:
        return name
    head, dot, suffix = name.rpartition(".")
    if not dot or not head:
        head, suffix = name, ""
    for _ in range(20):
        candidate = head + " (" + secrets.token_hex(4) + ")" + ("." + suffix if suffix else "")
        if candidate not in taken:
            return candidate
    raise ValueError("Не удалось подобрать имя объекта в корзине")


def move_many(conn, share, folder, files):
    """Move direct children only. Returns (moved, failures) with stable paths.

    A failed rename never claims success; all following objects are still
    attempted and metadata for successful moves is returned to the caller.
    """
    parent = "/" + folder if folder else "/"
    source = {x.filename: x for x in conn.listPath(share, parent, timeout=30)
              if x.filename not in (".", "..")}
    roots = {x.filename: x for x in conn.listPath(share, "/", timeout=30)}
    root = roots.get(".recycle")
    if root is None:
        conn.createDirectory(share, "/.recycle")
    elif not root.isDirectory or getattr(root, "isReparsePoint", False):
        raise ValueError("Имя .recycle занято файлом или папкой-ссылкой")
    taken = {x.filename for x in conn.listPath(share, "/.recycle", timeout=30)}
    moved, failed = [], []
    for target in files:
        name = target["name"]
        path = (folder + "/" if folder else "") + name
        entry = source.get(name)
        if entry is None:
            failed.append({"name": name, "reason": "Файл или папка не найдены"})
            continue
        if bool(entry.isDirectory) != target["directory"]:
            failed.append({"name": name, "reason": "Тип объекта изменился"})
            continue
        if getattr(entry, "isReparsePoint", False):
            failed.append({"name": name, "reason": "Папка-ссылка не поддерживается"})
            continue
        dest = _candidate(name, taken)
        try:
            conn.rename(share, "/" + path, "/.recycle/" + dest)
            taken.add(dest)
            moved.append({"trash_name": dest, "path": path,
                          "directory": bool(entry.isDirectory)})
        except Exception as exc:
            # An SMB connection can drop mid-batch; failed paths are not
            # removed from the gallery and remain eligible for a retry.
            failed.append({"name": name, "reason": type(exc).__name__})
    return moved, failed
