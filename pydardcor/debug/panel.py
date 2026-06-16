"""Debug Panel - VS Code style run and debug sidebar panel."""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QComboBox, QScrollArea
)
from PySide6.QtCore import Signal, Qt
from PySide6.QtGui import QColor, QFont

class DebugPanel(QWidget):
    """Panel showing Variables, Call Stack, Watch, and Breakpoints."""

    run_requested = Signal()
    debug_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("""
            background-color: #000000;
            border-bottom: 1px solid #1a0033;
        """)
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(20, 0, 8, 0)
        
        title = QLabel("RUN AND DEBUG")
        title.setStyleSheet("""
            color: #bbbbbb;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 1.2px;
        """)
        h_lay.addWidget(title)
        h_lay.addStretch()
        layout.addWidget(header)

        # Run toolbar
        run_bar = QWidget()
        run_bar.setFixedHeight(35)
        run_bar.setStyleSheet("background-color: #000000;")
        rb_lay = QHBoxLayout(run_bar)
        rb_lay.setContentsMargins(10, 4, 10, 4)

        start_btn = QPushButton("▶")
        start_btn.setFixedSize(24, 24)
        start_btn.setToolTip("Start Debugging (F5)")
        start_btn.setStyleSheet("""
            QPushButton { background: transparent; color: #89d185; font-size: 16px; border: none; }
            QPushButton:hover { background: #2c004a; border-radius: 3px; }
        """)
        start_btn.clicked.connect(self.debug_requested)
        rb_lay.addWidget(start_btn)

        self._config_combo = QComboBox()
        self._config_combo.addItems(["Python: Current File", "Python: Module"])
        self._config_combo.setStyleSheet("""
            QComboBox {
                background: #1a0033; color: #cccccc; border: 1px solid #3c0068;
                padding: 2px 6px; font-size: 12px;
            }
        """)
        rb_lay.addWidget(self._config_combo)

        settings_btn = QPushButton("⚙")
        settings_btn.setFixedSize(24, 24)
        settings_btn.setStyleSheet("""
            QPushButton { background: transparent; color: #cccccc; font-size: 14px; border: none; }
            QPushButton:hover { background: #2c004a; border-radius: 3px; }
        """)
        rb_lay.addWidget(settings_btn)

        layout.addWidget(run_bar)

        # Scroll area for sections
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: #000000; }")
        
        content = QWidget()
        content.setStyleSheet("background-color: #000000;")
        c_lay = QVBoxLayout(content)
        c_lay.setContentsMargins(0, 0, 0, 0)
        c_lay.setSpacing(0)

        # Sections
        self._variables = self._make_section("VARIABLES")
        c_lay.addWidget(self._variables)
        
        self._watch = self._make_section("WATCH")
        c_lay.addWidget(self._watch)
        
        self._call_stack = self._make_section("CALL STACK")
        c_lay.addWidget(self._call_stack)
        
        self._breakpoints = self._make_section("BREAKPOINTS")
        c_lay.addWidget(self._breakpoints)

        c_lay.addStretch()
        scroll.setWidget(content)
        layout.addWidget(scroll)

    def _make_section(self, title):
        tree = QTreeWidget()
        tree.setHeaderHidden(True)
        tree.setRootIsDecorated(True)
        tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000; color: #cccccc; border: none; font-size: 12px;
            }
            QTreeWidget::item { padding: 2px; }
            QTreeWidget::item:selected { background-color: #2c004a; }
        """)
        
        header = QTreeWidgetItem([title])
        header.setForeground(0, QColor("#bbbbbb"))
        f = header.font(0)
        f.setBold(True)
        f.setPointSize(10)
        header.setFont(0, f)
        header.setExpanded(True)
        
        tree.addTopLevelItem(header)
        tree._header = header
        
        # Placeholder content
        ph = QTreeWidgetItem(["Not debugging"])
        ph.setForeground(0, QColor("#888888"))
        header.addChild(ph)
        
        tree.setMaximumHeight(200)
        return tree
