"""Models Dashboard Dialog - Native PySide6 implementation matching the provided image."""

import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QWidget, QLabel, QPushButton,
    QLineEdit, QScrollArea, QGridLayout, QFrame, QSizePolicy, QCheckBox,
    QComboBox, QSpacerItem, QLayout, QFileDialog, QMessageBox
)
from PySide6.QtCore import Qt, QSize, QRect, QPoint, QRectF
from PySide6.QtGui import QColor, QFont, QPainter, QPen, QBrush, QIcon, QPainterPath
from pydardcor.settings.add_account_dialog import AddAccountDialog

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
    """A custom widget representing a single model's quota, identical to QuotaItem.tsx."""
    
    def __init__(self, name: str, time_str: str, percent: int, color_hex: str, is_red: bool = False, icon_char: str = "🤖", parent=None):
        super().__init__(parent)
        self.name = name
        self.time_str = time_str
        self.percent = percent
        self.color_hex = color_hex
        self.is_red = is_red
        
        self.setFixedHeight(22)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(6, 0, 6, 0)
        layout.setSpacing(6)
        
        name_lbl = QLabel(f"{icon_char} {name}")
        name_lbl.setStyleSheet("color: #9ca3af; font-size: 10px; font-weight: bold; background: transparent; border: none; font-family: 'Segoe UI';")
        layout.addWidget(name_lbl, stretch=1)
        
        time_color = "#34d399" if time_str not in ("Unknown", "N/A") else "#4b5563"
        time_lbl = QLabel(f"🕒 {time_str}")
        time_lbl.setStyleSheet(f"color: {time_color}; font-size: 10px; background: transparent; border: none; font-family: 'Segoe UI';")
        time_lbl.setFixedWidth(58)
        layout.addWidget(time_lbl)
        
        pct_color = color_hex if not is_red else "#f43f5e"
        pct_lbl = QLabel(f"{percent}%")
        pct_lbl.setStyleSheet(f"color: {pct_color}; font-size: 10px; font-weight: bold; background: transparent; border: none; font-family: 'Segoe UI';")
        pct_lbl.setFixedWidth(28)
        pct_lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        layout.addWidget(pct_lbl)
        
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        rect = self.rect()
        
        # Draw base border and faint background (like bg-white/5 border-white/5)
        painter.setPen(QPen(QColor("#1e1e20"), 1))
        bg_color = QColor("#ffffff")
        bg_color.setAlphaF(0.03)
        painter.setBrush(QBrush(bg_color)) 
        painter.drawRoundedRect(rect, 4, 4)
        
        # Draw the progress bar fill (like opacity-15)
        fill_color = QColor(self.color_hex)
        fill_color.setAlphaF(0.15)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QBrush(fill_color))
        
        bar_width = int(rect.width() * (self.percent / 100.0))
        path = QPainterPath()
        path.addRoundedRect(QRectF(rect), 4, 4)
        painter.setClipPath(path)
        painter.drawRect(QRectF(0, 0, bar_width, rect.height()))
        
        painter.end()


class ActionButtons(QWidget):
    """Grid of action icons matching antigravity_manager."""
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QGridLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)
        
        # Tooltips and icons
        actions = [
            ("Details", "ⓘ", "#868e96", "#3b82f6"),
            ("Device Fingerprint", "⌖", "#868e96", "#6366f1"),
            ("Edit Label", "🏷", "#868e96", "#f97316"),
            ("Switch to Classic", "⇄", "#868e96", "#3b82f6"),
            ("Switch to IDE", "🔁", "#868e96", "#0ea5e9"),
            ("Warmup", "✨", "#868e96", "#f59f00"),
            ("Refresh", "↻", "#868e96", "#22c55e"),
            ("Export", "📥", "#868e96", "#6366f1"),
            ("Toggle Proxy", "🌐", "#868e96", "#14b8a6"),
            ("Delete", "🗑", "#868e96", "#ef4444")
        ]
        
        for i, (tooltip, ic, col, hover_col) in enumerate(actions):
            btn = QPushButton(ic)
            btn.setFixedSize(24, 24)
            btn.setToolTip(tooltip)
            btn.setCursor(Qt.PointingHandCursor)
            btn.setStyleSheet(f"""
                QPushButton {{
                    background: transparent;
                    color: {col};
                    border: none;
                    border-radius: 4px;
                    font-size: 14px;
                }}
                QPushButton:hover {{ 
                    color: {hover_col};
                    background-color: #1a1d21;
                }}
            """)
            row = i // 5
            col_idx = i % 5
            layout.addWidget(btn, row, col_idx)


