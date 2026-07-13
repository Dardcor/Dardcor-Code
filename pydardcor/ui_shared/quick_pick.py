"""Quick Pick dialogs - Multi-select, Input Box with validation, Dropdown Quick Pick."""

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLineEdit, QListWidget, QListWidgetItem,
    QWidget, QFrame, QLabel, QApplication, QPushButton, QCheckBox, QMessageBox
)
from PySide6.QtCore import Signal, Qt, QTimer, QSize
from PySide6.QtGui import QColor, QKeyEvent, QFont


class QuickPickItem(QWidget):
    """Custom widget for a Quick Pick item with checkbox for multi-select."""
    def __init__(self, label: str, detail: str = "", checked: bool = False, parent=None):
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 2, 8, 2)
        layout.setSpacing(8)

        self.checkbox = QCheckBox()
        self.checkbox.setChecked(checked)
        self.checkbox.setStyleSheet("""
            QCheckBox::indicator {
                width: 14px; height: 14px;
                border: 1px solid #3c0068;
                border-radius: 3px;
                background: #000000;
            }
            QCheckBox::indicator:checked {
                background-color: #7c3aed;
                border-color: #7c3aed;
            }
        """)
        layout.addWidget(self.checkbox)

        self.label = QLabel(label)
        self.label.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
        layout.addWidget(self.label)

        if detail:
            self.detail = QLabel(detail)
            self.detail.setStyleSheet("color: #858585; font-size: 11px; background: transparent;")
            layout.addWidget(self.detail)

        layout.addStretch()

    def is_checked(self):
        return self.checkbox.isChecked()

    def set_checked(self, checked: bool):
        self.checkbox.setChecked(checked)


