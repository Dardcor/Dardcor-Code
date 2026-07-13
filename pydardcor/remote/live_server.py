"""Live Server - HTTP file server with multi-root, HTTPS, and concurrency support."""

import functools
import http.server
import os
import ssl
import socket
import socketserver
import threading
import logging
from pathlib import Path
from urllib.parse import quote
from typing import Optional, List, Set

logger = logging.getLogger(__name__)

FRONTEND_EXTENSIONS: Set[str] = {
    ".html", ".htm", ".css", ".js", ".mjs", ".cjs",
    ".ts", ".jsx", ".tsx", ".vue", ".svelte", ".json",
    ".xml", ".svg", ".ico", ".png", ".jpg", ".jpeg", ".gif",
    ".webp", ".woff", ".woff2", ".ttf", ".eot",
}


def is_frontend_file(path: str) -> bool:
    return os.path.isfile(path) and Path(path).suffix.lower() in FRONTEND_EXTENSIONS


def resolve_serve_root(file_path: str, workspace_path: str | None = None,
                       workspace_roots: List[str] | None = None) -> str:
    """Pick the directory to serve (workspace root when possible, else file parent)."""
    file_path = os.path.abspath(file_path)

    if workspace_roots:
        for root in reversed(sorted(workspace_roots, key=len)):
            root = os.path.abspath(root)
            if os.path.isdir(root):
                try:
                    rel = os.path.relpath(file_path, root)
                    if not rel.startswith(".."):
                        return root
                except ValueError:
                    pass

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


def choose_free_port(preferred: int = 5500, max_attempts: int = 100) -> int:
    port = int(preferred)
    last_error = None
    for _ in range(max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError as e:
                last_error = e
                port += 1
    raise OSError(f"No free TCP port found in range {preferred}-{port-1}") from last_error


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def end_headers(self):
        self._send_cors_headers()
        super().end_headers()


class LiveServerManager:
    """Serve folders over HTTP on localhost with multi-root and HTTPS support."""

    def __init__(self):
        self._servers: dict = {}
        self._main_root: str | None = None
        self._main_port: int | None = None
        self._main_httpd: socketserver.ThreadingTCPServer | None = None
        self._main_thread: threading.Thread | None = None
        self._use_https: bool = False
        self._cert_path: str | None = None
        self._key_path: str | None = None

    @property
    def port(self) -> int | None:
        return self._main_port

    @property
    def root(self) -> str | None:
        return self._main_root

    def is_serving(self, root: str) -> bool:
        root = os.path.abspath(root)
        return self._main_httpd is not None and self._main_root == root

    def is_running(self) -> bool:
        return self._main_httpd is not None

    def enable_https(self, cert_path: str, key_path: str):
        """Enable HTTPS with provided certificate and key files."""
        if os.path.isfile(cert_path) and os.path.isfile(key_path):
            self._use_https = True
            self._cert_path = cert_path
            self._key_path = key_path

    def disable_https(self):
        self._use_https = False

    def start(self, root: str, preferred_port: int = 5500) -> int:
        root = os.path.abspath(root)
        if not os.path.isdir(root):
            raise FileNotFoundError(root)

        if self.is_serving(root):
            return self._main_port

        self.stop()
        port = choose_free_port(preferred_port)
        handler = functools.partial(_QuietHandler, directory=root)

        if self._use_https:
            httpd = socketserver.ThreadingTCPServer(("0.0.0.0", port), handler)
            httpd.socket = ssl.wrap_socket(
                httpd.socket,
                certfile=self._cert_path,
                keyfile=self._key_path,
                server_side=True,
            )
        else:
            httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler)

        httpd.daemon_threads = True
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()

        self._main_root = root
        self._main_port = port
        self._main_httpd = httpd
        self._main_thread = thread

        logger.info(f"Live Server started on port {port} serving {root}")
        return port

    def start_additional(self, root: str, preferred_port: int = 5600) -> int:
        """Start an additional server for a different root (multi-root)."""
        root = os.path.abspath(root)
        if not os.path.isdir(root):
            raise FileNotFoundError(root)
        port = choose_free_port(preferred_port)
        handler = functools.partial(_QuietHandler, directory=root)
        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler)
        httpd.daemon_threads = True
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self._servers[root] = {"httpd": httpd, "port": port, "thread": thread}
        return port

    def stop(self):
        if self._main_httpd:
            try:
                self._main_httpd.shutdown()
            except Exception:
                pass
            self._main_httpd.server_close()
        self._main_httpd = None
        self._main_thread = None
        self._main_root = None
        self._main_port = None
        self._use_https = False

        for root, server in list(self._servers.items()):
            try:
                server["httpd"].shutdown()
                server["httpd"].server_close()
            except Exception:
                pass
        self._servers.clear()

    def get_port_for_root(self, root: str) -> Optional[int]:
        if self._main_root == os.path.abspath(root):
            return self._main_port
        server = self._servers.get(os.path.abspath(root))
        return server["port"] if server else None

    def cleanup(self):
        self.stop()