class AccountRow(QFrame):
    """A row containing email, models, last used, and actions."""
    def __init__(self, email_data: dict, show_all_quotas: bool = False, parent=None):
        super().__init__(parent)
        self.email_data = email_data
        
        email = email_data.get("email", "")
        tags = email_data.get("tags", [])
        models = email_data.get("models", [])
        
        if not show_all_quotas:
            pinned_names = [
                # Mock names
                "gemini 3.1 pro (high)", 
                "gemini 3.1 pro (low)", 
                "gemini 3 flash", 
                "gemini 2.5 pro", 
                "claude sonnet 4.6 (thinking)",
                # Real API / Tauri names
                "gemini-3.1-pro-high",
                "gemini-3-pro-high",
                "gemini-3.1-pro-low",
                "gemini-3-pro-low",
                "gemini-3-flash",
                "gemini-2.5-pro",
                "claude-sonnet-4-6-thinking",
                "claude-sonnet-4-6",
                "claude-opus-4-6-thinking"
            ]
            filtered_models = []
            for m in models:
                if m.get("name", "").lower() in pinned_names:
                    filtered_models.append(m)
            # Safe fallback: if no pinned models are matched (or to avoid empty display), show the first 5 models
            if not filtered_models and models:
                filtered_models = models[:5]
            models = filtered_models
        
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
        main_layout.setContentsMargins(16, 12, 16, 12)
        main_layout.setSpacing(12)
        
        # 1. Drag Handle
        drag_handle = QLabel("⋮")
        drag_handle.setFixedWidth(20)
        drag_handle.setStyleSheet("color: #495057; font-size: 16px; font-weight: bold; border: none;")
        main_layout.addWidget(drag_handle)
        
        # 2. Checkbox
        cb = QCheckBox()
        cb.setFixedWidth(24)
        cb.setStyleSheet("QCheckBox::indicator { width: 16px; height: 16px; border: 1px solid #495057; border-radius: 4px; }")
        main_layout.addWidget(cb)
        
        # 3. Email and Tags
        email_widget = QWidget()
        email_widget.setFixedWidth(280)
        em_info_layout = QVBoxLayout(email_widget)
        em_info_layout.setContentsMargins(0, 0, 0, 0)
        em_info_layout.setSpacing(4)
        
        em_lbl = QLabel(email)
        em_lbl.setStyleSheet("color: #ffffff; font-size: 13px; font-weight: 500; border: none;")
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
        
        main_layout.addWidget(email_widget)
        
        # 4. Models Grid (Quota)
        models_widget = QWidget()
        if models:
            mod_layout = QGridLayout(models_widget)
            mod_layout.setContentsMargins(0, 0, 0, 0)
            mod_layout.setSpacing(6)
            for i, m in enumerate(models):
                badge = ModelBadge(
                    name=m["name"],
                    time_str=m["time"],
                    percent=m["pct"],
                    color_hex=m["color"],
                    is_red=m.get("is_red", False),
                    icon_char=m.get("icon", "🤖")
                )
                row = i // 2
                col = i % 2
                mod_layout.addWidget(badge, row, col)
        else:
            # Show disabled/forbidden state if empty
            mod_layout = QHBoxLayout(models_widget)
            mod_layout.setContentsMargins(0, 0, 0, 0)
            empty_lbl = QLabel("No quota data available")
            empty_lbl.setStyleSheet("color: #495057; font-size: 12px; font-style: italic;")
            mod_layout.addWidget(empty_lbl)
            mod_layout.addStretch()
            
        main_layout.addWidget(models_widget, stretch=1)
        
        # 5. Last Used
        last_used_container = QWidget()
        last_used_container.setFixedWidth(90)
        lu_layout = QVBoxLayout(last_used_container)
        lu_layout.setContentsMargins(0, 0, 0, 0)
        lu_layout.setSpacing(2)
        
        parts = email_data.get("last_used", "Unknown").split("\\n")
        date_part = parts[0]
        time_part = parts[1] if len(parts) > 1 else ""
        
        lbl_date = QLabel(date_part)
        lbl_date.setStyleSheet("color: #868e96; font-size: 11px; border: none;")
        lu_layout.addWidget(lbl_date)
        if time_part:
            lbl_time = QLabel(time_part)
            lbl_time.setStyleSheet("color: #495057; font-size: 10px; border: none;")
            lu_layout.addWidget(lbl_time)
        lu_layout.addStretch()
        
        main_layout.addWidget(last_used_container)
        
        # 6. Actions
        actions = ActionButtons()
        actions.setFixedWidth(180)
        main_layout.addWidget(actions)


