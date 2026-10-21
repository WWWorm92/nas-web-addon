"""Bounded planning for explicit permanent deletion *inside* an SMB recycle bin.

Do not use for normal file deletion: those objects must go to .recycle by rename.
This module never follows SMB directory reparse points and does not delete
anything while it is inspecting and counting a requested subtree.
"""

MAX_ENTRIES = 5000
MAX_DEPTH = 64


class TrashDeletionError(ValueError):
    pass


def within_recycle(path):
    return isinstance(path, str) and path.startswith(".recycle/") and bool(path[9:])


def deletion_plan(conn, share, path, directory):
    """Return (files, directories deepest-first) for one explicit trash item.

    Performs the complete enumeration before the first destructive operation.
    No wildcard paths, dot segments, reparse-point traversal, or trash root.
    The caller must perform SMB authorization and root item type checks.
    """
    if not within_recycle(path):
        raise TrashDeletionError("Безвозвратное удаление разрешено только внутри корзины")
    if any(not bit or bit in (".", "..") or "/" in bit or "\\" in bit
           or "*" in bit or "?" in bit for bit in path.split("/")):
        raise TrashDeletionError("Некорректный путь объекта корзины")

    stack = [(path, bool(directory), 0, False)]
    files, directories = [], []
    inspected = 0
    while stack:
        current, is_dir, depth, is_reparse = stack.pop()
        inspected += 1
        if inspected > MAX_ENTRIES:
            raise TrashDeletionError("В папке слишком много объектов для безопасного удаления через браузер")
        if depth > MAX_DEPTH:
            raise TrashDeletionError("Слишком глубокая структура папок")
        if is_reparse:
            raise TrashDeletionError("Удаление папок-ссылок из корзины не поддерживается")
        if not is_dir:
            files.append(current)
            continue
        children = conn.listPath(share, "/" + current)
        directories.append(current)
        for child in children:
            name = child.filename
            if name in (".", ".."):
                continue
            if not isinstance(name, str) or not name or name in (".", "..") or any(
                ch in name for ch in "/\\*?\0"
            ) or any(ord(ch) < 32 for ch in name):
                raise TrashDeletionError("Некорректное имя внутри удаляемой папки")
            stack.append((current + "/" + name, bool(child.isDirectory), depth + 1,
                          bool(getattr(child, "isReparsePoint", False))))
    return files, list(reversed(directories))


def permanent_delete(conn, share, path, directory):
    """Delete a fully enumerated trash subtree; no other share/path is touched."""
    files, dirs = deletion_plan(conn, share, path, directory)
    deleted = 0
    for file in files:
        conn.deleteFiles(share, "/" + file)
        deleted += 1
    for folder in dirs:
        conn.deleteDirectory(share, "/" + folder)
        deleted += 1
    return deleted
