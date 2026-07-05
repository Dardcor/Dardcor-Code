from __future__ import annotations

import html
import ipaddress
import json
import re
import socket
import urllib.parse
import urllib.request
from typing import Any, Dict, List


def _is_private_host(hostname: str) -> bool:
    if not hostname:
        return True
    if hostname in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        infos = socket.getaddrinfo(hostname, None)
    except Exception:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except Exception:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            return True
    return False


def assert_public_url(url: str, *, allow_local: bool = False) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only http/https URLs are supported.")
    if not allow_local and _is_private_host(parsed.hostname or ""):
        raise ValueError("Local/private URLs are blocked unless allow_local is true.")
    return url


def web_fetch(url: str, *, allow_local: bool = False, max_chars: int = 12000) -> Dict[str, Any]:
    assert_public_url(url, allow_local=allow_local)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "DardcorCode/1.0",
            "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = resp.read(min(max_chars * 4, 2_000_000))
        content_type = resp.headers.get("content-type", "")
    text = raw.decode("utf-8", errors="replace")
    if "html" in content_type:
        text = re.sub(r"(?is)<script.*?</script>|<style.*?</style>", " ", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return {"url": url, "content_type": content_type, "text": text[:max_chars]}


def web_search(query: str, *, max_results: int = 5) -> Dict[str, Any]:
    # Stdlib-only fallback via DuckDuckGo instant answer. Full web search can be
    # provided later by provider-specific paid APIs.
    params = urllib.parse.urlencode({"q": query, "format": "json", "no_redirect": "1", "no_html": "1"})
    url = f"https://api.duckduckgo.com/?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "DardcorCode/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
    results: List[Dict[str, str]] = []
    abstract = data.get("AbstractText") or data.get("Heading")
    if abstract:
        results.append({"title": data.get("Heading", "DuckDuckGo"), "url": data.get("AbstractURL", ""), "snippet": abstract})
    for item in data.get("RelatedTopics", []):
        if len(results) >= max_results:
            break
        if isinstance(item, dict) and item.get("Text"):
            results.append({"title": item.get("Text", "").split(" - ")[0], "url": item.get("FirstURL", ""), "snippet": item.get("Text", "")})
    return {"query": query, "results": results[:max_results], "source": "duckduckgo_instant_answer"}