class QuickPickDialog(QDialog):
    """Quick Pick dialog supporting single-select and multi-select modes."""

    confirmed = Signal(list)  # Emits list of selected item data
    cancelled = Signal()

    def __init__(self, title: str = "", placeholder: str = "Type to filter...",
                 multi_select: bool = False, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground, False)
        self._items = []
        self._filtered_items = []
        self._multi_select = multi_select
        self._setup_ui(title, placeholder)

    def _setup_ui(self, title, placeholder):
        self.setFixedWidth(500)
        self.setMaximumHeight(450)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        container = QFrame()
        container.setObjectName("QuickPickContainer")
        container.setStyleSheet("""
            #QuickPickContainer {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 6px;
            }
        """)
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)
        container_layout.setSpacing(0)

        if title:
            title_bar = QWidget()
            title_bar.setFixedHeight(30)
            title_bar.setStyleSheet("background-color: #2c004a; border-top-left-radius: 6px; border-top-right-radius: 6px;")
            t_layout = QHBoxLayout(title_bar)
            t_layout.setContentsMargins(14, 0, 8, 0)
            t_label = QLabel(title)
            t_label.setStyleSheet("color: #cccccc; font-size: 12px; background: transparent;")
            t_layout.addWidget(t_label)
            container_layout.addWidget(title_bar)

        self._input = QLineEdit()
        self._input.setPlaceholderText(placeholder)
        self._input.setFixedHeight(36)
        self._input.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: none;
                border-bottom: 1px solid #3c0068;
                padding: 4px 14px;
                font-size: 14px;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
            }
        """)
        self._input.textChanged.connect(self._on_filter)
        container_layout.addWidget(self._input)

        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget {
                background-color: #000000;
                border: none;
                color: #cccccc;
                font-size: 13px;
                outline: none;
                padding: 4px 0px;
                border-bottom-left-radius: 6px;
                border-bottom-right-radius: 6px;
            }
            QListWidget::item {
                padding: 2px 4px;
                min-height: 28px;
                border: none;
            }
            QListWidget::item:selected {
                background-color: #3c0068;
            }
            QListWidget::item:hover:!selected {
                background-color: #1a0033;
            }
        """)
        self._list.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self._list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._list.itemActivated.connect(self._on_item_activated)
        self._list.itemClicked.connect(self._on_item_clicked)
        container_layout.addWidget(self._list)

        if self._multi_select:
            btn_bar = QWidget()
            btn_bar.setStyleSheet("background-color: #0d0d0d; border-top: 1px solid #1a0033;")
            btn_layout = QHBoxLayout(btn_bar)
            btn_layout.setContentsMargins(8, 4, 8, 4)

            ok_btn = QPushButton("OK")
            ok_btn.setStyleSheet("""
                QPushButton {
                    background-color: #7c3aed; color: white; border: none;
                    border-radius: 4px; padding: 4px 16px; font-size: 12px;
                }
                QPushButton:hover { background-color: #6d28d9; }
            """)
            ok_btn.clicked.connect(self._on_confirm)

            cancel_btn = QPushButton("Cancel")
            cancel_btn.setStyleSheet("""
                QPushButton {
                    background-color: transparent; color: #858585; border: 1px solid #3c0068;
                    border-radius: 4px; padding: 4px 16px; font-size: 12px;
                }
                QPushButton:hover { color: #cccccc; }
            """)
            cancel_btn.clicked.connect(self._on_cancel)

            select_all_btn = QPushButton("Toggle All")
            select_all_btn.setStyleSheet("""
                QPushButton {
                    background: transparent; color: #858585; border: none; font-size: 11px;
                }
                QPushButton:hover { color: #cccccc; }
            """)
            select_all_btn.clicked.connect(self._toggle_select_all)

            btn_layout.addWidget(select_all_btn)
            btn_layout.addStretch()
            btn_layout.addWidget(ok_btn)
            btn_layout.addWidget(cancel_btn)
            container_layout.addWidget(btn_bar)

        layout.addWidget(container)

    def set_items(self, items: list):
        """Set items. Each item is a dict: {label, detail?, data?, checked?}"""
        self._items = items
        self._filtered_items = items[:]
        self._populate_list()

    def _populate_list(self):
        self._list.clear()
        for item in self._filtered_items:
            list_item = QListWidgetItem()
            widget = QuickPickItem(
                item.get("label", ""),
                item.get("detail", ""),
                item.get("checked", False),
            )
            list_item.setSizeHint(QSize(0, 32))
            list_item.setData(Qt.UserRole, item.get("data", item.get("label", "")))
            list_item.setData(Qt.UserRole + 1, widget.is_checked())
            self._list.addItem(list_item)
            self._list.setItemWidget(list_item, widget)

        if self._filtered_items:
            self._list.setCurrentRow(0)

        self._adjust_size()

    def _adjust_size(self):
        count = min(self._list.count(), 12)
        h = count * 32 + 8
        self._list.setFixedHeight(max(50, h))

    def _on_filter(self, text):
        text = text.strip().lower()
        if not text:
            self._filtered_items = self._items[:]
        else:
            self._filtered_items = [
                item for item in self._items
                if text in item.get("label", "").lower()
                or text in item.get("detail", "").lower()
            ]
        self._populate_list()

    def _on_item_activated(self, item):
        if not self._multi_select:
            data = item.data(Qt.UserRole)
            self.confirmed.emit([data])
            self.close()

    def _on_item_clicked(self, item):
        if self._multi_select:
            widget = self._list.itemWidget(item)
            if widget and hasattr(widget, 'checkbox'):
                widget.checkbox.toggle()
                item.setData(Qt.UserRole + 1, widget.is_checked())

    def _toggle_select_all(self):
        any_unchecked = any(
            self._list.item(i).data(Qt.UserRole + 1) == False
            for i in range(self._list.count())
        )
        for i in range(self._list.count()):
            item = self._list.item(i)
            widget = self._list.itemWidget(item)
            if widget and hasattr(widget, 'checkbox'):
                widget.set_checked(any_unchecked)
                item.setData(Qt.UserRole + 1, any_unchecked)

    def _on_confirm(self):
        selected = []
        for i in range(self._list.count()):
            item = self._list.item(i)
            widget = self._list.itemWidget(item)
            if widget and hasattr(widget, 'checkbox') and widget.is_checked():
                selected.append(item.data(Qt.UserRole))
        self.confirmed.emit(selected)
        self.close()

    def _on_cancel(self):
        self.cancelled.emit()
        self.close()

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() == Qt.Key_Escape:
            self._on_cancel()
            return
        if event.key() == Qt.Key_Down:
            row = self._list.currentRow()
            if row < self._list.count() - 1:
                self._list.setCurrentRow(row + 1)
            return
        if event.key() == Qt.Key_Up:
            row = self._list.currentRow()
            if row > 0:
                self._list.setCurrentRow(row - 1)
            return
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            item = self._list.currentItem()
            if item:
                if self._multi_select:
                    self._on_item_clicked(item)
                else:
                    self._on_item_activated(item)
            return
        super().keyPressEvent(event)

    def show_dialog(self):
        parent = self.parent()
        if parent:
            from PySide6.QtCore import QPoint
            global_pos = parent.mapToGlobal(QPoint(0, 0))
            x = global_pos.x() + (parent.width() - self.width()) // 2
            y = global_pos.y() + 80
            self.move(x, y)
        self._input.clear()
        self._input.setFocus()
        self.show()


