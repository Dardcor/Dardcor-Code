"""Timeline Panel - VS Code style timeline view for current file."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QSizePolicy
)
from PySide6.QtCore import Qt, QSize
from PySide6.QtGui import QColor, QPainter, QPen


class SectionHeaderButton(QPushButton):
    """Custom button that draws a VS Code-style vector chevron to match FileExplorer."""
    def __init__(self, text, collapsed=True, parent=None):
        super().__init__(text, parent)
        self._collapsed = collapsed
        self.setFixedHeight(22)
        self.setCursor(Qt.PointingHandCursor)
        
        # Load colors from ThemeManager if available
        bg_color = "#000000"
        fg_color = "#cccccc"
        hover_color = "#1a1a1a"
        border_color = "#3c0068"
        try:
            from pydardcor.app.theme_manager import ThemeManager
            theme = ThemeManager.THEMES.get(ThemeManager._current_theme, {})
            colors = theme.get("colors", {})
            bg_color = colors.get("background", bg_color)
            fg_color = colors.get("foreground", fg_color)
            hover_color = colors.get("hover", hover_color)
            border_color = colors.get("border", border_color)
        except Exception:
            pass

        self.setStyleSheet(f"""
            QPushButton {{
                background-color: {bg_color};
                color: {fg_color};
                font-family: "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
                font-size: 11px;
                font-weight: bold;
                text-align: left;
                padding-left: 14px;
                border: none;
                border-top: 1px solid {border_color};
            }}
            QPushButton:hover {{
                background-color: {hover_color};
            }}
        """)

    def set_collapsed(self, collapsed):
        self._collapsed = collapsed
        self.update()

    def paintEvent(self, event):
        super().paintEvent(event)
        
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        cx = 6
        cy = self.height() // 2

        pen = QPen(QColor("#858585"))
        pen.setWidth(2)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)

        if self._collapsed:
            # > rightward chevron
            painter.drawLine(cx - 2, cy - 3, cx + 2, cy)
            painter.drawLine(cx + 2, cy, cx - 2, cy + 3)
        else:
            # v downward chevron
            painter.drawLine(cx - 3, cy - 2, cx, cy + 2)
            painter.drawLine(cx, cy + 2, cx + 3, cy - 2)

        painter.end()


class TimelinePanel(QWidget):
    """Panel showing local save history and git commits for the active file."""

    HEADER_HEIGHT = 22

    def __init__(self, parent=None):
        super().__init__(parent)
        self._collapsed = True
        self._setup_ui()
        self._apply_collapsed_size()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header - VS Code style collapsible section header
        self._header = SectionHeaderButton("Timeline", self._collapsed)
        self._header.clicked.connect(self._toggle_collapse)
        layout.addWidget(self._header)

        # Tree
        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(16)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 12px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 2px;
                border: none;
            }
            QTreeWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QTreeWidget::item:hover {
                background-color: #2a2d2e;
            }
        """)
        layout.addWidget(self._tree)

        # Start collapsed
        self._tree.hide()

    def _apply_collapsed_size(self):
        if self._collapsed:
            self.setFixedHeight(self.HEADER_HEIGHT)
        else:
            self.setMinimumHeight(self.HEADER_HEIGHT + 40)
            self.setMaximumHeight(16777215)  # QWIDGETSIZE_MAX

    def _update_header_text(self):
        self._header.set_collapsed(self._collapsed)

    def _toggle_collapse(self):
        self._collapsed = not self._collapsed
        self._tree.setVisible(not self._collapsed)
        self._update_header_text()
        self._apply_collapsed_size()

    def sizeHint(self):
        if self._collapsed:
            return QSize(200, self.HEADER_HEIGHT)
        return super().sizeHint()

    def minimumSizeHint(self):
        return QSize(0, self.HEADER_HEIGHT)

    def update_timeline(self, file_path: str):
        self._tree.clear()
        if not file_path or not os.path.exists(file_path):
            return

        # Add local save modified time
        import time
        try:
            mtime = os.path.getmtime(file_path)
            mtime_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime))
        except Exception:
            mtime_str = "Unknown time"

        item = QTreeWidgetItem([f"Local Save - {mtime_str}"])
        item.setForeground(0, QColor("#cccccc"))
        self._tree.addTopLevelItem(item)

        # Async fetch git log
        import threading
        from ..git.panel import run_git

        def fetch_git_log():
            cwd = os.path.dirname(file_path)
            basename = os.path.basename(file_path)
            stdout, stderr, rc = run_git(["log", "--follow", "--oneline", "-n", "10", "--", basename], cwd)
            if rc == 0 and stdout:
                lines = stdout.splitlines()
                from PySide6.QtCore import QTimer
                QTimer.singleShot(0, lambda: self._add_git_commits(lines))
            else:
                from PySide6.QtCore import QTimer
                QTimer.singleShot(0, lambda: self._add_no_commits_msg())

        threading.Thread(target=fetch_git_log, daemon=True).start()

    def _add_git_commits(self, lines):
        for line in lines:
            item = QTreeWidgetItem([f"Git: {line}"])
            item.setForeground(0, QColor("#888888"))
            self._tree.addTopLevelItem(item)

    def _add_no_commits_msg(self):
        item = QTreeWidgetItem(["No git commits found (untracked)"])
        item.setForeground(0, QColor("#666666"))
        self._tree.addTopLevelItem(item)
