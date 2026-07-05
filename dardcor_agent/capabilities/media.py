from __future__ import annotations

import base64
import json
import os
import urllib.request
from typing import Any, Dict

from .storage import timestamped_path


def _write_b64(kind: str, suffix: str, data_b64: str) -> str:
    path = timestamped_path(kind, suffix)
    with open(path, "wb") as f:
        f.write(base64.b64decode(data_b64))
    return path


def generate_image(prompt: str, *, api_key: str = "", base_url: str = "", model: str = "gpt-image-1") -> Dict[str, Any]:
    if not api_key or not base_url:
        return {"error": "Image generation requires a configured provider/API key."}
    payload = {"model": model, "prompt": prompt, "size": "1024x1024"}
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/images/generations",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    item = data.get("data", [{}])[0]
    if item.get("b64_json"):
        return {"path": _write_b64("images", ".png", item["b64_json"]), "model": model}
    return {"url": item.get("url", ""), "model": model}


def speech_to_text(path: str, *, api_key: str = "", base_url: str = "", model: str = "whisper-1") -> Dict[str, Any]:
    if not os.path.exists(path):
        return {"error": f"Audio file not found: {path}"}
    if not api_key or not base_url:
        return {"error": "Speech-to-text requires a configured provider/API key."}
    # ponytail: multipart without requests is verbose; keep boundary builder local.
    boundary = "----DardcorAudioBoundary"
    with open(path, "rb") as f:
        audio = f.read()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(path)}\"\r\n"
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8") + audio + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/audio/transcriptions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return {"text": data.get("text", ""), "model": model}


def text_to_speech(text: str, *, api_key: str = "", base_url: str = "", model: str = "gpt-4o-mini-tts", voice: str = "alloy") -> Dict[str, Any]:
    if not api_key or not base_url:
        return {"error": "Text-to-speech requires a configured provider/API key."}
    payload = {"model": model, "input": text, "voice": voice}
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/audio/speech",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        audio = resp.read()
    out = timestamped_path("tts", ".mp3")
    with open(out, "wb") as f:
        f.write(audio)
    return {"path": out, "model": model, "voice": voice}

