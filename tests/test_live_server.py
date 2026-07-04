import os
import shutil
import tempfile
import unittest
import urllib.request

from pydardcor.remote.live_server import (
    LiveServerManager,
    choose_free_port,
    is_frontend_file,
    localhost_url,
    resolve_serve_root,
)


class TestLiveServerHelpers(unittest.TestCase):
    def test_is_frontend_file_recognizes_html(self):
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tmp:
            path = tmp.name
        try:
            self.assertTrue(is_frontend_file(path))
            self.assertFalse(is_frontend_file(__file__))
        finally:
            os.unlink(path)

    def test_localhost_url_encodes_path(self):
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, "pages", "index.html")
            os.makedirs(os.path.dirname(nested), exist_ok=True)
            with open(nested, "w", encoding="utf-8") as f:
                f.write("<html></html>")
            url = localhost_url(root, nested, 5500)
            self.assertEqual(url, "http://localhost:5500/pages/index.html")

    def test_resolve_serve_root_prefers_workspace(self):
        with tempfile.TemporaryDirectory() as ws:
            nested = os.path.join(ws, "public", "index.html")
            os.makedirs(os.path.dirname(nested), exist_ok=True)
            with open(nested, "w", encoding="utf-8") as f:
                f.write("<html></html>")
            self.assertEqual(resolve_serve_root(nested, ws), ws)

    def test_resolve_serve_root_falls_back_to_parent(self):
        with tempfile.TemporaryDirectory() as ws:
            nested = os.path.join(ws, "index.html")
            with open(nested, "w", encoding="utf-8") as f:
                f.write("<html></html>")
            other = tempfile.mkdtemp()
            try:
                outside = os.path.join(other, "page.html")
                with open(outside, "w", encoding="utf-8") as f:
                    f.write("<html></html>")
                self.assertEqual(resolve_serve_root(outside, ws), other)
            finally:
                shutil.rmtree(other)

    def test_choose_free_port_returns_bindable_port(self):
        port = choose_free_port(5500)
        self.assertGreaterEqual(port, 5500)


class TestLiveServerManager(unittest.TestCase):
    def test_start_serves_file_and_reuses_same_root(self):
        manager = LiveServerManager()
        with tempfile.TemporaryDirectory() as root:
            page = os.path.join(root, "hello.html")
            with open(page, "w", encoding="utf-8") as f:
                f.write("<html><body>ok</body></html>")
            port = manager.start(root, preferred_port=5500)
            self.assertTrue(manager.is_serving(root))
            again = manager.start(root, preferred_port=5500)
            self.assertEqual(port, again)
            url = localhost_url(root, page, port)
            with urllib.request.urlopen(url, timeout=3) as resp:
                body = resp.read().decode("utf-8")
            self.assertIn("ok", body)
        manager.stop()
        self.assertIsNone(manager.port)


if __name__ == "__main__":
    unittest.main()
