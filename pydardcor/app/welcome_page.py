"""Welcome Page - VS Code style dynamic welcome & onboarding editor tab."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QScrollArea, QFrame, QCheckBox, QComboBox, QMessageBox
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont, QColor

class WelcomePageWidget(QWidget):
    """Interactive onboarding welcome tab for Dardcor Code."""
    
    file_action_requested = Signal(str)  # "new", "open_file", "open_folder", "clone"

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("WelcomePageWidget")
        self._setup_ui()

    # Duck-typing for editor tab compatibility
    def get_file_path(self) -> str:
        return ""
    def is_dirty(self) -> bool:
        return False
    def get_language(self) -> str:
        return "welcome"
    def get_content(self) -> str:
        return ""

    def _setup_ui(self):
        # Setup dark VS Code-like styles
        self.setStyleSheet("""
            QWidget#WelcomePageWidget {
                background-color: #000000;
            }
            QLabel {
                color: #cccccc;
                border: none;
            }
            QPushButton.LinkButton {
                background: transparent;
                border: none;
                color: #3794ff;
                text-align: left;
                padding: 4px 0px;
                font-size: 13px;
                font-family: "Segoe UI", sans-serif;
            }
            QPushButton.LinkButton:hover {
                color: #5bb3ff;
                text-decoration: underline;
            }
            QFrame.Card {
                background-color: #0d0d0d;
                border: 1px solid #3c0068;
                border-radius: 6px;
                padding: 12px;
            }
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(24)

        self._scroll = QScrollArea(self)
        self._scroll.setWidgetResizable(True)
        self._scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        
        content = QWidget()
        content.setStyleSheet("background: transparent;")
        c_lay = QVBoxLayout(content)
        c_lay.setContentsMargins(0, 0, 0, 0)
        c_lay.setSpacing(24)
        c_lay.setAlignment(Qt.AlignTop)

        # Header Title
        title_box = QVBoxLayout()
        title = QLabel("Dardcor Code")
        title.setStyleSheet("font-size: 32px; color: #ffffff; font-weight: 300;")
        subtitle = QLabel("Code editing. Redefined.")
        subtitle.setStyleSheet("font-size: 14px; color: #888888;")
        title_box.addWidget(title)
        title_box.addWidget(subtitle)
        c_lay.addLayout(title_box)

        # Two Column Grid: Left (Start/Recent), Right (Walkthroughs)
        grid = QHBoxLayout()
        grid.setSpacing(40)

        left_widget = QWidget()
        left_widget.setMaximumWidth(450)
        left_col = QVBoxLayout(left_widget)
        left_col.setContentsMargins(0, 0, 0, 0)
        left_col.setSpacing(10)
        left_col.setAlignment(Qt.AlignTop)

        # Start Section
        start_label = QLabel("Start")
        start_label.setStyleSheet("font-size: 18px; color: #ffffff; font-weight: bold;")
        left_col.addWidget(start_label)

        new_btn = QPushButton("New File...")
        new_btn.setCursor(Qt.PointingHandCursor)
        new_btn.setProperty("class", "LinkButton")
        new_btn.clicked.connect(lambda: self.file_action_requested.emit("new"))
        left_col.addWidget(new_btn)

        open_file_btn = QPushButton("Open File...")
        open_file_btn.setCursor(Qt.PointingHandCursor)
        open_file_btn.setProperty("class", "LinkButton")
        open_file_btn.clicked.connect(lambda: self.file_action_requested.emit("open_file"))
        left_col.addWidget(open_file_btn)

        open_folder_btn = QPushButton("Open Folder...")
        open_folder_btn.setCursor(Qt.PointingHandCursor)
        open_folder_btn.setProperty("class", "LinkButton")
        open_folder_btn.clicked.connect(lambda: self.file_action_requested.emit("open_folder"))
        left_col.addWidget(open_folder_btn)

        clone_btn = QPushButton("Clone Git Repository...")
        clone_btn.setCursor(Qt.PointingHandCursor)
        clone_btn.setProperty("class", "LinkButton")
        clone_btn.clicked.connect(lambda: self.file_action_requested.emit("clone"))
        left_col.addWidget(clone_btn)

        # Recent Section (BUG-026 & VS Code parity)
        recent_lbl = QLabel("Recent")
        recent_lbl.setStyleSheet("font-size: 18px; color: #ffffff; font-weight: bold; margin-top: 24px;")
        left_col.addWidget(recent_lbl)

        from ..core.config import get_config
        config = get_config()
        recent_folders = getattr(config, "recent_folders", [])
        recent_files = getattr(config, "recent_files", [])

        recent_items = []
        for f in recent_folders:
            if os.path.exists(f):
                recent_items.append(("folder", f))
        for f in recent_files:
            if os.path.exists(f):
                recent_items.append(("file", f))

        if not recent_items:
            no_recent = QLabel("No recent items")
            no_recent.setStyleSheet("color: #666666; font-size: 13px; font-style: italic;")
            left_col.addWidget(no_recent)
        else:
            for item_type, path in recent_items[:7]:
                name = os.path.basename(path) or path
                display_text = f"{name}  —  {path}"
                btn = QPushButton(display_text)
                btn.setCursor(Qt.PointingHandCursor)
                btn.setProperty("class", "LinkButton")
                btn.setStyleSheet("text-align: left; font-size: 12px; color: #aaaaaa; padding: 2px 0px;")
                if item_type == "folder":
                    btn.clicked.connect(lambda checked=False, p=path: self.file_action_requested.emit(f"open_folder_path:{p}"))
                else:
                    btn.clicked.connect(lambda checked=False, p=path: self.file_action_requested.emit(f"open_file_path:{p}"))
                left_col.addWidget(btn)

        grid.addWidget(left_widget)

        right_widget = QWidget()
        right_widget.setMaximumWidth(400)
        right_col = QVBoxLayout(right_widget)
        right_col.setContentsMargins(0, 0, 0, 0)
        right_col.setSpacing(20)
        right_col.setAlignment(Qt.AlignTop)

        # Onboarding Checklist Card
        walkthrough_label = QLabel("Getting Started Checklist")
        walkthrough_label.setStyleSheet("font-size: 18px; color: #ffffff; font-weight: bold;")
        right_col.addWidget(walkthrough_label)

        card = QFrame()
        card.setProperty("class", "Card")
        card_lay = QVBoxLayout(card)
        card_lay.setSpacing(10)

        theme_lbl = QLabel("Pick a Color Theme")
        theme_lbl.setStyleSheet("font-size: 13px; font-weight: bold; color: #ffffff;")
        card_lay.addWidget(theme_lbl)

        self._theme_combo = QComboBox()
        self._theme_combo.addItems(["Dardcor Purple", "VS Code Dark+", "VS Code Light+", "Monokai", "Solarized Dark", "High Contrast"])
        self._theme_combo.setStyleSheet("""
            QComboBox {
                background: #161616; color: #cccccc; border: 1px solid #3c0068;
                padding: 4px 8px; font-size: 12px;
            }
        """)
        self._theme_combo.currentTextChanged.connect(self._change_theme)
        card_lay.addWidget(self._theme_combo)

        # Shortcuts Playground
        play_lbl = QLabel("Interactive Shortcuts Playground")
        play_lbl.setStyleSheet("font-size: 13px; font-weight: bold; color: #ffffff; margin-top: 10px;")
        card_lay.addWidget(play_lbl)
        
        play_desc = QLabel("Try triggering 'Ctrl+P' or 'Ctrl+Shift+P' right now to switch files and run commands.")
        play_desc.setStyleSheet("color: #888888; font-size: 11px;")
        play_desc.setWordWrap(True)
        card_lay.addWidget(play_desc)

        # Telemetry Choice
        telemetry_cb = QCheckBox("Enable Telemetry (helps us improve Dardcor Code)")
        telemetry_cb.setChecked(True)
        telemetry_cb.setStyleSheet("""
            QCheckBox { color: #888888; font-size: 11px; margin-top: 10px; }
            QCheckBox::indicator { width: 12px; height: 12px; border: 1px solid #3c0068; border-radius: 2px; background: #000000; }
            QCheckBox::indicator:checked { background: #6d00b8; }
        """)
        telemetry_cb.stateChanged.connect(self._on_telemetry_toggled)
        card_lay.addWidget(telemetry_cb)

        right_col.addWidget(card)
        grid.addWidget(right_widget)
        grid.addStretch()

        c_lay.addLayout(grid)
        self._scroll.setWidget(content)
        layout.addWidget(self._scroll)

    def showEvent(self, event):
        super().showEvent(event)
        from PySide6.QtCore import QTimer
        QTimer.singleShot(100, lambda: self._scroll.verticalScrollBar().setValue(0))

    def _change_theme(self, theme_name: str):
        from .theme_manager import ThemeManager
        from PySide6.QtWidgets import QApplication
        theme_map = {
            "Dardcor Purple": "dardcor-purple",
            "VS Code Dark+": "dark+",
            "VS Code Light+": "light+",
            "Monokai": "monokai",
            "Solarized Dark": "solarized-dark",
            "High Contrast": "hc-black"
        }
        key = theme_map.get(theme_name, "dark+")
        app = QApplication.instance()
        if app:
            ThemeManager.apply_theme(app, key)
            from ..core.config import get_config
            config = get_config()
            config.color_theme = key
            config.save()

    def _on_telemetry_toggled(self, state):
        enabled = (state == Qt.Checked or state == 2)
        from ..core.config import get_config
        config = get_config()
        config.telemetry_enableTelemetry = enabled
        config.save()
