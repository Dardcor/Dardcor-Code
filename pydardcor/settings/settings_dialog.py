"""Settings Dialog - VS Code style settings UI with tabs for Editor, Appearance, AI, Workspace, Language, Sync, Profiles, and About."""

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QTabWidget,
    QWidget, QLabel, QLineEdit, QPushButton, QGroupBox,
    QFormLayout, QCheckBox, QSpinBox, QComboBox,
    QDialogButtonBox, QMessageBox, QScrollArea, QFrame,
    QPlainTextEdit, QListWidget, QListWidgetItem, QInputDialog,
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont

from ..core.config import get_config, get_snippets_dir, get_global_home_dir, get_user_data_dir
from .profile import ProfileManager
from .workspace_config import WorkspaceSettingsHandler, WorkspaceExtensionsHandler
from ..editor.snippet_manager import get_snippet_manager


class SettingsDialog(QDialog):
    """VS Code style settings dialog with comprehensive tabs."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._config = get_config()
        self._profile_manager = ProfileManager(self)
        self._snippet_manager = get_snippet_manager()
        self.setWindowTitle("Settings")
        self.setMinimumSize(720, 600)
        self.setStyleSheet("""
            QDialog { background-color: #000000; color: #cccccc; }
            QTabWidget::pane { border: none; background-color: #000000; }
            QTabBar::tab { background-color: #080808; color: #969696; padding: 8px 16px; border: none; border-bottom: 2px solid transparent; font-size: 13px; }
            QTabBar::tab:selected { background-color: #000000; color: #ffffff; border-bottom: 2px solid #4a0072; }
            QTabBar::tab:hover:!selected { color: #cccccc; }
            QGroupBox { background-color: #000000; border: 1px solid #2c004a; border-radius: 4px; margin-top: 16px; padding: 16px 12px 12px; font-size: 13px; font-weight: bold; color: #cccccc; }
            QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 8px; }
            QLabel { color: #cccccc; font-size: 13px; }
            QLineEdit { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; border-radius: 2px; padding: 5px 8px; font-size: 13px; min-height: 24px; }
            QLineEdit:focus { border: 1px solid #4a0072; }
            QComboBox { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; border-radius: 2px; padding: 5px 8px; font-size: 13px; min-height: 24px; }
            QComboBox:focus { border: 1px solid #4a0072; }
            QComboBox::drop-down { border: none; width: 20px; }
            QComboBox QAbstractItemView { background-color: #000000; color: #cccccc; border: 1px solid #454545; selection-background-color: #04395e; }
            QSpinBox { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; border-radius: 2px; padding: 5px 8px; font-size: 13px; min-height: 24px; }
            QSpinBox:focus { border: 1px solid #4a0072; }
            QCheckBox { color: #cccccc; font-size: 13px; spacing: 8px; }
            QCheckBox::indicator { width: 16px; height: 16px; border: 1px solid #2c004a; border-radius: 2px; background-color: #2c004a; }
            QCheckBox::indicator:checked { background-color: #4a0072; border-color: #4a0072; }
            QListWidget { background-color: #000000; color: #cccccc; border: 1px solid #2c004a; }
            QListWidget::item { padding: 6px; border-bottom: 1px solid #1a0033; }
            QListWidget::item:selected { background-color: #2c004a; }
            QPushButton { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; border-radius: 2px; padding: 6px 16px; font-size: 12px; }
            QPushButton:hover { background-color: #1a0033; border: 1px solid #4a0072; }
            QPlainTextEdit { background-color: #0a0a0a; color: #cccccc; border: 1px solid #2c004a; padding: 6px; font-family: Consolas, monospace; font-size: 12px; }
        """)
        self._setup_ui()
        self._load_settings()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QWidget()
        header.setFixedHeight(40)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #3c0068;")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(16, 0, 16, 0)
        title = QLabel("Settings")
        title.setStyleSheet("font-size: 14px; font-weight: bold; color: #cccccc;")
        header_layout.addWidget(title)
        header_layout.addSpacing(40)

        self._search_input = QLineEdit()
        self._search_input.setPlaceholderText("Search settings...")
        self._search_input.setFixedWidth(240)
        self._search_input.setStyleSheet("QLineEdit { background-color: #161616; color: #cccccc; border: 1px solid #3c0068; border-radius: 4px; padding: 4px 10px; font-size: 12px; } QLineEdit:focus { border-color: #5a009c; }")
        self._search_input.textChanged.connect(self._on_search_changed)
        header_layout.addWidget(self._search_input)
        header_layout.addStretch()
        layout.addWidget(header)

        self._tabs = QTabWidget()
        self._tabs.addTab(self._build_editor_tab(), "Editor")
        self._tabs.addTab(self._build_appearance_tab(), "Appearance")
        self._tabs.addTab(self._build_ai_tab(), "AI")
        self._tabs.addTab(self._build_workspace_tab(), "Workspace")
        self._tabs.addTab(self._build_language_tab(), "Language")
        self._tabs.addTab(self._build_sync_tab(), "Sync")
        self._tabs.addTab(self._build_profiles_tab(), "Profiles")
        self._tabs.addTab(self._build_about_tab(), "About")
        layout.addWidget(self._tabs)

        btn_container = QWidget()
        btn_container.setStyleSheet("background-color: #000000; border-top: 1px solid #3c0068;")
        btn_layout = QHBoxLayout(btn_container)
        btn_layout.setContentsMargins(16, 8, 16, 8)
        btn_layout.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setFixedHeight(30)
        cancel_btn.setStyleSheet("QPushButton { background-color: transparent; color: #cccccc; border: 1px solid #2c004a; border-radius: 2px; padding: 4px 20px; font-size: 13px; } QPushButton:hover { background-color: #2c004a; }")
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        save_btn = QPushButton("Save")
        save_btn.setFixedHeight(30)
        save_btn.setStyleSheet("QPushButton { background-color: #5a009c; color: #ffffff; border: none; border-radius: 2px; padding: 4px 20px; font-size: 13px; font-weight: bold; } QPushButton:hover { background-color: #7a00d3; } QPushButton:pressed { background-color: #3c0068; }")
        save_btn.clicked.connect(self._save_settings)
        btn_layout.addWidget(save_btn)
        layout.addWidget(btn_container)

    def _build_editor_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; }")
        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)

        editor_group = QGroupBox("Editor Settings")
        editor_layout = QFormLayout()
        editor_layout.setSpacing(10)
        self._font_family = QComboBox()
        self._font_family.setEditable(True)
        self._font_family.addItems(["Cascadia Code", "Consolas", "Fira Code", "JetBrains Mono", "Source Code Pro", "Menlo", "Monaco", "Courier New"])
        editor_layout.addRow("Font Family:", self._font_family)
        self._font_size = QSpinBox()
        self._font_size.setRange(8, 32)
        self._font_size.setValue(13)
        editor_layout.addRow("Font Size:", self._font_size)
        self._tab_size = QSpinBox()
        self._tab_size.setRange(1, 8)
        self._tab_size.setValue(4)
        editor_layout.addRow("Tab Size:", self._tab_size)
        self._word_wrap = QCheckBox("Word Wrap")
        editor_layout.addRow("", self._word_wrap)
        self._minimap = QCheckBox("Show Minimap")
        self._minimap.setChecked(True)
        editor_layout.addRow("", self._minimap)
        self._show_line_numbers = QCheckBox("Show Line Numbers")
        self._show_line_numbers.setChecked(True)
        editor_layout.addRow("", self._show_line_numbers)
        self._sticky_scroll = QCheckBox("Show Sticky Scroll")
        self._sticky_scroll.setChecked(True)
        editor_layout.addRow("", self._sticky_scroll)
        self._insert_spaces = QCheckBox("Insert Spaces (Use spaces instead of tabs)")
        self._insert_spaces.setChecked(True)
        editor_layout.addRow("", self._insert_spaces)
        self._auto_save_cb = QCheckBox("Auto-save files")
        self._auto_save_cb.setChecked(True)
        editor_layout.addRow("", self._auto_save_cb)
        self._format_on_save = QCheckBox("Format On Save")
        editor_layout.addRow("", self._format_on_save)
        self._smooth_scrolling = QCheckBox("Smooth Scrolling")
        self._smooth_scrolling.setChecked(True)
        editor_layout.addRow("", self._smooth_scrolling)
        editor_group.setLayout(editor_layout)
        form.addWidget(editor_group)
        form.addStretch()
        scroll.setWidget(tab)
        return scroll

    def _build_appearance_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; }")
        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)
        explorer_group = QGroupBox("Explorer")
        explorer_layout = QFormLayout()
        explorer_layout.setSpacing(10)
        self._show_folders = QCheckBox("Show folders")
        self._show_folders.setChecked(True)
        explorer_layout.addRow("", self._show_folders)
        self._show_open_editors = QCheckBox("Show Open Editors section")
        explorer_layout.addRow("", self._show_open_editors)
        self._show_outline = QCheckBox("Show Outline panel")
        self._show_outline.setChecked(True)
        explorer_layout.addRow("", self._show_outline)
        self._show_timeline = QCheckBox("Show Timeline panel")
        self._show_timeline.setChecked(True)
        explorer_layout.addRow("", self._show_timeline)
        explorer_group.setLayout(explorer_layout)
        form.addWidget(explorer_group)
        ui_group = QGroupBox("Interface")
        ui_layout = QFormLayout()
        ui_layout.setSpacing(10)
        self._ui_zoom = QSpinBox()
        self._ui_zoom.setRange(-5, 5)
        self._ui_zoom.setSuffix("  (0 = default)")
        ui_layout.addRow("UI Zoom:", self._ui_zoom)
        self._extensions_auto_update = QCheckBox("Auto-update extensions")
        self._extensions_auto_update.setChecked(True)
        ui_layout.addRow("", self._extensions_auto_update)
        self._breadcrumbs = QCheckBox("Show Breadcrumbs")
        self._breadcrumbs.setChecked(True)
        ui_layout.addRow("", self._breadcrumbs)
        ui_group.setLayout(ui_layout)
        form.addWidget(ui_group)
        form.addStretch()
        scroll.setWidget(tab)
        return scroll

    def _build_ai_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; }")
        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)
        ai_group = QGroupBox("AI Defaults")
        ai_layout = QFormLayout()
        ai_layout.setSpacing(10)
        self._default_model = QComboBox()
        self._default_model.setEditable(False)
        try:
            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY
            models = []
            for provider_name, pdef in PROVIDER_REGISTRY.items():
                for model in pdef.get("models", []):
                    model_id = model.get("id")
                    if model_id:
                        label = f"{model.get('name', model_id)} ({provider_name})"
                        models.append((model_id, label))
            priority = {"dardcor-v1-max": 0, "dardcor-flash-free": 1}
            models.sort(key=lambda item: (priority.get(item[0], 9), item[1].lower()))
            for model_id, label in models:
                self._default_model.addItem(label, model_id)
        except Exception:
            self._default_model.addItem("Dardcor MAX", "dardcor-v1-max")
            self._default_model.addItem("Dardcor Flash Free", "dardcor-flash-free")
        ai_layout.addRow("Default model:", self._default_model)
        hint = QLabel("Used when chat opens or no model is selected.")
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #858585; font-size: 12px;")
        ai_layout.addRow("", hint)
        ai_group.setLayout(ai_layout)
        form.addWidget(ai_group)
        form.addStretch()
        scroll.setWidget(tab)
        return scroll

    def _build_workspace_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; }")
        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)

        ws_group = QGroupBox("Workspace")
        ws_layout = QFormLayout()
        ws_layout.setSpacing(10)
        self._workspace = QLineEdit()
        self._workspace.setPlaceholderText("Path to workspace directory")
        ws_layout.addRow("Workspace Path:", self._workspace)
        self._terminal_shell = QLineEdit()
        self._terminal_shell.setPlaceholderText("Leave empty for default shell")
        ws_layout.addRow("Terminal Shell:", self._terminal_shell)
        ws_group.setLayout(ws_layout)
        form.addWidget(ws_group)

        ext_group = QGroupBox("Extension Recommendations")
        ext_layout = QVBoxLayout()
        self._ext_recommend_list = QListWidget()
        ext_layout.addWidget(self._ext_recommend_list)
        ext_btn_layout = QHBoxLayout()
        add_ext = QPushButton("Add Recommendation")
        add_ext.clicked.connect(self._add_ext_recommendation)
        ext_btn_layout.addWidget(add_ext)
        remove_ext = QPushButton("Remove Selected")
        remove_ext.clicked.connect(self._remove_ext_recommendation)
        ext_btn_layout.addWidget(remove_ext)
        ext_btn_layout.addStretch()
        ext_layout.addLayout(ext_btn_layout)
        ext_group.setLayout(ext_layout)
        form.addWidget(ext_group)

        form.addStretch()
        scroll.setWidget(tab)
        return scroll

    def _build_language_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; }")
        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)

        snip_group = QGroupBox("User Snippets")
        snip_layout = QVBoxLayout()
        self._snippet_lang = QComboBox()
        self._snippet_lang.setEditable(True)
        self._snippet_lang.addItems(["global", "python", "javascript", "typescript", "html", "css", "json", "markdown"])
        self._snippet_lang.currentTextChanged.connect(self._load_snippet_editor)
        snip_layout.addWidget(self._snippet_lang)
        self._snippet_editor = QPlainTextEdit()
        self._snippet_editor.setMinimumHeight(200)
        self._snippet_editor.setPlaceholderText('{"snippet_name": {"prefix": "log", "body": ["code"], "description": "..."}}')
        snip_layout.addWidget(self._snippet_editor)
        save_snip = QPushButton("Save Snippets")
        save_snip.clicked.connect(self._save_snippets)
        snip_layout.addWidget(save_snip)
        snip_group.setLayout(snip_layout)
        form.addWidget(snip_group)

        lang_group = QGroupBox("Language-specific Settings")
        lang_layout = QVBoxLayout()
        self._lang_specific_editor = QPlainTextEdit()
        self._lang_specific_editor.setPlaceholderText('{\n  "editor.tabSize": 2,\n  "editor.rulers": [80, 100]\n}')
        self._lang_specific_editor.setMinimumHeight(120)
        lang_layout.addWidget(self._lang_specific_editor)
        lang_group.setLayout(lang_layout)
        form.addWidget(lang_group)

        form.addStretch()
        scroll.setWidget(tab)
        return scroll

    def _build_sync_tab(self) -> QWidget:
        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)

        sync_group = QGroupBox("Settings Sync")
        sync_layout = QVBoxLayout()
        sync_info = QLabel("Sync your settings, keybindings, and snippets across machines.")
        sync_info.setWordWrap(True)
        sync_info.setStyleSheet("color: #858585; font-size: 12px;")
        sync_layout.addWidget(sync_info)

        self._sync_status = QLabel("Status: Not logged in")
        self._sync_status.setStyleSheet("color: #cccccc; font-size: 13px;")
        sync_layout.addWidget(self._sync_status)

        sync_btn_layout = QHBoxLayout()
        self._sync_turn_on = QPushButton("Turn On Sync")
        self._sync_turn_on.clicked.connect(self._turn_on_sync)
        sync_btn_layout.addWidget(self._sync_turn_on)
        self._sync_turn_off = QPushButton("Turn Off Sync")
        self._sync_turn_off.setEnabled(False)
        self._sync_turn_off.clicked.connect(self._turn_off_sync)
        sync_btn_layout.addWidget(self._sync_turn_off)
        sync_btn_layout.addStretch()
        sync_layout.addLayout(sync_btn_layout)

        account_btn = QPushButton("Sign in to Sync")
        account_btn.clicked.connect(self._sign_in_sync)
        sync_layout.addWidget(account_btn)
        sync_group.setLayout(sync_layout)
        form.addWidget(sync_group)

        export_group = QGroupBox("Export / Import")
        export_layout = QHBoxLayout()
        export_btn = QPushButton("Export Profile...")
        export_btn.clicked.connect(self._export_profile)
        export_layout.addWidget(export_btn)
        import_btn = QPushButton("Import Profile...")
        import_btn.clicked.connect(self._import_profile)
        export_layout.addWidget(import_btn)
        export_layout.addStretch()
        export_group.setLayout(export_layout)
        form.addWidget(export_group)

        form.addStretch()
        return tab

    def _build_profiles_tab(self) -> QWidget:
        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)

        profile_group = QGroupBox("Profile Management")
        profile_layout = QVBoxLayout()

        active_label = QLabel(f"Active Profile: {self._profile_manager.get_active_profile()}")
        active_label.setStyleSheet("color: #e0e0e0; font-size: 14px; font-weight: bold;")
        profile_layout.addWidget(active_label)

        self._profile_list = QListWidget()
        for p in self._profile_manager.get_profiles():
            item = QListWidgetItem(p)
            if p == self._profile_manager.get_active_profile():
                item.setIcon(self.style().standardIcon(4))
            self._profile_list.addItem(item)
        profile_layout.addWidget(self._profile_list)

        btn_layout = QHBoxLayout()
        create_btn = QPushButton("Create Profile")
        create_btn.clicked.connect(self._create_profile)
        btn_layout.addWidget(create_btn)
        switch_btn = QPushButton("Switch to Selected")
        switch_btn.clicked.connect(self._switch_profile)
        btn_layout.addWidget(switch_btn)
        delete_btn = QPushButton("Delete Selected")
        delete_btn.clicked.connect(self._delete_profile)
        btn_layout.addWidget(delete_btn)
        btn_layout.addStretch()
        profile_layout.addLayout(btn_layout)

        profile_group.setLayout(profile_layout)
        form.addWidget(profile_group)
        form.addStretch()
        return tab

    def _build_about_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(24, 24, 24, 24)
        title = QLabel("Dardcor Code")
        title.setStyleSheet("font-size: 24px; font-weight: 300; color: #cccccc; padding-bottom: 8px;")
        layout.addWidget(title)
        version = QLabel("Version 1.0.0")
        version.setStyleSheet("font-size: 13px; color: #858585; padding-bottom: 16px;")
        layout.addWidget(version)
        info = QLabel(
            "Full Desktop AI Coding Assistant\n\n"
            "Built with Python + PySide6 (Qt)\n"
            "License: MIT\n\n"
            "Supported AI Providers:\n"
            "  - OpenAI (GPT-4o, GPT-4, etc.)\n"
            "  - Anthropic (Claude 4, Claude 3.5, etc.)\n"
            "  - Google (Gemini 2.0, etc.)\n"
            "  - DeepSeek\n"
            "  - OpenRouter\n"
            "  - Ollama (Local models)\n"
            "  - NVIDIA NIM\n\n"
            "Features:\n"
            "  - VS Code-like interface\n"
            "  - Multi-language syntax highlighting (30+ languages)\n"
            "  - AI pair programming with tool calling\n"
            "  - Integrated terminal\n"
            "  - Full-text search across files\n"
            "  - File explorer with context menus\n"
            "  - Command palette (Ctrl+Shift+P)\n"
            "  - Find/Replace (Ctrl+F / Ctrl+H)\n"
            "  - Minimap, bracket matching, auto-indent\n"
        )
        info.setStyleSheet("color: #cccccc; font-size: 13px; line-height: 1.5;")
        info.setWordWrap(True)
        layout.addWidget(info)
        layout.addStretch()
        return tab

    def _load_settings(self):
        self._workspace.setText(self._config.workspace_path)
        self._auto_save_cb.setChecked(self._config.auto_save)
        self._font_family.setCurrentText(self._config.font_family)
        self._font_size.setValue(self._config.font_size)
        self._tab_size.setValue(self._config.tab_size)
        self._word_wrap.setChecked(self._config.word_wrap)
        self._minimap.setChecked(self._config.minimap_enabled)
        self._show_line_numbers.setChecked(self._config.line_numbers_enabled)
        self._sticky_scroll.setChecked(self._config.sticky_scroll_enabled)
        self._insert_spaces.setChecked(self._config.insert_spaces)
        self._terminal_shell.setText(self._config.terminal_shell)
        self._show_folders.setChecked(self._config.show_folders)
        self._show_open_editors.setChecked(self._config.show_open_editors)
        self._show_outline.setChecked(self._config.show_outline)
        self._show_timeline.setChecked(self._config.show_timeline)
        self._ui_zoom.setValue(self._config.ui_zoom)
        self._extensions_auto_update.setChecked(self._config.extensions_auto_update)
        self._breadcrumbs.setChecked(self._config.breadcrumbs_enabled if hasattr(self._config, 'breadcrumbs_enabled') else True)
        self._format_on_save.setChecked(self._config.format_on_save if hasattr(self._config, 'format_on_save') else False)
        self._smooth_scrolling.setChecked(self._config.smooth_scrolling if hasattr(self._config, 'smooth_scrolling') else True)
        default_model = getattr(self._config, "default_model", "dardcor-flash-free")
        idx = self._default_model.findData(default_model)
        if idx >= 0:
            self._default_model.setCurrentIndex(idx)
        self._load_extension_recommendations()
        self._load_snippet_editor(self._snippet_lang.currentText())

    def _load_extension_recommendations(self):
        ws_path = self._workspace.text()
        if ws_path:
            ext_handler = WorkspaceExtensionsHandler(ws_path)
            recs = ext_handler.get_recommendations()
            self._ext_recommend_list.clear()
            for r in recs:
                self._ext_recommend_list.addItem(r)

    def _load_snippet_editor(self, lang: str):
        fpath = os.path.join(get_snippets_dir(), f"{lang}.json")
        if os.path.exists(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    content = f.read()
                lines = [l for l in content.split("\n") if not l.strip().startswith("//")]
                data = json.loads("\n".join(lines))
                self._snippet_editor.setPlainText(json.dumps(data, indent=2, ensure_ascii=False))
            except Exception:
                self._snippet_editor.setPlainText("{}")
        else:
            self._snippet_editor.setPlainText("{}")

    def _save_settings(self):
        self._config.workspace_path = self._workspace.text()
        self._config.auto_save = self._auto_save_cb.isChecked()
        self._config.font_family = self._font_family.currentText()
        self._config.font_size = self._font_size.value()
        self._config.tab_size = self._tab_size.value()
        self._config.word_wrap = self._word_wrap.isChecked()
        self._config.minimap_enabled = self._minimap.isChecked()
        self._config.line_numbers_enabled = self._show_line_numbers.isChecked()
        self._config.sticky_scroll_enabled = self._sticky_scroll.isChecked()
        self._config.insert_spaces = self._insert_spaces.isChecked()
        self._config.terminal_shell = self._terminal_shell.text()
        self._config.show_folders = self._show_folders.isChecked()
        self._config.show_open_editors = self._show_open_editors.isChecked()
        self._config.show_outline = self._show_outline.isChecked()
        self._config.show_timeline = self._show_timeline.isChecked()
        self._config.ui_zoom = self._ui_zoom.value()
        self._config.extensions_auto_update = self._extensions_auto_update.isChecked()
        self._config.breadcrumbs_enabled = self._breadcrumbs.isChecked()
        self._config.format_on_save = self._format_on_save.isChecked()
        self._config.smooth_scrolling = self._smooth_scrolling.isChecked()
        self._config.default_model = self._default_model.currentData() or "dardcor-flash-free"
        self._config.save()
        self.accept()

    def _add_ext_recommendation(self):
        ext_id, ok = QInputDialog.getText(self, "Add Extension", "Enter extension ID (e.g. ms-python.python):")
        if ok and ext_id:
            ws_path = self._workspace.text()
            if ws_path:
                ext_handler = WorkspaceExtensionsHandler(ws_path)
                ext_handler.add_recommendation(ext_id.strip())
                self._load_extension_recommendations()

    def _remove_ext_recommendation(self):
        current = self._ext_recommend_list.currentItem()
        if current:
            ws_path = self._workspace.text()
            if ws_path:
                ext_handler = WorkspaceExtensionsHandler(ws_path)
                ext_handler.remove_recommendation(current.text())
                self._load_extension_recommendations()

    def _save_snippets(self):
        lang = self._snippet_lang.currentText()
        try:
            data = json.loads(self._snippet_editor.toPlainText() or "{}")
            fpath = os.path.join(get_snippets_dir(), f"{lang}.json")
            os.makedirs(os.path.dirname(fpath), exist_ok=True)
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            QMessageBox.information(self, "Snippets", f"Snippets for '{lang}' saved.")
        except json.JSONDecodeError as e:
            QMessageBox.warning(self, "Invalid JSON", str(e))

    def _turn_on_sync(self):
        from ..sync.settings_sync import SettingsSyncManager
        mgr = SettingsSyncManager()
        mgr.turn_on()
        self._sync_status.setText("Status: Syncing enabled")
        self._sync_turn_on.setEnabled(False)
        self._sync_turn_off.setEnabled(True)

    def _turn_off_sync(self):
        from ..sync.settings_sync import SettingsSyncManager
        mgr = SettingsSyncManager()
        mgr.turn_off()
        self._sync_status.setText("Status: Sync off")
        self._sync_turn_on.setEnabled(True)
        self._sync_turn_off.setEnabled(False)

    def _sign_in_sync(self):
        from ..sync.auth import AuthManager
        auth = AuthManager(get_user_data_dir())
        auth.login()
        self._sync_status.setText(f"Status: Logged in as {auth.user_info.get('login', 'user')}")

    def _export_profile(self):
        from PySide6.QtWidgets import QFileDialog
        fpath, _ = QFileDialog.getSaveFileName(self, "Export Profile", "", "JSON Files (*.json)")
        if fpath:
            name = self._profile_manager.get_active_profile()
            if self._profile_manager.export_profile(name, fpath):
                QMessageBox.information(self, "Export", f"Profile '{name}' exported.")
            else:
                QMessageBox.warning(self, "Export", "Failed to export profile.")

    def _import_profile(self):
        from PySide6.QtWidgets import QFileDialog
        fpath, _ = QFileDialog.getOpenFileName(self, "Import Profile", "", "JSON Files (*.json)")
        if fpath:
            if self._profile_manager.import_profile(fpath):
                QMessageBox.information(self, "Import", "Profile imported. Switch to it in the Profiles tab.")
            else:
                QMessageBox.warning(self, "Import", "Failed to import profile.")

    def _create_profile(self):
        name, ok = QInputDialog.getText(self, "Create Profile", "Profile name:")
        if ok and name:
            if self._profile_manager.create_profile(name):
                self._profile_list.addItem(name)
                QMessageBox.information(self, "Profile", f"Profile '{name}' created.")
            else:
                QMessageBox.warning(self, "Profile", f"Could not create profile '{name}'.")

    def _switch_profile(self):
        current = self._profile_list.currentItem()
        if current:
            self._profile_manager.switch_profile(current.text())
            QMessageBox.information(self, "Profile", f"Switched to profile '{current.text()}'. Restart some services to apply.")

    def _delete_profile(self):
        current = self._profile_list.currentItem()
        if current:
            if self._profile_manager.delete_profile(current.text()):
                self._profile_list.takeItem(self._profile_list.row(current))
                QMessageBox.information(self, "Profile", "Profile deleted.")
            else:
                QMessageBox.warning(self, "Profile", "Cannot delete the Default or active profile.")

    def _on_search_changed(self, text: str):
        query = text.strip().lower()
        def filter_layout(layout, q):
            visible_count = 0
            if layout is None:
                return 0
            if isinstance(layout, QFormLayout):
                for row in range(layout.rowCount()):
                    label_item = layout.itemAt(row, QFormLayout.LabelRole)
                    field_item = layout.itemAt(row, QFormLayout.FieldRole)
                    label_widget = label_item.widget() if label_item else None
                    field_widget = field_item.widget() if field_item else None
                    text_to_match = ""
                    if label_widget and isinstance(label_widget, QLabel):
                        text_to_match += label_widget.text()
                    if field_widget:
                        if isinstance(field_widget, (QCheckBox, QPushButton, QLabel)):
                            text_to_match += field_widget.text()
                    match = (not q) or (q in text_to_match.lower())
                    if label_widget:
                        label_widget.setVisible(match)
                    if field_widget:
                        field_widget.setVisible(match)
                    if match:
                        visible_count += 1
                return visible_count
            for i in range(layout.count()):
                item = layout.itemAt(i)
                widget = item.widget()
                if widget:
                    if isinstance(widget, QGroupBox):
                        sub_visible = filter_layout(widget.layout(), q)
                        widget.setVisible(sub_visible > 0)
                        if sub_visible > 0:
                            visible_count += 1
                    elif isinstance(widget, (QLabel, QCheckBox, QPushButton)):
                        match = (not q) or (q in widget.text().lower())
                        widget.setVisible(match)
                        if match:
                            visible_count += 1
                    else:
                        widget.setVisible(True)
                        visible_count += 1
                elif item.layout():
                    sub_visible = filter_layout(item.layout(), q)
                    visible_count += sub_visible
            return visible_count
        for idx in range(self._tabs.count()):
            tab_widget = self._tabs.widget(idx)
            if isinstance(tab_widget, QScrollArea):
                inner = tab_widget.widget()
                if inner and inner.layout():
                    filter_layout(inner.layout(), query)
