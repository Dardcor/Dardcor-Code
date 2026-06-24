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


PROVIDER_DEFINITIONS = {
    "OpenRouter": {
        "title": "OpenRouter API Configuration",
        "icon": "◇",
        "accent": "#a855f7",
        "placeholder": "sk-or-v1-...",
        "models_url": "https://openrouter.ai/api/v1/models",
        "base_url": "https://openrouter.ai/api/v1",
    },
    "DeepSeek": {
        "title": "DeepSeek API Configuration",
        "icon": "◆",
        "accent": "#4da3ff",
        "placeholder": "sk-...",
        "models_url": "https://api.deepseek.com/v1/models",
        "base_url": "https://api.deepseek.com/v1",
    },
    "NVIDIA": {
        "title": "NVIDIA NIM API Configuration",
        "icon": "▰",
        "accent": "#76b900",
        "placeholder": "nvapi-...",
        "models_url": "https://integrate.api.nvidia.com/v1/models",
        "base_url": "https://integrate.api.nvidia.com/v1",
    },
}


def provider_config_path(provider_name: str) -> str:
    return os.path.join(_PROJECT_ROOT, "database", "models", provider_name, "config.json")


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
    data.setdefault("base_url", definition["base_url"])
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


class OpenAICompatibleProviderPanel(QWidget):
    config_saved = Signal()

    def __init__(self, provider_name: str, parent=None):
        super().__init__(parent)
        self.provider_name = provider_name
        self.definition = PROVIDER_DEFINITIONS[provider_name]
        self._config = load_provider_config(provider_name)
        self._models = self._config.get("models", [])
        self._worker = None
        self._model_rows = {}
        self._selected_model = self._config.get("selected_model", "")
        self._setup_ui()

    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        api_section = QFrame()
        api_section.setStyleSheet("background-color: #0d0d0f; border-bottom: 1px solid #1e1e20;")
        api_layout = QVBoxLayout(api_section)
        api_layout.setContentsMargins(24, 20, 24, 20)
        api_layout.setSpacing(12)

        title_row = QHBoxLayout()
        icon_lbl = QLabel(self.definition["icon"])
        icon_lbl.setStyleSheet(f"color: {self.definition['accent']}; font-size: 18px; background: transparent; border: none;")
        title_row.addWidget(icon_lbl)
        title = QLabel(self.definition["title"])
        title.setStyleSheet("color: #e4e4e7; font-size: 14px; font-weight: 700; background: transparent; border: none;")
        title_row.addWidget(title)
        title_row.addStretch()
        api_layout.addLayout(title_row)

        desc = QLabel(f"Enter your {self.provider_name} API key to fetch models. Your key is stored locally in database/models/{self.provider_name}/config.json.")
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #6b7280; font-size: 11px; background: transparent; border: none; line-height: 1.5;")
        api_layout.addWidget(desc)

        key_row = QHBoxLayout()
        key_row.setSpacing(10)
        key_container = QFrame()
        key_container.setStyleSheet("QFrame { background-color: #111315; border: 1px solid #2c2e33; border-radius: 8px; }")
        key_inner = QHBoxLayout(key_container)
        key_inner.setContentsMargins(12, 0, 12, 0)
        key_inner.setSpacing(8)
        key_inner.addWidget(QLabel("🔑", styleSheet="background: transparent; border: none; font-size: 14px;"))

        self._key_input = QLineEdit()
        self._key_input.setPlaceholderText(self.definition["placeholder"])
        self._key_input.setEchoMode(QLineEdit.Password)
        self._key_input.setFixedHeight(38)
        self._key_input.setText(self._config.get("api_key", ""))
        self._key_input.setStyleSheet("QLineEdit { background: transparent; border: none; color: #e4e4e7; font-size: 13px; font-family: monospace; }")
        key_inner.addWidget(self._key_input, stretch=1)

        self._show_btn = QPushButton("👁")
        self._show_btn.setFixedSize(30, 30)
        self._show_btn.setStyleSheet("QPushButton { background: transparent; border: none; font-size: 14px; border-radius: 4px; } QPushButton:hover { background-color: #1e2025; }")
        self._show_btn.clicked.connect(self._toggle_key_visibility)
        key_inner.addWidget(self._show_btn)
        key_row.addWidget(key_container, stretch=1)

        self._fetch_btn = QPushButton("  Fetch Models")
        self._fetch_btn.setFixedHeight(40)
        self._fetch_btn.setFixedWidth(140)
        self._fetch_btn.setCursor(Qt.PointingHandCursor)
        self._fetch_btn.setStyleSheet("""
            QPushButton { background-color: #1c7ed6; color: #ffffff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; padding: 0 16px; }
            QPushButton:hover { background-color: #1971c2; }
            QPushButton:disabled { background-color: #2c2e33; color: #6b7280; }
        """)
        self._fetch_btn.clicked.connect(self._fetch_models)
        key_row.addWidget(self._fetch_btn)
        api_layout.addLayout(key_row)

        self._status_lbl = QLabel("")
        self._status_lbl.setStyleSheet("color: #6b7280; font-size: 11px; background: transparent; border: none;")
        api_layout.addWidget(self._status_lbl)
        main_layout.addWidget(api_section)

        save_bar = QFrame()
        save_bar.setStyleSheet("background-color: #0a0a0c; border-bottom: 1px solid #1e1e20;")
        save_bar_layout = QHBoxLayout(save_bar)
        save_bar_layout.setContentsMargins(24, 10, 24, 10)
        self._selected_lbl = QLabel("No model selected")
        self._selected_lbl.setStyleSheet("color: #6b7280; font-size: 12px; background: transparent; border: none;")
        save_bar_layout.addWidget(self._selected_lbl)
        save_bar_layout.addStretch()

        self._save_btn = QPushButton("💾  Save Configuration")
        self._save_btn.setFixedHeight(34)
        self._save_btn.setCursor(Qt.PointingHandCursor)
        self._save_btn.setStyleSheet("QPushButton { background-color: #2f9e44; color: #ffffff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; padding: 0 16px; } QPushButton:hover { background-color: #2b8a3e; }")
        self._save_btn.clicked.connect(self._save_config)
        save_bar_layout.addWidget(self._save_btn)
        main_layout.addWidget(save_bar)

        list_header = QFrame()
        list_header.setStyleSheet("background-color: #080808; border-bottom: 1px solid #1e1e20;")
        list_header.setFixedHeight(38)
        list_h = QHBoxLayout(list_header)
        list_h.setContentsMargins(16, 0, 16, 0)
        list_h.setSpacing(12)
        list_h.addWidget(QLabel("", fixedWidth=18, styleSheet="border: none;"))
        list_h.addWidget(QLabel("MODEL NAME", styleSheet="color: #6b7280; font-size: 11px; font-weight: bold; border: none;"), stretch=1)
        list_h.addWidget(QLabel("MODEL ID", fixedWidth=220, styleSheet="color: #6b7280; font-size: 11px; font-weight: bold; border: none;"))
        main_layout.addWidget(list_header)

        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setStyleSheet("QScrollArea { border: none; background-color: #040406; } QScrollBar:vertical { width: 8px; background: transparent; } QScrollBar::handle:vertical { background: #2c2e33; border-radius: 4px; min-height: 20px; }")
        self._list_container = QWidget()
        self._list_container.setStyleSheet("background-color: #040406;")
        self._list_layout = QVBoxLayout(self._list_container)
        self._list_layout.setContentsMargins(0, 0, 0, 0)
        self._list_layout.setSpacing(0)
        self._placeholder = QLabel(f"Enter your API key and click 'Fetch Models' to load available {self.provider_name} models.")
        self._placeholder.setWordWrap(True)
        self._placeholder.setAlignment(Qt.AlignCenter)
        self._placeholder.setStyleSheet("color: #495057; font-size: 13px; padding: 60px 40px;")
        self._list_layout.addWidget(self._placeholder)
        self._list_layout.addStretch()
        self._scroll.setWidget(self._list_container)
        main_layout.addWidget(self._scroll, stretch=1)

        if self._models:
            self._render_models(self._models)

    def _toggle_key_visibility(self):
        if self._key_input.echoMode() == QLineEdit.Password:
            self._key_input.setEchoMode(QLineEdit.Normal)
            self._show_btn.setText("🙈")
        else:
            self._key_input.setEchoMode(QLineEdit.Password)
            self._show_btn.setText("👁")

    def _fetch_models(self):
        api_key = self._key_input.text().strip()
        if not api_key and self.provider_name != "OpenRouter":
            self._status_lbl.setText("⚠️ Masukkan API key terlebih dahulu.")
            self._status_lbl.setStyleSheet("color: #f59e0b; font-size: 11px; background: transparent; border: none;")
            return
        self._fetch_btn.setEnabled(False)
        self._fetch_btn.setText("  Fetching...")
        self._status_lbl.setText(f"⏳ Mengambil daftar model dari {self.provider_name}...")
        self._status_lbl.setStyleSheet("color: #60a5fa; font-size: 11px; background: transparent; border: none;")
        self._worker = ProviderModelFetchWorker(self.provider_name, api_key, self)
        self._worker.finished.connect(self._on_models_fetched)
        self._worker.start()

    def _on_models_fetched(self, models: list, error: str):
        self._fetch_btn.setEnabled(True)
        self._fetch_btn.setText("  Fetch Models")
        if error:
            self._status_lbl.setText(f"❌ Error: {error}")
            self._status_lbl.setStyleSheet("color: #f43f5e; font-size: 11px; background: transparent; border: none;")
            return
        self._models = models
        cfg = load_provider_config(self.provider_name)
        cfg["models"] = models
        cfg["api_key"] = self._key_input.text().strip()
        cfg["base_url"] = self.definition["base_url"]
        save_provider_config(self.provider_name, cfg)
        self._status_lbl.setText(f"✅ Berhasil memuat {len(models)} model dari {self.provider_name}.")
        self._status_lbl.setStyleSheet("color: #2f9e44; font-size: 11px; background: transparent; border: none;")
        self._render_models(models)

    def _render_models(self, models: list):
        while self._list_layout.count():
            item = self._list_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._model_rows = {}
        self._models = models
        if not models:
            lbl = QLabel("Tidak ada model yang ditemukan untuk API key ini.")
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setStyleSheet("color: #6b7280; font-size: 13px; padding: 40px;")
            self._list_layout.addWidget(lbl)
            self._list_layout.addStretch()
            return
        for model in models:
            is_selected = model["id"] == self._selected_model
            row = ProviderModelRow(model, self.definition["accent"], is_selected=is_selected)
            row.selected.connect(self._on_model_selected)
            self._list_layout.addWidget(row)
            self._model_rows[model["id"]] = row
        self._list_layout.addStretch()
        self._update_selected_label()

    def _on_model_selected(self, model_id: str):
        if self._selected_model and self._selected_model in self._model_rows:
            self._model_rows[self._selected_model].set_selected(False)
        self._selected_model = model_id
        if model_id in self._model_rows:
            self._model_rows[model_id].set_selected(True)
        self._update_selected_label()

    def _update_selected_label(self):
        if self._selected_model:
            self._selected_lbl.setText(f"✅ Model terpilih: <b style='color: #4da3ff;'>{self._selected_model}</b>")
            self._selected_lbl.setStyleSheet("color: #e4e4e7; font-size: 12px; background: transparent; border: none;")
        else:
            self._selected_lbl.setText("Belum ada model yang dipilih")
            self._selected_lbl.setStyleSheet("color: #6b7280; font-size: 12px; background: transparent; border: none;")

    def _save_config(self):
        data = load_provider_config(self.provider_name)
        data["api_key"] = self._key_input.text().strip()
        data["selected_model"] = self._selected_model
        data["base_url"] = self.definition["base_url"]
        if self._models:
            data["models"] = self._models
        save_provider_config(self.provider_name, data)
        self._save_btn.setText("✅ Tersimpan!")
        QTimer.singleShot(2000, self._reset_save_btn)
        self.config_saved.emit()

    def _reset_save_btn(self):
        self._save_btn.setText("💾  Save Configuration")
