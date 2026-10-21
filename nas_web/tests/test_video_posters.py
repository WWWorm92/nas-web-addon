"""Bounded video thumbnail extraction: untrusted input and SMB safety."""
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from app import video_posters as p


class VideoPosterTests(unittest.TestCase):
    def test_extension_limit(self):
        for path in ("file.mp4", "A.MOV", "abc.webm", "A.m4v"):
            self.assertTrue(p.is_supported(path))
        for path in ("file.mp3", "photo.jpg", "noext", "song.ogg", "a.mp4.exe"):
            self.assertFalse(p.is_supported(path))

    def test_bounded_smb_prefix(self):
        conn=Mock()
        conn.iter_range.return_value=iter([b"a"*200,b"b"*150])
        content=p.read_prefix(conn,"Photos","clip.mp4",350)
        self.assertEqual(len(content),350)
        conn.iter_range.assert_called_once_with("Photos","/clip.mp4",0,350)
        conn.iter_range.reset_mock()
        conn.iter_range.return_value=iter([b"a"*p.MAX_PREFIX,b"!"])
        with self.assertRaises(p.PosterUnavailable):
            p.read_prefix(conn,"Photos","oversized.mov",p.MAX_PREFIX)
        conn.iter_range.assert_called_once_with("Photos","/oversized.mov",0,p.MAX_PREFIX)
        with self.assertRaises(p.PosterUnavailable):
            p.read_prefix(conn,"Photos","short.mp4",10)

    def test_single_frame_short_ffmpeg_and_thumbnail_transform(self):
        result=Mock(returncode=0,stdout=b"x"*100,stderr=b"")
        with patch.object(p.subprocess,"run",return_value=result) as run, \
             patch.object(p.thumb_cache,"render_image",return_value=b"webp") as render:
            data=p.extract_prefix(b"a"*1024)
        self.assertEqual(data,b"webp")
        self.assertEqual(run.call_count,1)
        args,kwargs=run.call_args
        self.assertEqual(kwargs["timeout"],p.MAX_SECONDS)
        self.assertLessEqual(len(kwargs["input"]),p.MAX_PREFIX)
        self.assertIn("pipe:0",args[0])
        self.assertIn("-frames:v",args[0])
        self.assertEqual(args[0][args[0].index("-frames:v")+1],"1")
        render.assert_called_once()

    def test_fail_closed_if_unsupported_or_timeout(self):
        with self.assertRaises(p.PosterUnavailable):
            p.extract_prefix(b"short")
        with patch.object(p.subprocess,"run",return_value=Mock(returncode=1,stdout=b"")):
            with self.assertRaises(p.PosterUnavailable):
                p.extract_prefix(b"a"*256)
        with patch.object(p.subprocess,"run",side_effect=subprocess.TimeoutExpired("ffmpeg",12)):
            with self.assertRaises(p.PosterUnavailable):
                p.extract_prefix(b"a"*256)
        with patch.object(p.subprocess,"run",return_value=Mock(returncode=0,stdout=b"x"*1024*1025)):
            with self.assertRaises(p.PosterUnavailable):
                p.extract_prefix(b"a"*256)

    def test_negative_cache_is_bounded_and_expires(self):
        p.BAD.clear()
        with patch.object(p.time,"monotonic",return_value=1000):
            p.mark_unavailable("bad")
            self.assertTrue(p.blocked("bad"))
        with patch.object(p.time,"monotonic",return_value=1000+p.BAD_TTL+1):
            self.assertFalse(p.blocked("bad"))
        p.BAD.clear()


if __name__=="__main__":
    unittest.main()
