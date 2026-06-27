"""Settings Dialog - VS Code style settings UI."""

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QTabWidget,
    QWidget, QLabel, QLineEdit, QPushButton, QGroupBox,
    QFormLayout, QCheckBox, QSpinBox, QComboBox,
    QDialogButtonBox, QMessageBox, QScrollArea, QFrame,
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont

from ..core.config import get_config, AIConfig


class SettingsDialog(QDialog):
    """VS Code style settings dialog."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._config = get_config()
        self.setWindowTitle("Settings")
        self.setMinimumSize(620, 520)
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
                color: #cccccc;
            }
            QTabWidget::pane {
                border: none;
                background-color: #000000;
            }
            QTabBar::tab {
                background-color: #080808;
                color: #969696;
                padding: 8px 16px;
                border: none;
                border-bottom: 2px solid transparent;
                font-size: 13px;
            }
            QTabBar::tab:selected {
                background-color: #000000;
                color: #ffffff;
                border-bottom: 2px solid #4a0072;
            }
            QTabBar::tab:hover:!selected {
                color: #cccccc;
            }
            QGroupBox {
                background-color: #000000;
                border: 1px solid #2c004a;
                border-radius: 4px;
                margin-top: 16px;
                padding: 16px 12px 12px;
                font-size: 13px;
                font-weight: bold;
                color: #cccccc;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 12px;
                padding: 0 8px;
            }
            QLabel {
                color: #cccccc;
                font-size: 13px;
            }
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: 1px solid #2c004a;
                border-radius: 2px;
                padding: 5px 8px;
                font-size: 13px;
                min-height: 24px;
            }
            QLineEdit:focus {
                border: 1px solid #4a0072;
            }
            QComboBox {
                background-color: #2c004a;
                color: #cccccc;
                border: 1px solid #2c004a;
                border-radius: 2px;
                padding: 5px 8px;
                font-size: 13px;
                min-height: 24px;
            }
            QComboBox:focus {
                border: 1px solid #4a0072;
            }
            QComboBox::drop-down {
                border: none;
                width: 20px;
            }
            QComboBox QAbstractItemView {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #454545;
                selection-background-color: #04395e;
            }
            QSpinBox {
                background-color: #2c004a;
                color: #cccccc;
                border: 1px solid #2c004a;
                border-radius: 2px;
                padding: 5px 8px;
                font-size: 13px;
                min-height: 24px;
            }
            QSpinBox:focus {
                border: 1px solid #4a0072;
            }
            QCheckBox {
                color: #cccccc;
                font-size: 13px;
                spacing: 8px;
            }
            QCheckBox::indicator {
                width: 16px;
                height: 16px;
                border: 1px solid #2c004a;
                border-radius: 2px;
                background-color: #2c004a;
            }
            QCheckBox::indicator:checked {
                background-color: #4a0072;
                border-color: #4a0072;
            }
        """)
        self._setup_ui()
        self._load_settings()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(40)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #3c0068;")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(16, 0, 16, 0)

        title = QLabel("Settings")
        title.setStyleSheet("font-size: 14px; font-weight: bold; color: #cccccc;")
        header_layout.addWidget(title)
        header_layout.addStretch()

        layout.addWidget(header)

        # Tabs
        tabs = QTabWidget()
        tabs.addTab(self._build_model_tab(), "AI Model")
        tabs.addTab(self._build_editor_tab(), "Editor")
        tabs.addTab(self._build_workspace_tab(), "Workspace")
        tabs.addTab(self._build_about_tab(), "About")
        layout.addWidget(tabs)

        # Buttons
        btn_container = QWidget()
        btn_container.setStyleSheet("background-color: #000000; border-top: 1px solid #3c0068;")
        btn_layout = QHBoxLayout(btn_container)
        btn_layout.setContentsMargins(16, 8, 16, 8)
        btn_layout.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setFixedHeight(30)
        cancel_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                color: #cccccc;
                border: 1px solid #2c004a;
                border-radius: 2px;
                padding: 4px 20px;
                font-size: 13px;
            }
            QPushButton:hover {
                background-color: #2c004a;
            }
        """)
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        save_btn = QPushButton("Save")
        save_btn.setFixedHeight(30)
        save_btn.setStyleSheet("""
            QPushButton {
                background-color: #5a009c;
                color: #ffffff;
                border: none;
                border-radius: 2px;
                padding: 4px 20px;
                font-size: 13px;
                font-weight: bold;
            }
            QPushButton:hover { background-color: #7a00d3; }
            QPushButton:pressed { background-color: #3c0068; }
        """)
        save_btn.clicked.connect(self._save_settings)
        btn_layout.addWidget(save_btn)

        layout.addWidget(btn_container)

    def _build_model_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; }")

        tab = QWidget()
        form = QVBoxLayout(tab)
        form.setContentsMargins(24, 16, 24, 16)
        form.setSpacing(12)

        # Provider group
        provider_group = QGroupBox("AI Provider")
        provider_layout = QFormLayout()
        provider_layout.setSpacing(10)

        self._provider = QComboBox()
        self._provider.addItems([
            "openai", "anthropic", "gemini", "deepseek",
            "openrouter", "ollama", "nvidia",
        ])
        self._provider.setEditable(True)
        provider_layout.addRow("Provider:", self._provider)

        self._model = QLineEdit()
        self._model.setPlaceholderText("e.g., gpt-4o, claude-sonnet-4-20250514, gemini-2.0-flash")
        provider_layout.addRow("Model:", self._model)

        self._api_key = QLineEdit()
        self._api_key.setEchoMode(QLineEdit.Password)
        self._api_key.setPlaceholderText("API Key (or set env: DARDCOR_CODE_API_KEY)")
        provider_layout.addRow("API Key:", self._api_key)

        self._base_url = QLineEdit()
        self._base_url.setPlaceholderText("Leave empty for default provider URL")
        provider_layout.addRow("Base URL:", self._base_url)

        provider_group.setLayout(provider_layout)
        form.addWidget(provider_group)

        # Generation group
        gen_group = QGroupBox("Generation Settings")
        gen_layout = QFormLayout()
        gen_layout.setSpacing(10)

        self._max_tokens = QSpinBox()
        self._max_tokens.setRange(1024, 256000)
        self._max_tokens.setValue(128000)
        self._max_tokens.setSingleStep(4096)
        gen_layout.addRow("Max Tokens:", self._max_tokens)

        self._temperature = QSpinBox()
        self._temperature.setRange(0, 100)
        self._temperature.setValue(70)
        self._temperature.setSuffix("%")
        gen_layout.addRow("Temperature:", self._temperature)

        gen_group.setLayout(gen_layout)
        form.addWidget(gen_group)

        form.addStretch()
        scroll.setWidget(tab)
        return scroll

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
        self._font_family.addItems([
            "Cascadia Code", "Consolas", "Fira Code", "JetBrains Mono",
            "Source Code Pro", "Menlo", "Monaco", "Courier New",
        ])
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

        self._auto_save_cb = QCheckBox("Auto-save files")
        self._auto_save_cb.setChecked(True)
        editor_layout.addRow("", self._auto_save_cb)

        editor_group.setLayout(editor_layout)
        form.addWidget(editor_group)

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

        form.addStretch()
        scroll.setWidget(tab)
        return scroll

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
        self._provider.setCurrentText(self._config.ai.provider)
        self._model.setText(self._config.ai.model)
        if self._config.ai.api_key:
            self._api_key.setText(self._config.ai.api_key)
        self._base_url.setText(self._config.ai.base_url)
        self._max_tokens.setValue(self._config.ai.max_tokens)
        self._temperature.setValue(int(self._config.ai.temperature * 100))
        self._workspace.setText(self._config.workspace_path)
        self._auto_save_cb.setChecked(self._config.auto_save)
        self._font_family.setCurrentText(self._config.font_family)
        self._font_size.setValue(self._config.font_size)
        self._tab_size.setValue(self._config.tab_size)
        self._word_wrap.setChecked(self._config.word_wrap)
        self._minimap.setChecked(self._config.minimap_enabled)
        self._terminal_shell.setText(self._config.terminal_shell)

    def _save_settings(self):
        self._config.ai.provider = self._provider.currentText()
        self._config.ai.model = self._model.text()
        if self._api_key.text():
            self._config.ai.api_key = self._api_key.text()
        self._config.ai.base_url = self._base_url.text()
        self._config.ai.max_tokens = self._max_tokens.value()
        self._config.ai.temperature = self._temperature.value() / 100.0
        self._config.workspace_path = self._workspace.text()
        self._config.auto_save = self._auto_save_cb.isChecked()
        self._config.font_family = self._font_family.currentText()
        self._config.font_size = self._font_size.value()
        self._config.tab_size = self._tab_size.value()
        self._config.word_wrap = self._word_wrap.isChecked()
        self._config.minimap_enabled = self._minimap.isChecked()
        self._config.terminal_shell = self._terminal_shell.text()
        self._config.save()
        self.accept()
