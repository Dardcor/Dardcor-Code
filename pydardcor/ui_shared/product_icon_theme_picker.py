"""Product Icon Theme Picker - VS Code style icon theme selection dialog."""

import os
import json
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QListWidget, QListWidgetItem, QFrame, QWidget, QScrollArea,
    QApplication
)
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QFont, QIcon, QPixmap, QPainter, QColor


THEME_PREVIEW_ICONS = [
    ("file", "\uea7b"),
    ("folder", "\uea77"),
    ("search", "\uea8d"),
    ("settings", "\ueab4"),
    ("terminal", "\uea8f"),
    ("extensions", "\uea77"),
    ("debug", "\uea8d"),
    ("source-control", "\uea76"),
    ("explorer", "\uea77"),
    ("account", "\ueb51"),
]


class ThemePreviewWidget(QFrame):
    """Shows a small grid of sample icons for a theme."""

    selected = Signal(str)

    def __init__(self, theme_id: str, theme_name: str, icons: dict[str, str],
                 is_selected: bool = False, parent=None):
        super().__init__(parent)
        self._theme_id = theme_id
        self._is_selected = is_selected
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(140, 160)

        border = "#7c3aed" if is_selected else "#1a0033"
        bg = "#0d0d0d" if not is_selected else "#1a0033"
        self.setStyleSheet(f"""
            ThemePreviewWidget {{
                background-color: {bg};
                border: 2px solid {border};
                border-radius: 8px;
            }}
            ThemePreviewWidget:hover {{
                background-color: #1a0033;
                border-color: {"#7c3aed" if not is_selected else "#7c3aed"};
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(4)
        layout.setAlignment(Qt.AlignCenter)

        # Icon grid (2x5)
        grid = QWidget()
        grid.setStyleSheet("background: transparent;")
        grid_layout = QHBoxLayout(grid)
        grid_layout.setContentsMargins(0, 0, 0, 0)
        grid_layout.setSpacing(4)

        col1 = QVBoxLayout()
        col1.setSpacing(2)
        col2 = QVBoxLayout()
        col2.setSpacing(2)

        for i, (key, default_icon) in enumerate(THEME_PREVIEW_ICONS[:6]):
            icon_char = icons.get(key, default_icon)
            lbl = QLabel(icon_char)
            lbl.setFont(QFont("codicon", 14))
            lbl.setStyleSheet(f"color: #ffffff; background: transparent;")
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setFixedSize(20, 20)
            if i % 2 == 0:
                col1.addWidget(lbl)
            else:
                col2.addWidget(lbl)

        grid_layout.addLayout(col1)
        grid_layout.addLayout(col2)
        layout.addWidget(grid, 0, Qt.AlignCenter)

        # Name
        name_label = QLabel(theme_name)
        name_label.setWordWrap(True)
        name_label.setAlignment(Qt.AlignCenter)
        name_label.setStyleSheet("color: #cccccc; font-size: 11px; font-weight: bold; background: transparent;")
        layout.addWidget(name_label, 0, Qt.AlignCenter)

        if is_selected:
            check = QLabel("\uea60")
            check.setFont(QFont("codicon", 12))
            check.setStyleSheet("color: #7c3aed; background: transparent;")
            check.setAlignment(Qt.AlignCenter)
            layout.addWidget(check, 0, Qt.AlignCenter)

    def mousePressEvent(self, event):
        self.selected.emit(self._theme_id)
        super().mousePressEvent(event)


class ProductIconThemePicker(QDialog):
    """Dialog for selecting a product icon theme."""

    theme_changed = Signal(str, str)  # (theme_id, theme_name)

    def __init__(self, current_theme: str = "default", parent=None):
        super().__init__(parent)
        self.setWindowTitle("Product Icon Theme")
        self.setFixedSize(480, 400)
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 8px;
            }
        """)
        self.setAttribute(Qt.WA_StyledBackground, True)

        self._current_theme = current_theme
        self._themes: dict[str, dict] = {}
        self._setup_ui()
        self._load_themes()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 16)
        layout.setSpacing(12)

        header = QHBoxLayout()
        title = QLabel("Product Icon Theme")
        title.setStyleSheet("color: #ffffff; font-size: 18px; font-weight: bold; background: transparent;")
        header.addWidget(title)
        header.addStretch()

        close_btn = QPushButton("✕")
        close_btn.setFixedSize(28, 28)
        close_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #858585; border: none;
                font-size: 16px; border-radius: 14px;
            }
            QPushButton:hover { background-color: #27272a; color: #ffffff; }
        """)
        close_btn.clicked.connect(self.reject)
        header.addWidget(close_btn)
        layout.addLayout(header)

        desc = QLabel("Select the icon theme used for file icons and product icons.")
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #858585; font-size: 12px; background: transparent;")
        layout.addWidget(desc)

        # Scrollable grid
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("""
            QScrollArea { background: transparent; border: none; }
            QScrollBar:vertical { width: 6px; }
            QScrollBar::handle:vertical { background: #3c0068; border-radius: 3px; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
        """)

        self._grid_container = QWidget()
        self._grid_container.setStyleSheet("background: transparent;")
        self._grid_layout = QHBoxLayout(self._grid_container)
        self._grid_layout.setContentsMargins(0, 0, 0, 0)
        self._grid_layout.setSpacing(12)
        self._grid_layout.setAlignment(Qt.AlignLeft)

        scroll.setWidget(self._grid_container)
        layout.addWidget(scroll, 1)

    def _load_themes(self):
        """Discover built-in icon themes."""
        self._themes = {
            "default": {
                "name": "Default",
                "icons": {
                    "file": "\uea7b", "folder": "\uea77", "search": "\uea8d",
                    "settings": "\ueab4", "terminal": "\uea8f", "extensions": "\uea77",
                    "debug": "\uea8d", "source-control": "\uea76", "explorer": "\uea77",
                    "account": "\ueb51",
                }
            },
            "minimal": {
                "name": "Minimal",
                "icons": {
                    "file": "\ueb57", "folder": "\ueb5c", "search": "\uea8d",
                    "settings": "\ueab4", "terminal": "\uea8f", "extensions": "\uea60",
                    "debug": "\uea8d", "source-control": "\uea76", "explorer": "\ueb5c",
                    "account": "\ueb51",
                }
            },
            "dark-modern": {
                "name": "Dark Modern",
                "icons": {
                    "file": "\uea7b", "folder": "\ueb5c", "search": "\uea8d",
                    "settings": "\ueab4", "terminal": "\uea8f", "extensions": "\uea77",
                    "debug": "\uea8d", "source-control": "\uea76", "explorer": "\ueb5c",
                    "account": "\ueb51",
                }
            },
            "high-contrast": {
                "name": "High Contrast",
                "icons": {
                    "file": "\uea7b", "folder": "\uea77", "search": "\uea8d",
                    "settings": "\ueab4", "terminal": "\uea8f", "extensions": "\uea60",
                    "debug": "\ueb57", "source-control": "\uea76", "explorer": "\uea77",
                    "account": "\ueb51",
                }
            },
        }

        self._populate_grid()

    def _populate_grid(self):
        for tid, theme in self._themes.items():
            card = ThemePreviewWidget(
                tid, theme["name"], theme["icons"],
                is_selected=(tid == self._current_theme)
            )
            card.selected.connect(self._on_theme_selected)
            self._grid_layout.addWidget(card)

    def _on_theme_selected(self, theme_id: str):
        self._current_theme = theme_id
        theme_data = self._themes.get(theme_id, {})
        self.theme_changed.emit(theme_id, theme_data.get("name", theme_id))
        self.accept()

    def get_selected_theme(self) -> str:
        return self._current_theme
