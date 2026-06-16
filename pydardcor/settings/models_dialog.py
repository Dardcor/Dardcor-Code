"""Models Dashboard Dialog - Native PySide6 implementation matching the provided image."""

import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QWidget, QLabel, QPushButton,
    QLineEdit, QScrollArea, QGridLayout, QFrame, QSizePolicy, QCheckBox,
    QComboBox, QSpacerItem, QLayout
)
from PySide6.QtCore import Qt, QSize, QRect, QPoint
from PySide6.QtGui import QColor, QFont, QPainter, QPen, QBrush, QIcon

class FlowLayout(QLayout):
    """A layout that wraps its items horizontally."""
    def __init__(self, parent=None, margin=0, hSpacing=8, vSpacing=8):
        super().__init__(parent)
        self._item_list = []
        self._hSpace = hSpacing
        self._vSpace = vSpacing
        self.setContentsMargins(margin, margin, margin, margin)

    def addItem(self, item):
        self._item_list.append(item)

    def horizontalSpacing(self):
        return self._hSpace

    def verticalSpacing(self):
        return self._vSpace

    def count(self):
        return len(self._item_list)

    def itemAt(self, index):
        if 0 <= index < len(self._item_list):
            return self._item_list[index]
        return None

    def takeAt(self, index):
        if 0 <= index < len(self._item_list):
            return self._item_list.pop(index)
        return None

    def expandingDirections(self):
        return Qt.Orientations(0)

    def hasHeightForWidth(self):
        return True

    def heightForWidth(self, width):
        height = self.doLayout(QRect(0, 0, width, 0), True)
        return height

    def setGeometry(self, rect):
        super().setGeometry(rect)
        self.doLayout(rect, False)

    def sizeHint(self):
        return self.minimumSize()

    def minimumSize(self):
        size = QSize()
        for item in self._item_list:
            size = size.expandedTo(item.minimumSize())
        m = self.contentsMargins()
        size += QSize(m.left() + m.right(), m.top() + m.bottom())
        return size

    def doLayout(self, rect, testOnly):
        m = self.contentsMargins()
        x = rect.x() + m.left()
        y = rect.y() + m.top()
        lineHeight = 0
        
        for item in self._item_list:
            spaceX = self.horizontalSpacing()
            spaceY = self.verticalSpacing()

            nextX = x + item.sizeHint().width() + spaceX
            if nextX - spaceX > rect.right() - m.right() and lineHeight > 0:
                x = rect.x() + m.left()
                y = y + lineHeight + spaceY
                nextX = x + item.sizeHint().width() + spaceX
                lineHeight = 0

            if not testOnly:
                item.setGeometry(QRect(QPoint(x, y), item.sizeHint()))

            x = nextX
            lineHeight = max(lineHeight, item.sizeHint().height())

        return y + lineHeight - rect.y() + m.bottom()


class ModelBadge(QFrame):
    """A custom widget representing a single model's quota."""
    
    def __init__(self, name: str, time_str: str, percent: int, color_hex: str, is_red: bool = False, parent=None):
        super().__init__(parent)
        self.name = name
        self.time_str = time_str
        self.percent = percent
        self.color_hex = color_hex
        self.is_red = is_red
        
        self.setFixedSize(240, 32)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 6)
        layout.setSpacing(6)
        
        icon_lbl = QLabel()
        icon_lbl.setFixedSize(12, 12)
        icon_lbl.setStyleSheet(f"background-color: {color_hex}; border-radius: 6px;")
        layout.addWidget(icon_lbl)
        
        name_lbl = QLabel(name)
        name_lbl.setStyleSheet("color: #cccccc; font-size: 11px;")
        layout.addWidget(name_lbl)
        
        layout.addStretch()
        
        time_lbl = QLabel(f"\u23f2 {time_str}")
        time_color = "#f03e3e" if is_red else "#40c057"
        time_lbl.setStyleSheet(f"color: {time_color}; font-size: 10px;")
        layout.addWidget(time_lbl)
        
        pct_lbl = QLabel(f"{percent}%")
        pct_lbl.setStyleSheet(f"color: {time_color}; font-size: 10px; font-weight: bold;")
        layout.addWidget(pct_lbl)
        
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        rect = self.rect()
        painter.setPen(Qt.NoPen)
        bg_color = QColor("#2b1114") if self.is_red else QColor("#1e1e1e")
        painter.setBrush(QBrush(bg_color)) 
        painter.drawRoundedRect(rect, 4, 4)
        
        line_color = QColor("#f03e3e") if self.is_red else QColor("#40c057")
        painter.setBrush(QBrush(line_color))
        
        bar_width = int((rect.width() - 16) * (self.percent / 100.0))
        bar_rect = QRect(8, rect.height() - 3, bar_width, 2)
        painter.drawRoundedRect(bar_rect, 1, 1)