class FilterButton(QFrame):
    """Interactive filter button containing label and count badge."""
    def __init__(self, text: str, count: str, is_active: bool, callback, parent=None):
        super().__init__(parent)
        self.text = text
        self.count = count
        self.is_active = is_active
        self.callback = callback
        
        self.setCursor(Qt.PointingHandCursor)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 2, 8, 2)
        layout.setSpacing(6)
        
        self.lbl_txt = QLabel(text)
        self.lbl_cnt = QLabel(count)
        self.lbl_cnt.setFixedSize(20, 20)
        self.lbl_cnt.setAlignment(Qt.AlignCenter)
        
        layout.addWidget(self.lbl_txt)
        layout.addWidget(self.lbl_cnt)
        
        self.update_style()

    def update_style(self):
        text_color = '#4da3ff' if self.is_active else '#868e96'
        cnt_bg = '#1c7ed6' if self.is_active else '#2c2e33'
        cnt_color = '#ffffff' if self.is_active else '#868e96'
        
        bg_color = "#1a1d21" if self.is_active else "transparent"
        self.setStyleSheet(f"""
            FilterButton {{
                background-color: {bg_color};
                border-radius: 4px;
                border: none;
            }}
            FilterButton:hover {{
                background-color: #2c2e33;
            }}
        """)
        
        self.lbl_txt.setStyleSheet(f"color: {text_color}; font-size: 11px; font-weight: bold; border: none; background: transparent; font-family: 'Segoe UI';")
        self.lbl_cnt.setStyleSheet(f"background-color: {cnt_bg}; color: {cnt_color}; border-radius: 6px; font-size: 10px; font-weight: bold; font-family: 'Segoe UI';")

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.callback(self.text)
            event.accept()


