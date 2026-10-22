"""Profile ownership and shared gallery visibility regression tests."""
import tempfile
import unittest
from pathlib import Path

from app import gallery_index as g, profiles


class ProfileVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_db = g.DB
        g.DB = Path(self.tmp.name) / "gallery.sqlite3"
        with g.connect() as db:
            for username in ("alice", "bob"):
                owner = g.key(username)
                db.execute(
                    "INSERT INTO jobs(owner,started,complete,revision) VALUES (?,1,1,0)", (owner,)
                )
                for path, taken in [
                    ("Alice/photo1.jpg", "2024-01-01T12:00:00"),
                    ("Alice/Travel/photo2.jpg", "2024-01-02T12:00:00"),
                    ("Bob/photo3.jpg", "2024-02-01T12:00:00"),
                    ("Alice-similar/photo4.jpg", "2024-02-02T12:00:00"),
                ]:
                    db.execute(
                        "INSERT INTO photos(owner,share,path,folder,name,size,modified,taken,exif_checked,sort_key) "
                        "VALUES (?,?,?,?,?,?,?, ?,1,?)",
                        (owner, "Photo", path, path.rsplit("/", 1)[0],
                         path.rsplit("/", 1)[-1], 10, 1700000000, taken, taken),
                    )

    def tearDown(self):
        g.DB = self.original_db
        self.tmp.cleanup()

    def names(self, username):
        return {item["path"] for item in
                g.page(g.key(username), ["Photo"], 0, 100)}

    def test_folder_visibility_changes_both_users_without_reindex(self):
        profiles.bind("alice", "Photo", "Alice")
        profiles.bind("bob", "Photo", "Bob")
        self.assertEqual(len(self.names("bob")), 4)
        profiles.set_visibility("alice", "Photo", "Alice", False)
        for username in ("alice", "bob"):
            self.assertEqual(self.names(username),
                             {"Bob/photo3.jpg", "Alice-similar/photo4.jpg"})
            self.assertEqual(g.state(g.key(username), ["Photo"])["total"], 2)
            self.assertEqual(sum(m["count"] for m in g.month_index(
                g.key(username), ["Photo"])), 2)
        self.assertEqual(g.state(g.key("bob"), ["Photo"])["revision"], 3)
        profiles.set_visibility("alice", "Photo", "Alice", True)
        self.assertEqual(len(self.names("bob")), 4)
        profiles.set_visibility("alice", "Photo", "Alice", False)
        profiles.unbind("alice", "Photo", "Alice")
        self.assertEqual(len(self.names("bob")), 4)

    def test_hidden_folder_does_not_remove_pending_exif_work(self):
        """The visible UI may say 0 remaining, while hidden photos still need EXIF."""
        owner = g.key("alice")
        target = "Alice/unchecked.jpg"
        # Add a unique pending photo: existing fixture photos share known dates
        # with another owner, and shared-metadata reuse would complete those
        # checks automatically before the background worker sees them.
        with g.connect() as db:
            db.execute(
                "INSERT INTO photos(owner,share,path,folder,name,size,modified,"
                "taken,exif_checked,sort_key) VALUES (?,?,?,?,?,?,?,NULL,0,?)",
                (owner, "Photo", target, "Alice", "unchecked.jpg",
                 10, 1700000000, "2023-11-14T22:13:20"))
        profiles.bind("alice", "Photo", "Alice")
        profiles.set_visibility("alice", "Photo", "Alice", False)

        # The public gallery and its counters respect profile visibility.
        self.assertNotIn(target, self.names("alice"))
        self.assertEqual(g.state(owner, ["Photo"])["dates_available"], 0)

        # The worker must query photos (not visible_photos) for unfinished EXIF.
        with g.connect() as db:
            entry = g.next_unchecked(db, owner, ["Photo"])
            self.assertIsNotNone(entry)
            self.assertEqual(entry["path"], target)
            g.save_date(db, owner, "Photo", target, "2018-07-02T13:00:00")

        # No hidden photo leaks into the gallery while it is disabled.
        self.assertNotIn(target, self.names("alice"))
        profiles.set_visibility("alice", "Photo", "Alice", True)
        result = next(p for p in g.page(owner, ["Photo"], 0, 20)
                      if p["path"] == target)
        self.assertEqual(result["taken"], "2018-07-02T13:00:00")

    def test_background_worker_stops_only_when_real_exif_queue_empty(self):
        """Ensure the worker termination criterion includes hidden folders."""
        source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()
        part = source.split("def _gallery_background(", 1)[1].split(
            "\n\nGALLERY_BACKGROUND_LOCK", 1)[0]
        self.assertNotIn('if state["complete"] and not state["dates_available"]', part)
        self.assertIn("gallery_index.next_unchecked(db, owner, shares, skipped)", part)
        self.assertIn("if remaining is None:", part)

    def test_ownership_overlap_and_authorization(self):
        profiles.bind("alice", "Photo", "Alice")
        with self.assertRaises(ValueError):
            profiles.bind("bob", "Photo", "Alice/Travel")
        with self.assertRaises(ValueError):
            profiles.bind("bob", "Photo", "Alice")
        with self.assertRaises(PermissionError):
            profiles.set_visibility("bob", "Photo", "Alice", False)
        with self.assertRaises(PermissionError):
            profiles.unbind("bob", "Photo", "Alice")
        with self.assertRaises(ValueError):
            profiles.bind("alice", "Photo", "")
        with self.assertRaises(ValueError):
            profiles.set_visibility("alice", "Photo", "Alice", "false")

    def test_edit_profile_does_not_change_login_or_index(self):
        profiles.update("alice", "Alice A.", "#7a72cf")
        user = profiles.get("alice", ["Photo"])
        self.assertEqual(user["username"], "alice")
        self.assertEqual(user["display_name"], "Alice A.")
        self.assertEqual(user["avatar_color"], "#7a72cf")
        self.assertEqual(len(self.names("alice")), 4)
        with self.assertRaises(ValueError):
            profiles.update("alice", "", "#7a72cf")
        with self.assertRaises(ValueError):
            profiles.update("alice", "Alice", "red")


if __name__ == "__main__":
    unittest.main()
