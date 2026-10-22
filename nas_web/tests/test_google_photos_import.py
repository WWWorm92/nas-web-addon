"""Google import: Takeout ZIP metadata, dedupe, OAuth state and Picker guards."""
import io
import json
import os
import tempfile
import unittest
import urllib.parse
import zipfile
from pathlib import Path
from unittest.mock import patch

from app import gallery_index as g, google_photos_import as importer


class FakeEntry:
    def __init__(self, name, value):
        self.filename = name
        self.isDirectory = False
        self.file_size = len(value)
        self.last_write_time = 1730000000


class FakeSMB:
    def __init__(self):
        self.files = {}
        self.failed = False

    def listPath(self, share, path, **kwargs):
        self.assert_path(path)
        folder = path.rstrip("/")
        return [FakeEntry(p.split("/")[-1], b) for p, b in self.files.items()
                if p.startswith(folder + "/") and p.rsplit("/", 1)[0] == folder]

    def assert_path(self, path):
        assert path.startswith("/Photos"), path

    def storeFile(self, share, path, stream, **kwargs):
        self.assert_path(path)
        self.files[path] = b""
        while True:
            chunk = stream.read(4)
            if not chunk:
                break
            self.files[path] += chunk

    def rename(self, share, old, new):
        if new in self.files:
            raise ValueError("Would overwrite an existing SMB file")
        self.files[new] = self.files.pop(old)

    def deleteFiles(self, share, path):
        self.files.pop(path, None)


class GoogleImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.prev = (importer.DB, importer.KEY, importer.ARCHIVES, g.DB)
        importer.DB = Path(self.tmp.name) / "import.sqlite3"
        importer.KEY = Path(self.tmp.name) / "secret.key"
        importer.ARCHIVES = Path(self.tmp.name)
        g.DB = Path(self.tmp.name) / "gallery.sqlite3"

    def tearDown(self):
        importer.DB, importer.KEY, importer.ARCHIVES, g.DB = self.prev
        self.tmp.cleanup()

    def test_takeout_archive_dedupes_and_restores_index_date(self):
        archive = Path(self.tmp.name) / "takeout.zip"
        picture = b"jpeg-test-bytes"
        sidecar = json.dumps({"title": "IMG_0001.jpg",
                              "photoTakenTime": {"timestamp": "1689438227"}})
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("Takeout/Google Photos/A/IMG_0001.jpg", picture)
            z.writestr("Takeout/Google Photos/A/IMG_0001.jpg.supplemental-metadata.json", sidecar)
            z.writestr("Takeout/Google Photos/B/IMG_0001.jpg", picture)
            z.writestr("Takeout/Google Photos/B/IMG_0001.jpg.json", sidecar)
            z.writestr("../outside.jpg", b"do-not-import")
        smb = FakeSMB()
        job = importer.new_job("alice", "takeout", "Photo", "Photos")
        results = importer.process_takeout(archive, smb, "alice", "Photo", "Photos", job)
        self.assertEqual((results["imported"],results["skipped"],results["failed"]), (1,1,0))
        self.assertEqual(results["dated"],2)
        self.assertEqual(smb.files, {"/Photos/IMG_0001.jpg": picture})
        photo = g.page(g.key("alice"), ["Photo"], 0, 10)[0]
        self.assertEqual(photo["taken"], "2023-07-15T16:23:47")
        # Re-importing an identical ZIP never creates a duplicate.
        job2 = importer.new_job("alice", "takeout", "Photo", "Photos")
        repeated = importer.process_takeout(archive, smb, "alice", "Photo", "Photos", job2)
        self.assertEqual(repeated["imported"], 0)
        self.assertEqual(repeated["skipped"], 2)

    def test_takeout_truncated_sidecar_restores_existing_file_date(self):
        folder="Takeout/Google Photos/Screenshots/"
        filename="Screenshot_20231027_123303_Facebook.jpg"
        picture=b"original archived bytes"
        # Real newer Takeout: truncate the combined supplemental prefix,
        # not the media filename before appending the full JSON suffix.
        json_name=(filename+".supplemental-metadata")[:46]+".json"
        taken=json.dumps({"photoTakenTime":{"timestamp":"1689438227"}})
        archive=Path(self.tmp.name)/"old.zip"
        smb=FakeSMB()
        with zipfile.ZipFile(archive,"w") as z:
            z.writestr(folder+filename,picture)
        first=importer.new_job("alice","takeout","Photo","Photos")
        prior=importer.process_takeout(archive,smb,"alice","Photo","Photos",first)
        self.assertEqual(prior["imported"],1)
        self.assertEqual(prior["dated"],0)
        self.assertIsNone(g.page(g.key("alice"),["Photo"],0,10)[0]["taken"])
        self.assertIn(folder+json_name,
            importer.sidecar_candidates(zipfile.ZipInfo(folder+filename)))

        # The user re-uploads the same ZIP but metadata is now recognized.
        # SHA-256 dedupe should avoid even a temporary SMB store/write.
        with zipfile.ZipFile(archive,"w") as z:
            z.writestr(folder+filename,picture)
            z.writestr(folder+json_name,taken)
        def unexpected_store(*args,**kwargs):
            self.fail("Unchanged photo unexpectedly copied to SMB again")
        smb.storeFile=unexpected_store
        second=importer.new_job("alice","takeout","Photo","Photos")
        result=importer.process_takeout(archive,smb,"alice","Photo","Photos",second)
        self.assertEqual(result["skipped"],1)
        self.assertEqual(result["restored_dates"],1)
        self.assertEqual(result["dated"],1)
        self.assertEqual(result["failed"],0)
        self.assertEqual(g.page(g.key("alice"),["Photo"],0,10)[0]["taken"],
                         "2023-07-15T16:23:47")
        self.assertEqual(smb.files,{"/Photos/"+filename:picture})

    def test_error_report_lists_failed_files_but_never_other_users(self):
        archive=Path(self.tmp.name)/"errors.zip"
        with zipfile.ZipFile(archive,"w") as z:
            z.writestr("Takeout/Google Photos/one.jpg",b"broken")
            z.writestr("Takeout/Google Photos/two.jpg",b"good")
        smb=FakeSMB()
        store=smb.storeFile
        attempts=[0]
        def flaky(share,destination,stream,**kwargs):
            attempts[0]+=1
            if attempts[0]==1:
                raise RuntimeError("STATUS_ACCESS_DENIED")
            return store(share,destination,stream,**kwargs)
        smb.storeFile=flaky
        job=importer.new_job("alice","takeout","Photo","Photos")
        result=importer.process_takeout(archive,smb,"alice","Photo","Photos",job)
        self.assertEqual(result["failed"],1)
        self.assertEqual(result["imported"],1)
        errors=importer.failures_for("alice",job)
        self.assertEqual(errors["failed"],1)
        self.assertEqual(errors["categories"],{"SMB_ACCESS":1})
        self.assertEqual(errors["items"][0]["path"],"Takeout/Google Photos/one.jpg")
        self.assertNotIn("STATUS_ACCESS_DENIED",errors["items"][0]["message"])
        with self.assertRaises(ValueError):
            importer.failures_for("bob",job)

    def test_duplicate_takeout_sidecar_numbered_suffix(self):
        name="IMG_1305(1).jpg"
        candidates=importer.sidecar_candidates(zipfile.ZipInfo(
            "Takeout/Google Photos/2024/"+name))
        self.assertIn("Takeout/Google Photos/2024/IMG_1305.jpg.supplemental-metadata(1).json",
                      candidates)
        self.assertIn("Takeout/Google Photos/2024/IMG_1305.jpg(1).json",candidates)

    def test_oauth_state_is_one_use_encrypted_and_user_scoped(self):
        opts = {
            "google_client_id": "test-client",
            "google_client_secret": "test-secret",
            "google_redirect_uri": "https://nas.example.org/api/import/google/oauth/callback"
        }
        url = importer.oauth_url("alice", opts)
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(params["scope"], [importer.OAUTH_SCOPE])
        state = params["state"][0]
        with patch.object(importer, "_http_json", return_value={"refresh_token": "private-refresh"}):
            owner = importer.finish_oauth(state, "code", opts)
        self.assertEqual(owner, g.key("alice"))
        self.assertTrue(importer.is_connected(owner))
        self.assertNotIn(b"private-refresh", importer.DB.read_bytes())
        self.assertEqual(importer.KEY.stat().st_mode & 0o077, 0)
        with self.assertRaises(ValueError):
            importer.finish_oauth(state, "code", opts)
        self.assertFalse(importer.is_connected(g.key("bob")))
        importer.disconnect("alice")
        self.assertFalse(importer.is_connected(owner))

    def test_picker_media_url_rejects_ssrf(self):
        self.assertEqual(importer.media_url("https://lh3.googleusercontent.com/p/abc", False),
                         "https://lh3.googleusercontent.com/p/abc=d")
        self.assertEqual(importer.media_url("https://lh3.googleusercontent.com/p/abc", True),
                         "https://lh3.googleusercontent.com/p/abc=dv")
        for value in ("http://lh3.googleusercontent.com/x", "https://evil.com/f",
                      "https://lh3.googleusercontent.com.evil.org/x",
                      "https://a.googleusercontent.com@attacker.org/x",
                      "https://lh3.googleusercontent.com:9443/x",
                      "https://127.0.0.1/x"):
            with self.assertRaises(ValueError, msg=value):
                importer.media_url(value, False)

    def test_picker_requires_finished_session_and_paginates(self):
        with importer.connect() as db, db:
            db.execute("INSERT INTO picker_sessions VALUES (?,?,?,?)",
                       (g.key("alice"), "session-123", "https://photos.google.com/picker", 2000000000))
        calls = []
        def fake_json(url, token):
            calls.append(url)
            if "/sessions/" in url:
                return {"mediaItemsSet": True}
            if "pageToken=" in url:
                return {"mediaItems": [{"id": "2"}]}
            return {"mediaItems": [{"id": "1"}], "nextPageToken": "next"}
        with patch.object(importer, "access_token", return_value="user-token"), patch.object(
                importer, "_google_json", side_effect=fake_json):
            items = importer.picked_items("alice", {})
        self.assertEqual([r["id"] for r in items], ["1", "2"])
        self.assertTrue(all("session-123" in url for url in calls))

    def test_unsafe_names_and_bounded_reader(self):
        for value in ("..", "../secret.jpg", "photo?.jpg", "\x00photo.jpg"):
            if value == "../secret.jpg":
                self.assertEqual(importer.safe_filename(value), "secret.jpg")
            else:
                with self.assertRaises(ValueError):
                    importer.safe_filename(value)
        reader = importer.HashReader(io.BytesIO(b"12345"), max_bytes=4)
        with self.assertRaises(ValueError):
            reader.read(6)


if __name__ == "__main__":
    unittest.main()
