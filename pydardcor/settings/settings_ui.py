"""Settings UI - VS Code style interactive settings editor (opens as an editor tab)."""

import os
import json
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QCheckBox, QComboBox, QSpinBox, QScrollArea, QFrame,
    QPushButton, QSizePolicy, QGroupBox, QFormLayout, QMessageBox,
    QPlainTextEdit, QTabWidget, QTreeWidget, QTreeWidgetItem,
    QSplitter, QMenu, QInputDialog, QListWidget, QListWidgetItem
)
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QColor, QFont

from ..core.config import ensure_user_dirs, get_config, get_global_home_dir, get_user_data_dir, get_snippets_dir
from .workspace_config import WorkspaceSettingsHandler, WorkspaceExtensionsHandler, get_all_defaults, get_default_setting
from .settings_migration import run_migrations
from ..editor.snippet_manager import get_snippet_manager


def _theme_colors():
    from ..app.theme_manager import ThemeManager
    return ThemeManager.get_canonical_colors()


class SettingRow(QWidget):
    """Single setting row with label, description, and input widget."""
    changed = Signal()

    def __init__(self, key, label, description, widget_type, value, options=None, parent=None):
        super().__init__(parent)
        self.key = key
        self._setup_ui(label, description, widget_type, value, options)

    def _setup_ui(self, label, description, widget_type, value, options):
        c = _theme_colors()
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
            self._input.setStyleSheet(f"""
                QSpinBox {{
                    background-color: {c['sidebar']}; color: {c['foreground']};
                    border: 1px solid {c['border']}; border-radius: 2px;
                    padding: 4px 8px; font-size: 13px;
                }}
                QSpinBox:focus {{ border: 1px solid {c['accent']}; }}
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
            self._input.setStyleSheet(f"""
                QComboBox {{
                    background-color: {c['sidebar']}; color: {c['foreground']};
                    border: 1px solid {c['border']}; border-radius: 2px;
                    padding: 4px 8px; font-size: 13px;
                }}
                QComboBox:focus {{ border: 1px solid {c['accent']}; }}
                QComboBox::drop-down {{ border: none; width: 20px; }}
                QComboBox QAbstractItemView {{
                    background-color: {c['sidebar']}; color: {c['foreground']};
                    border: 1px solid {c['border']};
                    selection-background-color: {c['selection']};
                }}
            """)
            layout.addWidget(self._input)
        elif widget_type == "text":
            self._input = QLineEdit()
            self._input.setText(str(value or ""))
            self._input.setPlaceholderText(options.get("placeholder", "") if options else "")
            self._input.textChanged.connect(lambda: self.changed.emit())
            self._input.setFixedWidth(400)
            self._input.setStyleSheet(f"""
                QLineEdit {{
                    background-color: {c['sidebar']}; color: {c['foreground']};
                    border: 1px solid {c['border']}; border-radius: 2px;
                    padding: 4px 8px; font-size: 13px;
                }}
                QLineEdit:focus {{ border: 1px solid {c['accent']}; }}
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


class RegistrySettingRow(QWidget):
    """JSON-backed registry editor stored in ~/.dardcor-code."""
    changed = Signal()

    def __init__(self, key, label, description, path, root_key, parent=None):
        super().__init__(parent)
        self.key = key
        self.path = path
        self.root_key = root_key
        self._setup_ui(label, description)

    def _setup_ui(self, label, description):
        c = _theme_colors()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 8, 0, 8)
        layout.setSpacing(8)

        title = QLabel(label)
        title.setStyleSheet("color: #e0e0e0; font-size: 13px; font-weight: 600;")
        layout.addWidget(title)

        desc = QLabel(f"{description}\nFile: {self.path}")
        desc.setStyleSheet("color: #858585; font-size: 12px;")
        desc.setWordWrap(True)
        layout.addWidget(desc)

        self._input = QPlainTextEdit()
        self._input.setPlainText(self._read_pretty_json())
        self._input.textChanged.connect(lambda: self.changed.emit())
        self._input.setMinimumHeight(180)
        self._input.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 3px;
                padding: 8px; font-family: Consolas, 'Cascadia Code', monospace;
                font-size: 12px;
            }}
            QPlainTextEdit:focus {{ border: 1px solid {c['accent']}; }}
        """)
        layout.addWidget(self._input)

    def _read_pretty_json(self) -> str:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            data = {self.root_key: {}}
        return json.dumps(data, indent=2, ensure_ascii=False)

    def get_value(self):
        text = self._input.toPlainText().strip() or f'{{"{self.root_key}": {{}}}}'
        data = json.loads(text)
        if not isinstance(data, dict) or not isinstance(data.get(self.root_key), dict):
            raise ValueError(f"JSON must be an object with '{self.root_key}' object")
        return data

    def save(self):
        data = self.get_value()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")


class LanguageSpecificSettingsWidget(QWidget):
    """Language-specific settings editor (e.g. [python], [typescript])."""
    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._data: dict = {}
        self._setup_ui()

    def _setup_ui(self):
        c = _theme_colors()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        header = QLabel("Language-specific settings override values for a specific language.")
        header.setStyleSheet("color: #858585; font-size: 12px; padding: 4px 0;")
        header.setWordWrap(True)
        layout.addWidget(header)

        form = QHBoxLayout()
        self._lang_combo = QComboBox()
        self._lang_combo.setEditable(True)
        self._lang_combo.addItems([
            "python", "javascript", "typescript", "html", "css", "json",
            "markdown", "yaml", "xml", "shell", "sql", "rust", "go", "java",
            "cpp", "csharp", "ruby", "php"
        ])
        self._lang_combo.setStyleSheet(f"""
            QComboBox {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 2px;
                padding: 4px 8px; font-size: 13px;
            }}
        """)
        form.addWidget(QLabel("Language:"))
        form.addWidget(self._lang_combo)

        self._add_setting_btn = QPushButton("Add Setting")
        self._add_setting_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {c['accent']}; color: #fff;
                border: none; border-radius: 3px;
                padding: 4px 12px; font-size: 12px;
            }}
            QPushButton:hover {{ background-color: {c['accent_hover']}; }}
        """)
        self._add_setting_btn.clicked.connect(self._add_language_setting)
        form.addWidget(self._add_setting_btn)
        layout.addLayout(form)

        self._editor = QPlainTextEdit()
        self._editor.setPlaceholderText("{\n  \"editor.tabSize\": 2\n}")
        self._editor.setMinimumHeight(150)
        self._editor.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 3px;
                padding: 8px; font-family: Consolas, monospace; font-size: 12px;
            }}
        """)
        self._editor.textChanged.connect(lambda: self.changed.emit())
        layout.addWidget(self._editor)

    def _add_language_setting(self):
        key, ok = QInputDialog.getText(self, "Add Setting Key",
            "Enter setting key (e.g. editor.tabSize):")
        if ok and key:
            value, ok2 = QInputDialog.getText(self, "Add Setting Value",
                f"Enter value for '{key}':")
            if ok2:
                try:
                    parsed = json.loads(value)
                except (json.JSONDecodeError, ValueError):
                    parsed = value
                try:
                    current = json.loads(self._editor.toPlainText() or "{}")
                except json.JSONDecodeError:
                    current = {}
                current[key] = parsed
                self._editor.setPlainText(json.dumps(current, indent=2))
                self.changed.emit()

    def get_data(self) -> dict:
        try:
            return json.loads(self._editor.toPlainText() or "{}")
        except json.JSONDecodeError:
            return {}

    def set_data(self, data: dict):
        self._editor.setPlainText(json.dumps(data, indent=2))

    def get_language(self) -> str:
        return self._lang_combo.currentText()


class SnippetsEditorWidget(QWidget):
    """Inline snippet editor for user snippets."""
    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._manager = get_snippet_manager()
        self._setup_ui()

    def _setup_ui(self):
        c = _theme_colors()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        header = QLabel("Edit user snippets. Changes apply immediately.")
        header.setStyleSheet("color: #858585; font-size: 12px; padding: 4px 0;")
        header.setWordWrap(True)
        layout.addWidget(header)

        lang_layout = QHBoxLayout()
        self._lang_combo = QComboBox()
        self._lang_combo.setEditable(True)
        self._lang_combo.addItems(["global", "python", "javascript", "typescript", "html", "css", "json", "markdown"])
        self._lang_combo.currentTextChanged.connect(self._load_snippets)
        self._lang_combo.setStyleSheet(f"""
            QComboBox {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 2px;
                padding: 4px 8px; font-size: 13px;
            }}
        """)
        lang_layout.addWidget(QLabel("Language:"))
        lang_layout.addWidget(self._lang_combo)
        lang_layout.addStretch()
        layout.addLayout(lang_layout)

        self._editor = QPlainTextEdit()
        self._editor.setMinimumHeight(200)
        self._editor.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 3px;
                padding: 8px; font-family: Consolas, monospace; font-size: 12px;
            }}
            QPlainTextEdit:focus {{ border: 1px solid {c['accent']}; }}
        """)
        self._editor.setPlaceholderText('{\n  "Print to console": {\n    "prefix": "log",\n    "body": ["console.log($1);"],\n    "description": "Log output to console"\n  }\n}')
        self._editor.textChanged.connect(lambda: self.changed.emit())
        layout.addWidget(self._editor)

    def _load_snippets(self, lang: str):
        fpath = os.path.join(get_snippets_dir(), f"{lang}.json")
        if os.path.exists(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    content = f.read()
                lines = [l for l in content.split("\n") if not l.strip().startswith("//")]
                data = json.loads("\n".join(lines))
                self._editor.setPlainText(json.dumps(data, indent=2, ensure_ascii=False))
            except Exception:
                self._editor.setPlainText("{}")
        else:
            self._editor.setPlainText("{}")

    def get_snippets(self) -> dict:
        try:
            return json.loads(self._editor.toPlainText() or "{}")
        except json.JSONDecodeError:
            return {}

    def get_language(self) -> str:
        return self._lang_combo.currentText()

    def save_current(self):
        lang = self.get_language()
        data = self.get_snippets()
        fpath = os.path.join(get_snippets_dir(), f"{lang}.json")
        os.makedirs(os.path.dirname(fpath), exist_ok=True)
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        self._manager._load_language(lang)


class SettingsUIWidget(QWidget):
    """Full settings UI panel that can be embedded in an editor tab."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._config = get_config()
        self._rows = []
        self._category_labels = []
        self._dirty = False
        self._setup_ui()
        self._load_workspace_settings()
        self._load_user_settings_json()

    def get_file_path(self):
        return ""
    def is_dirty(self):
        return self._dirty
    def get_language(self):
        return "settings"
    def get_content(self):
        return ""

    def _setup_ui(self):
        c = _theme_colors()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.setStyleSheet(f"background-color: {c['background']};")

        header = QWidget()
        header.setFixedHeight(50)
        header.setStyleSheet(f"background-color: {c['background']}; border-bottom: 1px solid {c['border']};")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(24, 0, 24, 0)

        title = QLabel("\u2699 Settings")
        title.setStyleSheet("color: #cccccc; font-size: 18px; font-weight: 300;")
        header_layout.addWidget(title)
        header_layout.addStretch()

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
        self._scope_user.clicked.connect(lambda: self._switch_scope("user"))
        self._scope_ws.clicked.connect(lambda: self._switch_scope("workspace"))
        header_layout.addWidget(self._scope_user)
        header_layout.addWidget(self._scope_ws)

        self._save_btn = QPushButton("Save")
        self._save_btn.setEnabled(False)
        self._save_btn.setCursor(Qt.PointingHandCursor)
        self._save_btn.clicked.connect(self._save_settings)
        self._save_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {c['accent']};
                color: #ffffff;
                border: none;
                border-radius: 3px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
            }}
            QPushButton:hover:enabled {{ background-color: {c['accent_hover']}; }}
            QPushButton:disabled {{
                background-color: {c['hover']};
                color: #666666;
            }}
        """)
        header_layout.addWidget(self._save_btn)

        self._migrate_btn = QPushButton("Run Migrations")
        self._migrate_btn.setFixedHeight(24)
        self._migrate_btn.setCursor(Qt.PointingHandCursor)
        self._migrate_btn.clicked.connect(self._run_migrations)
        self._migrate_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #4a90d9;
                border: 1px solid #4a90d9; border-radius: 3px;
                padding: 4px 10px; font-size: 11px;
            }
            QPushButton:hover { background-color: #1a3a5c; }
        """)
        header_layout.addWidget(self._migrate_btn)
        layout.addWidget(header)

        search_bar = QWidget()
        search_bar.setFixedHeight(40)
        search_bar.setStyleSheet(f"background-color: {c['background']};")
        search_layout = QHBoxLayout(search_bar)
        search_layout.setContentsMargins(24, 8, 24, 8)

        self._search = QLineEdit()
        self._search.setPlaceholderText("Search settings")
        self._search.setStyleSheet(f"""
            QLineEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 4px;
                padding: 6px 12px; font-size: 13px;
            }}
            QLineEdit:focus {{ border: 1px solid {c['accent']}; }}
        """)
        self._search.textChanged.connect(self._filter_settings)
        search_layout.addWidget(self._search)
        layout.addWidget(search_bar)

        self._tabs = QTabWidget()
        self._tabs.setStyleSheet(f"""
            QTabWidget::pane {{ border: none; background-color: {c['background']}; }}
            QTabBar::tab {{
                background-color: {c['background']}; color: #969696;
                padding: 6px 14px; border: none;
                border-bottom: 2px solid transparent; font-size: 12px;
            }}
            QTabBar::tab:selected {{
                color: #ffffff; border-bottom: 2px solid {c['accent']};
            }}
            QTabBar::tab:hover:!selected {{ color: #cccccc; }}
        """)

        self._tabs.addTab(self._build_common_tab(), "Common")
        self._tabs.addTab(self._build_json_editor_tab(), "JSON")
        self._tabs.addTab(self._build_language_specific_tab(), "Language")
        self._tabs.addTab(self._build_workspace_config_tab(), "Workspace")
        self._tabs.addTab(self._build_snippets_tab(), "Snippets")
        self._tabs.addTab(self._build_defaults_tab(), "Defaults")

        self._tabs.currentChanged.connect(self._on_tab_changed)
        layout.addWidget(self._tabs)

        from ..app.theme_manager import ThemeManager
        ThemeManager.patch_widget(self)

    def _on_tab_changed(self, idx: int):
        if idx == 0:
            self._save_btn.setVisible(True)
        else:
            self._save_btn.setVisible(False)

    def _build_common_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; } QScrollBar:vertical { background-color: transparent; width: 4px; } QScrollBar::handle:vertical { background-color: #454545; border-radius: 2px; }")

        self._content = QWidget()
        self._content_layout = QVBoxLayout(self._content)
        self._content_layout.setContentsMargins(24, 16, 24, 16)
        self._content_layout.setSpacing(0)

        self._build_settings()

        self._content_layout.addStretch()
        scroll.setWidget(self._content)
        return scroll

    def _build_json_editor_tab(self) -> QWidget:
        c = _theme_colors()
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        header = QLabel("Raw settings.json editor. Edit your user settings directly.")
        header.setStyleSheet("color: #858585; font-size: 12px;")
        header.setWordWrap(True)
        layout.addWidget(header)

        self._json_editor = QPlainTextEdit()
        self._json_editor.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 3px;
                padding: 8px; font-family: Consolas, 'Cascadia Code', monospace;
                font-size: 12px;
            }}
            QPlainTextEdit:focus {{ border: 1px solid {c['accent']}; }}
        """)
        self._json_editor.setMinimumHeight(300)
        self._json_editor.textChanged.connect(self._mark_dirty)
        layout.addWidget(self._json_editor)

        btn_layout = QHBoxLayout()
        save_json = QPushButton("Save JSON")
        save_json.setStyleSheet(f"""
            QPushButton {{
                background-color: {c['accent']}; color: #fff;
                border: none; border-radius: 3px;
                padding: 6px 16px; font-size: 12px;
            }}
            QPushButton:hover {{ background-color: {c['accent_hover']}; }}
        """)
        save_json.clicked.connect(self._save_json_settings)
        btn_layout.addWidget(save_json)

        btn_layout.addStretch()
        layout.addLayout(btn_layout)

        return w

    def _build_language_specific_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        self._lang_specific = LanguageSpecificSettingsWidget()
        self._lang_specific.changed.connect(self._mark_dirty)
        layout.addWidget(self._lang_specific)

        save_lang = QPushButton("Save Language Settings")
        save_lang.clicked.connect(self._save_language_settings)
        c = _theme_colors()
        save_lang.setStyleSheet(f"""
            QPushButton {{
                background-color: {c['accent']}; color: #fff;
                border: none; border-radius: 3px;
                padding: 6px 16px; font-size: 12px;
            }}
            QPushButton:hover {{ background-color: {c['accent_hover']}; }}
        """)
        layout.addWidget(save_lang)
        layout.addStretch()
        return w

    def _build_workspace_config_tab(self) -> QWidget:
        c = _theme_colors()
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        self._ws_path_label = QLabel("Workspace: (not set)")
        self._ws_path_label.setStyleSheet("color: #858585; font-size: 12px;")
        layout.addWidget(self._ws_path_label)

        tabs = QTabWidget()
        tabs.setStyleSheet(f"""
            QTabWidget::pane {{ border: none; background-color: {c['background']}; }}
            QTabBar::tab {{ background: transparent; color: #858585; padding: 4px 10px; border-bottom: 2px solid transparent; font-size: 11px; }}
            QTabBar::tab:selected {{ color: #fff; border-bottom: 2px solid {c['accent']}; }}
        """)

        self._ws_settings_editor = QPlainTextEdit()
        self._ws_settings_editor.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 3px;
                padding: 8px; font-family: Consolas, monospace; font-size: 12px;
            }}
        """)
        tabs.addTab(self._ws_settings_editor, "settings.json")

        self._ws_extensions_editor = QPlainTextEdit()
        self._ws_extensions_editor.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 3px;
                padding: 8px; font-family: Consolas, monospace; font-size: 12px;
            }}
        """)
        tabs.addTab(self._ws_extensions_editor, "extensions.json")

        layout.addWidget(tabs)

        btn_layout = QHBoxLayout()
        save_ws = QPushButton("Save Workspace Config")
        save_ws.setStyleSheet(f"""
            QPushButton {{
                background-color: {c['accent']}; color: #fff;
                border: none; border-radius: 3px;
                padding: 6px 16px; font-size: 12px;
            }}
            QPushButton:hover {{ background-color: {c['accent_hover']}; }}
        """)
        save_ws.clicked.connect(self._save_workspace_config)
        btn_layout.addWidget(save_ws)
        btn_layout.addStretch()
        layout.addLayout(btn_layout)

        return w

    def _build_snippets_tab(self) -> QWidget:
        c = _theme_colors()
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        self._snippets_editor = SnippetsEditorWidget()
        self._snippets_editor.changed.connect(self._mark_dirty)
        layout.addWidget(self._snippets_editor)

        btn_layout = QHBoxLayout()
        save_snip = QPushButton("Save Snippets")
        save_snip.setStyleSheet(f"""
            QPushButton {{
                background-color: {c['accent']}; color: #fff;
                border: none; border-radius: 3px;
                padding: 6px 16px; font-size: 12px;
            }}
            QPushButton:hover {{ background-color: {c['accent_hover']}; }}
        """)
        save_snip.clicked.connect(self._save_snippets)
        btn_layout.addWidget(save_snip)
        btn_layout.addStretch()
        layout.addLayout(btn_layout)

        return w

    def _build_defaults_tab(self) -> QWidget:
        c = _theme_colors()
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        header = QLabel("Default settings values (read-only). These are the built-in defaults Dardcor Code uses.")
        header.setStyleSheet("color: #858585; font-size: 12px;")
        header.setWordWrap(True)
        layout.addWidget(header)

        self._defaults_search = QLineEdit()
        self._defaults_search.setPlaceholderText("Search defaults")
        self._defaults_search.setStyleSheet(f"""
            QLineEdit {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; border-radius: 3px;
                padding: 4px 8px; font-size: 12px;
            }}
        """)
        self._defaults_search.textChanged.connect(self._filter_defaults)
        layout.addWidget(self._defaults_search)

        self._defaults_tree = QTreeWidget()
        self._defaults_tree.setHeaderLabels(["Setting", "Default Value"])
        self._defaults_tree.setColumnWidth(0, 350)
        self._defaults_tree.setStyleSheet(f"""
            QTreeWidget {{
                background-color: {c['sidebar']}; color: {c['foreground']};
                border: 1px solid {c['border']}; font-size: 12px;
            }}
            QTreeWidget::item {{ padding: 2px 4px; }}
            QHeaderView::section {{
                background-color: {c['background']}; color: #858585;
                border: none; border-bottom: 1px solid {c['border']};
                padding: 4px; font-weight: bold;
            }}
        """)

        defaults = get_all_defaults()
        for key in sorted(defaults.keys()):
            item = QTreeWidgetItem([key, json.dumps(defaults[key], ensure_ascii=False) if not isinstance(defaults[key], str) else defaults[key]])
            self._defaults_tree.addTopLevelItem(item)

        layout.addWidget(self._defaults_tree)
        return w

    def _filter_defaults(self, text: str):
        text = text.lower()
        for i in range(self._defaults_tree.topLevelItemCount()):
            item = self._defaults_tree.topLevelItem(i)
            match = not text or text in item.text(0).lower() or text in item.text(1).lower()
            item.setHidden(not match)

    def _switch_scope(self, scope: str):
        is_user = scope == "user"
        self._scope_user.setStyleSheet("""
            QPushButton { background: transparent; color: #858585; border: none; padding: 4px 12px; font-size: 12px; }
            QPushButton:hover { color: #cccccc; }
        """ if not is_user else """
            QPushButton { background: transparent; color: #cccccc; border: none; border-bottom: 2px solid #4a0072; padding: 4px 12px; font-size: 12px; }
            QPushButton:hover { color: #cccccc; }
        """)
        self._scope_ws.setStyleSheet("""
            QPushButton { background: transparent; color: #858585; border: none; padding: 4px 12px; font-size: 12px; }
            QPushButton:hover { color: #cccccc; }
        """ if is_user else """
            QPushButton { background: transparent; color: #cccccc; border: none; border-bottom: 2px solid #4a0072; padding: 4px 12px; font-size: 12px; }
            QPushButton:hover { color: #cccccc; }
        """)
        if scope == "workspace":
            self._load_workspace_settings()
        else:
            self._load_user_settings_json()

    def _load_workspace_settings(self):
        ws_path = getattr(self._config, "workspace_path", "")
        self._ws_path_label.setText(f"Workspace: {ws_path}" if ws_path else "Workspace: (not set)")
        if ws_path:
            ws_handler = WorkspaceSettingsHandler(ws_path)
            data = ws_handler.load()
            self._ws_settings_editor.setPlainText(json.dumps(data, indent=2) if data else "{}")
            ext_handler = WorkspaceExtensionsHandler(ws_path)
            ext_data = ext_handler.load()
            self._ws_extensions_editor.setPlainText(json.dumps(ext_data, indent=2) if ext_data else '{\n  "recommendations": []\n}')
        else:
            self._ws_settings_editor.setPlainText("# No workspace set. Open a folder first.")
            self._ws_extensions_editor.setPlainText("# No workspace set. Open a folder first.")

    def _load_user_settings_json(self):
        settings_path = os.path.join(get_user_data_dir(), "settings.json")
        if os.path.exists(settings_path):
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._json_editor.setPlainText(json.dumps(data, indent=2))
            except Exception:
                self._json_editor.setPlainText("{}")
        else:
            self._json_editor.setPlainText("{}")

    def _add_category(self, title):
        c = _theme_colors()
        lbl = QLabel(title)
        lbl.setStyleSheet(f"""
            color: {c['foreground']}; font-size: 14px; font-weight: bold;
            padding: 16px 0 8px 0; border-bottom: 1px solid {c['border']};
        """)
        self._content_layout.addWidget(lbl)
        self._category_labels.append((lbl, title))
        return lbl

    def _add_setting(self, key, label, description, widget_type, value, options=None, category=None):
        row = SettingRow(key, label, description, widget_type, value, options)
        row.changed.connect(self._mark_dirty)
        self._rows.append((row, category))

        sep = QFrame()
        sep.setFixedHeight(1)
        sep.setStyleSheet(f"background-color: {_theme_colors()['border']};")

        self._content_layout.addWidget(row)
        self._content_layout.addWidget(sep)
        return row

    def _add_registry_setting(self, key, label, description, relative_path, root_key, category=None):
        path = os.path.join(get_global_home_dir(), relative_path)
        row = RegistrySettingRow(key, label, description, path, root_key)
        row.changed.connect(self._mark_dirty)
        self._rows.append((row, category))

        sep = QFrame()
        sep.setFixedHeight(1)
        sep.setStyleSheet(f"background-color: {_theme_colors()['border']};")

        self._content_layout.addWidget(row)
        self._content_layout.addWidget(sep)
        return row

    def _build_settings(self):
        c = self._config

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

        self._add_category("Workbench")
        from ..app.theme_manager import ThemeManager
        ThemeManager.register_extension_themes()
        theme_ids = [t["id"] for t in ThemeManager.get_theme_list()]
        self._add_setting("color_theme", "Workbench: Color Theme",
            "Workbench color theme. Includes built-in and extension themes.",
            "combo", getattr(c, "color_theme", "") or "dardcor-purple",
            {"items": theme_ids},
            "workbench")
        self._add_setting("sidebar_position", "Workbench: Side Bar Location",
            "Controls the location of the sidebar. It can be shown on the left or right of the editor.",
            "combo", getattr(c, "sidebar_position", "left"),
            {"items": ["left", "right"]},
            "workbench")
        self._add_setting("breadcrumbs_enabled", "Breadcrumbs: Enabled",
            "Enable or disable breadcrumb navigation.",
            "checkbox", getattr(c, "breadcrumbs_enabled", True), None, "workbench")

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

        self._add_category("Workspace")
        self._add_setting("workspace_path", "Workspace: Path",
            "The root folder path for the current workspace.",
            "text", c.workspace_path, {"placeholder": "Path to workspace"}, "workspace")

        ensure_user_dirs()
        self._add_category("Dardcor Agent")
        self._add_registry_setting("mcp_servers", "MCP: Servers",
            "Edit MCP server list. Add new entries under the servers object.",
            os.path.join("mcp", "servers.json"), "servers", "dardcor agent")
        self._add_registry_setting("lsp_servers", "LSP: Servers",
            "Edit language server list. Add commands under the servers object.",
            os.path.join("lsp", "servers.json"), "servers", "dardcor agent")
        self._add_registry_setting("skills", "Skills: Registry",
            "Edit skill registry. Add source and skill name under the skills object.",
            os.path.join("skills", "skills.json"), "skills", "dardcor agent")

        self._add_category("Telemetry")
        self._add_setting("telemetry_enabled", "Telemetry: Enabled",
            "Enable usage data and errors to be sent to Dardcor.",
            "checkbox", getattr(c, "telemetry_enableTelemetry", True), None, "telemetry")

    def _mark_dirty(self):
        self._dirty = True
        if hasattr(self, "_save_btn"):
            self._save_btn.setEnabled(True)

    def _save_settings(self):
        c = self._config
        old_theme = getattr(c, "color_theme", "")
        try:
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
                elif k == "color_theme":
                    c.color_theme = v
                    self._apply_color_theme(v)
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
                elif isinstance(row, RegistrySettingRow): row.save()
        except (json.JSONDecodeError, ValueError) as exc:
            QMessageBox.warning(self, "Invalid registry JSON", str(exc))
            return
        c.save()
        self._dirty = False
        if hasattr(self, "_save_btn"):
            self._save_btn.setEnabled(False)

    def _save_json_settings(self):
        text = self._json_editor.toPlainText().strip()
        if not text:
            text = "{}"
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            QMessageBox.warning(self, "Invalid JSON", str(e))
            return
        settings_path = os.path.join(get_user_data_dir(), "settings.json")
        os.makedirs(os.path.dirname(settings_path), exist_ok=True)
        with open(settings_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        QMessageBox.information(self, "Settings", "User settings.json saved successfully.")

    def _save_language_settings(self):
        lang = self._lang_specific.get_language()
        data = self._lang_specific.get_data()
        settings_path = os.path.join(get_user_data_dir(), "settings.json")
        try:
            if os.path.exists(settings_path):
                with open(settings_path, "r", encoding="utf-8") as f:
                    all_settings = json.load(f)
            else:
                all_settings = {}
            lang_key = f"[{lang}]"
            all_settings[lang_key] = data
            os.makedirs(os.path.dirname(settings_path), exist_ok=True)
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(all_settings, f, indent=2, ensure_ascii=False)
                f.write("\n")
            QMessageBox.information(self, "Language Settings", f"Settings for [{lang}] saved to user settings.")
        except Exception as e:
            QMessageBox.warning(self, "Error", str(e))

    def _save_workspace_config(self):
        ws_path = getattr(self._config, "workspace_path", "")
        if not ws_path:
            QMessageBox.warning(self, "Workspace", "No workspace path set. Set it in the Common tab first.")
            return
        try:
            ws_data = json.loads(self._ws_settings_editor.toPlainText())
            ws_handler = WorkspaceSettingsHandler(ws_path)
            ws_handler.save(ws_data)
        except json.JSONDecodeError as e:
            QMessageBox.warning(self, "Invalid settings.json", str(e))
            return
        try:
            ext_data = json.loads(self._ws_extensions_editor.toPlainText())
            ext_handler = WorkspaceExtensionsHandler(ws_path)
            ext_handler.save(ext_data)
        except json.JSONDecodeError as e:
            QMessageBox.warning(self, "Invalid extensions.json", str(e))
            return
        QMessageBox.information(self, "Workspace", "Workspace config files saved.")

    def _save_snippets(self):
        self._snippets_editor.save_current()
        QMessageBox.information(self, "Snippets", "Snippets saved successfully.")

    def _run_migrations(self):
        try:
            run_migrations()
            QMessageBox.information(self, "Migrations", "Settings migrations completed.")
        except Exception as e:
            QMessageBox.warning(self, "Migration Error", str(e))

    def _restart_ide(self):
        import sys
        from PySide6.QtCore import QCoreApplication, QProcess
        args = sys.argv[:]
        if args:
            program = os.path.abspath(args[0])
            restart_args = args[1:]
        else:
            program = sys.executable
            restart_args = []
        if program.endswith(".py"):
            restart_args = [program, *restart_args]
            program = sys.executable
        QProcess.startDetached(program, restart_args)
        QCoreApplication.quit()

    def _apply_color_theme(self, theme_id: str):
        from PySide6.QtWidgets import QApplication
        from ..app.theme_manager import ThemeManager
        p = self.parentWidget()
        while p:
            if hasattr(p, "_set_theme"):
                p._set_theme(theme_id)
                return
            p = p.parentWidget()
        app = QApplication.instance()
        if not app:
            return
        window = app.activeWindow()
        if window and hasattr(window, "_set_theme"):
            window._set_theme(theme_id)
            return
        ThemeManager.register_extension_themes()
        ThemeManager.apply_theme(app, theme_id)

    def _filter_settings(self, text):
        text = text.lower()
        visible_categories = set()
        for row, category in self._rows:
            visible = not text or text in row.key.lower() or any(
                text in child.text().lower()
                for child in row.findChildren(QLabel)
            )
            row.setVisible(visible)
            if visible and category:
                visible_categories.add(category)
        for lbl, title in self._category_labels:
            if not text:
                lbl.setVisible(True)
            else:
                cat_match = any(
                    cat in visible_categories
                    for cat in [title.lower()]
                ) or text in title.lower()
                lbl.setVisible(cat_match)