class InputBox(QDialog):
    """Input box with validation, supporting text and password modes."""

    accepted_text = Signal(str)

    def __init__(self, title: str = "", prompt: str = "",
                 placeholder: str = "", default_text: str = "",
                 password_mode: bool = False,
                 validator=None,  # callable(text) -> (bool, error_msg)
                 parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground, False)
        self._validator = validator
        self._setup_ui(title, prompt, placeholder, default_text, password_mode)

    def _setup_ui(self, title, prompt, placeholder, default_text, password_mode):
        self.setFixedWidth(450)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        container = QFrame()
        container.setObjectName("InputBoxContainer")
        container.setStyleSheet("""
            #InputBoxContainer {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 6px;
            }
        """)
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(14, 12, 14, 12)
        container_layout.setSpacing(8)

        if title:
            title_label = QLabel(title)
            title_label.setStyleSheet("color: #cccccc; font-size: 14px; font-weight: bold; background: transparent;")
            container_layout.addWidget(title_label)

        if prompt:
            prompt_label = QLabel(prompt)
            prompt_label.setWordWrap(True)
            prompt_label.setStyleSheet("color: #858585; font-size: 12px; background: transparent;")
            container_layout.addWidget(prompt_label)

        self._input = QLineEdit()
        self._input.setPlaceholderText(placeholder)
        self._input.setText(default_text)
        if password_mode:
            self._input.setEchoMode(QLineEdit.Password)
        self._input.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: 1px solid #3c0068;
                border-radius: 4px;
                padding: 6px 10px;
                font-size: 13px;
            }
            QLineEdit:focus {
                border: 1px solid #7c3aed;
            }
        """)
        self._input.textChanged.connect(self._on_text_changed)
        container_layout.addWidget(self._input)

        self._error_label = QLabel()
        self._error_label.setStyleSheet("color: #ef4444; font-size: 11px; background: transparent;")
        self._error_label.hide()
        container_layout.addWidget(self._error_label)

        btn_layout = QHBoxLayout()
        btn_layout.setSpacing(8)

        self._ok_btn = QPushButton("OK")
        self._ok_btn.setStyleSheet("""
            QPushButton {
                background-color: #7c3aed; color: white; border: none;
                border-radius: 4px; padding: 6px 20px; font-size: 12px;
            }
            QPushButton:hover { background-color: #6d28d9; }
            QPushButton:disabled { background-color: #3c0068; color: #858585; }
        """)
        self._ok_btn.clicked.connect(self._on_ok)
        btn_layout.addStretch()
        btn_layout.addWidget(self._ok_btn)

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent; color: #858585; border: 1px solid #3c0068;
                border-radius: 4px; padding: 6px 20px; font-size: 12px;
            }
            QPushButton:hover { color: #cccccc; }
        """)
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        container_layout.addLayout(btn_layout)
        layout.addWidget(container)

        self._on_text_changed(default_text)

    def _on_text_changed(self, text):
        if self._validator:
            valid, error = self._validator(text)
            self._ok_btn.setEnabled(valid)
            if error:
                self._error_label.setText(error)
                self._error_label.show()
            else:
                self._error_label.hide()
        else:
            self._ok_btn.setEnabled(bool(text.strip()))

    def _on_ok(self):
        text = self._input.text()
        if self._validator:
            valid, error = self._validator(text)
            if not valid:
                self._error_label.setText(error or "Invalid input")
                self._error_label.show()
                return
        self.accepted_text.emit(text)
        self.accept()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.reject()
            return
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            self._on_ok()
            return
        super().keyPressEvent(event)

    def show_dialog(self):
        parent = self.parent()
        if parent:
            from PySide6.QtCore import QPoint
            global_pos = parent.mapToGlobal(QPoint(0, 0))
            x = global_pos.x() + (parent.width() - self.width()) // 2
            y = global_pos.y() + 120
            self.move(x, y)
        self._input.setFocus()
        self._input.selectAll()
        self.show()


class DropdownQuickPick(QDialog):
    """Dropdown-style Quick Pick that appears below a button/input."""

    selected = Signal(str)

    def __init__(self, items: list, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground, False)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        container = QFrame()
        container.setStyleSheet("""
            QFrame {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 4px;
            }
        """)
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)

        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget {
                background-color: #000000; border: none; color: #cccccc;
                font-size: 12px; outline: none;
            }
            QListWidget::item { padding: 6px 14px; min-height: 24px; }
            QListWidget::item:selected { background-color: #3c0068; }
            QListWidget::item:hover:!selected { background-color: #1a0033; }
        """)
        self._list.itemClicked.connect(self._on_selected)
        self._list.itemActivated.connect(self._on_selected)
        container_layout.addWidget(self._list)

        layout.addWidget(container)

        self.set_items(items)

    def set_items(self, items: list):
        self._list.clear()
        for item in items:
            if isinstance(item, str):
                li = QListWidgetItem(item)
                li.setData(Qt.UserRole, item)
            elif isinstance(item, dict):
                li = QListWidgetItem(item.get("label", ""))
                li.setData(Qt.UserRole, item.get("data", item.get("label", "")))
            self._list.addItem(li)
        if self._list.count() > 0:
            self._list.setCurrentRow(0)

    def _on_selected(self, item):
        self.selected.emit(item.data(Qt.UserRole))
        self.close()

    def show_below(self, widget):
        pos = widget.mapToGlobal(widget.rect().bottomLeft())
        self.move(pos)
        self.setFixedWidth(max(200, widget.width()))
        self.show()
