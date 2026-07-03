"""Test Explorer Panel - VS Code style Testing Framework."""

import os
import subprocess
import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTreeWidget, QTreeWidgetItem, QScrollArea
)
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QColor, QFont

class TestExplorerPanel(QWidget):
    """VS Code-style Testing panel to run and debug tests."""
    
    file_open_requested = Signal(str)

    def __init__(self, root_path=None, parent=None):
        super().__init__(parent)
        self._root = root_path or os.path.expanduser("~")
        self._tests = []
        self._setup_ui()
        self.refresh_tests()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(36)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2b2b2b;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 8, 0)

        title = QLabel("TESTING")
        title.setStyleSheet("color: #bbbbbb; font-size: 10px; font-weight: 600; letter-spacing: 1.2px;")
        h_lay.addWidget(title)
        h_lay.addStretch()

        refresh_btn = QPushButton("↻")
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setToolTip("Discover Tests")
        refresh_btn.setStyleSheet(self._icon_btn())
        refresh_btn.clicked.connect(self.refresh_tests)
        h_lay.addWidget(refresh_btn)

        run_all_btn = QPushButton("▶")
        run_all_btn.setFixedSize(22, 22)
        run_all_btn.setToolTip("Run All Tests")
        run_all_btn.setStyleSheet(self._icon_btn())
        run_all_btn.clicked.connect(self.run_all_tests)
        h_lay.addWidget(run_all_btn)

        layout.addWidget(header)

        # Action bar
        btn_row = QWidget()
        btn_row.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2b2b2b;")
        btn_lay = QHBoxLayout(btn_row)
        btn_lay.setContentsMargins(8, 4, 8, 4)
        btn_lay.setSpacing(6)

        self._status_label = QLabel("  No tests found")
        self._status_label.setStyleSheet("color: #888888; font-size: 11px;")
        btn_lay.addWidget(self._status_label)
        btn_lay.addStretch()

        layout.addWidget(btn_row)

        # Tree
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: #000000; } QScrollBar:vertical { width: 8px; background: #000000; } QScrollBar::handle:vertical { background: #333333; }")
        
        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setRootIsDecorated(False)
        self._tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tree.setStyleSheet("""
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
            }
            QTreeWidget::item:selected {
                background-color: #1a1a1a;
                color: #ffffff;
            }
            QTreeWidget::item:hover {
                background-color: #1a0033;
            }
        """)
        
        scroll.setWidget(self._tree)
        layout.addWidget(scroll)

    def _icon_btn(self):
        return """
            QPushButton { background: transparent; border: none; color: #cccccc; font-size: 14px; border-radius: 3px; }
            QPushButton:hover { background: #1a1a1a; }
        """

    def set_root(self, path):
        self._root = path
        self.refresh_tests()

    def refresh_tests(self):
        """Mock discovering tests via pytest --collect-only"""
        self._status_label.setText("  Discovering tests...")
        self._tree.clear()
        
        def _discover():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                res = subprocess.run(["pytest", "--collect-only", "-q"], cwd=self._root, capture_output=True, text=True, timeout=5, **kwargs)
                lines = res.stdout.splitlines()
                tests = [line for line in lines if "::" in line]
                return tests
            except Exception:
                return []
                
        def _on_done(tests):
            self._status_label.setText(f"  {len(tests)} tests found")
            self._populate_tree(tests)
            
        threading.Thread(target=lambda: QTimer.singleShot(0, lambda t=_discover(): _on_done(t)), daemon=True).start()

    def _populate_tree(self, tests):
        self._tree.clear()
        for t in tests:
            item = QTreeWidgetItem([f"  {t}"])
            item.setData(0, Qt.UserRole, t)
            self._tree.addTopLevelItem(item)

    def run_all_tests(self):
        self._status_label.setText("  Running tests...")
        
        def _run():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                res = subprocess.run(["pytest", "-q"], cwd=self._root, capture_output=True, text=True, timeout=30, **kwargs)
                return res.stdout, res.returncode
            except Exception as e:
                return str(e), 1
                
        def _on_done(stdout, rc):
            self._status_label.setText(f"  Tests finished (rc: {rc})")
            for i in range(self._tree.topLevelItemCount()):
                item = self._tree.topLevelItem(i)
                test_name = item.data(0, Qt.UserRole)
                # Mock result parsing
                if "failed" in stdout.lower() and test_name in stdout:
                    item.setForeground(0, QColor("#f14c4c")) # Red
                else:
                    item.setForeground(0, QColor("#73c991")) # Green
                    
        threading.Thread(target=lambda: QTimer.singleShot(0, lambda res=_run(): _on_done(*res)), daemon=True).start()
