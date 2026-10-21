"""Regression tests for PDF embedding without weakening page protection."""
import unittest
from types import SimpleNamespace
from app import pdf_frame_policy as policy


class Headers(dict):
    def get(self, key, default=None):
        for k, value in self.items():
            if k.casefold() == key.casefold():
                return value
        return default


def response(mime="application/pdf",
             disposition="inline; filename*=UTF-8''report.pdf", status=200):
    return SimpleNamespace(status_code=status, headers=Headers({
        "Content-Type": mime,
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store"
    }))


class PdfFrameTests(unittest.TestCase):
    def test_same_origin_pdf_preview_and_ranges(self):
        for status in (200, 206):
            with self.subTest(status=status):
                r = response(status=status)
                self.assertTrue(policy.permitted_inline_pdf("/api/file", r))
                policy.apply_headers("/api/file", r)
                self.assertEqual(r.headers["X-Frame-Options"], "SAMEORIGIN")
                self.assertIn("frame-ancestors 'self'", r.headers["Content-Security-Policy"])
                self.assertNotIn("frame-ancestors 'none'", r.headers["Content-Security-Policy"])
                self.assertIn("object-src 'none'", r.headers["Content-Security-Policy"])
                self.assertEqual(r.headers["Cache-Control"], "private, no-store")

    def test_other_routes_downloads_errors_and_types_denied(self):
        cases = [
            ("/", response()), ("/admin", response()),
            ("/api/thumb", response()), ("/api/photo", response()),
            ("/api/file", response(disposition="attachment; filename=report.pdf")),
            ("/api/file", response(mime="image/png")),
            ("/api/file", response(mime="text/html")),
            ("/api/file", response(mime="application/octet-stream")),
            ("/api/file", response(status=401)),
            ("/api/file", response(status=403)),
            ("/api/file", response(status=404)),
            ("/api/file", response(status=416)),
        ]
        for path, r in cases:
            with self.subTest(path=path, status=r.status_code,
                              disposition=r.headers.get("Content-Disposition")):
                policy.apply_headers(path, r)
                self.assertEqual(r.headers["X-Frame-Options"], "DENY")
                self.assertIn("frame-ancestors 'none'", r.headers["Content-Security-Policy"])

    def test_robust_case_and_charset(self):
        r = response(mime="APPLICATION/PDF; charset=binary",
                     disposition="INLINE; filename=report.pdf")
        policy.apply_headers("/api/file", r)
        self.assertEqual(r.headers["X-Frame-Options"], "SAMEORIGIN")


if __name__ == "__main__":
    unittest.main()
