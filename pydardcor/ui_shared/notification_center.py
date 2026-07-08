"""Notification Center - Expandable notification center dialog (matches VS Code notification pane)."""

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QScrollArea, QWidget, QCheckBox, QFrame
)
from PySide6.QtCore import Qt, QSize
from PySide6.QtGui import QColor, QFont
from .notification_service import _SEVERITY_STYLES, NotificationService

class NotificationCenter(QDialog):
    """An overlay/dialog popup that displays the list of past and active notifications."""

    def __init__(self, service: NotificationService, parent=None):
        super().__init__(parent)
        self._service = service
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setFixedWidth(400)
        self.setMinimumHeight(200)
        self.setMaximumHeight(450)
        
        self.setStyleSheet("""
            NotificationCenter {
                background-color: #0d0d0d;
                border: 1px solid #3c0068;
                border-radius: 6px;
            }
        """)
        
        self._setup_ui()
        self._service.history_changed.connect(self.refresh)
        self.refresh()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        # Header
        header = QHBoxLayout()
        title = QLabel("NOTIFICATIONS")
        title.setStyleSheet("color: #bbbbbb; font-size: 11px; font-weight: bold; letter-spacing: 1px;")
        header.addWidget(title)
        header.addStretch()

        # DND Toggle
        self._dnd_cb = QCheckBox("DND")
        self._dnd_cb.setChecked(self._service._dnd)
        self._dnd_cb.setStyleSheet("""
            QCheckBox {
                color: #888888;
                font-size: 11px;
            }
            QCheckBox::indicator {
                width: 12px;
                height: 12px;
                border: 1px solid #3c0068;
                border-radius: 2px;
                background: #000000;
            }
            QCheckBox::indicator:checked {
                background-color: #6d00b8;
            }
        """)
        self._dnd_cb.stateChanged.connect(self._on_dnd_changed)
        header.addWidget(self._dnd_cb)

        # Clear All
        clear_btn = QPushButton("Clear All")
        clear_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #888888;
                font-size: 11px;
            }
            QPushButton:hover {
                color: #ffffff;
                text-decoration: underline;
            }
        """)
        clear_btn.clicked.connect(self._service.dismiss_all)
        header.addWidget(clear_btn)
        
        layout.addLayout(header)

        # Separator line
        sep = QFrame()
        sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet("background-color: #2b2b2b; max-height: 1px;")
        layout.addWidget(sep)

        # Scroll Area
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        
        self._scroll_widget = QWidget()
        self._scroll_widget.setStyleSheet("background: transparent;")
        self._list_layout = QVBoxLayout(self._scroll_widget)
        self._list_layout.setContentsMargins(0, 0, 0, 0)
        self._list_layout.setSpacing(6)
        
        self._scroll.setWidget(self._scroll_widget)
        layout.addWidget(self._scroll, 1)

    def _on_dnd_changed(self, state):
        self._service.set_dnd(state == Qt.Checked)

    def refresh(self):
        # Clear list layout
        while self._list_layout.count():
            child = self._list_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        items = self._service._history
        if not items:
            placeholder = QLabel("No new notifications")
            placeholder.setAlignment(Qt.AlignCenter)
            placeholder.setStyleSheet("color: #888888; font-size: 12px; padding: 40px;")
            self._list_layout.addWidget(placeholder)
            return

        for entry in reversed(items):
            card = QFrame()
            card_style = _SEVERITY_STYLES.get(entry["severity"], _SEVERITY_STYLES["info"])
            accent = card_style["accent"]
            
            card.setStyleSheet(f"""
                QFrame {{
                    background-color: #161616;
                    border: 1px solid #2b2b2b;
                    border-left: 3px solid {accent};
                    border-radius: 4px;
                }}
            """)
            card_lay = QVBoxLayout(card)
            card_lay.setContentsMargins(10, 8, 8, 8)
            card_lay.setSpacing(4)

            top = QHBoxLayout()
            icon = QLabel(card_style["icon"])
            icon.setStyleSheet(f"color: {accent}; font-weight: bold; font-size: 12px;")
            top.addWidget(icon)

            msg = QLabel(entry["message"])
            msg.setWordWrap(True)
            msg.setStyleSheet("color: #cccccc; font-size: 11px;")
            top.addWidget(msg, 1)

            # Close/Dismiss individual notification button
            del_btn = QPushButton("✕")
            del_btn.setFixedSize(16, 16)
            del_btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: none;
                    color: #666666;
                    font-size: 9px;
                }
                QPushButton:hover {
                    color: #ff5555;
                }
            """)
            # Store id to dismiss
            del_btn.clicked.connect(lambda checked=False, nid=entry["id"]: self._dismiss_notification(nid))
            top.addWidget(del_btn)
            card_lay.addLayout(top)

            # Meta and source info
            meta = QHBoxLayout()
            meta.setContentsMargins(16, 0, 0, 0)
            src_lbl = QLabel(f"{entry['source']} • {entry['timestamp']}")
            src_lbl.setStyleSheet("color: #666666; font-size: 9px;")
            meta.addWidget(src_lbl)
            meta.addStretch()
            card_lay.addLayout(meta)

            # Action buttons
            if entry.get("actions"):
                btn_row = QHBoxLayout()
                btn_row.setContentsMargins(16, 2, 0, 0)
                btn_row.addStretch()
                for label, callback in entry["actions"]:
                    act_btn = QPushButton(label)
                    act_btn.setStyleSheet(f"""
                        QPushButton {{
                            background: transparent;
                            color: {accent};
                            border: none;
                            font-size: 10px;
                            padding: 2px 6px;
                        }}
                        QPushButton:hover {{ color: #ffffff; text-decoration: underline; }}
                    """)
                    act_btn.clicked.connect(callback)
                    act_btn.clicked.connect(lambda checked=False, nid=entry["id"]: self._dismiss_notification(nid))
                    btn_row.addWidget(act_btn)
                card_lay.addLayout(btn_row)

            self._list_layout.addWidget(card)

        # Add a stretch item at the end
        self._list_layout.addStretch()

    def _dismiss_notification(self, nid):
        self._service._history = [x for x in self._service._history if x["id"] != nid]
        self._service.history_changed.emit()

    def show_above_widget(self, widget: QWidget):
        """Position the dialog nicely above or aligned with the notification bell button."""
        p = widget.mapToGlobal(QSize(0, 0).toPoint())
        # Display above status bar
        x = p.x() - self.width() + widget.width()
        y = p.y() - self.height() - 4
        self.move(x, y)
        self.exec()
