"""Gemini Provider UI — API Key form + real model list from Google AI Studio."""

import os
import json
from PySide6.QtWidgets import *
from PySide6.QtCore import *
from PySide6.QtGui import *

from pydardcor.core.config import get_user_data_dir as _get_user_data_dir
_GEMINI_CONFIG_DIR = _get_user_data_dir()
GEMINI_CONFIG_PATH = os.path.join(_GEMINI_CONFIG_DIR, "database", "models", "Gemini", "config.json")


def _load_gemini_config() -> dict:
    if os.path.exists(GEMINI_CONFIG_PATH):
        try:
            with open(GEMINI_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"api_key": "", "selected_model": ""}


def _save_gemini_config(data: dict):
    os.makedirs(os.path.dirname(GEMINI_CONFIG_PATH), exist_ok=True)
    with open(GEMINI_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ──────────────────────────────────────────────────────────────
#  Worker: fetch model list from Google AI Studio API
# ──────────────────────────────────────────────────────────────
class GeminiModelFetchWorker(QThread):
    finished = Signal(list, str)   # models list, error_str

    def __init__(self, api_key: str, parent=None):
        super().__init__(parent)
        self.api_key = api_key

    def run(self):
        try:
            import urllib.request
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}&pageSize=1000"
            req = urllib.request.Request(url, headers={"User-Agent": "DardcorCode/1.0"})
            with urllib.request.urlopen(req, timeout=15) as res:
                data = json.loads(res.read().decode("utf-8"))

            models = []
            for m in data.get("models", []):
                name = m.get("name", "")           # e.g. "models/gemini-1.5-pro"
                display = m.get("displayName", name.replace("models/", ""))
                desc = m.get("description", "")
                input_token = m.get("inputTokenLimit", 0)
                output_token = m.get("outputTokenLimit", 0)
                methods = m.get("supportedGenerationMethods", [])
                models.append({
                    "id": name.replace("models/", ""),
                    "display": display,
                    "description": desc,
                    "input_tokens": input_token,
                    "output_tokens": output_token,
                })
            # Sort alphabetically
            models.sort(key=lambda x: x["id"])
            self.finished.emit(models, "")
        except Exception as e:
            self.finished.emit([], str(e))


# ──────────────────────────────────────────────────────────────
#  Model Row Widget
# ──────────────────────────────────────────────────────────────
class GeminiModelRow(QFrame):
    selected = Signal(str)  # emits model id

    def __init__(self, model: dict, is_selected: bool = False, parent=None):
        super().__init__(parent)
        self.model_id = model["id"]
        self.is_selected = is_selected
        self._model = model

        self.setFixedHeight(60)
        self.setCursor(Qt.PointingHandCursor)
        self._apply_style()

        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 8, 16, 8)
        layout.setSpacing(12)

        # Radio indicator
        self._radio = QLabel("◉" if is_selected else "○")
        self._radio.setFixedWidth(18)
        self._radio.setStyleSheet(f"color: {'#1c7ed6' if is_selected else '#495057'}; font-size: 16px; background: transparent; border: none;")
        layout.addWidget(self._radio)

        # Info column
        info = QVBoxLayout()
        info.setSpacing(2)

        lbl_name = QLabel(model["display"])
        lbl_name.setStyleSheet("color: #e4e4e7; font-size: 13px; font-weight: 600; background: transparent; border: none;")
        info.addWidget(lbl_name)

        meta_parts = []
        if model["input_tokens"]:
            meta_parts.append(f"Input: {model['input_tokens']:,} tokens")
        if model["output_tokens"]:
            meta_parts.append(f"Output: {model['output_tokens']:,} tokens")
        meta_text = "  •  ".join(meta_parts) if meta_parts else model["id"]

        lbl_meta = QLabel(meta_text)
        lbl_meta.setStyleSheet("color: #6b7280; font-size: 11px; background: transparent; border: none;")
        info.addWidget(lbl_meta)

        layout.addLayout(info, stretch=1)

        # Model ID badge
        badge = QLabel(model["id"])
        badge.setStyleSheet("color: #4da3ff; font-size: 10px; font-family: monospace; background: #0d1b2e; border: 1px solid #1e3a5f; border-radius: 4px; padding: 2px 6px;")
        layout.addWidget(badge)

    def _apply_style(self):
        bg = "#0a1628" if self.is_selected else "transparent"
        border = "1px solid #1c7ed6" if self.is_selected else "1px solid transparent"
        self.setStyleSheet(f"GeminiModelRow {{ background-color: {bg}; border-bottom: 1px solid #1e1e20; border-left: {border}; border-right: none; border-top: none; }}"
                           f"GeminiModelRow:hover {{ background-color: #0f2040; }}")

    def set_selected(self, selected: bool):
        self.is_selected = selected
        self._radio.setText("◉" if selected else "○")
        self._radio.setStyleSheet(f"color: {'#1c7ed6' if selected else '#495057'}; font-size: 16px; background: transparent; border: none;")
        self._apply_style()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.selected.emit(self.model_id)
        super().mousePressEvent(event)


