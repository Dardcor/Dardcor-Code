"""Pure helpers for provider card labels and key status (no Qt dependency)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Sequence, Tuple


DEFAULT_MODELS_PAGE_SIZE = 12


def registry_config_path(provider_name: str) -> str:
    from pydardcor.core.config import get_user_data_dir
    return os.path.join(get_user_data_dir(), "database", "models", provider_name, "config.json")


def load_registry_provider_config(provider_name: str) -> dict:
    path = registry_config_path(provider_name)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"api_key": "", "base_url": "", "selected_model": "", "auth_mode": "api_key"}


def save_registry_provider_config(provider_name: str, data: dict) -> None:
    path = registry_config_path(provider_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data.setdefault("provider", provider_name.lower())
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def count_free_models(provider_def: Dict[str, Any]) -> int:
    count = 0
    for model in provider_def.get("models", []):
        name = str(model.get("name", "")).lower()
        model_id = str(model.get("id", "")).lower()
        if "(free)" in name or model_id.endswith(":free") or model.get("free"):
            count += 1
    return count


def provider_key_status(provider_name: str, provider_def: Dict[str, Any]) -> str:
    if provider_def.get("built_in"):
        return "Built-in"
    if provider_name == "Antigravity":
        return "OAuth accounts"
    oauth_provider = provider_def.get("oauth_provider")
    if oauth_provider:
        try:
            from dardcor_agent.models.subscription_oauth import load_oauth_token

            if load_oauth_token(str(oauth_provider)).get("access_token"):
                return "OAuth signed in"
        except Exception:
            pass
        return "OAuth login required"
    api_key_env = provider_def.get("api_key_env", "")
    if not api_key_env:
        return "No key required"
    if os.environ.get(api_key_env, "").strip():
        return "Key set"
    try:
        from dardcor_agent.models.providers.openai_compatible.components import load_provider_config

        if load_provider_config(provider_name).get("api_key", "").strip():
            return "Key set"
    except Exception:
        pass
    try:
        from dardcor_agent.models.provider_meta import load_registry_provider_config

        if load_registry_provider_config(provider_name).get("api_key", "").strip():
            return "Key set"
    except Exception:
        pass
    return "No key"


def provider_card_meta(provider_name: str, provider_def: Dict[str, Any]) -> str:
    parts: list[str] = []
    tier = provider_def.get("tier")
    if tier:
        parts.append(str(tier))
    elif provider_def.get("built_in"):
        parts.append("Built-in")

    free_count = count_free_models(provider_def)
    if free_count:
        label = "Free model" if free_count == 1 else "Free models"
        parts.append(f"{free_count} {label}")

    key_status = provider_key_status(provider_name, provider_def)
    if key_status not in parts:
        parts.append(key_status)

    model_count = len(provider_def.get("models", []))
    if model_count and not free_count and provider_name not in ("Dardcor", "Antigravity"):
        parts.append(f"{model_count} models")

    return " · ".join(parts)


def provider_display_name(provider_name: str, provider_def: Dict[str, Any]) -> str:
    return str(provider_def.get("name") or provider_name)


def normalize_registry_model(model: Dict[str, Any]) -> Dict[str, Any]:
    model_id = str(model.get("id") or model.get("name") or "").strip()
    display = str(model.get("name") or model.get("display") or model_id).strip()
    name_lower = display.lower()
    model_id_lower = model_id.lower()
    is_free = bool(
        model.get("free")
        or "(free)" in name_lower
        or model_id_lower.endswith(":free")
        or name_lower.endswith(" free")
    )
    return {
        "id": model_id,
        "display": display,
        "description": str(model.get("description", "")).strip(),
        "free": is_free,
    }


def _models_cache_path(provider_name: str) -> str:
    root = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    )
    return os.path.join(root, "database", "models", provider_name, "models_cache.json")


def _load_models_cache(provider_name: str) -> List[Dict[str, Any]]:
    path = _models_cache_path(provider_name)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return [normalize_registry_model(m) for m in data if isinstance(m, dict)]
    except Exception:
        pass
    return []


def save_models_cache(provider_name: str, models: List[Dict[str, Any]]) -> None:
    path = _models_cache_path(provider_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(models, f, indent=2, ensure_ascii=False)


def fetch_remote_models(
    provider_name: str,
    provider_def: Dict[str, Any],
    *,
    api_key: str = "",
    base_url: str = "",
) -> Tuple[List[Dict[str, Any]], str]:
    """Fetch models from provider API. Returns (models, error_message)."""
    fetch_url = str(provider_def.get("models_fetch_url") or "").strip()
    if not fetch_url:
        return [], "No remote models endpoint for this provider."

    headers = {
        "Accept": "application/json",
        "User-Agent": "DardcorCode/1.0",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if provider_name == "OpenRouter":
        headers["HTTP-Referer"] = "https://dardcor.local"
        headers["X-Title"] = "Dardcor Code"

    try:
        req = urllib.request.Request(fetch_url, headers=headers)
        with urllib.request.urlopen(req, timeout=25) as res:
            data = json.loads(res.read().decode("utf-8"))

        raw_models = data if isinstance(data, list) else data.get("data", data.get("models", []))
        if not isinstance(raw_models, list):
            return [], "Unexpected models response format."

        registry_by_id = {
            str(m.get("id", "")): m
            for m in provider_def.get("models", [])
            if isinstance(m, dict) and m.get("id")
        }

        models: List[Dict[str, Any]] = []
        for item in raw_models:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or item.get("name") or "").strip()
            if not model_id:
                continue
            registry_entry = registry_by_id.get(model_id, {})
            display = (
                registry_entry.get("name")
                or item.get("name")
                or item.get("displayName")
                or model_id
            )
            pricing = item.get("pricing") or {}
            is_free = bool(
                registry_entry.get("free")
                or pricing.get("prompt") == "0"
                or pricing.get("completion") == "0"
                or model_id.endswith(":free")
            )
            models.append(
                normalize_registry_model(
                    {
                        "id": model_id,
                        "name": display,
                        "description": item.get("description", ""),
                        "free": is_free,
                    }
                )
            )

        models.sort(key=lambda m: (not m.get("free"), m["display"].lower()))
        if models:
            save_models_cache(provider_name, models)
        return models, ""
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        if exc.code in (401, 403):
            return [], "API key required — save your key or use Login via Web first."
        return [], f"HTTP {exc.code}: {body or exc.reason}"
    except Exception as exc:
        return [], str(exc)


def get_registry_models(
    provider_name: str,
    provider_def: Dict[str, Any] | None = None,
    *,
    prefer_cache: bool = False,
) -> List[Dict[str, Any]]:
    if provider_def is None:
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

        provider_def = PROVIDER_REGISTRY.get(provider_name, {})

    if prefer_cache:
        cached = _load_models_cache(provider_name)
        if cached:
            return cached

    models: List[Dict[str, Any]] = []
    for raw in provider_def.get("models", []):
        if not isinstance(raw, dict):
            continue
        normalized = normalize_registry_model(raw)
        if normalized["id"]:
            models.append(normalized)
    return models


def paginate_items(
    items: Sequence[Any],
    page: int,
    page_size: int = DEFAULT_MODELS_PAGE_SIZE,
) -> Tuple[List[Any], int, int]:
    total = len(items)
    if total == 0:
        return [], 1, 0
    total_pages = max(1, (total + page_size - 1) // page_size)
    current_page = max(1, min(page, total_pages))
    start = (current_page - 1) * page_size
    end = start + page_size
    return list(items[start:end]), total_pages, total
