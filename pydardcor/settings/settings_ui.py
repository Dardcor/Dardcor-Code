"""Settings UI - VS Code style interactive settings editor (opens as an editor tab)."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QCheckBox, QComboBox, QSpinBox, QScrollArea, QFrame,
    QPushButton, QSizePolicy, QGroupBox, QFormLayout
)
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QColor, QFont

from ..core.config import get_config


class SettingRow(QWidget):
    """Single setting row with label, description, and input widget."""
    changed = Signal()

    def __init__(self, key, label, description, widget_type, value, options=None, parent=None):
        super().__init__(parent)
        self.key = key
        self._setup_ui(label, description, widget_type, value, options)

    def _setup_ui(self, label, description, widget_type, value, options):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 8, 0, 8)
        layout.setSpacing(4)

        title = QLabel(label)
        title.setStyleSheet("color: #e0e0e0; font-size: 13px; font-weight: 600;")
        layout.addWidget(title)

        if description:
            desc = QLabel(description)
            desc.setStyleSheet("color: #858585; font-size: 12px;")
            desc.setWordWrap(True)
            layout.addWidget(desc)

        if widget_type == "checkbox":
            self._input = QCheckBox()
            self._input.setChecked(bool(value))
            self._input.stateChanged.connect(lambda: self.changed.emit())
            layout.addWidget(self._input)
        elif widget_type == "spinbox":
            self._input = QSpinBox()
            self._input.setRange(options.get("min", 0), options.get("max", 9999))
            self._input.setValue(int(value))
            self._input.valueChanged.connect(lambda: self.changed.emit())
            self._input.setFixedWidth(200)
            self._input.setStyleSheet("""
                QSpinBox {
                    background-color: #2c004a; color: #cccccc;
                    border: 1px solid #2c004a; border-radius: 2px;
                    padding: 4px 8px; font-size: 13px;
                }
                QSpinBox:focus { border: 1px solid #4a0072; }
            """)
            layout.addWidget(self._input)
        elif widget_type == "combo":
            self._input = QComboBox()
            if options and "items" in options:
                self._input.addItems(options["items"])
            self._input.setCurrentText(str(value))
            self._input.setEditable(options.get("editable", False))
            self._input.currentTextChanged.connect(lambda: self.changed.emit())
            self._input.setFixedWidth(300)
            self._input.setStyleSheet("""
                QComboBox {
                    background-color: #2c004a; color: #cccccc;
                    border: 1px solid #2c004a; border-radius: 2px;
                    padding: 4px 8px; font-size: 13px;
                }
                QComboBox:focus { border: 1px solid #4a0072; }
                QComboBox::drop-down { border: none; width: 20px; }
                QComboBox QAbstractItemView {
                    background-color: #000000; color: #cccccc;
                    border: 1px solid #454545;
                    selection-background-color: #04395e;
                }
            """)
            layout.addWidget(self._input)
        elif widget_type == "text":
            self._input = QLineEdit()
            self._input.setText(str(value or ""))
            self._input.setPlaceholderText(options.get("placeholder", "") if options else "")
            self._input.textChanged.connect(lambda: self.changed.emit())
            self._input.setFixedWidth(400)
            self._input.setStyleSheet("""
                QLineEdit {
                    background-color: #2c004a; color: #cccccc;
                    border: 1px solid #2c004a; border-radius: 2px;
                    padding: 4px 8px; font-size: 13px;
                }
                QLineEdit:focus { border: 1px solid #4a0072; }
            """)
            layout.addWidget(self._input)

    def get_value(self):
        w = self._input
        if isinstance(w, QCheckBox):
            return w.isChecked()
        elif isinstance(w, QSpinBox):
            return w.value()
        elif isinstance(w, QComboBox):
            return w.currentText()
        elif isinstance(w, QLineEdit):
            return w.text()
        return None


class SettingsUIWidget(QWidget):
    """Full settings UI panel that can be embedded in an editor tab."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._config = get_config()
        self._rows = []
        self._setup_ui()

    # Duck-typing for editor tab compatibility
    def get_file_path(self):
        return ""
    def is_dirty(self):
        return False
    def get_language(self):
        return "settings"
    def get_content(self):
        return ""

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.setStyleSheet("background-color: #000000;")

        # Header
        header = QWidget()
        header.setFixedHeight(50)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #1a0033;")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(24, 0, 24, 0)

        title = QLabel("⚙ Settings")
        title.setStyleSheet("color: #cccccc; font-size: 18px; font-weight: 300;")
        header_layout.addWidget(title)
        header_layout.addStretch()

        # User / Workspace toggle
        self._scope_user = QPushButton("User")
        self._scope_ws = QPushButton("Workspace")
        for btn in (self._scope_user, self._scope_ws):
            btn.setFixedHeight(24)
            btn.setCursor(Qt.PointingHandCursor)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent; color: #858585;
                    border: none; padding: 4px 12px; font-size: 12px;
                }
                QPushButton:hover { color: #cccccc; }
            """)
        self._scope_user.setStyleSheet(self._scope_user.styleSheet().replace("color: #858585", "color: #cccccc; border-bottom: 2px solid #4a0072"))
        header_layout.addWidget(self._scope_user)
        header_layout.addWidget(self._scope_ws)
        layout.addWidget(header)

        # Search
        search_bar = QWidget()
        search_bar.setFixedHeight(40)
        search_bar.setStyleSheet("background-color: #000000;")
        search_layout = QHBoxLayout(search_bar)
        search_layout.setContentsMargins(24, 8, 24, 8)

        self._search = QLineEdit()
        self._search.setPlaceholderText("Search settings")
        self._search.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a; color: #cccccc;
                border: 1px solid #2c004a; border-radius: 4px;
                padding: 6px 12px; font-size: 13px;
            }
            QLineEdit:focus { border: 1px solid #4a0072; }
        """)
        self._search.textChanged.connect(self._filter_settings)
        search_layout.addWidget(self._search)
        layout.addWidget(search_bar)

        # Scroll area
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("""
            QScrollArea { border: none; background-color: #000000; }
            QScrollBar:vertical {
                background-color: #000000; width: 10px;
            }
            QScrollBar::handle:vertical {
                background-color: #424242; border-radius: 5px; min-height: 30px;
            }
            QScrollBar::handle:vertical:hover { background-color: #4f4f4f; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
        """)

        self._content = QWidget()
        self._content_layout = QVBoxLayout(self._content)
        self._content_layout.setContentsMargins(24, 16, 24, 16)
        self._content_layout.setSpacing(0)

        self._build_settings()

        self._content_layout.addStretch()
        scroll.setWidget(self._content)
        layout.addWidget(scroll)

    def _add_category(self, title):
        lbl = QLabel(title)
        lbl.setStyleSheet("""
            color: #cccccc; font-size: 14px; font-weight: bold;
            padding: 16px 0 8px 0; border-bottom: 1px solid #1a0033;
        """)
        self._content_layout.addWidget(lbl)
        return lbl

    def _add_setting(self, key, label, description, widget_type, value, options=None, category=None):
        row = SettingRow(key, label, description, widget_type, value, options)
        row.changed.connect(self._on_setting_changed)
        self._rows.append((row, category))
        
        sep = QFrame()
        sep.setFixedHeight(1)
        sep.setStyleSheet("background-color: #1a0033;")
        
        self._content_layout.addWidget(row)
        self._content_layout.addWidget(sep)
        return row

    def _build_settings(self):
        c = self._config

        # ── Editor ──
        self._add_category("Text Editor")

        self._add_setting("font_family", "Editor: Font Family",
            "Controls the font family.",
            "combo", c.font_family,
            {"items": ["Cascadia Code", "Consolas", "Fira Code", "JetBrains Mono", 
                       "Source Code Pro", "Menlo", "Monaco", "Courier New"], "editable": True},
            "editor")

        self._add_setting("font_size", "Editor: Font Size",
            "Controls the font size in pixels.",
            "spinbox", c.font_size, {"min": 8, "max": 72}, "editor")

        self._add_setting("tab_size", "Editor: Tab Size",
            "The number of spaces a tab is equal to.",
            "spinbox", c.tab_size, {"min": 1, "max": 8}, "editor")

        self._add_setting("word_wrap", "Editor: Word Wrap",
            "Controls how lines should wrap.",
            "checkbox", c.word_wrap, None, "editor")

        self._add_setting("minimap_enabled", "Editor: Minimap",
            "Controls whether the minimap is shown.",
            "checkbox", c.minimap_enabled, None, "editor")

        self._add_setting("auto_save", "Files: Auto Save",
            "Controls whether files are automatically saved after changes.",
            "checkbox", c.auto_save, None, "editor")

        # ── AI ──
        self._add_category("AI Provider")

        self._add_setting("ai.provider", "AI: Provider",
            "The AI service provider to use for code assistance.",
            "combo", c.ai.provider,
            {"items": ["openai", "anthropic", "gemini", "deepseek", "openrouter", "ollama", "nvidia"], "editable": True},
            "ai")

        self._add_setting("ai.model", "AI: Model",
            "The model name to use (e.g., gpt-4o, claude-sonnet-4-20250514, gemini-2.0-flash).",
            "text", c.ai.model, {"placeholder": "Model name"}, "ai")

        self._add_setting("ai.base_url", "AI: Base URL",
            "Custom base URL for the AI provider. Leave empty for default.",
            "text", c.ai.base_url, {"placeholder": "Leave empty for default"}, "ai")

        self._add_setting("ai.max_tokens", "AI: Max Tokens",
            "Maximum number of tokens in AI responses.",
            "spinbox", c.ai.max_tokens, {"min": 1024, "max": 256000}, "ai")

        # ── Workspace ──
        self._add_category("Workspace")

        self._add_setting("workspace_path", "Workspace: Path",
            "The root folder path for the current workspace.",
            "text", c.workspace_path, {"placeholder": "Path to workspace"}, "workspace")

        self._add_setting("terminal_shell", "Terminal: Shell",
            "The shell to use for the integrated terminal. Leave empty for default.",
            "text", c.terminal_shell, {"placeholder": "Leave empty for default"}, "workspace")

    def _on_setting_changed(self):
        c = self._config
        for row, _ in self._rows:
            k = row.key
            v = row.get_value()
            if k == "font_family": c.font_family = v
            elif k == "font_size": c.font_size = v
            elif k == "tab_size": c.tab_size = v
            elif k == "word_wrap": c.word_wrap = v
            elif k == "minimap_enabled": c.minimap_enabled = v
            elif k == "auto_save": c.auto_save = v
            elif k == "ai.provider": c.ai.provider = v
            elif k == "ai.model": c.ai.model = v
            elif k == "ai.base_url": c.ai.base_url = v
            elif k == "ai.max_tokens": c.ai.max_tokens = v
            elif k == "workspace_path": c.workspace_path = v
            elif k == "terminal_shell": c.terminal_shell = v
        c.save()

    def _filter_settings(self, text):
        text = text.lower()
        for row, _ in self._rows:
            visible = not text or text in row.key.lower() or any(
                text in child.text().lower()
                for child in row.findChildren(QLabel)
            )
            row.setVisible(visible)