class ModelsQuotaDialog(QDialog):
    """The main Dashboard Dialog."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Model Quotas")
        self.setMinimumSize(900, 500)
        self.resize(1100, 600)
        self.setWindowFlags(Qt.Window | Qt.FramelessWindowHint)
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
                border: 1px solid #3c0068;
            }
            QLabel {
                font-family: "Segoe UI", sans-serif;
            }
        """)
        
        # State for window moving
        self._is_dragging = False
        self._drag_pos = None
        
        from ..core.config import get_config
        self._config = get_config()
        root_path = self._config.workspace_path or os.path.expanduser("~")
        
        from ..core.antigravity_db import AntigravityDB
        self.db = AntigravityDB(root_path)
        
        self.current_tab = "Antigravity"
        self.current_filter = "All"
        self.show_all_quotas = False
        
        self._setup_ui()
        self._load_data()
        
    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton and event.pos().y() < 40:
            self._is_dragging = True
            self._drag_pos = event.globalPosition().toPoint()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._is_dragging:
            delta = event.globalPosition().toPoint() - self._drag_pos
            self.move(self.pos() + delta)
            self._drag_pos = event.globalPosition().toPoint()
            event.accept()

    def mouseReleaseEvent(self, event):
        self._is_dragging = False
        event.accept()
        
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
        
        # --- CUSTOM TITLE BAR ---
        title_bar = QFrame()
        title_bar.setStyleSheet("background-color: #080808;")
        title_bar.setFixedHeight(36)
        title_layout = QHBoxLayout(title_bar)
        title_layout.setContentsMargins(16, 0, 0, 0)
        title_layout.setSpacing(0)
        
        app_icon = QLabel("✨")
        app_icon.setStyleSheet("color: #1c7ed6; font-size: 14px;")
        title_layout.addWidget(app_icon)
        
        title_lbl = QLabel("  Model Quotas - Dardcor Code")
        title_lbl.setStyleSheet("color: #cccccc; font-size: 12px; font-weight: 500;")
        title_layout.addWidget(title_lbl)
        
        title_layout.addStretch()
        
        # Window controls
        btn_style = """
            QPushButton {
                background: transparent;
                color: #868e96;
                border: none;
                font-size: 14px;
            }
            QPushButton:hover { background-color: #2a2d2e; color: #ffffff; }
        """
        close_style = """
            QPushButton {
                background: transparent;
                color: #868e96;
                border: none;
                font-size: 14px;
            }
            QPushButton:hover { background-color: #e81123; color: #ffffff; }
        """
        
        min_btn = QPushButton("─")
        min_btn.setFixedSize(46, 36)
        min_btn.setStyleSheet(btn_style)
        min_btn.clicked.connect(self.showMinimized)
        title_layout.addWidget(min_btn)
        
        max_btn = QPushButton("☐")
        max_btn.setFixedSize(46, 36)
        max_btn.setStyleSheet(btn_style)
        def toggle_maximize():
            if self.isMaximized():
                self.showNormal()
            else:
                self.showMaximized()
        max_btn.clicked.connect(toggle_maximize)
        title_layout.addWidget(max_btn)
        
        close_btn = QPushButton("✕")
        close_btn.setFixedSize(46, 36)
        close_btn.setStyleSheet(close_style)
        close_btn.clicked.connect(self.close)
        title_layout.addWidget(close_btn)
        
        main_layout.addWidget(title_bar)
        
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
        self.pyside_header = QFrame()
        header = self.pyside_header
        header.setStyleSheet("background-color: #111315; border-bottom: 1px solid #1e1e20;")
        header.setFixedHeight(64)
        h_layout = QHBoxLayout(header)
        h_layout.setContentsMargins(20, 0, 20, 0)
        h_layout.setSpacing(12)
        
        # Search Container
        search_container = QFrame()
        search_container.setFixedSize(160, 32)
        search_container.setStyleSheet("""
            QFrame { background-color: #1a1d21; border-radius: 6px; }
        """)
        search_layout = QHBoxLayout(search_container)
        search_layout.setContentsMargins(8, 0, 8, 0)
        search_layout.setSpacing(8)
        
        search_icon = QLabel("🔍")
        search_icon.setStyleSheet("color: #868e96; font-size: 12px; border: none; background: transparent;")
        search_layout.addWidget(search_icon)
        
        search = QLineEdit()
        search.setPlaceholderText("Search email...")
        search.setStyleSheet("""
            QLineEdit { background: transparent; border: none; color: #cccccc; font-size: 13px; font-family: 'Segoe UI'; }
        """)
        self.search_input = search
        self.search_input.textChanged.connect(self._on_search)
        search_layout.addWidget(search)
        h_layout.addWidget(search_container)
        
        # View toggles (List / Grid)
        view_container = QFrame()
        view_container.setFixedHeight(32)
        view_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 6px; }")
        view_layout = QHBoxLayout(view_container)
        view_layout.setContentsMargins(2, 2, 2, 2)
        view_layout.setSpacing(2)
        
        btn_list = QPushButton("☷")
        btn_list.setFixedSize(28, 28)
        btn_list.setStyleSheet("background-color: transparent; color: #4da3ff; border: none; border-radius: 4px; font-size: 16px; font-family: 'Segoe UI Symbol';")
        
        btn_grid = QPushButton("⊞")
        btn_grid.setFixedSize(28, 28)
        btn_grid.setStyleSheet("background-color: transparent; color: #868e96; border: none; border-radius: 4px; font-size: 16px; font-family: 'Segoe UI Symbol';")
        
        view_layout.addWidget(btn_list)
        view_layout.addWidget(btn_grid)
        h_layout.addWidget(view_container)
        
        # Filters Container
        filters_container = QFrame()
        filters_container.setFixedHeight(32)
        filters_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 6px; }")
        filters_layout = QHBoxLayout(filters_container)
        filters_layout.setContentsMargins(4, 4, 4, 4)
        filters_layout.setSpacing(12)
        
        filters = [("All", "0", True), ("PRO", "0", False), ("ULTRA", "0", False), ("FREE", "0", False)]
        self.filter_buttons = []
        for text, count, is_active in filters:
            f_btn = FilterButton(text, count, is_active, self._on_filter)
            self.filter_buttons.append(f_btn)
            filters_layout.addWidget(f_btn)
            
        h_layout.addWidget(filters_container)
        
        h_layout.addStretch()
        
        # Plus Button
        add_btn = QPushButton("+")
        add_btn.setFixedSize(32, 32)
        add_btn.setStyleSheet("""
            QPushButton { background-color: #1a1d21; color: #cccccc; border: none; border-radius: 6px; font-size: 20px; font-family: 'Segoe UI'; }
            QPushButton:hover { background-color: #2c2e33; color: #ffffff; }
        """)
        add_btn.setCursor(Qt.PointingHandCursor)
        add_btn.clicked.connect(self._on_add_account)
        h_layout.addWidget(add_btn)
        
        # Refresh All
        ref_btn = QPushButton("↺ Refresh All")
        ref_btn.setFixedHeight(32)
        ref_btn.setStyleSheet("background-color: #3b82f6; color: white; border: none; border-radius: 6px; padding: 0 16px; font-size: 13px; font-weight: bold; font-family: 'Segoe UI';")
        ref_btn.setCursor(Qt.PointingHandCursor)
        ref_btn.clicked.connect(self._on_refresh)
        h_layout.addWidget(ref_btn)
        
        # Warmup
        warm_btn = QPushButton("✨ One-click Warmup")
        warm_btn.setFixedHeight(32)
        warm_btn.setStyleSheet("background-color: #f97316; color: white; border: none; border-radius: 6px; padding: 0 16px; font-size: 13px; font-weight: bold; font-family: 'Segoe UI';")
        warm_btn.setCursor(Qt.PointingHandCursor)
        warm_btn.clicked.connect(self._on_warmup)
        h_layout.addWidget(warm_btn)
        
        # Show All Quotas
        show_all = QLabel("Show All Quotas")
        show_all.setStyleSheet("color: #cccccc; font-size: 12px; border: none; background: transparent; font-family: 'Segoe UI';")
        h_layout.addWidget(show_all)
        
        toggle = QCheckBox()
        toggle.setFixedSize(36, 20)
        toggle.setStyleSheet("""
            QCheckBox { spacing: 0; }
            QCheckBox::indicator { 
                width: 36px; 
                height: 20px; 
                border-radius: 10px; 
                background-color: #2c2e33; 
            }
            QCheckBox::indicator:unchecked {
                image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7" fill="white"/></svg>');
            }
            QCheckBox::indicator:checked { 
                background-color: #3b82f6; 
                image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><circle cx="26" cy="10" r="7" fill="white"/></svg>');
            }
        """)
        self.show_all_toggle = toggle
        self.show_all_toggle.stateChanged.connect(self._on_toggle_show_all)
        h_layout.addWidget(toggle)
        
        # Import & Export
        sep = QFrame()
        sep.setFixedSize(1, 16)
        sep.setStyleSheet("background-color: #2c2e33;")
        h_layout.addWidget(sep)
        
        import_btn = QPushButton("↑ Import")
        import_btn.setStyleSheet("background: transparent; color: #cccccc; font-size: 13px; border: none; font-family: 'Segoe UI';")
        import_btn.setCursor(Qt.PointingHandCursor)
        import_btn.clicked.connect(self._on_import)
        h_layout.addWidget(import_btn)
        
        export_btn = QPushButton("↓ Export")
        export_btn.setStyleSheet("background: transparent; color: #cccccc; font-size: 13px; border: none; font-family: 'Segoe UI';")
        export_btn.setCursor(Qt.PointingHandCursor)
        export_btn.clicked.connect(self._on_export)
        h_layout.addWidget(export_btn)
        
        main_layout.addWidget(header)
        
        # --- TABLE HEADER ---
        self.pyside_th = QFrame()
        th = self.pyside_th
        th.setStyleSheet("background-color: #080808; border-bottom: 1px solid #3c0068;")
        th.setFixedHeight(40)
        th_layout = QHBoxLayout(th)
        th_layout.setContentsMargins(16, 0, 16, 0)
        th_layout.setSpacing(12)
        
        lbl_drag = QLabel(" ")
        lbl_drag.setFixedWidth(20)
        lbl_drag.setStyleSheet("border: none;")
        th_layout.addWidget(lbl_drag)
        
        cb_all = QCheckBox()
        cb_all.setFixedWidth(24)
        th_layout.addWidget(cb_all)
        
        lbl_email = QLabel("EMAIL")
        lbl_email.setFixedWidth(280)
        lbl_email.setStyleSheet("color: #868e96; font-size: 11px; font-weight: bold; border: none;")
        th_layout.addWidget(lbl_email)
        
        lbl_quota = QLabel("MODEL QUOTA")
        lbl_quota.setStyleSheet("color: #868e96; font-size: 11px; font-weight: bold; border: none;")
        th_layout.addWidget(lbl_quota, stretch=1)
        
        lbl_last = QLabel("LAST USED")
        lbl_last.setFixedWidth(90)
        lbl_last.setStyleSheet("color: #868e96; font-size: 11px; font-weight: bold; border: none;")
        th_layout.addWidget(lbl_last)
        
        lbl_act = QLabel("ACTIONS")
        lbl_act.setFixedWidth(180)
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
        self.pyside_footer = QFrame()
        footer = self.pyside_footer
        footer.setStyleSheet("background-color: #080808; border-top: 1px solid #3c0068;")
        footer.setFixedHeight(50)
        f_layout = QHBoxLayout(footer)
        f_layout.setContentsMargins(20, 0, 20, 0)
        
        lbl_info = QLabel("Showing 0 to 0 of 0 entries   Per page")
        self.lbl_info = lbl_info
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
                
        # Ensure native header/footer are visible
        self.pyside_header.setVisible(True)
        self.pyside_th.setVisible(True)
        self.scroll.setVisible(True)
        self.pyside_footer.setVisible(True)
                
        # Fallback for other tabs (Gemini, OpenRouter, etc.)
        if self.current_tab == "Antigravity":
            all_accounts = self.db.get_all_accounts()
            pro_count = sum(1 for acc in all_accounts if any('PRO' in t[0] for t in acc.get('tags', [])))
            ultra_count = sum(1 for acc in all_accounts if any('ULTRA' in t[0] for t in acc.get('tags', [])))
            free_count = sum(1 for acc in all_accounts if any('FREE' in t[0] for t in acc.get('tags', [])))
            
            if hasattr(self, 'filter_buttons'):
                for btn in self.filter_buttons:
                    text_prefix = btn.text.split(' ')[0]
                    if text_prefix == "All":
                        btn.lbl_cnt.setText(str(len(all_accounts)))
                    elif text_prefix == "PRO":
                        btn.lbl_cnt.setText(str(pro_count))
                    elif text_prefix == "ULTRA":
                        btn.lbl_cnt.setText(str(ultra_count))
                    elif text_prefix == "FREE":
                        btn.lbl_cnt.setText(str(free_count))
            
            # Apply search filter
            search_text = getattr(self, 'search_input', None)
            if search_text and search_text.text().strip():
                query = search_text.text().strip().lower()
                all_accounts = [acc for acc in all_accounts if query in acc.get("email", "").lower()]
                
            # Apply tag filter
            if getattr(self, 'current_filter', "All") != "All":
                all_accounts = [acc for acc in all_accounts if any(self.current_filter.lower() in t[0].lower() for t in acc.get("tags", []))]
                
            if not all_accounts:
                lbl = QLabel("No accounts found. Please click Import to add accounts.")
                lbl.setStyleSheet("color: #868e96; font-size: 14px; padding: 40px;")
                lbl.setAlignment(Qt.AlignCenter)
                self.c_layout.addWidget(lbl)
            else:
                for acc in all_accounts:
                    row = AccountRow(acc, show_all_quotas=self.show_all_quotas)
                    self.c_layout.addWidget(row)
                    
            if hasattr(self, 'lbl_info'):
                total_count = len(self.db.get_all_accounts())
                filtered_count = len(all_accounts)
                start_idx = 1 if filtered_count > 0 else 0
                self.lbl_info.setText(f"Showing {start_idx} to {filtered_count} of {total_count} entries   Per page")
        else:
            # Placeholder for other tabs
            lbl = QLabel(f"Data for {self.current_tab} is not available yet.")
            lbl.setStyleSheet("color: #868e96; font-size: 14px; padding: 40px;")
            lbl.setAlignment(Qt.AlignCenter)
            self.c_layout.addWidget(lbl)
        self.c_layout.addStretch()

    def _on_add_account(self):
        dialog = AddAccountDialog(self.db, self)
        if dialog.exec():
            self._load_data()

    def _on_search(self, text: str):
        self._load_data()

    def _on_filter(self, filter_text: str):
        self.current_filter = filter_text
        self._load_data()
        
    def _on_import(self):
        filename, _ = QFileDialog.getOpenFileName(self, "Import Accounts", "", "JSON Files (*.json)")
        if filename:
            added = self.db.import_data(filename)
            QMessageBox.information(self, "Import Successful", f"Successfully imported {added} accounts.")
            self._load_data()

    def _on_export(self):
        filename, _ = QFileDialog.getSaveFileName(self, "Export Accounts", "accounts_export.json", "JSON Files (*.json)")
        if filename:
            success = self.db.export_data(filename)
            if success:
                QMessageBox.information(self, "Export Successful", f"Successfully exported accounts to {filename}")
            else:
                QMessageBox.critical(self, "Export Failed", "Failed to export accounts.")

    def _on_refresh(self):
        QMessageBox.information(self, "Refresh", "Quota refresh initiated.")
        
    def _on_warmup(self):
        QMessageBox.information(self, "Warmup", "Warmup schedule initiated.")
    
    def _on_toggle_show_all(self, state):
        """Toggle between showing all quota models or only pinned models.
        
        When OFF (unchecked): Show only the pinned/default models (5 models).
        When ON (checked): Show ALL models from the account's quota data.
        
        This mirrors the 'showAllQuotas' toggle in antigravity_manager's
        useConfigStore -> AccountTable.tsx logic.
        """
        self.show_all_quotas = bool(state)
        self._load_data()
