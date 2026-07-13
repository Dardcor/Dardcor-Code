import os
import json
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QListWidget, QListWidgetItem,
    QPushButton, QLabel, QInputDialog, QMessageBox, QWidget, QLineEdit
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QIcon

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
        
        self.btn_edit = QPushButton()
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        edit_icon = os.path.join(base_dir, "image", "edit.svg")
        if os.path.exists(edit_icon):
            self.btn_edit.setIcon(QIcon(edit_icon))
        else:
            self.btn_edit.setText("✏️")
            
        self.btn_edit.setFixedSize(28, 28)
        self.btn_edit.setToolTip("Ubah Judul")
        self.btn_edit.setStyleSheet("""
            QPushButton { background: transparent; border: none; font-size: 14px; border-radius: 4px; font-family: "Segoe UI Emoji", "Segoe UI Symbol", sans-serif; }
            QPushButton:hover { background-color: rgba(255, 255, 255, 0.1); }
        """)
        self.btn_edit.setCursor(Qt.PointingHandCursor)
        self.btn_edit.clicked.connect(lambda: self.edit_clicked.emit(self.cid, self.title))
        
        self.btn_delete = QPushButton()
        del_icon = os.path.join(base_dir, "image", "delete.svg")
        if os.path.exists(del_icon):
            self.btn_delete.setIcon(QIcon(del_icon))
        else:
            self.btn_delete.setText("🗑️")
            
        self.btn_delete.setFixedSize(28, 28)
        self.btn_delete.setToolTip("Hapus")
        self.btn_delete.setStyleSheet("""
            QPushButton { background: transparent; border: none; font-size: 14px; border-radius: 4px; font-family: "Segoe UI Emoji", "Segoe UI Symbol", sans-serif; }
            QPushButton:hover { background-color: rgba(255, 50, 50, 0.3); }
        """)
        self.btn_delete.setCursor(Qt.PointingHandCursor)
        self.btn_delete.clicked.connect(lambda: self.delete_clicked.emit(self.cid, self.title))
        
        layout.addWidget(self.lbl_title)
        layout.addStretch()
        layout.addWidget(self.btn_edit)
        layout.addWidget(self.btn_delete)


class ChatHistoryDialog(QDialog):
    """A robust dialog to view, edit, and delete chat history with search."""

    conversation_selected = Signal(str)

    def __init__(self, agent, initial_query: str = "", parent=None):
        super().__init__(parent)
        self._agent = agent
        self._initial_query = initial_query
        self._all_convs = []
        self.setWindowTitle("AI Conversation History")
        self.setMinimumSize(550, 450)
        self.setStyleSheet("QDialog { background-color: #1e1b2e; color: #d4d4d4; }")

        layout = QVBoxLayout(self)

        # Header Row
        header_layout = QHBoxLayout()
        title_lbl = QLabel("Conversation History")
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

        # Search bar
        search_layout = QHBoxLayout()
        self._search_input = QLineEdit()
        self._search_input.setPlaceholderText("Search conversations by title or content...")
        self._search_input.setStyleSheet("""
            QLineEdit {
                background-color: #111315; color: #e4e4e7;
                border: 1px solid #2c2e33; border-radius: 6px;
                padding: 6px 10px; font-size: 12px;
            }
            QLineEdit:focus { border-color: #a855f7; }
        """)
        self._search_input.textChanged.connect(self._filter_conversations)
        search_layout.addWidget(self._search_input)

        search_btn = QPushButton("Search")
        search_btn.setFixedHeight(30)
        search_btn.setStyleSheet("""
            QPushButton {
                background: #7c3aed; color: white; border: none;
                border-radius: 6px; font-size: 11px; font-weight: bold;
                padding: 0 12px;
            }
            QPushButton:hover { background: #6d28d9; }
        """)
        search_btn.clicked.connect(self._filter_conversations)
        search_layout.addWidget(search_btn)
        layout.addLayout(search_layout)

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

        if self._initial_query:
            self._search_input.setText(self._initial_query)
            self._filter_conversations()

        # Apply current theme
        from pydardcor.app.theme_manager import ThemeManager
        ThemeManager.patch_widget(self)

    def _load_data(self):
        self.list_widget.clear()
        self._all_convs = self._agent.list_conversations()
        self._render_convs(self._all_convs)

    def _filter_conversations(self):
        query = self._search_input.text().strip().lower()
        if not query:
            self._render_convs(self._all_convs)
            return
        filtered = []
        for c in self._all_convs:
            title = c.get("title", "").lower()
            cid = c.get("id", "")
            # Also search in conversation content for this query
            if query in title or query in cid.lower():
                filtered.append(c)
                continue
            # Search content
            conv = self._agent._store.load(cid)
            if conv:
                for msg in conv.messages:
                    if query in msg.content.lower():
                        filtered.append(c)
                        break
        self._render_convs(filtered)

    def _render_convs(self, convs: list):
        self.list_widget.clear()
        self.btn_delete_all.setVisible(len(convs) > 0)
        for c in convs:
            title = c.get("title", "Untitled")
            cid = c.get("id")
            item = QListWidgetItem(self.list_widget)
            item.setData(Qt.UserRole, cid)
            widget = ChatHistoryItemWidget(cid, title, self.list_widget)
            widget.edit_clicked.connect(self._on_edit_clicked)
            widget.delete_clicked.connect(self._on_delete_clicked)
            item.setSizeHint(widget.sizeHint())
            self.list_widget.addItem(item)
            self.list_widget.setItemWidget(item, widget)

    def _on_item_clicked(self, item):
        cid = item.data(Qt.UserRole)
        self.conversation_selected.emit(cid)
        self.accept()

    def _on_edit_clicked(self, cid, old_title):
        new_title, ok = QInputDialog.getText(self, "Rename Title", "New Conversation Title:", text=old_title)
        if ok and new_title.strip():
            self._agent.rename_conversation(cid, new_title.strip())
            self._load_data()

    def _on_delete_clicked(self, cid, title):
        reply = QMessageBox.question(
            self, 'Confirm Deletion',
            f"Are you sure you want to delete conversation '{title}'?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            self._agent.delete_conversation(cid)
            self._load_data()

    def _on_delete_all_clicked(self):
        reply = QMessageBox.question(
            self, 'Confirm Delete All',
            "Are you sure you want to delete ALL conversation history? This action cannot be undone.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            convs = self._agent.list_conversations()
            for c in convs:
                self._agent.delete_conversation(c.get("id"))
            self._load_data()
