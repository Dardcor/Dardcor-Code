import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QListWidget, QListWidgetItem,
    QPushButton, QLabel, QInputDialog, QMessageBox, QWidget
)
from PySide6.QtCore import Qt, Signal

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

        # Title
        title_lbl = QLabel("Riwayat Percakapan")
        title_lbl.setStyleSheet("font-size: 16px; font-weight: bold; color: #e0e0e0; margin-bottom: 8px;")
        layout.addWidget(title_lbl)

        # List Widget
        self.list_widget = QListWidget()
        self.list_widget.setStyleSheet(
            "QListWidget { background-color: #161616; border: 1px solid #3c0068; border-radius: 4px; padding: 4px; outline: none; }"
            "QListWidget::item { padding: 8px; border-bottom: 1px solid #2d2d2d; }"
            "QListWidget::item:selected { background-color: #2a2238; }"
        )
        self.list_widget.itemDoubleClicked.connect(self._on_item_double_clicked)
        layout.addWidget(self.list_widget)

        # Buttons
        btn_layout = QHBoxLayout()
        
        self.btn_open = QPushButton("Buka")
        self.btn_open.setStyleSheet("background-color: #3c0068; color: white; padding: 6px 16px; border-radius: 4px;")
        self.btn_open.clicked.connect(self._on_open_clicked)
        
        self.btn_edit = QPushButton("Ubah Judul")
        self.btn_edit.setStyleSheet("background-color: #2d2d2d; color: white; padding: 6px 16px; border-radius: 4px;")
        self.btn_edit.clicked.connect(self._on_edit_clicked)
        
        self.btn_delete = QPushButton("Hapus")
        self.btn_delete.setStyleSheet("background-color: #8a1515; color: white; padding: 6px 16px; border-radius: 4px;")
        self.btn_delete.clicked.connect(self._on_delete_clicked)

        btn_layout.addWidget(self.btn_open)
        btn_layout.addStretch()
        btn_layout.addWidget(self.btn_edit)
        btn_layout.addWidget(self.btn_delete)

        layout.addLayout(btn_layout)

        self._load_data()

    def _load_data(self):
        self.list_widget.clear()
        convs = self._agent.list_conversations()
        for c in convs:
            title = c.get("title", "Untitled")
            cid = c.get("id")
            item = QListWidgetItem(f"{title}")
            item.setData(Qt.UserRole, cid)
            self.list_widget.addItem(item)

    def _on_item_double_clicked(self, item):
        self._on_open_clicked()

    def _on_open_clicked(self):
        item = self.list_widget.currentItem()
        if not item:
            return
        cid = item.data(Qt.UserRole)
        self.conversation_selected.emit(cid)
        self.accept()

    def _on_edit_clicked(self):
        item = self.list_widget.currentItem()
        if not item:
            return
        cid = item.data(Qt.UserRole)
        old_title = item.text()

        new_title, ok = QInputDialog.getText(self, "Ubah Judul", "Judul Percakapan Baru:", text=old_title)
        if ok and new_title.strip():
            self._agent.rename_conversation(cid, new_title.strip())
            self._load_data()

    def _on_delete_clicked(self):
        item = self.list_widget.currentItem()
        if not item:
            return
        cid = item.data(Qt.UserRole)
        
        reply = QMessageBox.question(
            self, 'Konfirmasi Hapus',
            f"Apakah Anda yakin ingin menghapus percakapan '{item.text()}'?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            self._agent.delete_conversation(cid)
            self._load_data()
