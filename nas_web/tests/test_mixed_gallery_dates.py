"""Regression for mixed EXIF/mtime chronology and accurate month jump offsets."""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from app import gallery_index as g


def epoch(iso):
    return datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp()


class MixedGalleryDates(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=g.DB
        g.DB=Path(self.tmp.name)/"gallery.sqlite3"
        self.owner=g.key("photo-reader")
        with g.LOCK,g.connect() as db:
            g.begin(db,self.owner,["Photos","Private"])
        self.add("vacation.jpg","Photos","2023-08-10T09:00:00","2024-11-02T14:00:00")
        self.add("Glitched Waveform Over a Fogbound Mountain Valley.png",
                 "Photos","2026-10-21T11:09:50",None)
        self.add("summer.jpg","Photos","2025-07-04T09:00:00","2019-04-03T12:00:00")
        self.add("winter.webp","Photos","2024-02-01T15:00:00",None)
        self.add("secret.png","Private","2026-12-01T10:00:00",None)

    def tearDown(self):
        g.DB=self.old
        self.tmp.cleanup()

    def add(self,name,share,modified,taken):
        g.record_upload(self.owner,share,name,123,epoch(modified))
        if taken:
            with g.LOCK,g.connect() as db:
                g.save_date(db,self.owner,share,name,taken)

    def test_mixed_order_photo_without_exif_is_first(self):
        rows=g.page(self.owner,["Photos"],0,90,"taken",0)
        self.assertEqual([r["name"] for r in rows],[
            "Glitched Waveform Over a Fogbound Mountain Valley.png",
            "vacation.jpg","winter.webp","summer.jpg"])
        self.assertIsNone(rows[0]["taken"])
        self.assertEqual(g.state(self.owner,["Photos"])["total"],4)

    def test_calendar_offsets_match_actual_pages(self):
        months=g.month_index(self.owner,["Photos"],"taken",0)
        self.assertEqual([(m["month"],m["offset"],m["count"]) for m in months],[
            ("2026-10",0,1),("2024-11",1,1),("2024-02",2,1),
            ("2019-04",3,1)])
        for row in months:
            hit=g.page(self.owner,["Photos"],row["offset"],1,"taken",0)[0]
            actual=hit["taken"][:7] if hit["taken"] else datetime.fromtimestamp(
                hit["modified"],timezone.utc).strftime("%Y-%m")
            self.assertEqual(row["month"],actual)
        self.assertNotIn("undated",[x["month"] for x in months])

    def test_timezone_and_acl(self):
        # Modified at 00:30 UTC belongs to previous month at UTC-02.
        self.add("near-midnight.png","Photos","2024-07-01T00:30:00",None)
        local=g.month_index(self.owner,["Photos"],"taken",120)
        self.assertIn("2024-06",[m["month"] for m in local])
        names=[x["name"] for x in g.page(self.owner,["Photos"],0,20,"taken",120)]
        self.assertNotIn("secret.png",names)
        self.assertEqual(g.page(self.owner,[],0,10,"taken",120),[])
        self.assertEqual(g.month_index(g.key("other"),["Photos"],"taken",120),[])

    def test_record_upload_keeps_existing_metadata(self):
        before=g.state(self.owner,["Photos"])
        self.add("another-new.png","Photos","2026-10-21T14:00:00",None)
        after=g.state(self.owner,["Photos"])
        self.assertEqual(after["total"],before["total"]+1)
        self.assertEqual(g.page(self.owner,["Photos"],0,1)[0]["name"],"another-new.png")
        with g.LOCK,g.connect() as db:
            dated=db.execute("SELECT taken FROM photos WHERE owner=? AND name='vacation.jpg'",
                             (self.owner,)).fetchone()[0]
        self.assertEqual(dated,"2024-11-02T14:00:00")


if __name__=="__main__":
    unittest.main()
