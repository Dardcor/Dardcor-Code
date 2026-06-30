"""Hex Editor - VS Code style binary file viewer/editor."""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QScrollArea,
    QTextEdit, QPushButton, QFileDialog
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont, QColor


class HexEditorWidget(QWidget):
    """Hex editor for viewing and editing binary files."""

    content_changed = Signal(str)
    save_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._file_path = ""
        self._data = b""
        self._is_dirty = False
        self._bytes_per_row = 16
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Toolbar
        toolbar = QWidget()
        toolbar.setFixedHeight(32)
        toolbar.setStyleSheet("background-color: #0d0d0d; border-bottom: 1px solid #2c004a;")
        tb_lay = QHBoxLayout(toolbar)
        tb_lay.setContentsMargins(8, 0, 8, 0)

        self._info_label = QLabel("No file loaded")
        self._info_label.setStyleSheet("color: #888888; font-size: 11px;")
        tb_lay.addWidget(self._info_label)
        tb_lay.addStretch()

        self._offset_label = QLabel("Offset: 0x0000")
        self._offset_label.setStyleSheet("color: #569cd6; font-size: 11px;")
        tb_lay.addWidget(self._offset_label)

        layout.addWidget(toolbar)

        # Content area
        content = QWidget()
        content_layout = QHBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        mono_font = QFont("Cascadia Code", 12)
        mono_font.setStyleHint(QFont.Monospace)

        # Hex view
        self._hex_view = QTextEdit()
        self._hex_view.setReadOnly(True)
        self._hex_view.setFont(mono_font)
        self._hex_view.setStyleSheet("""
            QTextEdit {
                background-color: #000000;
                color: #d4d4d4;
                border: none;
                border-right: 1px solid #1a0033;
                selection-background-color: #264f78;
            }
        """)
        content_layout.addWidget(self._hex_view, 3)

        # ASCII view
        self._ascii_view = QTextEdit()
        self._ascii_view.setReadOnly(True)
        self._ascii_view.setFont(mono_font)
        self._ascii_view.setStyleSheet("""
            QTextEdit {
                background-color: #000000;
                color: #ce9178;
                border: none;
                selection-background-color: #264f78;
            }
        """)
        content_layout.addWidget(self._ascii_view, 1)

        # Sync scrolling
        self._hex_view.verticalScrollBar().valueChanged.connect(
            self._ascii_view.verticalScrollBar().setValue
        )
        self._ascii_view.verticalScrollBar().valueChanged.connect(
            self._hex_view.verticalScrollBar().setValue
        )

        layout.addWidget(content)

    def load_file(self, file_path: str):
        self._file_path = file_path
        try:
            with open(file_path, "rb") as f:
                self._data = f.read()
            self._render()
            size = len(self._data)
            unit = "bytes"
            if size > 1024 * 1024:
                size = size / (1024 * 1024)
                unit = "MB"
            elif size > 1024:
                size = size / 1024
                unit = "KB"
            self._info_label.setText(f"{file_path}  ({size:.1f} {unit})")
        except Exception as e:
            self._info_label.setText(f"Error: {e}")

    def _render(self):
        hex_lines = []
        ascii_lines = []
        bpr = self._bytes_per_row
        
        # Limit to first 1MB to avoid hanging on massive files
        data_to_render = self._data[:1048576] 

        for offset in range(0, len(data_to_render), bpr):
            chunk = data_to_render[offset:offset + bpr]

            # Offset
            offset_str = f"{offset:08X}  "

            # Hex
            hex_parts = []
            for i, b in enumerate(chunk):
                hex_parts.append(f"{b:02X}")
                if i == 7:
                    hex_parts.append("")  # extra space in middle
            hex_str = offset_str + " ".join(hex_parts)
            # Pad if short
            if len(chunk) < bpr:
                missing = bpr - len(chunk)
                hex_str += "   " * missing
            hex_lines.append(hex_str)

            # ASCII
            ascii_parts = []
            for b in chunk:
                if 32 <= b < 127:
                    ascii_parts.append(chr(b))
                else:
                    ascii_parts.append(".")
            ascii_lines.append("".join(ascii_parts))
            
        if len(self._data) > 1048576:
            hex_lines.append("... (Content truncated for performance) ...")
            ascii_lines.append("...")

        self._hex_view.setPlainText("\n".join(hex_lines))
        self._ascii_view.setPlainText("\n".join(ascii_lines))

    def get_file_path(self):
        return self._file_path

    def is_dirty(self):
        return self._is_dirty

    def get_language(self):
        return "hex"

    def save(self):
        if self._file_path:
            self.save_as(self._file_path)

    def save_as(self, path):
        try:
            with open(path, "wb") as f:
                f.write(self._data)
            self._file_path = path
            self._is_dirty = False
            self.load_file(path) # update UI
        except Exception as e:
            self._info_label.setText(f"Save failed: {e}")
