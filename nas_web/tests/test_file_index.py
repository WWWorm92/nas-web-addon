"""Regression tests: independent SMB filename index and account isolation."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from app import file_index as idx


def item(name, directory=False, size=20, modified=100, reparse=False):
    return SimpleNamespace(
        filename=name, isDirectory=directory, file_size=size,
        last_write_time=modified, isReparsePoint=reparse,
    )


class FileIndexTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=idx.DB
        idx.DB=Path(self.tmp.name)/"files.sqlite3"
        self.owner="alice"
        self.shares=["Photos","Documents"]

    def tearDown(self):
        idx.DB=self.old
        self.tmp.cleanup()

    def test_incremental_discovery_and_scoped_search(self):
        status=idx.state(self.owner,self.shares)
        self.assertEqual(status["pending"],2)
        self.assertFalse(status["complete"])
        idx.record_folder(self.owner,"Photos","",[
            item("Trips",True),item("IMG_0001.JPG",size=100),
            item("video.MOV",size=200),item(".recycle",True),
            item("link",True,reparse=True)])
        idx.record_folder(self.owner,"Documents","",[
            item("Документы",True),item("Report.pdf"),item("cost_100%.txt"),
            item("cost_100A.txt"),item("alpha_beta.docx"),item("alphaXbeta.docx")])
        idx.record_folder(self.owner,"Photos","Trips",[item("Summer 2025.png",size=400)])
        idx.record_folder(self.owner,"Documents","Документы",[item("ДОГОВОР.pdf")])
        self.assertTrue(idx.finish_if_done(self.owner,self.shares))
        s=idx.state(self.owner,self.shares)
        self.assertTrue(s["complete"])
        self.assertEqual(s["pending"],0)
        self.assertEqual(len(idx.search("alice",self.shares,"img","photo")),1)
        self.assertEqual(len(idx.search("alice",self.shares,"2025","photo")),1)
        self.assertEqual(len(idx.search("alice",self.shares,"video","video")),1)
        self.assertEqual(len(idx.search("alice",self.shares,"report","document")),1)
        self.assertEqual(len(idx.search("alice",self.shares,"договор","document")),1)
        self.assertEqual(len(idx.search("alice",self.shares,"документы","folder")),1)
        self.assertEqual(len(idx.search("alice",self.shares,"cost_100%")),1)
        self.assertEqual(len(idx.search("alice",self.shares,"alpha_beta")),1)
        self.assertEqual(len(idx.search("alice",["Documents"],"img")),0)
        self.assertEqual(len(idx.search("bob",self.shares,"img")),0)
        self.assertEqual(len(idx.search("alice",self.shares,".recycle")),0)

    def test_refresh_keeps_existing_hits_until_relisted(self):
        idx.state(self.owner,["Photos"])
        idx.record_folder(self.owner,"Photos","",[item("First",True),item("keep.jpg")])
        idx.record_folder(self.owner,"Photos","First",[item("removed.pdf")])
        self.assertTrue(idx.finish_if_done(self.owner,["Photos"]))
        idx.refresh(self.owner,["Photos"])
        self.assertEqual(len(idx.search(self.owner,["Photos"],"removed")),1)
        # Failed SMB listings never wipe old, previously authorized metadata.
        idx.record_folder(self.owner,"Photos","",failed=True)
        self.assertEqual(len(idx.search(self.owner,["Photos"],"keep")),1)
        idx.record_folder(self.owner,"Photos","First",failed=True)
        self.assertEqual(idx.state(self.owner,["Photos"])["errors"],2)
        idx.refresh(self.owner,["Photos"])
        idx.record_folder(self.owner,"Photos","",[item("new.jpg")])
        self.assertFalse(idx.search(self.owner,["Photos"],"removed"))
        self.assertFalse(idx.search(self.owner,["Photos"],"keep"))
        self.assertEqual(len(idx.search(self.owner,["Photos"],"new")),1)
        self.assertTrue(idx.finish_if_done(self.owner,["Photos"]))

    def test_file_type_folders_and_limits(self):
        idx.state(self.owner,["Photos"])
        idx.record_folder(self.owner,"Photos","",[item("f1.txt"),item("f2.txt")])
        self.assertEqual(len(idx.search(self.owner,["Photos"],"f",offset=1,limit=1)),1)
        self.assertEqual(len(idx.search(self.owner,[],"f")),0)
        prev=idx.MAX_ENTRIES
        try:
            idx.MAX_ENTRIES=3
            idx.record_folder(self.owner,"Photos","",[
                item("f1.txt"),item("f2.txt"),item("f3.txt"),item("f4.txt")])
            self.assertTrue(idx.state(self.owner,["Photos"])["limited"])
            self.assertFalse(idx.search(self.owner,["Photos"],"f4"))
        finally:
            idx.MAX_ENTRIES=prev


if __name__=="__main__":
    unittest.main()
