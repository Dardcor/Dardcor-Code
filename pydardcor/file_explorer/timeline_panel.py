"""Timeline Panel - Shows local history and git commits for the active file."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem, QLabel
)
from PySide6.QtCore import Qt, QSize, Signal
from PySide6.QtGui import QColor

from .outline_panel import SectionHeaderButton

class TimelinePanel(QWidget):
    item_selected = Signal(str)  # Emit commit hash or local history ID
    toggled = Signal(bool)
    def __init__(self, parent=None):
        super().__init__(parent)
        self._collapsed = True
        self._setup_ui()
        
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        self._header = SectionHeaderButton("Timeline", self._collapsed)
        self._header.clicked.connect(self._toggle_collapse)
        layout.addWidget(self._header)
        
        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(16)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 11px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 4px 2px;
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
        self._tree.hide()
        
    def _update_header_text(self):
        self._header.set_collapsed(self._collapsed)
        
    def _toggle_collapse(self):
        self._collapsed = not self._collapsed
        self._tree.setVisible(not self._collapsed)
        self._update_header_text()
        self.toggled.emit(self._collapsed)
        
    def update_timeline(self, file_path: str):
        self._tree.clear()
        if not file_path:
            item = QTreeWidgetItem(["No active file"])
            item.setForeground(0, QColor("#888888"))
            self._tree.addTopLevelItem(item)
            return
            
        import subprocess
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            
            # Fetch git log for file
            workdir = os.path.dirname(file_path)
            res = subprocess.run(
                ["git", "log", "--pretty=format:%h|%an|%ar|%s", "--max-count=10", "--", os.path.basename(file_path)],
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=2,
                **kwargs
            )
            
            if res.returncode == 0 and res.stdout.strip():
                lines = res.stdout.strip().splitlines()
                for line in lines:
                    parts = line.split("|", 3)
                    if len(parts) == 4:
                        hash_, author, time_, msg = parts
                        item = QTreeWidgetItem([f"[{hash_}] {msg} ({time_})"])
                        item.setToolTip(0, f"Author: {author}\nMessage: {msg}")
                        self._tree.addTopLevelItem(item)
            else:
                item = QTreeWidgetItem(["No Git History"])
                item.setForeground(0, QColor("#888888"))
                self._tree.addTopLevelItem(item)
                
            # Add Local History mock
            local_item = QTreeWidgetItem(["Local History (Saved 2 mins ago)"])
            local_item.setForeground(0, QColor("#e2c08d"))
            self._tree.addTopLevelItem(local_item)
            
        except Exception:
            item = QTreeWidgetItem(["History unavailable"])
            item.setForeground(0, QColor("#888888"))
            self._tree.addTopLevelItem(item)
