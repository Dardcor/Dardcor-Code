"""Git Graph - VS Code style visual git history viewer."""

import os
import subprocess
import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem, QLabel,
    QHBoxLayout, QPushButton
)
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QColor, QFont


class GitGraphPanel(QWidget):
    """A visual representation of git history."""

    commit_selected = Signal(str)  # emits commit hash

    def __init__(self, workspace_path: str = "", parent=None):
        super().__init__(parent)
        self._workspace = workspace_path
        self._setup_ui()
        self.refresh()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Toolbar
        toolbar = QWidget()
        toolbar.setFixedHeight(30)
        toolbar.setStyleSheet("background-color: #0d0d0d; border-bottom: 1px solid #2c004a;")
        tb_lay = QHBoxLayout(toolbar)
        tb_lay.setContentsMargins(8, 0, 8, 0)

        title = QLabel("GIT GRAPH")
        title.setStyleSheet("color: #bbbbbb; font-size: 11px; font-weight: bold;")
        tb_lay.addWidget(title)
        tb_lay.addStretch()

        refresh_btn = QPushButton("↻")
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setStyleSheet("QPushButton { background: transparent; border: none; color: #cccccc; font-size: 14px; } QPushButton:hover { background: #2c004a; }")
        refresh_btn.clicked.connect(self.refresh)
        tb_lay.addWidget(refresh_btn)

        layout.addWidget(toolbar)

        # Tree
        self._tree = QTreeWidget()
        self._tree.setHeaderLabels(["Graph", "Description", "Date", "Author", "Commit"])
        self._tree.setColumnWidth(0, 80)
        self._tree.setColumnWidth(1, 300)
        self._tree.setColumnWidth(2, 120)
        self._tree.setColumnWidth(3, 100)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-family: "Cascadia Code", "Consolas", monospace;
                font-size: 11px;
            }
            QTreeWidget::item { padding: 4px; }
            QTreeWidget::item:selected { background-color: #2c004a; }
            QHeaderView::section {
                background-color: #1a1a1a;
                color: #888888;
                border: none;
                border-bottom: 1px solid #333333;
                padding: 4px;
            }
        """)
        self._tree.itemClicked.connect(self._on_item_clicked)
        layout.addWidget(self._tree)

    def set_workspace(self, path: str):
        self._workspace = path
        self.refresh()

    def refresh(self):
        self._tree.clear()
        if not self._workspace or not os.path.exists(os.path.join(self._workspace, ".git")):
            item = QTreeWidgetItem(["", "No Git repository found", "", "", ""])
            item.setForeground(1, QColor("#888888"))
            self._tree.addTopLevelItem(item)
            return

        def _fetch_history():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                result = subprocess.run(
                    ["git", "log", "--graph", "--oneline", "--decorate", "--all", "-n", "100",
                     "--pretty=format:%h|%s|%cd|%an|%d", "--date=short"],
                    cwd=self._workspace, capture_output=True, text=True,
                    timeout=5, **kwargs
                )
                return result.stdout.splitlines()
            except Exception:
                return []

        def _on_done(lines):
            for line in lines:
                parts = line.split("|")
                if len(parts) >= 5:
                    commit_hash = parts[0].strip("*\\|/ ")
                    graph_part = parts[0].replace(commit_hash, "").strip() if commit_hash else parts[0]
                    subject = parts[1]
                    date = parts[2]
                    author = parts[3]
                    refs = parts[4]
                    
                    desc = subject
                    if refs:
                        desc = f"({refs.strip()}) {subject}"

                    item = QTreeWidgetItem([graph_part + " *", desc, date, author, commit_hash])
                    
                    # Colors
                    if refs:
                        item.setForeground(1, QColor("#f1d45a"))  # Yellow for refs
                    item.setForeground(0, QColor("#e2c08d"))      # Graph lines
                    item.setForeground(2, QColor("#888888"))      # Date
                    item.setForeground(3, QColor("#569cd6"))      # Author
                    item.setForeground(4, QColor("#888888"))      # Hash
                    
                    item.setData(0, Qt.UserRole, commit_hash)
                    self._tree.addTopLevelItem(item)

        threading.Thread(target=lambda: QTimer.singleShot(0, lambda: _on_done(_fetch_history())), daemon=True).start()

    def _on_item_clicked(self, item, column):
        commit_hash = item.data(0, Qt.UserRole)
        if commit_hash:
            self.commit_selected.emit(commit_hash)