# ──────────────────────────────────────────────────────────────
#  Main Gemini Panel Widget
# ──────────────────────────────────────────────────────────────
class GeminiProviderPanel(QWidget):
    """Full Gemini provider UI: API Key form + model list."""

    config_saved = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._config = _load_gemini_config()
        self._models = []
        self._worker = None
        self._model_rows = {}
        self._selected_model = self._config.get("selected_model", "")
        self._setup_ui()

    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # ── API KEY SECTION ──────────────────────────────────
        api_section = QFrame()
        api_section.setStyleSheet("background-color: #0d0d0f; border-bottom: 1px solid #1e1e20;")
        api_layout = QVBoxLayout(api_section)
        api_layout.setContentsMargins(24, 20, 24, 20)
        api_layout.setSpacing(12)

        # Title row
        title_row = QHBoxLayout()
        icon_lbl = QLabel("✦")
        icon_lbl.setStyleSheet("color: #4285f4; font-size: 18px; background: transparent; border: none;")
        title_row.addWidget(icon_lbl)

        title = QLabel("Google Gemini API Configuration")
        title.setStyleSheet("color: #e4e4e7; font-size: 14px; font-weight: 700; background: transparent; border: none;")
        title_row.addWidget(title)
        title_row.addStretch()
        api_layout.addLayout(title_row)

        desc = QLabel("Enter your Google AI Studio API key to fetch available Gemini models. Your key is stored locally in <code>database/models/Gemini/config.json</code>.")
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #6b7280; font-size: 11px; background: transparent; border: none; line-height: 1.5;")
        api_layout.addWidget(desc)

        # API Key input row
        key_row = QHBoxLayout()
        key_row.setSpacing(10)

        key_container = QFrame()
        key_container.setStyleSheet("QFrame { background-color: #111315; border: 1px solid #2c2e33; border-radius: 8px; }")
        key_inner = QHBoxLayout(key_container)
        key_inner.setContentsMargins(12, 0, 12, 0)
        key_inner.setSpacing(8)

        key_icon = QLabel("🔑")
        key_icon.setStyleSheet("background: transparent; border: none; font-size: 14px;")
        key_inner.addWidget(key_icon)

        self._key_input = QLineEdit()
        self._key_input.setPlaceholderText("AIza... (paste your Google AI Studio API key)")
        self._key_input.setEchoMode(QLineEdit.Password)
        self._key_input.setFixedHeight(38)
        self._key_input.setText(self._config.get("api_key", ""))
        self._key_input.setStyleSheet("QLineEdit { background: transparent; border: none; color: #e4e4e7; font-size: 13px; font-family: monospace; }")
        key_inner.addWidget(self._key_input, stretch=1)

        # Show/hide toggle
        self._show_btn = QPushButton("👁")
        self._show_btn.setFixedSize(30, 30)
        self._show_btn.setStyleSheet("QPushButton { background: transparent; border: none; font-size: 14px; border-radius: 4px; } QPushButton:hover { background-color: #1e2025; }")
        self._show_btn.clicked.connect(self._toggle_key_visibility)
        key_inner.addWidget(self._show_btn)

        key_row.addWidget(key_container, stretch=1)

        # Fetch button
        self._fetch_btn = QPushButton("  Fetch Models")
        self._fetch_btn.setFixedHeight(40)
        self._fetch_btn.setFixedWidth(140)
        self._fetch_btn.setCursor(Qt.PointingHandCursor)
        self._fetch_btn.setStyleSheet("""
            QPushButton {
                background-color: #1c7ed6;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                padding: 0 16px;
            }
            QPushButton:hover { background-color: #1971c2; }
            QPushButton:disabled { background-color: #2c2e33; color: #6b7280; }
        """)
        self._fetch_btn.clicked.connect(self._fetch_models)
        key_row.addWidget(self._fetch_btn)

        api_layout.addLayout(key_row)

        # Status label
        self._status_lbl = QLabel("")
        self._status_lbl.setStyleSheet("color: #6b7280; font-size: 11px; background: transparent; border: none;")
        api_layout.addWidget(self._status_lbl)

        main_layout.addWidget(api_section)

        # ── SAVE BAR ─────────────────────────────────────────
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
        self._save_btn.setStyleSheet("""
            QPushButton {
                background-color: #2f9e44;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 600;
                padding: 0 16px;
            }
            QPushButton:hover { background-color: #2b8a3e; }
        """)
        self._save_btn.clicked.connect(self._save_config)
        save_bar_layout.addWidget(self._save_btn)

        main_layout.addWidget(save_bar)

        # ── MODEL LIST SECTION ───────────────────────────────
        # Header
        list_header = QFrame()
        list_header.setStyleSheet("background-color: #080808; border-bottom: 1px solid #1e1e20;")
        list_header.setFixedHeight(38)
        list_h = QHBoxLayout(list_header)
        list_h.setContentsMargins(16, 0, 16, 0)
        list_h.setSpacing(12)

        list_h.addWidget(QLabel("", fixedWidth=18, styleSheet="border: none;"))
        list_h.addWidget(QLabel("MODEL NAME", styleSheet="color: #6b7280; font-size: 11px; font-weight: bold; border: none;"), stretch=1)
        list_h.addWidget(QLabel("MODEL ID", fixedWidth=200, styleSheet="color: #6b7280; font-size: 11px; font-weight: bold; border: none;"))

        main_layout.addWidget(list_header)

        # Scroll area for model list
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setStyleSheet("QScrollArea { border: none; background-color: #040406; } QScrollBar:vertical { width: 8px; background: transparent; } QScrollBar::handle:vertical { background: #2c2e33; border-radius: 4px; min-height: 20px; }")

        self._list_container = QWidget()
        self._list_container.setStyleSheet("background-color: #040406;")
        self._list_layout = QVBoxLayout(self._list_container)
        self._list_layout.setContentsMargins(0, 0, 0, 0)
        self._list_layout.setSpacing(0)

        # Initial placeholder
        self._placeholder = QLabel("Enter your API key and click 'Fetch Models' to load available Gemini models from Google AI Studio.")
        self._placeholder.setWordWrap(True)
        self._placeholder.setAlignment(Qt.AlignCenter)
        self._placeholder.setStyleSheet("color: #495057; font-size: 13px; padding: 60px 40px;")
        self._list_layout.addWidget(self._placeholder)
        self._list_layout.addStretch()

        self._scroll.setWidget(self._list_container)
        main_layout.addWidget(self._scroll, stretch=1)

        # Load existing models if key exists
        if self._config.get("api_key") and self._config.get("models"):
            self._render_models(self._config["models"])

    def _toggle_key_visibility(self):
        if self._key_input.echoMode() == QLineEdit.Password:
            self._key_input.setEchoMode(QLineEdit.Normal)
            self._show_btn.setText("🙈")
        else:
            self._key_input.setEchoMode(QLineEdit.Password)
            self._show_btn.setText("👁")

    def _fetch_models(self):
        api_key = self._key_input.text().strip()
        if not api_key:
            self._status_lbl.setText("⚠️ Masukkan API key terlebih dahulu.")
            self._status_lbl.setStyleSheet("color: #f59e0b; font-size: 11px; background: transparent; border: none;")
            return

        self._fetch_btn.setEnabled(False)
        self._fetch_btn.setText("  Fetching...")
        self._status_lbl.setText("⏳ Mengambil daftar model dari Google AI Studio...")
        self._status_lbl.setStyleSheet("color: #60a5fa; font-size: 11px; background: transparent; border: none;")

        self._worker = GeminiModelFetchWorker(api_key, self)
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
        # Save models cache to config
        cfg = _load_gemini_config()
        cfg["models"] = models
        _save_gemini_config(cfg)

        self._status_lbl.setText(f"✅ Berhasil memuat {len(models)} model dari Google AI Studio.")
        self._status_lbl.setStyleSheet("color: #2f9e44; font-size: 11px; background: transparent; border: none;")
        self._render_models(models)

    def _render_models(self, models: list):
        # Clear existing
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

        for m in models:
            is_sel = (m["id"] == self._selected_model)
            row = GeminiModelRow(m, is_selected=is_sel)
            row.selected.connect(self._on_model_selected)
            self._list_layout.addWidget(row)
            self._model_rows[m["id"]] = row

        self._list_layout.addStretch()
        self._update_selected_label()

    def _on_model_selected(self, model_id: str):
        # Deselect old
        if self._selected_model and self._selected_model in self._model_rows:
            self._model_rows[self._selected_model].set_selected(False)

        self._selected_model = model_id

        # Select new
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
        api_key = self._key_input.text().strip()
        data = _load_gemini_config()
        data["api_key"] = api_key
        data["selected_model"] = self._selected_model
        # Keep cached models
        if self._models:
            data["models"] = self._models
        _save_gemini_config(data)

        # Flash feedback
        self._save_btn.setText("✅ Tersimpan!")
        self._save_btn.setStyleSheet("""
            QPushButton {
                background-color: #0d7a3a;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 600;
                padding: 0 16px;
            }
        """)
        QTimer.singleShot(2000, self._reset_save_btn)
        self.config_saved.emit()

    def _reset_save_btn(self):
        self._save_btn.setText("💾  Save Configuration")
        self._save_btn.setStyleSheet("""
            QPushButton {
                background-color: #2f9e44;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 600;
                padding: 0 16px;
            }
            QPushButton:hover { background-color: #2b8a3e; }
        """)
