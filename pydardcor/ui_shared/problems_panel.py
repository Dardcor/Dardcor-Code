"""Problems Panel - VS Code style diagnostics panel."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QFrame
)
from PySide6.QtCore import Signal, Qt, QTimer
from PySide6.QtGui import QColor, QIcon


PROBLEM_STYLE = """
    QTreeWidget {
        background-color: #000000;
        color: #cccccc;
        border: none;
        outline: none;
        font-size: 12px;
    }
    QTreeWidget::item {
        padding: 2px 4px;
        border: none;
        min-height: 22px;
    }
    QTreeWidget::item:selected {
        background-color: #2c004a;
    }
    QTreeWidget::item:hover {
        background-color: #1a0033;
    }
"""


class ProblemsPanel(QWidget):
    """Panel listing errors and warnings from the linter/LSP."""

    problem_selected = Signal(str, int, int)  # file, line, col

    def __init__(self, parent=None):
        super().__init__(parent)
        self._problems = []  # list of dicts {severity, file, line, col, message}
        self._rebuild_timer = QTimer(self)
        self._rebuild_timer.setSingleShot(True)
        self._rebuild_timer.setInterval(75)
        self._rebuild_timer.timeout.connect(self._rebuild)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setStyleSheet(PROBLEM_STYLE)
        self._tree.setRootIsDecorated(True)
        self._tree.itemDoubleClicked.connect(self._on_item_clicked)
        layout.addWidget(self._tree)

    def set_problems(self, file_path, problems):
        """
        problems: list of dicts with keys:
          severity ('error'|'warning'|'info'), line, col, message, source
        """
        # Remove old items for this file
        self._problems = [p for p in self._problems if p.get('file') != file_path]
        for p in problems:
            p['file'] = file_path
            self._problems.append(p)
        self._schedule_rebuild()

    def clear_file(self, file_path):
        self._problems = [p for p in self._problems if p.get('file') != file_path]
        self._schedule_rebuild()

    def clear_all(self):
        self._problems = []
        self._schedule_rebuild()

    def _schedule_rebuild(self):
        self._rebuild_timer.start()

    def _rebuild(self):
        self._tree.clear()

        errors = [p for p in self._problems if p.get('severity') == 'error']
        warnings = [p for p in self._problems if p.get('severity') == 'warning']
        infos = [p for p in self._problems if p.get('severity') == 'info']

        self._add_group("Errors", errors, "🔴", "#f14c4c")
        self._add_group("Warnings", warnings, "🟡", "#cca700")
        self._add_group("Info", infos, "🔵", "#75beff")

    def _add_group(self, title, items, icon, color):
        if not items:
            return
        parent = QTreeWidgetItem(self._tree)
        parent.setText(0, f"  {icon}  {title} ({len(items)})")
        parent.setForeground(0, QColor(color))
        f = parent.font(0)
        f.setBold(True)
        parent.setFont(0, f)
        parent.setExpanded(True)

        for p in items:
            child = QTreeWidgetItem(parent)
            fname = os.path.basename(p.get('file', ''))
            line = p.get('line', 0)
            col = p.get('col', 0)
            msg = p.get('message', '')
            src = p.get('source', '')
            child.setText(0, f"    {msg}  [{fname}:{line}:{col}]  ({src})")
            child.setForeground(0, QColor("#d4d4d4"))
            child.setData(0, Qt.UserRole, p)

    def _on_item_clicked(self, item, col):
        data = item.data(0, Qt.UserRole)
        if data:
            self.problem_selected.emit(
                data.get('file', ''),
                data.get('line', 1),
                data.get('col', 1)
            )

    def get_error_count(self):
        return len([p for p in self._problems if p.get('severity') == 'error'])

    def get_warning_count(self):
        return len([p for p in self._problems if p.get('severity') == 'warning'])
