"""Resumable Takeout uploads: disconnect recovery, replay safety and ownership."""
import io
import os
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from app import google_photos_import as imp


class ResumableTakeoutTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old=(imp.DB,imp.KEY,imp.ARCHIVES)
        imp.DB=Path(self.temp.name)/"db.sqlite"
        imp.KEY=Path(self.temp.name)/"key"
        imp.ARCHIVES=Path(self.temp.name)/"spool"
        imp.ACTIVE.clear()

    def tearDown(self):
        imp.ACTIVE.clear()
        imp.DB,imp.KEY,imp.ARCHIVES=self.old
        self.temp.cleanup()

    def archive(self):
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,"w",compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("Takeout/Google Photos/img.jpg",b"image contents")
        return buffer.getvalue()

    def new(self,size,username="alice",filename="Google Photos.zip",mtime=123,max_bytes=4096):
        return imp.begin_takeout_upload(username,"Photo","Photos",filename,size,mtime,max_bytes)

    def test_restart_resume_replay_and_complete(self):
        payload=self.archive()
        a=self.new(len(payload))
        self.assertEqual(a["offset"],0)
        ident=a["upload_id"]
        midpoint=len(payload)//2
        b=imp.write_takeout_chunk("alice",ident,0,payload[:midpoint])
        self.assertEqual(b["offset"],midpoint)
        # Retry after lost ACK must acknowledge without doubling the data.
        retried=imp.write_takeout_chunk("alice",ident,0,payload[:midpoint])
        self.assertEqual(retried["offset"],midpoint)
        # This is a *new* browser session with the original file selected.
        resumed=self.new(len(payload))
        self.assertEqual(resumed["upload_id"],ident)
        self.assertEqual(resumed["offset"],midpoint)
        imp.cleanup_orphaned_archives()  # Startup may clean other temp files.
        self.assertEqual(imp.takeout_upload_status("alice",ident)["offset"],midpoint)
        with self.assertRaises(imp.TakeoutOffsetMismatch):
            imp.write_takeout_chunk("alice",ident,midpoint+1,b"x")
        imp.write_takeout_chunk("alice",ident,midpoint,payload[midpoint:])
        complete=imp.complete_takeout_upload("alice",ident)
        self.assertEqual(complete["archive"].read_bytes(),payload)
        self.assertEqual(complete["share"],"Photo")
        self.assertEqual(complete["path"],"Photos")
        self.assertTrue(zipfile.is_zipfile(complete["archive"]))
        with self.assertRaises(ValueError):
            imp.takeout_upload_status("alice",ident)
        with self.assertRaises(ValueError):
            self.new(len(payload))
        # Worker cleanup removes the completed ZIP.
        complete["archive"].unlink()
        imp.release(complete["owner"])

    def test_owner_isolation_and_chunk_corruption_rejected(self):
        a=self.new(20)
        ident=a["upload_id"]
        with self.assertRaises(ValueError):
            imp.takeout_upload_status("bob",ident)
        with self.assertRaises(ValueError):
            imp.write_takeout_chunk("bob",ident,0,b"bad")
        imp.write_takeout_chunk("alice",ident,0,b"hello")
        with self.assertRaises(imp.TakeoutOffsetMismatch):
            imp.write_takeout_chunk("alice",ident,0,b"HELLO")
        with self.assertRaises(ValueError):
            imp.write_takeout_chunk("alice",ident,15,b"overflows total size")
        self.assertEqual(imp.takeout_upload_status("alice",ident)["offset"],5)
        with self.assertRaises(ValueError):
            imp.complete_takeout_upload("alice",ident)

    def test_full_non_zip_rejected_and_kept_for_reselect(self):
        a=self.new(5)
        imp.write_takeout_chunk("alice",a["upload_id"],0,b"abcde")
        with self.assertRaises(ValueError):
            imp.complete_takeout_upload("alice",a["upload_id"])
        self.assertEqual(self.new(5)["offset"],5)

    def test_max_size_and_chunk_limits(self):
        with self.assertRaises(ValueError):
            self.new(4097)
        with self.assertRaises(ValueError):
            self.new(0)
        with self.assertRaises(ValueError):
            self.new(1,filename="../other.zip")
        a=self.new(2 * imp.TAKEOUT_CHUNK_SIZE,max_bytes=3*imp.TAKEOUT_CHUNK_SIZE)
        with self.assertRaises(ValueError):
            imp.write_takeout_chunk("alice",a["upload_id"],0,b"x"*(imp.TAKEOUT_CHUNK_SIZE+1))
        self.assertEqual(imp.takeout_upload_status("alice",a["upload_id"])["offset"],0)

    def test_stale_part_cleanup_without_deleting_fresh_resume(self):
        fresh=self.new(10,filename="fresh.zip")
        stale=self.new(10,filename="old.zip",mtime=124)
        imp.write_takeout_chunk("alice",fresh["upload_id"],0,b"a")
        imp.write_takeout_chunk("alice",stale["upload_id"],0,b"b")
        with imp.connect() as db,db:
            db.execute("UPDATE takeout_uploads SET updated=? WHERE id=?",
                       (time.time()-imp.TAKEOUT_UPLOAD_TTL-10,stale["upload_id"]))
        imp.cleanup_orphaned_archives()
        self.assertEqual(imp.takeout_upload_status("alice",fresh["upload_id"])["offset"],1)
        with self.assertRaises(ValueError):
            imp.takeout_upload_status("alice",stale["upload_id"])
        self.assertFalse(imp._takeout_part(stale["upload_id"]).exists())


if __name__=="__main__":
    unittest.main()
