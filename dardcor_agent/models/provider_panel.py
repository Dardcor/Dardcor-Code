import json
import os
import urllib.error
import urllib.request

from PySide6.QtCore import Qt, QThread, QTimer, Signal
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)


_PROJECT_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")
)


import importlib

def get_provider_definition(provider_name: str) -> dict:
    folder_name = provider_name.lower().replace(" ", "_").replace("-", "_")
    try:
        module = importlib.import_module(f"dardcor_agent.models.providers.{folder_name}.components")
        return getattr(module, "PROVIDER_DEFINITION", {})
    except (ImportError, AttributeError):
        return {}


def provider_config_path(provider_name: str) -> str:
    from pydardcor.core.config import get_user_data_dir
    return os.path.join(get_user_data_dir(), "database", "models", provider_name, "config.json")


def load_provider_config(provider_name: str) -> dict:
    path = provider_config_path(provider_name)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"api_key": "", "selected_model": "", "models": []}


def save_provider_config(provider_name: str, data: dict) -> None:
    definition = PROVIDER_DEFINITIONS[provider_name]
    data.setdefault("provider", provider_name.lower())
    default_base = definition.get("base_url", "")
    if default_base:
        data.setdefault("base_url", default_base)
    path = provider_config_path(provider_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class ProviderModelFetchWorker(QThread):
    finished = Signal(list, str)

    def __init__(self, provider_name: str, api_key: str, parent=None):
        super().__init__(parent)
        self.provider_name = provider_name
        self.api_key = api_key

    def run(self):
        try:
            definition = PROVIDER_DEFINITIONS[self.provider_name]
            headers = {
                "Accept": "application/json",
                "User-Agent": "DardcorCode/1.0",
            }
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            if self.provider_name == "OpenRouter":
                headers["HTTP-Referer"] = "https://dardcor.local"
                headers["X-Title"] = "Dardcor Code"

            req = urllib.request.Request(definition["models_url"], headers=headers)
            with urllib.request.urlopen(req, timeout=20) as res:
                data = json.loads(res.read().decode("utf-8"))

            raw_models = data.get("data", data.get("models", []))
            models = []
            for item in raw_models:
                model_id = item.get("id") or item.get("name")
                if not model_id:
                    continue
                display = item.get("name") or item.get("displayName") or model_id
                context = item.get("context_length") or item.get("max_context_length") or item.get("inputTokenLimit") or 0
                output = item.get("max_completion_tokens") or item.get("outputTokenLimit") or 0
                models.append({
                    "id": model_id,
                    "display": display,
                    "description": item.get("description", ""),
                    "input_tokens": context,
                    "output_tokens": output,
                })

            models.sort(key=lambda x: x["id"].lower())
            self.finished.emit(models, "")
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            self.finished.emit([], f"HTTP {e.code}: {body[:300]}")
        except Exception as e:
            self.finished.emit([], str(e))


class ProviderModelRow(QFrame):
    selected = Signal(str)

    def __init__(self, model: dict, accent: str, is_selected: bool = False, parent=None):
        super().__init__(parent)
        self.model_id = model["id"]
        self.accent = accent
        self.is_selected = is_selected
        self.setFixedHeight(60)
        self.setCursor(Qt.PointingHandCursor)
        self._apply_style()

        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 8, 16, 8)
        layout.setSpacing(12)

        self._radio = QLabel("◉" if is_selected else "○")
        self._radio.setFixedWidth(18)
        self._radio.setStyleSheet(f"color: {accent if is_selected else '#495057'}; font-size: 16px; background: transparent; border: none;")
        layout.addWidget(self._radio)

        info = QVBoxLayout()
        info.setSpacing(2)
        lbl_name = QLabel(model.get("display") or model["id"])
        lbl_name.setStyleSheet("color: #e4e4e7; font-size: 13px; font-weight: 600; background: transparent; border: none;")
        info.addWidget(lbl_name)

        meta_parts = []
        if model.get("input_tokens"):
            meta_parts.append(f"Context: {int(model['input_tokens']):,} tokens")
        if model.get("output_tokens"):
            meta_parts.append(f"Output: {int(model['output_tokens']):,} tokens")
        lbl_meta = QLabel("  •  ".join(meta_parts) if meta_parts else model["id"])
        lbl_meta.setStyleSheet("color: #6b7280; font-size: 11px; background: transparent; border: none;")
        info.addWidget(lbl_meta)
        layout.addLayout(info, stretch=1)

        badge = QLabel(model["id"])
        badge.setStyleSheet("color: #4da3ff; font-size: 10px; font-family: monospace; background: #0d1b2e; border: 1px solid #1e3a5f; border-radius: 4px; padding: 2px 6px;")
        layout.addWidget(badge)

    def _apply_style(self):
        bg = "#0a1628" if self.is_selected else "transparent"
        border = f"1px solid {self.accent}" if self.is_selected else "1px solid transparent"
        self.setStyleSheet(
            f"ProviderModelRow {{ background-color: {bg}; border-bottom: 1px solid #1e1e20; border-left: {border}; border-right: none; border-top: none; }}"
            "ProviderModelRow:hover { background-color: #0f2040; }"
        )

    def set_selected(self, selected: bool):
        self.is_selected = selected
        self._radio.setText("◉" if selected else "○")
        self._radio.setStyleSheet(f"color: {self.accent if selected else '#495057'}; font-size: 16px; background: transparent; border: none;")
        self._apply_style()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.selected.emit(self.model_id)
        super().mousePressEvent(event)


