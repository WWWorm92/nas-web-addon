"""HEIC/HEIF: real encoded fixture through decoder, EXIF, SMB bounds and index."""
import importlib
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image
from app import heif_support, photo_dates, gallery_index


class FakeSMB:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def iter_range(self, share, path, start, length):
        self.requests.append((share, path, start, length))
        for offset in range(start, min(len(self.payload), start + length), 32768):
            yield self.payload[offset:min(offset+32768,start+length)]


class HEIFSupportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        exif = Image.Exif()
        exif[36867] = "2021:07:19 11:22:33"
        out = io.BytesIO()
        Image.new("RGB", (240, 120), (48, 91, 140)).save(
            out, format="HEIF", quality=75, exif=exif.tobytes())
        cls.payload = out.getvalue()
        assert cls.payload

    def test_decoder_and_exif(self):
        with Image.open(io.BytesIO(self.payload)) as image:
            self.assertEqual(image.size, (240, 120))
        self.assertEqual(photo_dates.parse_exif(io.BytesIO(self.payload)),
                         "2021-07-19T11:22:33")

    def test_bounded_heif_smb_metadata_read(self):
        smb = FakeSMB(self.payload)
        value = photo_dates.from_photo_file(smb, "Photo", "IMG_1.HEIC", len(self.payload))
        self.assertEqual(value, "2021-07-19T11:22:33")
        self.assertEqual(smb.requests, [("Photo", "/IMG_1.HEIC", 0, len(self.payload))])
        smb.requests.clear()
        value = photo_dates.from_photo_file(smb, "Photo", "IMG_1.HEIC",
                                           photo_dates.MAX_HEIF_EXIF_BYTES + 1)
        self.assertIsNone(value)
        self.assertEqual(smb.requests, [])

    def test_cached_webp_preview(self):
        # Test CI without creating /data; production uses the persistent add-on cache.
        with patch.object(Path, "mkdir"):
            from app import thumb_cache
        small = thumb_cache.render_image(io.BytesIO(self.payload))
        large = thumb_cache.render_image(io.BytesIO(self.payload), large=True)
        for data in (small, large):
            with Image.open(io.BytesIO(data)) as image:
                self.assertEqual(image.format, "WEBP")
                self.assertEqual(image.size, (240, 120))

    def test_gallery_discovery_and_original_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_db = gallery_index.DB
            gallery_index.DB = Path(tmp) / "gallery.sqlite3"
            try:
                owner = gallery_index.key("alice")
                entries = [
                    SimpleNamespace(filename="IMG_1.HEIC",isDirectory=False,
                                    file_size=len(self.payload),last_write_time=1720000000),
                    SimpleNamespace(filename="IMG_2.heif",isDirectory=False,
                                    file_size=len(self.payload),last_write_time=1720000001),
                ]
                with gallery_index.LOCK, gallery_index.connect() as db:
                    gallery_index.begin(db, owner, ["Photo"])
                    gallery_index.add_folder_contents(db, owner, "Photo", "", entries)
                    row = gallery_index.next_unchecked(db, owner, ["Photo"])
                    self.assertIsNotNone(row)
                    gallery_index.save_date(db, owner, "Photo", "IMG_1.HEIC",
                                            "2021-07-19T11:22:33")
                self.assertEqual(gallery_index.state(owner, ["Photo"])["total"], 2)
                self.assertEqual(gallery_index.state(owner, ["Photo"])["dates_pending"], 1)
                self.assertTrue(any(p["name"] == "IMG_1.HEIC" and
                                    p["taken"] == "2021-07-19T11:22:33"
                                    for p in gallery_index.page(owner, ["Photo"], 0, 10)))
            finally:
                gallery_index.DB = original_db


if __name__ == "__main__":
    unittest.main()
