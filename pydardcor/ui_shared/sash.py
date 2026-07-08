"""
Sash Resizer — TASK-0019
==========================
Drag handle untuk resize panel dengan snap.
Mirip VS Code: src/vs/base/browser/ui/sash/sash.ts

Provides custom sash widgets that work as drag-handles between panels.
Supports: horizontal/vertical orientation, snap thresholds, min/max limits.
"""

from __future__ import annotations

from typing import Callable, Optional

try:
    from PySide6.QtWidgets import QSplitter, QSplitterHandle, QWidget, QSizePolicy
    from PySide6.QtCore import Qt, QPoint, Signal, QTimer
    from PySide6.QtGui import QCursor, QPainter, QColor, QPen, QMouseEvent, QPaintEvent
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class SashHandle(QSplitterHandle):
        """
        Custom splitter handle (sash) with VS Code styling.
        Shows visual feedback on hover.
        """

        def __init__(self, orientation: Qt.Orientation, parent: "Sash"):
            super().__init__(orientation, parent)
            self._hovered = False
            self._dragging = False
            self.setMouseTracking(True)

            # VS Code sash is 4px wide
            if orientation == Qt.Horizontal:
                self.setFixedWidth(4)
            else:
                self.setFixedHeight(4)

        def paintEvent(self, event: "QPaintEvent") -> None:
            painter = QPainter(self)
            painter.setRenderHint(QPainter.Antialiasing)

            if self._dragging:
                color = QColor("#007fd4")  # VS Code accent blue
            elif self._hovered:
                color = QColor("#555555")
            else:
                color = QColor("#3c3c3c")

            painter.fillRect(self.rect(), color)

        def enterEvent(self, event) -> None:
            self._hovered = True
            self.update()
            if self.orientation() == Qt.Horizontal:
                self.setCursor(Qt.SplitHCursor)
            else:
                self.setCursor(Qt.SplitVCursor)

        def leaveEvent(self, event) -> None:
            self._hovered = False
            self._dragging = False
            self.update()
            self.unsetCursor()

        def mousePressEvent(self, event: "QMouseEvent") -> None:
            self._dragging = True
            self.update()
            super().mousePressEvent(event)

        def mouseReleaseEvent(self, event: "QMouseEvent") -> None:
            self._dragging = False
            self.update()
            super().mouseReleaseEvent(event)


    class Sash(QSplitter):
        """
        VS Code style sash splitter.
        Wraps QSplitter with custom handles and snap support.
        """

        sash_moved = Signal(int, int)  # (index, position)

        def __init__(
            self,
            orientation: Qt.Orientation = Qt.Horizontal,
            parent: Optional[QWidget] = None,
            snap_threshold: int = 60,
        ):
            super().__init__(orientation, parent)
            self._snap_threshold = snap_threshold
            self.setHandleWidth(4)
            self.setChildrenCollapsible(True)
            self.setStyleSheet("""
                QSplitter::handle {
                    background: #3c3c3c;
                }
                QSplitter::handle:hover {
                    background: #555555;
                }
                QSplitter::handle:pressed {
                    background: #007fd4;
                }
            """)
            self.splitterMoved.connect(self._on_sash_moved)

        def createHandle(self) -> "SashHandle":
            return SashHandle(self.orientation(), self)

        def _on_sash_moved(self, pos: int, index: int) -> None:
            """Handle snap-to-min behavior."""
            sizes = self.sizes()
            if not sizes:
                return

            # Snap to minimum if below threshold
            for i, sz in enumerate(sizes):
                if 0 < sz < self._snap_threshold:
                    new_sizes = list(sizes)
                    new_sizes[i] = 0
                    self.setSizes(new_sizes)
                    break

            self.sash_moved.emit(index, pos)

        def set_panel_size(self, index: int, size: int) -> None:
            """Set size of a specific panel."""
            sizes = self.sizes()
            if 0 <= index < len(sizes):
                total = sum(sizes)
                remaining = total - size
                new_sizes = []
                for i, _ in enumerate(sizes):
                    if i == index:
                        new_sizes.append(size)
                    else:
                        other_count = len(sizes) - 1
                        new_sizes.append(remaining // other_count if other_count else 0)
                self.setSizes(new_sizes)

        def toggle_panel(self, index: int, min_size: int = 200) -> None:
            """Toggle panel visibility at index."""
            sizes = self.sizes()
            if 0 <= index < len(sizes):
                if sizes[index] == 0:
                    self.set_panel_size(index, min_size)
                else:
                    sizes[index] = 0
                    self.setSizes(sizes)

else:
    class SashHandle:  # type: ignore
        pass

    class Sash:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass
