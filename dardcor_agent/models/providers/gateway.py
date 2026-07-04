"""Detect local AI gateway services (9Router, OpenCode, etc.)."""

from __future__ import annotations

import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class GatewayConfig:
    name: str
    base_url: str
    health_path: str = "/"
    port: Optional[int] = None


_GATEWAYS = (
    GatewayConfig("NineRouter", "http://localhost:20128/v1", "/v1/models", 20128),
    GatewayConfig("OpenCode", "https://opencode.ai/zen/v1", "/models", 443),
)


def _port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _http_reachable(url: str, timeout: float = 0.5) -> bool:
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, TimeoutError):
        return False


def detect_running_gateways(timeout: float = 0.5) -> Dict[str, bool]:
    """Return {gateway_name: reachable} without raising on failure."""
    result: Dict[str, bool] = {}
    for gw in _GATEWAYS:
        reachable = False
        if gw.port and gw.port != 443:
            reachable = _port_open("127.0.0.1", gw.port, timeout)
        if not reachable and gw.health_path:
            base = gw.base_url.rstrip("/")
            path = gw.health_path if gw.health_path.startswith("/") else f"/{gw.health_path}"
            reachable = _http_reachable(f"{base}{path}", timeout)
        result[gw.name] = reachable
    return result
