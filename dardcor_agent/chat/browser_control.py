from __future__ import annotations

import json
import base64
import os
import socket
import urllib.parse
import urllib.request
from typing import Any, Dict, List

from pydardcor.browser.chrome_launcher import AGENT_DEBUG_PORT, open_agent_chrome


CONTROL_BANNER_TEXT = "This browser is controlled by AI"


def controlled_banner_html() -> str:
    return (
        '<div id="dardcor-ai-browser-banner" '
        'style="position:fixed;top:0;left:0;right:0;z-index:2147483647;'
        'background:#3c0068;color:#fff;font:12px Segoe UI,sans-serif;'
        'padding:6px 10px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35)">'
        f"{CONTROL_BANNER_TEXT}</div>"
    )


def open_controlled_browser(url: str, *, debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    ok, message = open_agent_chrome(url, controlled=True, debug_port=debug_port)
    return {"ok": ok, "message": message, "url": url, "debug_port": debug_port}


def list_tabs(debug_port: int = AGENT_DEBUG_PORT) -> List[Dict[str, Any]]:
    endpoint = f"http://127.0.0.1:{debug_port}/json"
    with urllib.request.urlopen(endpoint, timeout=3) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
    return data if isinstance(data, list) else []


def observe_browser(debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    tabs = list_tabs(debug_port)
    if not tabs:
        return {"error": "No Chrome tabs found on debugging port.", "debug_port": debug_port}
    tab = tabs[0]
    return {
        "debug_port": debug_port,
        "title": tab.get("title", ""),
        "url": tab.get("url", ""),
        "type": tab.get("type", ""),
        "tabs": [
            {"title": t.get("title", ""), "url": t.get("url", ""), "type": t.get("type", "")}
            for t in tabs[:10]
        ],
    }


def open_debug_tab(url: str, debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    encoded = urllib.parse.quote(url, safe="")
    endpoint = f"http://127.0.0.1:{debug_port}/json/new?{encoded}"
    req = urllib.request.Request(endpoint, method="PUT")
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
    return {"debug_port": debug_port, "tab": data}


def _active_tab(debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    tabs = [tab for tab in list_tabs(debug_port) if tab.get("type") == "page"]
    if not tabs:
        raise RuntimeError("No page tab found on Chrome debugging port.")
    return tabs[0]


def _read_ws_frame(sock: socket.socket) -> str:
    first = sock.recv(2)
    if len(first) < 2:
        raise RuntimeError("WebSocket closed before response.")
    length = first[1] & 0x7F
    if length == 126:
        length = int.from_bytes(sock.recv(2), "big")
    elif length == 127:
        length = int.from_bytes(sock.recv(8), "big")
    payload = b""
    while len(payload) < length:
        payload += sock.recv(length - len(payload))
    return payload.decode("utf-8", errors="replace")


def _send_ws_text(sock: socket.socket, text: str) -> None:
    payload = text.encode("utf-8")
    mask = os.urandom(4)
    header = bytearray([0x81])
    if len(payload) < 126:
        header.append(0x80 | len(payload))
    elif len(payload) < 65536:
        header.extend([0x80 | 126, *len(payload).to_bytes(2, "big")])
    else:
        header.extend([0x80 | 127, *len(payload).to_bytes(8, "big")])
    masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
    sock.sendall(bytes(header) + mask + masked)


def _cdp_call(method: str, params: Dict[str, Any] | None = None, debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    return _cdp_call_many([(method, params or {})], debug_port)[0]


def _cdp_call_many(calls: List[tuple[str, Dict[str, Any]]], debug_port: int = AGENT_DEBUG_PORT) -> List[Dict[str, Any]]:
    tab = _active_tab(debug_port)
    ws_url = tab.get("webSocketDebuggerUrl")
    if not ws_url:
        raise RuntimeError("Chrome tab has no webSocketDebuggerUrl.")
    parsed = urllib.parse.urlparse(ws_url)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        f"GET {parsed.path} HTTP/1.1\r\n"
        f"Host: {parsed.hostname}:{parsed.port or debug_port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    with socket.create_connection((parsed.hostname or "127.0.0.1", parsed.port or debug_port), timeout=5) as sock:
        sock.sendall(request.encode("ascii"))
        response = sock.recv(4096)
        if b" 101 " not in response:
            raise RuntimeError("Chrome DevTools WebSocket handshake failed.")
        results = {}
        for idx, (method, params) in enumerate(calls, start=1):
            _send_ws_text(sock, json.dumps({"id": idx, "method": method, "params": params}))
        while len(results) < len(calls):
            data = json.loads(_read_ws_frame(sock))
            if data.get("id") in range(1, len(calls) + 1):
                results[data["id"]] = data
        return [results[idx] for idx in range(1, len(calls) + 1)]


def browser_eval(script: str, debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    return _cdp_call(
        "Runtime.evaluate",
        {"expression": script, "returnByValue": True, "awaitPromise": True},
        debug_port,
    )


def browser_click(x: int, y: int, debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    down, up = _cdp_call_many([
        ("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1}),
        ("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}),
    ], debug_port)
    return {"down": down, "up": up}


def browser_type(text: str, debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    script = (
        "(() => { const el = document.activeElement; "
        "if (!el) return false; "
        f"const text = {json.dumps(text)}; "
        "if ('value' in el) { el.value += text; el.dispatchEvent(new Event('input', {bubbles:true})); return true; } "
        "document.execCommand('insertText', false, text); return true; })()"
    )
    return browser_eval(script, debug_port)


def browser_screenshot(debug_port: int = AGENT_DEBUG_PORT) -> Dict[str, Any]:
    result = _cdp_call("Page.captureScreenshot", {"format": "png", "fromSurface": True}, debug_port)
    data = result.get("result", {}).get("data")
    if not data:
        return result

    from dardcor_agent.capabilities.storage import timestamped_path

    path = timestamped_path("screenshots", ".png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))
    return {"ok": True, "path": path, "debug_port": debug_port}

