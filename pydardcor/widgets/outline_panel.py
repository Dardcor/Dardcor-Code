"""Outline Panel - VS Code style outline view for current file."""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton
)
from PySide6.QtCore import Signal, Qt
from PySide6.QtGui import QColor, QIcon

class OutlinePanel(QWidget):
    """Panel showing symbols (classes, functions, etc) for the active file."""

    item_selected = Signal(int)  # Emit line number to jump to

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(22)
        header.setStyleSheet("background-color: #000000;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(10, 0, 4, 0)
        
        title = QLabel("OUTLINE")
        title.setStyleSheet("""
            color: #cccccc;
            font-size: 11px;
            font-weight: bold;
        """)
        h_lay.addWidget(title)
        h_lay.addStretch()

        layout.addWidget(header)

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
        self._tree.itemClicked.connect(self._on_item_clicked)
        layout.addWidget(self._tree)

    def set_symbols(self, symbols: list):
        """
        symbols: list of dicts: {'name': str, 'type': str, 'line': int, 'children': list}
        """
        self._tree.clear()
        if not symbols:
            item = QTreeWidgetItem(["No symbols found"])
            item.setForeground(0, QColor("#888888"))
            self._tree.addTopLevelItem(item)
            return

        def add_nodes(parent_item, syms):
            for sym in syms:
                item = QTreeWidgetItem([sym.get('name', 'Unknown')])
                icon_text = "{} "  # fallback
                t = sym.get('type', '')
                if t == 'class':
                    icon_text = "🅲 "
                elif t == 'function' or t == 'method':
                    icon_text = "🅼 "
                elif t == 'variable':
                    icon_text = "🆅 "
                
                item.setText(0, f"{icon_text}{sym.get('name')}")
                item.setData(0, Qt.UserRole, sym.get('line', 1))
                
                if parent_item:
                    parent_item.addChild(item)
                else:
                    self._tree.addTopLevelItem(item)
                    
                if sym.get('children'):
                    add_nodes(item, sym.get('children'))

        add_nodes(None, symbols)
        self._tree.expandAll()

    def _on_item_clicked(self, item: QTreeWidgetItem, col: int):
        line = item.data(0, Qt.UserRole)
        if line:
            self.item_selected.emit(line)
