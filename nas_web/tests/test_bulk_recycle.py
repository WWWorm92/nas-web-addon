"""Fast SMB recycle batching and permanent gallery exclusion tests."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app import gallery_index as gallery, trash_batch


def file(name, directory=False, reparse=False):
    return SimpleNamespace(filename=name,isDirectory=directory,
                           isReparsePoint=reparse,file_size=42,
                           last_write_time=1740000000)


class FakeConn:
    def __init__(self):
        self.root={"Photo":file("Photo",True),".recycle":file(".recycle",True)}
        self.folder={"one.jpg":file("one.jpg"),
                     "folder":file("folder",True),
                     "two.jpg":file("two.jpg"),
                     "link":file("link",True,True)}
        self.trash={"one.jpg":file("one.jpg")}
        self.listed=[]
        self.renames=[]

    def listPath(self,share,path,timeout=30):
        self.listed.append(path)
        mapping={"/":self.root,"/Photos":self.folder,"/.recycle":self.trash}
        if path not in mapping:
            raise RuntimeError("unexpected SMB path "+path)
        return list(mapping[path].values())

    def createDirectory(self,share,path):
        if path!="/.recycle":
            raise RuntimeError("unsafe mkdir")
        self.trash={}
        self.root[".recycle"]=file(".recycle",True)

    def rename(self,share,src,dst):
        self.renames.append((src,dst))
        if src=="/Photos/two.jpg":
            raise RuntimeError("Connection closed")
        name=src.rsplit("/",1)[-1]
        if name not in self.folder:
            raise ValueError("nonexistent source")
        self.folder.pop(name)


class BulkRecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.previous=gallery.DB
        gallery.DB=Path(self.tmp.name)/"gallery.sqlite3"

    def tearDown(self):
        gallery.DB=self.previous
        self.tmp.cleanup()

    def test_bulk_lists_only_parent_root_and_recycle_once(self):
        conn=FakeConn()
        moved,failed=trash_batch.move_many(conn,"Photo","Photos",[
            {"name":"one.jpg","directory":False},
            {"name":"folder","directory":True},
            {"name":"two.jpg","directory":False},
            {"name":"link","directory":True},
            {"name":"missing.jpg","directory":False}
        ])
        self.assertEqual(conn.listed,["/Photos","/","/.recycle"])
        self.assertEqual(len(moved),2)
        self.assertEqual({x["path"] for x in moved},
                         {"Photos/one.jpg","Photos/folder"})
        self.assertEqual(len(failed),3)
        self.assertEqual(moved[0]["trash_name"].startswith("one ("),True)
        self.assertEqual(conn.renames[0][0],"/Photos/one.jpg")
        self.assertEqual(conn.renames[0][1].startswith("/.recycle/one ("),True)
        self.assertEqual(conn.renames[1][0],"/Photos/folder")

    def test_first_bulk_creates_recycle_without_recursive_delete(self):
        conn=FakeConn()
        del conn.root[".recycle"]
        moved,failed=trash_batch.move_many(conn,"Photo","Photos",[
            {"name":"folder","directory":True}
        ])
        self.assertEqual(len(moved),1)
        self.assertFalse(failed)
        self.assertEqual(conn.listed,["/Photos","/","/.recycle"])
        self.assertEqual(conn.renames,[("/Photos/folder","/.recycle/folder")])

    def test_recycle_excluded_from_new_gallery_scan_and_new_upload(self):
        owner=gallery.key("alice")
        with gallery.connect() as db:
            gallery.begin(db,owner,["Photo"])
            gallery.add_folder_contents(db,owner,"Photo","",
                                        [file(".recycle",True),file("Family",True)])
            self.assertEqual(
                [dict(row)["path"] for row in db.execute(
                    "SELECT path FROM folders WHERE owner=? AND path !=''",
                    (owner,))],["Family"])
            self.assertIsNone(gallery.pending_folder(db,owner) is None and
                              next(iter([]),None))
            gallery.add_folder_contents(db,owner,"Photo","Family",[file("real.jpg")])
        self.assertFalse(gallery.record_upload(owner,"Photo",".recycle/recycled.jpg",
                                               42,1740000000))
        self.assertEqual([p["path"] for p in gallery.page(owner,["Photo"],0,30)],
                         ["Family/real.jpg"])

    def test_migration_removes_old_recycle_rows_only(self):
        owner=gallery.key("alice")
        with gallery.connect() as db:
            db.execute("INSERT INTO jobs(owner,started) VALUES (?,1)",(owner,))
            for p in ("Family/real.jpg",".recycle/old.jpg",".recycle/Nested/deep.jpg"):
                parent,_,name=p.rpartition("/")
                db.execute(
                    "INSERT INTO photos(owner,share,path,folder,name,size,modified,sort_key) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (owner,"Photo",p,parent,name,10,1740000000,"2025-02-19"))
            db.execute("INSERT INTO folders(owner,share,path) VALUES (?,?,?)",
                       (owner,"Photo",".recycle"))
            db.execute("INSERT INTO folders(owner,share,path) VALUES (?,?,?)",
                       (owner,"Photo",".recycle/Nested"))
            db.execute("DELETE FROM index_migrations "
                       "WHERE name='exclude_recycle_from_gallery_02237'")
        with gallery.connect() as db:
            paths=[r["path"] for r in db.execute("SELECT path FROM photos")]
            folders=[r["path"] for r in db.execute("SELECT path FROM folders")]
        self.assertEqual(paths,["Family/real.jpg"])
        self.assertFalse(any(p.startswith(".recycle") for p in folders))
        self.assertEqual(gallery.state(owner,["Photo"])["total"],1)

    def test_move_paths_are_invalidated_for_all_profiles(self):
        with gallery.connect() as db:
            for user in ("alice","bob"):
                owner=gallery.key(user)
                db.execute("INSERT INTO jobs(owner,started) VALUES (?,1)",(owner,))
                for p in ("Albums/a.jpg","Albums/Nested/b.jpg","Other/c.jpg"):
                    folder,_,name=p.rpartition("/")
                    db.execute(
                        "INSERT INTO photos(owner,share,path,folder,name,size,modified,sort_key) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (owner,"Photo",p,folder,name,10,1740000000,"2025-02-19"))
                db.execute("INSERT INTO folders(owner,share,path) VALUES (?,?,?)",
                           (owner,"Photo","Albums"))
                db.execute("INSERT INTO folders(owner,share,path) VALUES (?,?,?)",
                           (owner,"Photo","Albums/Nested"))
        gallery.forget_moved_to_recycle("Photo",["Albums"])
        for user in ("alice","bob"):
            self.assertEqual([p["path"] for p in gallery.page(
                gallery.key(user),["Photo"],0,100)],["Other/c.jpg"])
            self.assertEqual(gallery.state(gallery.key(user),["Photo"])["revision"],1)


if __name__=="__main__":
    unittest.main()
