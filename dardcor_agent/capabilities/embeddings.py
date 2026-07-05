from __future__ import annotations

import hashlib
import json
import math
import os
import re
import urllib.request
from typing import Any, Dict, Iterable, List

from .storage import capability_dir


def local_embedding(text: str, *, dims: int = 256) -> List[float]:
    vec = [0.0] * dims
    for token in re.findall(r"\w+", text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % dims
        sign = 1.0 if digest[4] % 2 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


def create_embedding(text: str, *, provider: str = "local", api_key: str = "", base_url: str = "", model: str = "") -> Dict[str, Any]:
    if provider == "local" or not api_key or not base_url:
        vector = local_embedding(text)
        return {"provider": "local", "model": "hashing-256", "dimensions": len(vector), "embedding": vector}

    payload = {"input": text, "model": model or "text-embedding-3-small"}
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/embeddings",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    vector = data.get("data", [{}])[0].get("embedding", [])
    return {"provider": provider, "model": payload["model"], "dimensions": len(vector), "embedding": vector}


def save_embedding(name: str, result: Dict[str, Any]) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name).strip("-") or "embedding"
    path = os.path.join(capability_dir("embeddings"), f"{safe}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    return path

