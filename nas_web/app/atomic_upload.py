"""Crash-safe, same-directory SMB upload publication.

The user-visible destination is NEVER opened for streaming writes.
Impacket SMB2/3 rename uses FILE_RENAME_INFORMATION with ReplaceIfExists,
so an existing regular file remains unchanged until the staged file is fully
closed and a single same-directory rename succeeds on the SMB server.

Network loss *during* the final rename can produce an ambiguous result; it
must never be "fixed" by deleting/rewriting the original.
"""
import logging
import secrets

log = logging.getLogger("nasweb")

STAGE_PREFIX = ".nasweb-upload-"
STAGE_SUFFIX = ".part"


class UploadSizeMismatch(Exception):
    """Staged SMB file is shorter or longer than the received local upload."""


def is_stage_name(name):
    return (name.startswith(STAGE_PREFIX) and name.endswith(STAGE_SUFFIX)
            and len(name) == len(STAGE_PREFIX) + 32 + len(STAGE_SUFFIX)
            and all(c in "0123456789abcdef" for c in
                    name[len(STAGE_PREFIX):-len(STAGE_SUFFIX)]))


def temporary_path(parent, token=None):
    """Keep source and destination on the *same SMB share and directory*."""
    stage = STAGE_PREFIX + (token or secrets.token_hex(16)) + STAGE_SUFFIX
    if not is_stage_name(stage):
        raise ValueError("Invalid staging identifier")
    return "/".join(filter(None, (parent, stage)))


def publish(conn, share, parent, filename, source, expected_size, *, token=None):
    """Stage, verify remote byte length, atomically rename to destination.

    Uses create-only SMB disposition for the temporary name; existing target
    files are replaced ONLY at the final server-side rename. No backup/restore
    sequence and no delete of the existing destination is performed.
    Return the final relative SMB path after successful commit.
    """
    if not isinstance(expected_size, int) or expected_size < 0:
        raise ValueError("Invalid expected upload size")
    temporary = temporary_path(parent, token=token)
    target = "/".join(filter(None, (parent, filename)))
    if temporary == target or is_stage_name(filename):
        raise ValueError("Reserved upload filename")
    owned = True
    try:
        source.seek(0)
        # FILE_CREATE rejects collisions rather than truncating another user's
        # staging file; random 128-bit names prevent predictable collisions.
        try:
            conn.storeFileNew(share, "/" + temporary, source, timeout=600)
        except Exception as exc:
            # If the randomly chosen temporary name already exists, it is not
            # ours; never delete another writer's file on FILE_CREATE failure.
            status = str(exc).upper()
            try:
                status += " " + str(exc.getErrorString()).upper()
            except Exception:
                pass
            if "STATUS_OBJECT_NAME_COLLISION" in status or "STATUS_OBJECT_NAME_EXISTS" in status:
                owned = False
            raise
        actual_size = conn.file_size(share, "/" + temporary)
        if actual_size != expected_size:
            raise UploadSizeMismatch("SMB upload byte length mismatch")
        # Do not delete the old target, and do not fall back to a destructive
        # two-rename backup sequence if the server refuses atomic replacement.
        conn.rename(share, "/" + temporary, "/" + target)
        owned = False
        return target
    finally:
        if owned:
            try:
                conn.deleteFiles(share, "/" + temporary)
            except Exception as exc:
                # A network outage may prevent cleanup; an orphan .part file
                # is safer than deleting the original. Retain for manual review.
                log.warning("SMB staged upload cleanup failed: %s", type(exc).__name__)
