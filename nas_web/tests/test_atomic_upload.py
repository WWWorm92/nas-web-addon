"""Failure-injection tests for publication of SMB uploads without truncating originals."""
import io
import unittest

from app import atomic_upload as uploads


class SMBFake:
    def __init__(self, prior=None, **faults):
        self.files = dict(prior or {})
        self.faults = faults
        self.operations = []
        self.deleted = []

    @staticmethod
    def key(remote):
        return remote.lstrip("/")

    def storeFileNew(self, share, remote, stream, timeout=None):
        self.operations.append("create-only")
        key = self.key(remote)
        if key in self.files:
            raise RuntimeError("STATUS_OBJECT_NAME_COLLISION")
        data = stream.read()
        if self.faults.get("interrupted"):
            self.files[key] = data[:4]
            raise OSError("network disconnected during write")
        if self.faults.get("short"):
            data = data[:-1]
        self.files[key] = data

    def file_size(self, share, remote):
        self.operations.append("verify-size")
        if self.faults.get("verify_failed"):
            raise OSError("network disconnected during verification")
        return len(self.files[self.key(remote)])

    def rename(self, share, old, new):
        self.operations.append("rename")
        if self.faults.get("rename_failed"):
            raise PermissionError("STATUS_ACCESS_DENIED")
        old = self.key(old)
        new = self.key(new)
        if old not in self.files:
            raise FileNotFoundError(old)
        # Single server-side namespace transition: no "backup" or gap.
        self.files[new] = self.files.pop(old)

    def deleteFiles(self, share, remote):
        self.deleted.append(remote)
        self.operations.append("cleanup-stage")
        if self.faults.get("cleanup_failed"):
            raise OSError("network disconnected during cleanup")
        self.files.pop(self.key(remote), None)


class AtomicUploadTests(unittest.TestCase):
    def setUp(self):
        self.token = "a" * 32
        self.temp = "Photos/" + uploads.STAGE_PREFIX + self.token + uploads.STAGE_SUFFIX
        self.target = "Photos/IMG_0001.HEIC"
        self.original = b"original photo bytes"
        self.new = b"new iphone image bytes"

    def commit(self, conn, data=None, *, filename="IMG_0001.HEIC"):
        data = self.new if data is None else data
        return uploads.publish(conn, "Photo", "Photos", filename,
                               io.BytesIO(data), len(data), token=self.token)

    def assert_no_temporary_files(self, conn):
        self.assertFalse(any(uploads.STAGE_PREFIX in key for key in conn.files))

    def test_new_file_is_verified_before_becoming_visible(self):
        smb = SMBFake()
        self.assertEqual(self.commit(smb), self.target)
        self.assertEqual(smb.files, {self.target: self.new})
        self.assertEqual(smb.operations, ["create-only", "verify-size", "rename"])

    def test_overwrite_existing_original_only_at_commit(self):
        smb = SMBFake({self.target: self.original})
        self.commit(smb)
        self.assertEqual(smb.files, {self.target: self.new})
        self.assertFalse(smb.deleted, "Never delete the original to replace it")

    def test_connection_drop_during_stream_preserves_original(self):
        smb = SMBFake({self.target: self.original}, interrupted=True)
        with self.assertRaises(OSError):
            self.commit(smb)
        self.assertEqual(smb.files, {self.target: self.original})
        self.assertEqual(smb.operations, ["create-only", "cleanup-stage"])

    def test_short_remote_write_prevents_rename(self):
        smb = SMBFake({self.target: self.original}, short=True)
        with self.assertRaises(uploads.UploadSizeMismatch):
            self.commit(smb)
        self.assertEqual(smb.files, {self.target: self.original})
        self.assertEqual(smb.operations, ["create-only", "verify-size", "cleanup-stage"])

    def test_verification_error_preserves_original(self):
        smb = SMBFake({self.target: self.original}, verify_failed=True)
        with self.assertRaises(OSError):
            self.commit(smb)
        self.assertEqual(smb.files, {self.target: self.original})
        self.assert_no_temporary_files(smb)

    def test_denied_atomic_rename_preserves_original_and_cleans_stage(self):
        smb = SMBFake({self.target: self.original}, rename_failed=True)
        with self.assertRaises(PermissionError):
            self.commit(smb)
        self.assertEqual(smb.files, {self.target: self.original})
        self.assertEqual(smb.operations, ["create-only", "verify-size",
                                           "rename", "cleanup-stage"])

    def test_cleanup_failure_does_not_delete_original(self):
        smb = SMBFake({self.target: self.original}, interrupted=True, cleanup_failed=True)
        with self.assertRaises(OSError):
            self.commit(smb)
        self.assertEqual(smb.files[self.target], self.original)
        self.assertEqual(smb.files[self.temp], self.new[:4])
        self.assertEqual(smb.deleted, ["/" + self.temp])

    def test_staging_collision_does_not_delete_another_writers_file(self):
        existing = b"another writer's stage"
        smb = SMBFake({self.temp: existing, self.target: self.original})
        with self.assertRaisesRegex(RuntimeError, "STATUS_OBJECT_NAME_COLLISION"):
            self.commit(smb)
        self.assertEqual(smb.files[self.temp], existing)
        self.assertEqual(smb.files[self.target], self.original)
        self.assertFalse(smb.deleted)

    def test_empty_file_is_supported(self):
        smb = SMBFake()
        self.commit(smb, data=b"", filename="blank.txt")
        self.assertEqual(smb.files, {"Photos/blank.txt": b""})

    def test_stages_are_in_same_folder_and_randomized(self):
        self.assertEqual(uploads.temporary_path("Photos", token=self.token), self.temp)
        first = uploads.temporary_path("")
        second = uploads.temporary_path("")
        self.assertNotEqual(first, second)
        self.assertTrue(uploads.is_stage_name(first))
        self.assertFalse(uploads.is_stage_name("my-photo.HEIC"))
        with self.assertRaises(ValueError):
            uploads.temporary_path("Photos", token="../bad")

    def test_reserved_stage_filenames_not_publishable(self):
        smb = SMBFake()
        with self.assertRaises(ValueError):
            self.commit(smb, filename=uploads.STAGE_PREFIX+self.token+uploads.STAGE_SUFFIX)
        self.assertEqual(smb.files, {})


if __name__ == "__main__":
    unittest.main()