class ActionButtons(QWidget):
    """Grid of 8 action icons."""
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QGridLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(12)
        
        icons = ["\u24d8", "\U0001f5a4", "\U0001f3f7", "\u21c4", "\u21bb", "\u21e3", "\u2699", "\U0001f5d1"]
        for i, ic in enumerate(icons):
            btn = QPushButton(ic)
            btn.setFixedSize(20, 20)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    color: #868e96;
                    border: none;
                    font-size: 14px;
                }
                QPushButton:hover { color: #ffffff; }
            """)
            layout.addWidget(btn, i // 4, i % 4)


class AccountRow(QFrame):
    """A row containing email, models, last used, and actions."""
    def __init__(self, email_data: dict, parent=None):
        super().__init__(parent)
        self.email_data = email_data
        
        email = email_data.get("email", "")
        tags = email_data.get("tags", [])
        models = email_data.get("models", [])
        
        self.setStyleSheet("""
            AccountRow {
                background-color: #000000;
                border-bottom: 1px solid #3c0068;
            }
            AccountRow:hover {
                background-color: #2a2d2e;
            }
        """)
        
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(16, 16, 16, 16)
        main_layout.setSpacing(20)
        
        # Email and Tags
        email_widget = QWidget()
        email_widget.setFixedWidth(250)
        em_layout = QHBoxLayout(email_widget)
        em_layout.setContentsMargins(0, 0, 0, 0)
        
        drag_handle = QLabel("\u2807")
        drag_handle.setStyleSheet("color: #495057; font-size: 16px; border: none;")
        em_layout.addWidget(drag_handle)
        
        cb = QCheckBox()
        cb.setStyleSheet("QCheckBox::indicator { width: 16px; height: 16px; border: 1px solid #495057; border-radius: 4px; }")
        em_layout.addWidget(cb)
        
        em_info_layout = QVBoxLayout()
        em_lbl = QLabel(email)
        em_lbl.setStyleSheet("color: #ffffff; font-size: 13px; border: none;")
        em_info_layout.addWidget(em_lbl)
        
        tags_layout = QHBoxLayout()
        for tag, color in tags:
            t = QLabel(tag)
            t.setStyleSheet(f"""
                background-color: {color};
                color: #ffffff;
                font-size: 9px;
                font-weight: bold;
                padding: 2px 6px;
                border-radius: 4px;
                border: none;
            """)
            tags_layout.addWidget(t)
        tags_layout.addStretch()
        em_info_layout.addLayout(tags_layout)
        
        em_layout.addLayout(em_info_layout)
        main_layout.addWidget(email_widget)
        
        # Models Grid using FlowLayout for responsiveness
        models_widget = QWidget()
        mod_layout = FlowLayout(models_widget, margin=0, hSpacing=8, vSpacing=8)
        
        for m in models:
            badge = ModelBadge(
                name=m["name"],
                time_str=m["time"],
                percent=m["pct"],
                color_hex=m["color"],
                is_red=m.get("is_red", False)
            )
            # Use addWidget on the QLayout (which wraps it into a QWidgetItem automatically)
            mod_layout.addWidget(badge)
            
        main_layout.addWidget(models_widget, stretch=1)
        
        # Last Used
        last_used = QLabel(email_data.get("last_used", "Unknown"))
        last_used.setStyleSheet("color: #868e96; font-size: 11px; border: none;")
        last_used.setAlignment(Qt.AlignCenter)
        last_used.setFixedWidth(80)
        main_layout.addWidget(last_used)
        
        # Actions
        actions = ActionButtons()
        actions.setFixedWidth(120)
        main_layout.addWidget(actions)


class ModelsQuotaDialog(QDialog):
    """The main Dashboard Dialog."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Model Quotas")
        self.setMinimumSize(900, 500)
        self.resize(1100, 600)
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
            }
            QLabel {
                font-family: "Segoe UI", sans-serif;
            }
        """)
        
        from ..core.config import get_config
        self._config = get_config()
        root_path = self._config.workspace_path or os.path.expanduser("~")
        
        from ..core.antigravity_db import AntigravityDB
        self.db = AntigravityDB(root_path)
        
        self.current_tab = "Antigravity"
        self._setup_ui()
        self._load_data()
        
    def _switch_tab(self, tab_name: str):
        self.current_tab = tab_name
        self._load_data()
        # Update tab styles
        for i in range(self.tabs_layout.count() - 1): # Exclude stretch
            item = self.tabs_layout.itemAt(i)
            if item and item.widget():
                btn = item.widget()
                if btn.text() == tab_name:
                    btn.setStyleSheet("""
                        QPushButton {
                            background-color: transparent;
                            color: #ffffff;
                            border: none;
                            border-bottom: 2px solid #1c7ed6;
                            font-size: 13px;
                            font-weight: bold;
                            padding: 0 16px;
                        }
                    """)
                else:
                    btn.setStyleSheet("""
                        QPushButton {
                            background-color: transparent;
                            color: #868e96;
                            border: none;
                            border-bottom: 2px solid transparent;
                            font-size: 13px;
                            padding: 0 16px;
                        }
                        QPushButton:hover {
                            color: #cccccc;
                            border-bottom: 2px solid #373a40;
                        }
                    """)
        
    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # --- TABS ---
        tabs_frame = QFrame()
        tabs_frame.setStyleSheet("background-color: #000000;")
        tabs_frame.setFixedHeight(40)
        self.tabs_layout = QHBoxLayout(tabs_frame)
        self.tabs_layout.setContentsMargins(20, 0, 20, 0)
        self.tabs_layout.setSpacing(0)
        
        tab_names = ["Antigravity", "Gemini", "OpenRouter", "DeepSeek", "NVIDIA"]
        for i, name in enumerate(tab_names):
            btn = QPushButton(name)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda checked, n=name: self._switch_tab(n))
            if i == 0:
                # Active tab
                btn.setStyleSheet("""
                    QPushButton {
                        background-color: transparent;
                        color: #ffffff;
                        border: none;
                        border-bottom: 2px solid #1c7ed6;
                        font-size: 13px;
                        font-weight: bold;
                        padding: 0 16px;
                    }
                """)
            else:
                # Inactive tab
                btn.setStyleSheet("""
                    QPushButton {
                        background-color: transparent;
                        color: #868e96;
                        border: none;
                        border-bottom: 2px solid transparent;
                        font-size: 13px;
                        padding: 0 16px;
                    }
                    QPushButton:hover {
                        color: #cccccc;
                        border-bottom: 2px solid #373a40;
                    }
                """)
            self.tabs_layout.addWidget(btn)
        self.tabs_layout.addStretch()
        main_layout.addWidget(tabs_frame)
        
        # --- HEADER ---
        header = QFrame()
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #3c0068;")
        header.setFixedHeight(60)
        h_layout = QHBoxLayout(header)
        h_layout.setContentsMargins(20, 0, 20, 0)
        h_layout.setSpacing(12)
        
        search = QLineEdit()
        search.setPlaceholderText("\U0001f50d Search email...")
        search.setFixedWidth(200)
        search.setStyleSheet("""
            QLineEdit {
                background-color: #1e1e1e;
                border: 1px solid #3c0068;
                border-radius: 6px;
                color: #cccccc;
                padding: 6px 10px;
                font-size: 13px;
            }
        """)
        h_layout.addWidget(search)
        
        btn_list = QPushButton("\u2630")
        btn_grid = QPushButton("\u25a6")
        for b in (btn_list, btn_grid):
            b.setFixedSize(32, 32)
            b.setStyleSheet("background-color: #1e1e1e; color: #868e96; border: none; border-radius: 4px; font-size: 16px;")
        h_layout.addWidget(btn_list)
        h_layout.addWidget(btn_grid)
        
        filters = [("All", "34", "#1971c2"), ("PRO", "1", "#1e1e1e"), ("ULTRA", "0", "#1e1e1e"), ("FREE", "33", "#1e1e1e")]
        for text, count, color in filters:
            btn = QPushButton(f"{text}  {count}")
            btn.setStyleSheet(f"""
                QPushButton {{
                    background-color: {color};
                    color: {'#ffffff' if color != '#1e1e1e' else '#868e96'};
                    border: none;
                    border-radius: 16px;
                    padding: 6px 16px;
                    font-size: 11px;
                    font-weight: bold;
                }}
            """)
            h_layout.addWidget(btn)
            
        h_layout.addStretch()
        
        add_btn = QPushButton("+")
        add_btn.setFixedSize(32, 32)
        add_btn.setStyleSheet("background-color: #1e1e1e; color: #cccccc; border: none; border-radius: 4px;")
        h_layout.addWidget(add_btn)
        
        ref_btn = QPushButton("\u21bb Refresh All")
        ref_btn.setStyleSheet("background-color: #1c7ed6; color: white; border: none; border-radius: 4px; padding: 6px 12px; font-weight: bold;")
        h_layout.addWidget(ref_btn)
        
        warm_btn = QPushButton("\u26a1 One-click Warmup")
        warm_btn.setStyleSheet("background-color: #f59f00; color: white; border: none; border-radius: 4px; padding: 6px 12px; font-weight: bold;")
        h_layout.addWidget(warm_btn)
        
        show_all = QLabel("Show All Quotas")
        show_all.setStyleSheet("color: #cccccc; font-size: 12px; border: none;")
        h_layout.addWidget(show_all)
        
        toggle = QCheckBox()
        toggle.setStyleSheet("QCheckBox::indicator { width: 30px; height: 16px; border-radius: 8px; background-color: #ffffff; }")
        h_layout.addWidget(toggle)
        
        h_layout.addWidget(QLabel("  \u2191 Import", styleSheet="color: #cccccc; font-size: 12px; border: none;"))
        h_layout.addWidget(QLabel("  \u2193 Export", styleSheet="color: #cccccc; font-size: 12px; border: none;"))
        
        main_layout.addWidget(header)
        
        # --- TABLE HEADER ---
        th = QFrame()
        th.setStyleSheet("background-color: #080808; border-bottom: 1px solid #3c0068;")
        th.setFixedHeight(40)
        th_layout = QHBoxLayout(th)
        th_layout.setContentsMargins(16, 0, 16, 0)
        th_layout.setSpacing(20)
        
        th_layout.addWidget(QLabel("   ", styleSheet="border: none;")) 
        th_layout.addWidget(QCheckBox())
        
        lbl_email = QLabel("EMAIL")
        lbl_email.setFixedWidth(250)
        lbl_email.setStyleSheet("color: #868e96; font-size: 11px; font-weight: bold; border: none;")
        th_layout.addWidget(lbl_email)
        
        lbl_quota = QLabel("MODEL QUOTA")
        lbl_quota.setStyleSheet("color: #868e96; font-size: 11px; font-weight: bold; border: none;")
        th_layout.addWidget(lbl_quota)
        
        lbl_last = QLabel("LAST USED")
        lbl_last.setFixedWidth(80)
        lbl_last.setAlignment(Qt.AlignCenter)
        lbl_last.setStyleSheet("color: #868e96; font-size: 11px; font-weight: bold; border: none;")
        th_layout.addWidget(lbl_last)
        
        lbl_act = QLabel("ACTIONS")
        lbl_act.setFixedWidth(120)
        lbl_act.setAlignment(Qt.AlignCenter)
        lbl_act.setStyleSheet("color: #868e96; font-size: 11px; font-weight: bold; border: none;")
        th_layout.addWidget(lbl_act)
        
        main_layout.addWidget(th)
        
        # --- SCROLL AREA ---
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setStyleSheet("""
            QScrollArea { border: none; background-color: #000000; }
            QScrollBar:vertical { width: 10px; background: transparent; }
            QScrollBar::handle:vertical { background: #373a40; border-radius: 5px; }
        """)
        
        self.content_w = QWidget()
        self.content_w.setStyleSheet("background-color: #000000;")
        self.c_layout = QVBoxLayout(self.content_w)
        self.c_layout.setContentsMargins(0, 0, 0, 0)
        self.c_layout.setSpacing(0)
        
        self.c_layout.addStretch()
        self.scroll.setWidget(self.content_w)
        main_layout.addWidget(self.scroll)
        
        # --- FOOTER ---
        footer = QFrame()
        footer.setStyleSheet("background-color: #080808; border-top: 1px solid #3c0068;")
        footer.setFixedHeight(50)
        f_layout = QHBoxLayout(footer)
        f_layout.setContentsMargins(20, 0, 20, 0)
        
        lbl_info = QLabel("Showing 1 to 34 of 34 entries   Per page")
        lbl_info.setStyleSheet("color: #cccccc; font-size: 12px; border: none;")
        f_layout.addWidget(lbl_info)
        
        combo = QComboBox()
        combo.addItems(["100 items", "50 items", "20 items"])
        combo.setStyleSheet("""
            QComboBox {
                background-color: #1e1e1e;
                color: #cccccc;
                border: 1px solid #3c0068;
                border-radius: 4px;
                padding: 4px 8px;
            }
        """)
        f_layout.addWidget(combo)
        f_layout.addStretch()
        
        pag_layout = QHBoxLayout()
        for t in ("<", "1", ">"):
            b = QPushButton(t)
            b.setFixedSize(28, 28)
            bg = "#1c7ed6" if t == "1" else "#1e1e1e"
            col = "#ffffff" if t == "1" else "#868e96"
            b.setStyleSheet(f"background-color: {bg}; color: {col}; border: none; border-radius: 4px;")
            pag_layout.addWidget(b)
            
        f_layout.addLayout(pag_layout)
        main_layout.addWidget(footer)

    def _load_data(self):
        """Loads data into the scroll area based on the current tab."""
        # Clear existing items
        while self.c_layout.count():
            item = self.c_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
                
        if self.current_tab == "Antigravity":
            accounts = self.db.get_all_accounts()
            if not accounts:
                lbl = QLabel("No accounts found. Please add an account.")
                lbl.setStyleSheet("color: #868e96; font-size: 14px; padding: 40px;")
                lbl.setAlignment(Qt.AlignCenter)
                self.c_layout.addWidget(lbl)
            else:
                for acc in accounts:
                    row = AccountRow(acc)
                    self.c_layout.addWidget(row)
        else:
            # Placeholder for other tabs
            lbl = QLabel(f"Data for {self.current_tab} is not available yet.")
            lbl.setStyleSheet("color: #868e96; font-size: 14px; padding: 40px;")
            lbl.setAlignment(Qt.AlignCenter)
            self.c_layout.addWidget(lbl)
            
        self.c_layout.addStretch()
