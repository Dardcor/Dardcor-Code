import os
from PySide6.QtWidgets import QWidget, QVBoxLayout, QListWidget, QListWidgetItem
from PySide6.QtCore import Signal, Qt
from PySide6.QtGui import QColor

from .outline_panel import SectionHeaderButton
from .panel import get_file_icon

class OpenEditorsPanel(QWidget):
    file_selected = Signal(str)
    file_closed = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._collapsed = False
        self._open_files = [] # list of (path, is_active)
        self.setObjectName("openEditorsPanel")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._header = SectionHeaderButton("OPEN EDITORS", self._collapsed)
        self._header.clicked.connect(self._toggle_collapse)
        layout.addWidget(self._header)

        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget {
                background-color: #000000;
                border: none;
                color: #cccccc;
                font-family: "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
                font-size: 12px;
                outline: none;
            }
            QListWidget::item {
                padding: 2px 4px;
                min-height: 22px;
                border: none;
            }
            QListWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QListWidget::item:hover:!selected {
                background-color: #2a2d2e;
            }
        """)
        self._list.itemClicked.connect(self._on_item_clicked)
        self._list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._list.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self._list.setTextElideMode(Qt.ElideRight)
        layout.addWidget(self._list)
        
        self._adjust_height()

    def _toggle_collapse(self):
        self._collapsed = not self._collapsed
        self._header.set_collapsed(self._collapsed)
        self._adjust_height()

    def _adjust_height(self):
        count = self._list.count()
        if self._collapsed or count == 0:
            self._list.setVisible(False)
            self.setMaximumHeight(16777215) # Let layout naturally shrink it to header size
        else:
            self._list.setVisible(True)
            # Calculate height needed for list items (approx 22px each)
            h = (count * 22) + 4
            self._list.setFixedHeight(min(h, 200))
            self.setMaximumHeight(16777215)

    def update_editors(self, open_files: list, active_path: str = None):
        """open_files is a list of file paths"""
        self._list.clear()
        self._open_files = []
        for path in open_files:
            if not path:
                continue
            name = os.path.basename(path)
            item = QListWidgetItem(name)
            item.setIcon(get_file_icon(path))
            item.setData(Qt.UserRole, path)
            item.setToolTip(path)
            
            if path == active_path:
                item.setForeground(QColor("#ffffff"))
            else:
                item.setForeground(QColor("#cccccc"))
                
            self._list.addItem(item)
            self._open_files.append(path)
            
            if path == active_path:
                self._list.setCurrentItem(item)
                
        self._adjust_height()

    def _on_item_clicked(self, item: QListWidgetItem):
        path = item.data(Qt.UserRole)
        if path:
            self.file_selected.emit(path)
