"""Small Live Server helpers and manager, kept UI-free for tests."""

import functools
import http.server
import os
import socket
import socketserver
import threading
from pathlib import Path
from urllib.parse import quote


FRONTEND_EXTENSIONS = {".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".vue"}


def is_frontend_file(path: str) -> bool:
    return os.path.isfile(path) and Path(path).suffix.lower() in FRONTEND_EXTENSIONS


def resolve_serve_root(file_path: str, workspace_path: str | None = None) -> str:
    """Pick the directory to serve (workspace root when possible, else file parent)."""
    file_path = os.path.abspath(file_path)
    if workspace_path and os.path.isdir(workspace_path):
        workspace_path = os.path.abspath(workspace_path)
        try:
            rel = os.path.relpath(file_path, workspace_path)
            if not rel.startswith(".."):
                return workspace_path
        except ValueError:
            pass
    return os.path.dirname(file_path)


def localhost_url(root: str, file_path: str, port: int) -> str:
    rel = os.path.relpath(file_path, root).replace(os.sep, "/")
    return f"http://localhost:{port}/{quote(rel)}"


def choose_free_port(preferred: int = 5500) -> int:
    port = int(preferred)
    while port <= 65535:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    raise OSError("No free TCP port found")


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


class LiveServerManager:
    """Serve a folder over HTTP on localhost, reusing an existing server for the same root."""

    def __init__(self):
        self._root: str | None = None
        self._port: int | None = None
        self._httpd: socketserver.ThreadingTCPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int | None:
        return self._port

    @property
    def root(self) -> str | None:
        return self._root

    def is_serving(self, root: str) -> bool:
        root = os.path.abspath(root)
        return self._httpd is not None and self._root == root

    def start(self, root: str, preferred_port: int = 5500) -> int:
        root = os.path.abspath(root)
        if not os.path.isdir(root):
            raise FileNotFoundError(root)
        if self.is_serving(root):
            return self._port

        self.stop()
        port = choose_free_port(preferred_port)
        handler = functools.partial(_QuietHandler, directory=root)
        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler)
        httpd.daemon_threads = True
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self._root = root
        self._port = port
        self._httpd = httpd
        self._thread = thread
        return port

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
        self._httpd = None
        self._thread = None
        self._root = None
        self._port = None
