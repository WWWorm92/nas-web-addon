"""Auto-refresh of the existing photo index: metadata-only, owner-scoped, no reindex."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from app import gallery_index as g


def entry(name, directory=False, size=150, modified=1792600000):
    return SimpleNamespace(filename=name, isDirectory=directory,
                           file_size=size, last_write_time=modified)


class GalleryAutoSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = g.DB
        g.DB = Path(self.temp.name) / "photos.sqlite3"
        self.owner = g.key("Anna")
        self.other = g.key("Boris")
        g.state(self.owner, ["Photos"])
        g.state(self.other, ["Photos"])
    def tearDown(self):
        g.DB = self.old_db
        self.temp.cleanup()

    def scan(self, owner, folder, files):
        with g.LOCK, g.connect() as db:
            g.add_folder_contents(db, owner, "Photos", folder, files)

    def test_unchanged_metadata_does_not_trigger_refresh(self):
        self.scan(self.owner, "", [entry("a.jpg")])
        start = g.state(self.owner, ["Photos"])
        self.scan(self.owner, "", [entry("a.jpg")])
        same = g.state(self.owner, ["Photos"])
        self.assertEqual(start["revision"], same["revision"])
        self.assertEqual(start["total"], 1)
        with g.LOCK, g.connect() as db:
            g.save_date(db, self.owner, "Photos", "a.jpg", "2020-10-21T15:30:00")
        dated = g.state(self.owner, ["Photos"])
        self.assertGreater(dated["revision"], start["revision"])
        with g.LOCK, g.connect() as db:
            g.save_date(db, self.owner, "Photos", "a.jpg", "2020-10-21T15:30:00")
        self.assertEqual(g.state(self.owner, ["Photos"])["revision"], dated["revision"])
        self.assertEqual(g.page(self.owner, ["Photos"], 0, 1)[0]["taken"], "2020-10-21T15:30:00")

    def test_external_add_delete_empty_and_acl_failure(self):
        self.scan(self.owner, "", [entry("a.jpg"),entry("Folder",True)])
        self.scan(self.owner, "Folder", [entry("old.png")])
        revision = g.state(self.owner, ["Photos"])["revision"]
        self.scan(self.owner, "", [entry("a.jpg"),entry("Folder",True),entry("new.png")])
        self.assertGreater(g.state(self.owner, ["Photos"])["revision"],revision)
        self.assertEqual(g.state(self.owner, ["Photos"])["total"],3)
        with g.LOCK,g.connect() as db:
            g.mark_folder_failed(db,self.owner,"Photos","Folder")
        self.assertEqual(len(g.page(self.owner, ["Photos"],0,20)),3,
                         "Inaccessible SMB folder must not erase its contents")
        self.scan(self.owner, "Folder", [])
        self.assertEqual(g.state(self.owner, ["Photos"])["total"],2,
                         "Successful empty listing must remove deleted files")
        self.scan(self.owner, "", [entry("new.png")])
        self.assertEqual(g.state(self.owner, ["Photos"])["total"],1,
                         "Deleting a folder must prune its descendants")
        self.assertNotIn("a.jpg", [x["name"] for x in g.page(self.owner,["Photos"],0,20)])
        self.assertEqual(g.state(self.other, ["Photos"])["total"],0)

    def test_upload_and_periodic_refresh_keep_existing_index_and_exif(self):
        self.assertTrue(g.record_upload(self.owner,"Photos","one.jpg",100,1792600000))
        self.assertTrue(g.record_upload(self.owner,"Photos","two.png",100,1792600001))
        with g.LOCK,g.connect() as db:
            g.save_date(db,self.owner,"Photos","one.jpg","2018-04-01T10:00:00")
            db.execute("UPDATE jobs SET complete=1,started=? WHERE owner=?",
                       (1000,self.owner))
            db.execute("UPDATE folders SET done=1 WHERE owner=?",(self.owner,))
        old = g.state(self.owner, ["Photos"])
        self.assertEqual(old["total"],2)
        # Calling state on a completed job schedules a directory-name refresh,
        # without dropping rows or re-reading EXIF in memory or on disk.
        with patch.object(g.time,"time",return_value=1000+10*60+1):
            after=g.state(self.owner, ["Photos"])
        self.assertFalse(after["complete"])
        self.assertGreaterEqual(after["pending"],1)
        self.assertEqual(after["total"],2)
        self.assertEqual(after["revision"],old["revision"])
        self.assertEqual(g.page(self.owner, ["Photos"],0,2)[1]["taken"],"2018-04-01T10:00:00")

    def test_legacy_database_migrates_revision_only(self):
        legacy = Path(self.temp.name)/"old.sqlite3"
        with sqlite3.connect(legacy) as db:
            db.execute("CREATE TABLE jobs(owner TEXT PRIMARY KEY, started REAL NOT NULL,"
                       "complete INTEGER NOT NULL DEFAULT 0,limited INTEGER NOT NULL DEFAULT 0)")
            db.execute("INSERT INTO jobs(owner,started,complete) VALUES (?,?,1)",
                       (self.owner,1792600000))
        g.DB=legacy
        result=g.state(self.owner,["Photos"])
        self.assertEqual(result["revision"],0)
        with sqlite3.connect(legacy) as db:
            cols=[x[1] for x in db.execute("PRAGMA table_info(jobs)")]
        self.assertIn("revision",cols)


if __name__=="__main__":
    unittest.main()
