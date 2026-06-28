import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QListWidget, QListWidgetItem,
    QPushButton, QLabel, QInputDialog, QMessageBox, QWidget
)
from PySide6.QtCore import Qt, Signal

class ChatHistoryItemWidget(QWidget):
    edit_clicked = Signal(str, str) # cid, current_title
    delete_clicked = Signal(str, str) # cid, current_title

    def __init__(self, cid, title, parent=None):
        super().__init__(parent)
        self.cid = cid
        self.title = title
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)
        
        self.lbl_title = QLabel(title)
        self.lbl_title.setStyleSheet("color: #d4d4d4; font-size: 13px; background: transparent;")
        
        self.btn_edit = QPushButton("✏️")
        self.btn_edit.setFixedSize(28, 28)
        self.btn_edit.setToolTip("Ubah Judul")
        self.btn_edit.setStyleSheet("""
            QPushButton { background: transparent; border: none; font-size: 14px; border-radius: 4px; }
            QPushButton:hover { background-color: rgba(255, 255, 255, 0.1); }
        """)
        self.btn_edit.setCursor(Qt.PointingHandCursor)
        self.btn_edit.clicked.connect(lambda: self.edit_clicked.emit(self.cid, self.title))
        
        self.btn_delete = QPushButton("🗑️")
        self.btn_delete.setFixedSize(28, 28)
        self.btn_delete.setToolTip("Hapus")
        self.btn_delete.setStyleSheet("""
            QPushButton { background: transparent; border: none; font-size: 14px; border-radius: 4px; }
            QPushButton:hover { background-color: rgba(255, 50, 50, 0.3); }
        """)
        self.btn_delete.setCursor(Qt.PointingHandCursor)
        self.btn_delete.clicked.connect(lambda: self.delete_clicked.emit(self.cid, self.title))
        
        layout.addWidget(self.lbl_title)
        layout.addStretch()
        layout.addWidget(self.btn_edit)
        layout.addWidget(self.btn_delete)


class ChatHistoryDialog(QDialog):
    """A robust dialog to view, edit, and delete chat history."""

    conversation_selected = Signal(str)

    def __init__(self, agent, parent=None):
        super().__init__(parent)
        self._agent = agent
        self.setWindowTitle("Riwayat Percakapan AI")
        self.setMinimumSize(500, 400)
        self.setStyleSheet("QDialog { background-color: #1e1b2e; color: #d4d4d4; }")

        layout = QVBoxLayout(self)

        # Header Row
        header_layout = QHBoxLayout()
        title_lbl = QLabel("Riwayat Percakapan")
        title_lbl.setStyleSheet("font-size: 16px; font-weight: bold; color: #e0e0e0;")
        header_layout.addWidget(title_lbl)
        
        header_layout.addStretch()
        
        self.btn_delete_all = QPushButton("Delete All")
        self.btn_delete_all.setStyleSheet("""
            QPushButton {
                background-color: #8a1515; 
                color: white; 
                padding: 4px 12px; 
                border-radius: 4px;
                font-size: 12px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #a81a1a;
            }
        """)
        self.btn_delete_all.setCursor(Qt.PointingHandCursor)
        self.btn_delete_all.clicked.connect(self._on_delete_all_clicked)
        header_layout.addWidget(self.btn_delete_all)
        
        layout.addLayout(header_layout)

        # List Widget
        self.list_widget = QListWidget()
        self.list_widget.setStyleSheet("""
            QListWidget { 
                background-color: #161616; 
                border: 1px solid #3c0068; 
                border-radius: 4px; 
                padding: 4px; 
                outline: none; 
            }
            QListWidget::item { 
                border-bottom: 1px solid #2d2d2d; 
            }
            QListWidget::item:selected { 
                background-color: #2a2238; 
            }
            QListWidget::item:hover:!selected {
                background-color: rgba(255, 255, 255, 0.05);
            }
        """)
        self.list_widget.itemClicked.connect(self._on_item_clicked)
        layout.addWidget(self.list_widget)

        self._load_data()

    def _load_data(self):
        self.list_widget.clear()
        convs = self._agent.list_conversations()
        
        self.btn_delete_all.setVisible(len(convs) > 0)
        
        for c in convs:
            title = c.get("title", "Untitled")
            cid = c.get("id")
            
            item = QListWidgetItem(self.list_widget)
            item.setData(Qt.UserRole, cid)
            
            # Create custom widget
            widget = ChatHistoryItemWidget(cid, title, self.list_widget)
            widget.edit_clicked.connect(self._on_edit_clicked)
            widget.delete_clicked.connect(self._on_delete_clicked)
            
            # Set size hint properly
            item.setSizeHint(widget.sizeHint())
            
            self.list_widget.addItem(item)
            self.list_widget.setItemWidget(item, widget)

    def _on_item_clicked(self, item):
        cid = item.data(Qt.UserRole)
        self.conversation_selected.emit(cid)
        self.accept()

    def _on_edit_clicked(self, cid, old_title):
        new_title, ok = QInputDialog.getText(self, "Ubah Judul", "Judul Percakapan Baru:", text=old_title)
        if ok and new_title.strip():
            self._agent.rename_conversation(cid, new_title.strip())
            self._load_data()

    def _on_delete_clicked(self, cid, title):
        reply = QMessageBox.question(
            self, 'Konfirmasi Hapus',
            f"Apakah Anda yakin ingin menghapus percakapan '{title}'?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            self._agent.delete_conversation(cid)
            self._load_data()

    def _on_delete_all_clicked(self):
        reply = QMessageBox.question(
            self, 'Konfirmasi Hapus Semua',
            "Apakah Anda yakin ingin menghapus SEMUA riwayat percakapan? Tindakan ini tidak dapat dibatalkan.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            convs = self._agent.list_conversations()
            for c in convs:
                self._agent.delete_conversation(c.get("id"))
            self._load_data()
