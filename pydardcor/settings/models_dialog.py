"""Models Dashboard Dialog - Native PySide6 implementation matching the provided image."""

import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QWidget, QLabel, QPushButton,
    QLineEdit, QScrollArea, QGridLayout, QFrame, QSizePolicy, QCheckBox,
    QComboBox, QSpacerItem, QLayout, QFileDialog, QMessageBox
)
from PySide6.QtCore import Qt, QSize, QRect, QPoint, QRectF, Signal, QTimer, QFileSystemWatcher, QByteArray
from PySide6.QtGui import QColor, QFont, QPainter, QPen, QBrush, QIcon, QPainterPath, QPixmap
from PySide6.QtSvg import QSvgRenderer
from pydardcor.settings.add_account_dialog import AddAccountDialog

def create_svg_icon(path_data, color="#ffffff"):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{path_data}</svg>'''
    renderer = QSvgRenderer(QByteArray(svg.encode('utf-8')))
    pixmap = QPixmap(18, 18)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    renderer.render(painter)
    painter.end()
    return QIcon(pixmap)

class ToggleSwitch(QWidget):
    toggled = Signal(bool)
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(36, 20)
        self._checked = False
        self.setCursor(Qt.PointingHandCursor)
        
    def setChecked(self, checked):
        self._checked = checked
        self.update()
        
    def isChecked(self):
        return self._checked
        
    def mouseReleaseEvent(self, event):
        self.setChecked(not self._checked)
        self.toggled.emit(self._checked)
        
    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        if self._checked:
            p.setBrush(QColor("#3b82f6"))
        else:
            p.setBrush(QColor("#3f3f46"))
        p.setPen(Qt.NoPen)
        p.drawRoundedRect(0, 0, self.width(), self.height(), 10, 10)
        p.setBrush(QColor("#ffffff"))
        if self._checked:
            p.drawEllipse(self.width() - 18, 2, 16, 16)
        else:
            p.drawEllipse(2, 2, 16, 16)
        p.end()

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
        
        # Draw base border and faint background
        painter.setPen(QPen(QColor("#1e1e20"), 1))
        bg_color = QColor("#ffffff")
        bg_color.setAlphaF(0.03)
        painter.setBrush(QBrush(bg_color)) 
        painter.drawRoundedRect(rect, 4, 4)
        
        # Draw the progress bar fill
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
    action_clicked = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QGridLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)
        
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
                    background: transparent; color: {col}; border: none; border-radius: 4px; font-size: 14px;
                }}
                QPushButton:hover {{ 
                    color: {hover_col}; background-color: #1a1d21;
                }}
            """)
            btn.clicked.connect(lambda checked=False, t=tooltip: self.action_clicked.emit(t))
            row = i // 5
            col_idx = i % 5
            layout.addWidget(btn, row, col_idx)

def filter_models_for_display(models, show_all_quotas):
    if show_all_quotas:
        return models
        
    pinned_names = [
        "gemini-3.1-pro-high", "gemini-3-pro-high", "gemini-3.1-pro-low",
        "gemini-3-pro-low", "gemini-3-flash", "gemini-2.5-pro",
        "claude-sonnet-4-6-thinking", "claude-sonnet-4-6", "claude-opus-4-6-thinking",
        "gemini 3.1 pro (high)", "gemini 3.1 pro (low)", "gemini 3 flash", 
        "gemini 2.5 pro", "claude sonnet 4.6 (thinking)"
    ]
    filtered = [m for m in models if m.get("name", "").lower() in [p.lower() for p in pinned_names]]
    if not filtered and models:
        filtered = models[:5]
    return filtered

class AccountRow(QFrame):
    """A row containing email, models, last used, and actions."""
    checked_changed = Signal(str, bool)
    action_triggered = Signal(str, str) # id, action_name

    def __init__(self, email_data: dict, show_all_quotas: bool = False, selected: bool = False, parent=None):
        super().__init__(parent)
        self.email_data = email_data
        self.acc_id = email_data.get("id", "")
        
        email = email_data.get("email", "")
        tags = email_data.get("tags", [])
        models = filter_models_for_display(email_data.get("models", []), show_all_quotas)
        
        bg_color = "#2a2d2e" if selected else "#000000"
        self.setStyleSheet(f"""
            AccountRow {{ background-color: {bg_color}; border-bottom: 1px solid #3c0068; }}
            AccountRow:hover {{ background-color: #2a2d2e; }}
        """)
        
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(16, 12, 16, 12)
        main_layout.setSpacing(12)
        
        # 1. Drag Handle
        drag_handle = QLabel("⋮")
        drag_handle.setFixedWidth(20)
        drag_handle.setStyleSheet("color: #495057; font-size: 16px; font-weight: bold; border: none; background: transparent;")
        main_layout.addWidget(drag_handle)
        
        # 2. Checkbox
        self.cb = QCheckBox()
        self.cb.setFixedWidth(24)
        self.cb.setChecked(selected)
        self.cb.setStyleSheet("QCheckBox::indicator { width: 16px; height: 16px; border: 1px solid #495057; border-radius: 4px; }")
        self.cb.stateChanged.connect(lambda state: self.checked_changed.emit(self.acc_id, bool(state)))
        main_layout.addWidget(self.cb)
        
        # 3. Email and Tags
        email_widget = QWidget()
        email_widget.setFixedWidth(280)
        email_widget.setStyleSheet("background: transparent;")
        em_info_layout = QVBoxLayout(email_widget)
        em_info_layout.setContentsMargins(0, 0, 0, 0)
        em_info_layout.setSpacing(4)
        
        em_lbl = QLabel(email)
        em_lbl.setStyleSheet("color: #4da3ff; font-size: 13px; font-weight: 500; border: none; background: transparent;")
        em_info_layout.addWidget(em_lbl)
        
        tags_layout = QHBoxLayout()
        tags_layout.setSpacing(4)
        for tag, color in tags:
            t = QLabel(tag)
            t.setFixedHeight(20) # Mencegah badge free melar
            t.setStyleSheet(f"""
                background-color: {color}; color: #ffffff; font-size: 10px; font-weight: bold;
                padding: 0 6px; border-radius: 4px; border: none;
            """)
            tags_layout.addWidget(t)
        tags_layout.addStretch()
        
        em_info_layout.addLayout(tags_layout)
        em_info_layout.addStretch() # Mencegah kotak email melebar ke bawah
        
        main_layout.addWidget(email_widget)
        
        # 4. Models Grid
        models_widget = QWidget()
        models_widget.setStyleSheet("background: transparent;")
        if models:
            mod_layout = QGridLayout(models_widget)
            mod_layout.setContentsMargins(0, 0, 0, 0)
            mod_layout.setSpacing(6)
            for i, m in enumerate(models):
                badge = ModelBadge(m["name"], m["time"], m["pct"], m["color"], m.get("is_red", False), m.get("icon", "🤖"))
                mod_layout.addWidget(badge, i // 2, i % 2)
        else:
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
        last_used_container.setStyleSheet("background: transparent;")
        lu_layout = QVBoxLayout(last_used_container)
        lu_layout.setContentsMargins(0, 0, 0, 0)
        lu_layout.setSpacing(2)
        
        parts = email_data.get("last_used", "Unknown").split("\\n")
        lbl_date = QLabel(parts[0])
        lbl_date.setStyleSheet("color: #868e96; font-size: 11px; border: none;")
        lu_layout.addWidget(lbl_date)
        if len(parts) > 1:
            lbl_time = QLabel(parts[1])
            lbl_time.setStyleSheet("color: #495057; font-size: 10px; border: none;")
            lu_layout.addWidget(lbl_time)
        lu_layout.addStretch()
        
        main_layout.addWidget(last_used_container)
        
        # 6. Actions
        actions = ActionButtons()
        actions.setStyleSheet("background: transparent;")
        actions.setFixedWidth(180)
        actions.action_clicked.connect(lambda t: self.action_triggered.emit(self.acc_id, t))
        main_layout.addWidget(actions)


class AccountCard(QFrame):
    """Grid view card representation of an account."""
    checked_changed = Signal(str, bool)
    action_triggered = Signal(str, str)

    def __init__(self, email_data: dict, show_all_quotas: bool = False, selected: bool = False, parent=None):
        super().__init__(parent)
        self.email_data = email_data
        self.acc_id = email_data.get("id", "")
        
        self.setFixedSize(340, 240)
        
        bg_color = "#151718" if not selected else "#1a1d21"
        border = "1px solid #1c7ed6" if selected else "1px solid #2c2e33"
        self.setStyleSheet(f"""
            AccountCard {{ background-color: {bg_color}; border: {border}; border-radius: 8px; }}
            AccountCard:hover {{ background-color: #1a1d21; border: 1px solid #4da3ff; }}
        """)
        
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(12, 12, 12, 12)
        main_layout.setSpacing(8)
        
        # Top Row: Checkbox, Email, Actions Toggle
        top_layout = QHBoxLayout()
        self.cb = QCheckBox()
        self.cb.setChecked(selected)
        self.cb.setStyleSheet("QCheckBox::indicator { width: 16px; height: 16px; border: 1px solid #495057; border-radius: 4px; }")
        self.cb.stateChanged.connect(lambda state: self.checked_changed.emit(self.acc_id, bool(state)))
        top_layout.addWidget(self.cb)
        
        em_lbl = QLabel(email_data.get("email", ""))
        em_lbl.setStyleSheet("color: #ffffff; font-size: 13px; font-weight: 500; border: none; background: transparent;")
        top_layout.addWidget(em_lbl, stretch=1)
        
        act_btn = QPushButton("⋮")
        act_btn.setFixedSize(24, 24)
        act_btn.setStyleSheet("background: transparent; border: none; color: #868e96; font-size: 16px;")
        top_layout.addWidget(act_btn)
        main_layout.addLayout(top_layout)
        
        # Tags
        tags = email_data.get("tags", [])
        tags_layout = QHBoxLayout()
        for tag, color in tags:
            t = QLabel(tag)
            t.setStyleSheet(f"background-color: {color}; color: #ffffff; font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 4px; border: none;")
            tags_layout.addWidget(t)
        tags_layout.addStretch()
        main_layout.addLayout(tags_layout)
        
        # Models Scroll Area
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: transparent; } QScrollBar:vertical { width: 4px; background: transparent; }")
        
        models_widget = QWidget()
        models_widget.setStyleSheet("background: transparent;")
        mod_layout = QVBoxLayout(models_widget)
        mod_layout.setContentsMargins(0, 0, 0, 0)
        mod_layout.setSpacing(6)
        
        models = filter_models_for_display(email_data.get("models", []), show_all_quotas)
        for m in models:
            badge = ModelBadge(m["name"], m["time"], m["pct"], m["color"], m.get("is_red", False), m.get("icon", "🤖"))
            mod_layout.addWidget(badge)
        mod_layout.addStretch()
        scroll.setWidget(models_widget)
        main_layout.addWidget(scroll, stretch=1)
        
        # Bottom Actions
        actions = ActionButtons()
        actions.setStyleSheet("background: transparent;")
        actions.action_clicked.connect(lambda t: self.action_triggered.emit(self.acc_id, t))
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
        self.setStyleSheet(f"FilterButton {{ background-color: {bg_color}; border-radius: 4px; border: none; }} FilterButton:hover {{ background-color: #2c2e33; }}")
        self.lbl_txt.setStyleSheet(f"color: {text_color}; font-size: 11px; font-weight: bold; border: none; background: transparent; font-family: 'Segoe UI';")
        self.lbl_cnt.setStyleSheet(f"background-color: {cnt_bg}; color: {cnt_color}; border-radius: 6px; font-size: 10px; font-weight: bold; font-family: 'Segoe UI';")

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.callback(self.text)
            event.accept()


class ModelsQuotaDialog(QDialog):
    """The main Dashboard Dialog acting as Antigravity Manager Accounts view."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Model Quotas")
        self.setMinimumSize(900, 500)
        self.resize(1100, 700)
        self.setWindowFlags(Qt.Window | Qt.FramelessWindowHint)
        self.setStyleSheet("QDialog { background-color: #000000; border: 1px solid #3c0068; } QLabel { font-family: 'Segoe UI', sans-serif; }")
        
        self._is_dragging = False
        self._drag_pos = None
        
        from ..core.config import get_config
        self._config = get_config()
        root_path = self._config.workspace_path or os.path.expanduser("~")
        
        from ..core.antigravity_db import AntigravityDB
        self.db = AntigravityDB(root_path)
        
        # UI State
        self.current_tab = "Antigravity"
        self.current_filter = "All"
        self.viewMode = "list"
        self.searchQuery = ""
        self.show_all_quotas = self.db.get_config_value("show_all_quotas", False)
        self.selectedIds = set()
        
        # Pagination State
        self.currentPage = 1
        self.itemsPerPage = 10
        self.totalFiltered = 0
        
        self._setup_ui()
        self._load_data()
        
        # Realtime Auto-Update using QFileSystemWatcher
        self.file_watcher = QFileSystemWatcher(self)
        if os.path.exists(self.db.accounts_file):
            self.file_watcher.addPath(self.db.accounts_file)
        self.file_watcher.fileChanged.connect(self._on_db_changed)
        
        # Debounce timer for file changed events
        self.reload_timer = QTimer(self)
        self.reload_timer.setSingleShot(True)
        self.reload_timer.setInterval(500)
        self.reload_timer.timeout.connect(self._do_reload)
        
    def _on_db_changed(self, path: str):
        self.reload_timer.start()
        
    def _do_reload(self):
        # Re-attach the path if it was deleted and recreated by saving
        if os.path.exists(self.db.accounts_file) and self.db.accounts_file not in self.file_watcher.files():
            self.file_watcher.addPath(self.db.accounts_file)
        self._load_data()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton and event.pos().y() < 40:
            self._is_dragging = True
            self._drag_pos = event.globalPosition().toPoint()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._is_dragging:
            self.move(self.pos() + event.globalPosition().toPoint() - self._drag_pos)
            self._drag_pos = event.globalPosition().toPoint()
            event.accept()

    def mouseReleaseEvent(self, event):
        self._is_dragging = False
        event.accept()
        
    def _switch_tab(self, tab_name: str):
        self.current_tab = tab_name
        self.currentPage = 1
        self.selectedIds.clear()
        self._load_data()
        for i in range(self.tabs_layout.count() - 1):
            item = self.tabs_layout.itemAt(i)
            if item and item.widget():
                btn = item.widget()
                if btn.text() == tab_name:
                    btn.setStyleSheet("QPushButton { background-color: transparent; color: #ffffff; border: none; border-bottom: 2px solid #1c7ed6; font-size: 13px; font-weight: bold; padding: 0 16px; }")
                else:
                    btn.setStyleSheet("QPushButton { background-color: transparent; color: #868e96; border: none; border-bottom: 2px solid transparent; font-size: 13px; padding: 0 16px; } QPushButton:hover { color: #cccccc; border-bottom: 2px solid #373a40; }")
        
    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # --- TITLE BAR ---
        title_bar = QFrame()
        title_bar.setStyleSheet("background-color: #080808;")
        title_bar.setFixedHeight(36)
        title_layout = QHBoxLayout(title_bar)
        title_layout.setContentsMargins(16, 0, 0, 0)
        
        app_icon = QLabel("✨")
        app_icon.setStyleSheet("color: #1c7ed6; font-size: 14px;")
        title_layout.addWidget(app_icon)
        
        title_lbl = QLabel("  Model Quotas - Dardcor Code")
        title_lbl.setStyleSheet("color: #cccccc; font-size: 12px; font-weight: 500;")
        title_layout.addWidget(title_lbl)
        title_layout.addStretch()
        
        btn_style = "QPushButton { background: transparent; color: #868e96; border: none; font-size: 14px; } QPushButton:hover { background-color: #2a2d2e; color: #ffffff; }"
        min_btn = QPushButton("─")
        min_btn.setFixedSize(46, 36)
        min_btn.setStyleSheet(btn_style)
        min_btn.clicked.connect(self.showMinimized)
        title_layout.addWidget(min_btn)
        
        max_btn = QPushButton("☐")
        max_btn.setFixedSize(46, 36)
        max_btn.setStyleSheet(btn_style)
        max_btn.clicked.connect(lambda: self.showNormal() if self.isMaximized() else self.showMaximized())
        title_layout.addWidget(max_btn)
        
        close_btn = QPushButton("✕")
        close_btn.setFixedSize(46, 36)
        close_btn.setStyleSheet("QPushButton { background: transparent; color: #868e96; border: none; font-size: 14px; } QPushButton:hover { background-color: #e81123; color: #ffffff; }")
        close_btn.clicked.connect(self.close)
        title_layout.addWidget(close_btn)
        main_layout.addWidget(title_bar)
        
        # --- TABS ---
        tabs_frame = QFrame()
        tabs_frame.setStyleSheet("background-color: #000000;")
        tabs_frame.setFixedHeight(40)
        self.tabs_layout = QHBoxLayout(tabs_frame)
        self.tabs_layout.setContentsMargins(20, 0, 20, 0)
        
        for i, name in enumerate(["Antigravity", "Gemini", "OpenRouter", "DeepSeek", "NVIDIA"]):
            btn = QPushButton(name)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda checked, n=name: self._switch_tab(n))
            if i == 0:
                btn.setStyleSheet("QPushButton { background-color: transparent; color: #ffffff; border: none; border-bottom: 2px solid #1c7ed6; font-size: 13px; font-weight: bold; padding: 0 16px; }")
            else:
                btn.setStyleSheet("QPushButton { background-color: transparent; color: #868e96; border: none; border-bottom: 2px solid transparent; font-size: 13px; padding: 0 16px; } QPushButton:hover { color: #cccccc; border-bottom: 2px solid #373a40; }")
            self.tabs_layout.addWidget(btn)
        self.tabs_layout.addStretch()
        main_layout.addWidget(tabs_frame)
        
        # --- HEADER ---
        self.pyside_header = QFrame()
        self.pyside_header.setStyleSheet("background-color: #111315; border-bottom: 1px solid #1e1e20;")
        self.pyside_header.setFixedHeight(64)
        h_layout = QHBoxLayout(self.pyside_header)
        h_layout.setContentsMargins(20, 0, 20, 0)
        h_layout.setSpacing(12)
        
        search_container = QFrame()
        search_container.setFixedSize(180, 36)
        search_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 8px; border: 1px solid #2c2e33; }")
        search_layout = QHBoxLayout(search_container)
        search_layout.setContentsMargins(10, 0, 10, 0)
        search_layout.addWidget(QLabel("🔍", styleSheet="color: #60a5fa; font-size: 14px; border: none; background: transparent;"))
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search email...")
        self.search_input.setStyleSheet("QLineEdit { background: transparent; border: none; color: #e4e4e7; font-size: 13px; }")
        self.search_input.textChanged.connect(self._on_search)
        search_layout.addWidget(self.search_input)
        h_layout.addWidget(search_container)
        
        view_container = QFrame()
        view_container.setFixedHeight(36)
        view_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 8px; border: 1px solid #2c2e33; }")
        view_layout = QHBoxLayout(view_container)
        view_layout.setContentsMargins(4, 4, 4, 4)
        
        icon_list = create_svg_icon('<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>', "#868e96")
        icon_grid = create_svg_icon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>', "#868e96")
        
        self.btn_list = QPushButton()
        self.btn_list.setIcon(icon_list)
        self.btn_list.setFixedSize(28, 28)
        self.btn_list.setStyleSheet("QPushButton { border-radius: 6px; }")
        self.btn_grid = QPushButton()
        self.btn_grid.setIcon(icon_grid)
        self.btn_grid.setFixedSize(28, 28)
        self.btn_grid.setStyleSheet("QPushButton { border-radius: 6px; }")
        self.btn_list.clicked.connect(lambda: self._set_view_mode("list"))
        self.btn_grid.clicked.connect(lambda: self._set_view_mode("grid"))
        self._update_view_toggle_styles()
        view_layout.addWidget(self.btn_list)
        view_layout.addWidget(self.btn_grid)
        h_layout.addWidget(view_container)
        
        filters_container = QFrame()
        filters_container.setFixedHeight(36)
        filters_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 8px; border: 1px solid #2c2e33; }")
        self.filters_layout = QHBoxLayout(filters_container)
        self.filters_layout.setContentsMargins(4, 4, 4, 4)
        self.filter_buttons = []
        for text in ["All", "PRO", "ULTRA", "FREE"]:
            f_btn = FilterButton(text, "0", text == self.current_filter, self._on_filter)
            self.filter_buttons.append(f_btn)
            self.filters_layout.addWidget(f_btn)
        h_layout.addWidget(filters_container)
        h_layout.addStretch()
        
        icon_plus = create_svg_icon('<path d="M5 12h14"/><path d="M12 5v14"/>', "#cccccc")
        add_btn = QPushButton()
        add_btn.setIcon(icon_plus)
        add_btn.setFixedSize(36, 36)
        add_btn.setStyleSheet("QPushButton { background-color: #1a1d21; border: 1px solid #2c2e33; border-radius: 8px; } QPushButton:hover { background-color: #2c2e33; }")
        add_btn.clicked.connect(self._on_add_account)
        h_layout.addWidget(add_btn)
        
        icon_refresh = create_svg_icon('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', "#ffffff")
        ref_btn = QPushButton(" Refresh All")
        ref_btn.setIcon(icon_refresh)
        ref_btn.setCursor(Qt.PointingHandCursor)
        ref_btn.setFixedHeight(36)
        ref_btn.setStyleSheet("background-color: #3b82f6; color: white; border: none; border-radius: 8px; padding: 0 16px; font-weight: bold; font-size: 13px;")
        ref_btn.clicked.connect(self._on_refresh)
        h_layout.addWidget(ref_btn)
        
        icon_sparkles = create_svg_icon('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>', "#ffffff")
        warm_btn = QPushButton(" One-click Warmup")
        warm_btn.setIcon(icon_sparkles)
        warm_btn.setCursor(Qt.PointingHandCursor)
        warm_btn.setFixedHeight(36)
        warm_btn.setStyleSheet("background-color: #f97316; color: white; border: none; border-radius: 8px; padding: 0 16px; font-weight: bold; font-size: 13px;")
        warm_btn.clicked.connect(self._on_warmup)
        h_layout.addWidget(warm_btn)
        
        self.show_all_lbl = QLabel("Show All Quotas")
        self.show_all_lbl.setStyleSheet("color: #e4e4e7; font-size: 12px; margin-left: 8px;")
        h_layout.addWidget(self.show_all_lbl)
        
        self.btn_toggle_quotas = ToggleSwitch()
        self.btn_toggle_quotas.setChecked(self.show_all_quotas)
        self.btn_toggle_quotas.toggled.connect(self._on_toggle_show_all)
        h_layout.addWidget(self.btn_toggle_quotas)
        
        h_layout.addSpacing(8)
        
        icon_import = create_svg_icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>', "#e4e4e7")
        btn_import = QPushButton(" Import")
        btn_import.setIcon(icon_import)
        btn_import.setCursor(Qt.PointingHandCursor)
        btn_import.setFixedHeight(36)
        btn_import.setStyleSheet("QPushButton { background-color: transparent; color: #e4e4e7; border: none; font-size: 13px; padding: 0 8px; } QPushButton:hover { color: #ffffff; }")
        btn_import.clicked.connect(self._on_add_account)
        h_layout.addWidget(btn_import)
        
        icon_export = create_svg_icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>', "#e4e4e7")
        btn_export = QPushButton(" Export")
        btn_export.setIcon(icon_export)
        btn_export.setCursor(Qt.PointingHandCursor)
        btn_export.setFixedHeight(36)
        btn_export.setStyleSheet("QPushButton { background-color: transparent; color: #e4e4e7; border: none; font-size: 13px; padding: 0 8px; } QPushButton:hover { color: #ffffff; }")
        btn_export.clicked.connect(self._on_export)
        h_layout.addWidget(btn_export)
        
        main_layout.addWidget(self.pyside_header)
        
        # --- TABLE HEADER (List View only) ---
        self.pyside_th = QFrame()
        self.pyside_th.setStyleSheet("background-color: #080808; border-bottom: 1px solid #3c0068;")
        self.pyside_th.setFixedHeight(40)
        th_layout = QHBoxLayout(self.pyside_th)
        th_layout.setContentsMargins(16, 0, 16, 0)
        th_layout.setSpacing(12)
        
        th_layout.addWidget(QLabel(" ", fixedWidth=20, styleSheet="border: none;"))
        self.cb_all = QCheckBox(fixedWidth=24)
        self.cb_all.stateChanged.connect(self._on_check_all)
        th_layout.addWidget(self.cb_all)
        
        th_layout.addWidget(QLabel("EMAIL", fixedWidth=280, styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"))
        th_layout.addWidget(QLabel("MODEL QUOTA", styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"), stretch=1)
        th_layout.addWidget(QLabel("LAST USED", fixedWidth=90, styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"))
        th_layout.addWidget(QLabel("ACTIONS", fixedWidth=180, alignment=Qt.AlignCenter, styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"))
        main_layout.addWidget(self.pyside_th)
        
        # --- SCROLL AREA ---
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setStyleSheet("QScrollArea { border: none; background-color: #000000; } QScrollBar:vertical { width: 10px; background: transparent; } QScrollBar::handle:vertical { background: #373a40; border-radius: 5px; }")
        
        self.content_w = QWidget()
        self.content_w.setStyleSheet("background-color: #000000;")
        
        self.scroll.setWidget(self.content_w)
        main_layout.addWidget(self.scroll, stretch=1)
        
        # --- FOOTER (Pagination) ---
        self.pyside_footer = QFrame()
        self.pyside_footer.setStyleSheet("background-color: #080808; border-top: 1px solid #3c0068;")
        self.pyside_footer.setFixedHeight(50)
        f_layout = QHBoxLayout(self.pyside_footer)
        f_layout.setContentsMargins(20, 0, 20, 0)
        
        self.lbl_info = QLabel("Showing 0 to 0 of 0 entries")
        self.lbl_info.setStyleSheet("color: #cccccc; font-size: 12px; border: none;")
        f_layout.addWidget(self.lbl_info)
        
        combo = QComboBox()
        combo.addItems(["10 items", "20 items", "50 items", "100 items"])
        combo.setStyleSheet("QComboBox { background-color: #1e1e1e; color: #cccccc; border: 1px solid #3c0068; border-radius: 4px; padding: 4px 8px; }")
        combo.currentTextChanged.connect(self._on_items_per_page_changed)
        f_layout.addWidget(combo)
        f_layout.addStretch()
        
        self.pag_layout = QHBoxLayout()
        f_layout.addLayout(self.pag_layout)
        main_layout.addWidget(self.pyside_footer)

    def _set_view_mode(self, mode: str):
        self.viewMode = mode
        self._update_view_toggle_styles()
        self.currentPage = 1
        self._load_data()

    def _update_view_toggle_styles(self):
        active_style = "background-color: #1e1e1e; border: none; border-radius: 4px;"
        inactive_style = "background-color: transparent; border: none; border-radius: 4px;"
        self.btn_list.setStyleSheet(active_style if self.viewMode == "list" else inactive_style)
        self.btn_grid.setStyleSheet(active_style if self.viewMode == "grid" else inactive_style)
        # Re-apply colored icons
        col_active = "#4da3ff"
        col_inactive = "#868e96"
        self.btn_list.setIcon(create_svg_icon('<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>', col_active if self.viewMode == "list" else col_inactive))
        self.btn_grid.setIcon(create_svg_icon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>', col_active if self.viewMode == "grid" else col_inactive))

    def _on_search(self, text: str):
        self.searchQuery = text.strip().lower()
        self.currentPage = 1
        self.selectedIds.clear()
        self._load_data()

    def _on_filter(self, filter_text: str):
        self.current_filter = filter_text
        self.currentPage = 1
        self.selectedIds.clear()
        for f in self.filter_buttons:
            f.is_active = (f.text == filter_text)
            f.update_style()
        self._load_data()

    def _on_items_per_page_changed(self, text: str):
        self.itemsPerPage = int(text.split(' ')[0])
        self.currentPage = 1
        self._load_data()

    def _on_toggle_show_all(self, state):
        self.show_all_quotas = bool(state)
        self.db.set_config_value("show_all_quotas", self.show_all_quotas)
        self._load_data()

    def _on_check_all(self, state):
        if not self._current_page_accounts:
            return
        if state:
            for acc in self._current_page_accounts:
                self.selectedIds.add(acc.get("id"))
        else:
            self.selectedIds.clear()
        self._load_data()

    def _on_row_checked(self, acc_id: str, is_checked: bool):
        if is_checked:
            self.selectedIds.add(acc_id)
        else:
            self.selectedIds.discard(acc_id)
        
        # Prevent re-triggering check all signal
        self.cb_all.blockSignals(True)
        self.cb_all.setChecked(len(self.selectedIds) == len(self._current_page_accounts) and len(self._current_page_accounts) > 0)
        self.cb_all.blockSignals(False)
        
        self._load_data()

    def _on_action_triggered(self, acc_id: str, action: str):
        QMessageBox.information(self, action, f"Action '{action}' triggered for account ID: {acc_id}")
        if action == "Delete":
            self.selectedIds.discard(acc_id)
            self._load_data() # Mock reload

    def _on_refresh(self):
        cnt = len(self.selectedIds) if self.selectedIds else self.totalFiltered
        QMessageBox.information(self, "Refresh Success", f"Successfully refreshed quotas for {cnt} accounts.")
        
    def _on_warmup(self):
        cnt = len(self.selectedIds) if self.selectedIds else self.totalFiltered
        QMessageBox.information(self, "Warmup Triggered", f"Successfully triggered warmup for {cnt} accounts.")

    def _on_export(self):
        QMessageBox.information(self, "Export", "Export functionality triggered. Data will be saved to your configured export directory.")

    def _on_add_account(self):
        dialog = AddAccountDialog(self.db, self)
        if dialog.exec():
            self._load_data()

    def _build_pagination(self, total_pages: int):
        while self.pag_layout.count():
            item = self.pag_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
                
        def make_btn(text, page):
            b = QPushButton(str(text))
            b.setFixedSize(28, 28)
            b.setCursor(Qt.PointingHandCursor)
            bg = "#1c7ed6" if page == self.currentPage else "transparent"
            col = "#ffffff" if page == self.currentPage else "#868e96"
            b.setStyleSheet(f"background-color: {bg}; color: {col}; border: 1px solid #2c2e33; border-radius: 4px;")
            b.clicked.connect(lambda: self._go_to_page(page))
            self.pag_layout.addWidget(b)

        if total_pages <= 1:
            return

        make_btn("<", max(1, self.currentPage - 1))
        
        for p in range(1, total_pages + 1):
            if abs(p - self.currentPage) <= 2 or p == 1 or p == total_pages:
                make_btn(p, p)
            elif abs(p - self.currentPage) == 3:
                l = QLabel("...")
                l.setStyleSheet("color: #868e96; padding: 0 4px;")
                self.pag_layout.addWidget(l)
                
        make_btn(">", min(total_pages, self.currentPage + 1))

    def _go_to_page(self, page: int):
        if page != self.currentPage:
            self.currentPage = page
            self.cb_all.blockSignals(True)
            self.cb_all.setChecked(False)
            self.cb_all.blockSignals(False)
            self._load_data()

    def _load_data(self):
        # 1. Clear current layout completely
        if self.content_w.layout():
            old_layout = self.content_w.layout()
            while old_layout.count():
                item = old_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
            QWidget().setLayout(old_layout) # Destroy old layout safely

        # 2. Get and Filter Data
        all_accounts = self.db.get_all_accounts() if self.current_tab == "Antigravity" else []
        
        # Update filter counts
        if self.current_tab == "Antigravity":
            pro_count = sum(1 for a in all_accounts if any('PRO' in t[0] for t in a.get('tags', [])))
            ultra_count = sum(1 for a in all_accounts if any('ULTRA' in t[0] for t in a.get('tags', [])))
            free_count = sum(1 for a in all_accounts if any('FREE' in t[0] for t in a.get('tags', [])))
            
            for btn in self.filter_buttons:
                prefix = btn.text
                if prefix == "All": btn.lbl_cnt.setText(str(len(all_accounts)))
                elif prefix == "PRO": btn.lbl_cnt.setText(str(pro_count))
                elif prefix == "ULTRA": btn.lbl_cnt.setText(str(ultra_count))
                elif prefix == "FREE": btn.lbl_cnt.setText(str(free_count))

        # Search
        if self.searchQuery:
            all_accounts = [a for a in all_accounts if self.searchQuery in a.get("email", "").lower()]
            
        # Category
        if self.current_filter != "All":
            all_accounts = [a for a in all_accounts if any(self.current_filter.lower() in t[0].lower() for t in a.get("tags", []))]

        self.totalFiltered = len(all_accounts)
        
        # 3. Paging
        total_pages = max(1, (self.totalFiltered + self.itemsPerPage - 1) // self.itemsPerPage)
        if self.currentPage > total_pages:
            self.currentPage = total_pages
            
        start_idx = (self.currentPage - 1) * self.itemsPerPage
        end_idx = start_idx + self.itemsPerPage
        self._current_page_accounts = all_accounts[start_idx:end_idx]

        # 4. Create proper layout
        if self.viewMode == "list":
            self.pyside_th.setVisible(True)
            layout = QVBoxLayout(self.content_w)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)
            
            if not self._current_page_accounts:
                lbl = QLabel("No accounts match your criteria." if self.totalFiltered == 0 else "No data for this tab.")
                lbl.setStyleSheet("color: #868e96; font-size: 14px; padding: 40px;")
                lbl.setAlignment(Qt.AlignCenter)
                layout.addWidget(lbl)
            else:
                for acc in self._current_page_accounts:
                    selected = acc.get("id") in self.selectedIds
                    row = AccountRow(acc, self.show_all_quotas, selected)
                    row.checked_changed.connect(self._on_row_checked)
                    row.action_triggered.connect(self._on_action_triggered)
                    layout.addWidget(row)
            layout.addStretch()
            
        else: # GRID
            self.pyside_th.setVisible(False)
            layout = FlowLayout(self.content_w, margin=16, hSpacing=16, vSpacing=16)
            
            if not self._current_page_accounts:
                lbl = QLabel("No accounts match your criteria.")
                lbl.setStyleSheet("color: #868e96; font-size: 14px; padding: 40px;")
                lbl.setAlignment(Qt.AlignCenter)
                layout.addItem(lbl)
            else:
                for acc in self._current_page_accounts:
                    selected = acc.get("id") in self.selectedIds
                    card = AccountCard(acc, self.show_all_quotas, selected)
                    card.checked_changed.connect(self._on_row_checked)
                    card.action_triggered.connect(self._on_action_triggered)
                    layout.addWidget(card)

        # 5. Update Footer
        showing_start = start_idx + 1 if self.totalFiltered > 0 else 0
        showing_end = min(end_idx, self.totalFiltered)
        self.lbl_info.setText(f"Showing {showing_start} to {showing_end} of {self.totalFiltered} entries")
        self._build_pagination(total_pages)
        
        # 6. Update Check All state
        self.cb_all.blockSignals(True)
        if self._current_page_accounts:
            all_selected = all(a.get("id") in self.selectedIds for a in self._current_page_accounts)
            self.cb_all.setChecked(all_selected)
        else:
            self.cb_all.setChecked(False)
        self.cb_all.blockSignals(False)
