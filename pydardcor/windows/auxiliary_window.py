"""
Auxiliary Window — TASK-0017
==============================
Secondary floating window untuk panel tambahan.
Mirip VS Code: src/vs/workbench/browser/parts/auxiliarybar/
"""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

try:
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
        QSizePolicy, QApplication
    )
    from PySide6.QtCore import Qt, Signal, QTimer
    from PySide6.QtGui import QFont, QCloseEvent
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class AuxiliaryWindow(QWidget):
        """
        Secondary window that can host any panel/view.
        Floats independently of the main window.
        """

        closed = Signal()

        def __init__(
            self,
            title: str = "Auxiliary Window",
            parent: Optional[QWidget] = None,
        ):
            super().__init__(parent, Qt.Window | Qt.WindowStaysOnTopHint if False else Qt.Window)
            self._title = title
            self._content: Optional[QWidget] = None
            self._setup_ui()
            self.resize(600, 400)

        def _setup_ui(self) -> None:
            self.setWindowTitle(self._title)
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)

            # Title bar
            self._title_bar = QWidget()
            self._title_bar.setFixedHeight(30)
            self._title_bar.setStyleSheet(
                "background: #252526; border-bottom: 1px solid #3c3c3c;"
            )
            tb_layout = QHBoxLayout(self._title_bar)
            tb_layout.setContentsMargins(8, 0, 8, 0)

            self._title_label = QLabel(self._title)
            self._title_label.setStyleSheet("color: #cccccc; font-size: 12px;")
            tb_layout.addWidget(self._title_label)
            tb_layout.addStretch()

            close_btn = QPushButton("✕")
            close_btn.setFixedSize(24, 24)
            close_btn.setStyleSheet(
                "QPushButton { background: transparent; border: none; color: #888; }"
                "QPushButton:hover { background: #c0392b; color: white; border-radius: 3px; }"
            )
            close_btn.clicked.connect(self.close)
            tb_layout.addWidget(close_btn)

            layout.addWidget(self._title_bar)

            # Content area
            self._content_area = QWidget()
            self._content_area.setStyleSheet("background: #1e1e1e;")
            self._content_layout = QVBoxLayout(self._content_area)
            self._content_layout.setContentsMargins(0, 0, 0, 0)
            layout.addWidget(self._content_area, 1)

        def set_content(self, widget: QWidget) -> None:
            """Set the content widget."""
            # Remove old content
            old = self._content
            if old:
                self._content_layout.removeWidget(old)
                old.setParent(None)

            self._content = widget
            self._content_layout.addWidget(widget)

        def set_title(self, title: str) -> None:
            self._title = title
            self.setWindowTitle(title)
            self._title_label.setText(title)

        def closeEvent(self, event: "QCloseEvent") -> None:
            self.closed.emit()
            super().closeEvent(event)

        def show_and_raise(self) -> None:
            self.show()
            self.raise_()
            self.activateWindow()

else:
    class AuxiliaryWindow:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def set_content(self, *args):
            pass

        def show_and_raise(self):
            pass
