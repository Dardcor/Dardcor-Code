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
        self._category_labels = []
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
        self._category_labels.append((lbl, title))
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

        # ── Text Editor ──
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

        self._add_setting("render_whitespace", "Editor: Render Whitespace",
            "Controls how whitespace characters are rendered in the editor.",
            "combo", getattr(c, "render_whitespace", "selection"),
            {"items": ["none", "boundary", "selection", "trailing", "all"]},
            "editor")

        self._add_setting("cursor_style", "Editor: Cursor Style",
            "Controls the cursor style.",
            "combo", getattr(c, "cursor_style", "line"),
            {"items": ["line", "block", "underline", "line-thin", "block-outline", "underline-thin"]},
            "editor")

        self._add_setting("cursor_blinking", "Editor: Cursor Blinking",
            "Controls the cursor animation style.",
            "combo", getattr(c, "cursor_blinking", "blink"),
            {"items": ["blink", "smooth", "phase", "expand", "solid"]},
            "editor")

        self._add_setting("bracket_pair_colorization", "Editor: Bracket Pair Colorization",
            "Controls whether bracket pair colorization is enabled.",
            "checkbox", getattr(c, "bracket_pair_colorization", True), None, "editor")

        self._add_setting("smooth_scrolling", "Editor: Smooth Scrolling",
            "Controls whether the editor scrolls with an animation.",
            "checkbox", getattr(c, "smooth_scrolling", True), None, "editor")

        self._add_setting("sticky_scroll", "Editor: Sticky Scroll",
            "Shows nested current scopes during scroll.",
            "checkbox", getattr(c, "sticky_scroll", True), None, "editor")

        self._add_setting("format_on_save", "Editor: Format On Save",
            "Format a file on save.",
            "checkbox", getattr(c, "format_on_save", False), None, "editor")

        self._add_setting("format_on_paste", "Editor: Format On Paste",
            "Format pasted content.",
            "checkbox", getattr(c, "format_on_paste", False), None, "editor")

        self._add_setting("line_numbers", "Editor: Line Numbers",
            "Controls the display of line numbers.",
            "combo", getattr(c, "line_numbers", "on"),
            {"items": ["on", "off", "relative", "interval"]},
            "editor")

        self._add_setting("font_ligatures", "Editor: Font Ligatures",
            "Configures font ligatures or font features.",
            "checkbox", getattr(c, "font_ligatures", False), None, "editor")

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

        self._add_setting("ai.temperature", "AI: Temperature",
            "Controls randomness. Lower = more focused (0.0 - 2.0). Value is x10 (e.g., 7 = 0.7).",
            "spinbox", int(getattr(c.ai, "temperature", 0.7) * 10),
            {"min": 0, "max": 20}, "ai")

        # ── Workbench ──
        self._add_category("Workbench")

        self._add_setting("ui_theme", "Workbench: Color Theme",
            "Specifies the color theme used in the workbench.",
            "combo", getattr(c, "ui_theme", "dark+"),
            {"items": ["dark+", "light+", "high-contrast", "monokai", "solarized-dark",
                       "solarized-light", "github-dark", "one-dark-pro"]},
            "workbench")

        self._add_setting("sidebar_position", "Workbench: Side Bar Location",
            "Controls the location of the sidebar. It can be shown on the left or right of the editor.",
            "combo", getattr(c, "sidebar_position", "left"),
            {"items": ["left", "right"]},
            "workbench")

        self._add_setting("breadcrumbs_enabled", "Breadcrumbs: Enabled",
            "Enable or disable breadcrumb navigation.",
            "checkbox", getattr(c, "breadcrumbs_enabled", True), None, "workbench")

        # ── Files ──
        self._add_category("Files")

        self._add_setting("files_encoding", "Files: Encoding",
            "The default character set encoding to use when reading and writing files.",
            "combo", getattr(c, "files_encoding", "utf-8"),
            {"items": ["utf-8", "utf-16", "ascii", "iso-8859-1", "windows-1252", "shift-jis", "euc-kr"]},
            "files")

        self._add_setting("files_eol", "Files: Eol",
            "The default end of line character.",
            "combo", getattr(c, "files_eol", "auto"),
            {"items": ["auto", "\\n", "\\r\\n"]},
            "files")

        self._add_setting("files_trim_trailing_whitespace", "Files: Trim Trailing Whitespace",
            "When enabled, will trim trailing whitespace when saving a file.",
            "checkbox", getattr(c, "files_trim_trailing_whitespace", False), None, "files")

        self._add_setting("files_insert_final_newline", "Files: Insert Final Newline",
            "When enabled, insert a final new line at the end of the file when saving it.",
            "checkbox", getattr(c, "files_insert_final_newline", False), None, "files")

        # ── Terminal ──
        self._add_category("Terminal")

        self._add_setting("terminal_shell", "Terminal: Shell",
            "The shell to use for the integrated terminal. Leave empty for default.",
            "text", c.terminal_shell, {"placeholder": "Leave empty for default"}, "terminal")

        self._add_setting("terminal_font_size", "Terminal: Font Size",
            "Controls the font size of the terminal.",
            "spinbox", getattr(c, "terminal_font_size", 14), {"min": 8, "max": 36}, "terminal")

        self._add_setting("terminal_cursor_style", "Terminal: Cursor Style",
            "Controls the style of terminal cursor.",
            "combo", getattr(c, "terminal_cursor_style", "block"),
            {"items": ["block", "underline", "bar"]},
            "terminal")

        # ── Workspace ──
        self._add_category("Workspace")

        self._add_setting("workspace_path", "Workspace: Path",
            "The root folder path for the current workspace.",
            "text", c.workspace_path, {"placeholder": "Path to workspace"}, "workspace")

        # ── Telemetry ──
        self._add_category("Telemetry")

        self._add_setting("telemetry_enabled", "Telemetry: Enabled",
            "Enable usage data and errors to be sent to Dardcor.",
            "checkbox", getattr(c, "telemetry_enableTelemetry", True), None, "telemetry")

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
            elif k == "render_whitespace": c.render_whitespace = v
            elif k == "cursor_style": c.cursor_style = v
            elif k == "cursor_blinking": c.cursor_blinking = v
            elif k == "bracket_pair_colorization": c.bracket_pair_colorization = v
            elif k == "smooth_scrolling": c.smooth_scrolling = v
            elif k == "sticky_scroll": c.sticky_scroll = v
            elif k == "format_on_save": c.format_on_save = v
            elif k == "format_on_paste": c.format_on_paste = v
            elif k == "line_numbers": c.line_numbers = v
            elif k == "font_ligatures": c.font_ligatures = v
            elif k == "ai.provider": c.ai.provider = v
            elif k == "ai.model": c.ai.model = v
            elif k == "ai.base_url": c.ai.base_url = v
            elif k == "ai.max_tokens": c.ai.max_tokens = v
            elif k == "ai.temperature": c.ai.temperature = v / 10.0
            elif k == "ui_theme": c.ui_theme = v
            elif k == "sidebar_position": c.sidebar_position = v
            elif k == "breadcrumbs_enabled": c.breadcrumbs_enabled = v
            elif k == "files_encoding": c.files_encoding = v
            elif k == "files_eol": c.files_eol = v
            elif k == "files_trim_trailing_whitespace": c.files_trim_trailing_whitespace = v
            elif k == "files_insert_final_newline": c.files_insert_final_newline = v
            elif k == "workspace_path": c.workspace_path = v
            elif k == "terminal_shell": c.terminal_shell = v
            elif k == "terminal_font_size": c.terminal_font_size = v
            elif k == "terminal_cursor_style": c.terminal_cursor_style = v
            elif k == "telemetry_enabled": c.telemetry_enableTelemetry = v
        c.save()

    def _filter_settings(self, text):
        text = text.lower()
        # Track which categories have visible rows
        visible_categories = set()
        
        for row, category in self._rows:
            visible = not text or text in row.key.lower() or any(
                text in child.text().lower()
                for child in row.findChildren(QLabel)
            )
            row.setVisible(visible)
            if visible and category:
                visible_categories.add(category)
        
        # Show/hide category labels
        for lbl, title in self._category_labels:
            if not text:
                lbl.setVisible(True)
            else:
                # Check if any associated category is visible
                cat_match = any(
                    cat in visible_categories
                    for cat in [title.lower()]
                ) or text in title.lower()
                lbl.setVisible(cat_match)
