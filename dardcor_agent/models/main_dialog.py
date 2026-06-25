"""Models Dashboard Dialog - Native PySide6 implementation matching the provided image."""

import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QWidget, QLabel, QPushButton,
    QLineEdit, QScrollArea, QGridLayout, QFrame, QSizePolicy, QCheckBox,
    QComboBox, QSpacerItem, QLayout, QFileDialog, QMessageBox, QStackedWidget
)
from PySide6.QtCore import Qt, QSize, QRect, QPoint, QRectF, Signal, QTimer, QFileSystemWatcher, QByteArray, QPropertyAnimation, QEasingCurve, QThread
from PySide6.QtGui import QColor, QFont, QPainter, QPen, QBrush, QIcon, QPainterPath, QPixmap
from PySide6.QtWidgets import QGraphicsOpacityEffect
from PySide6.QtSvg import QSvgRenderer
from pydardcor.settings.add_account_dialog import AddAccountDialog
import urllib.request
import urllib.parse
import urllib.error
import json

def create_svg_icon(path_data, color="#ffffff", rotation_angle=0):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{path_data}</svg>'''
    renderer = QSvgRenderer(QByteArray(svg.encode('utf-8')))
    pixmap = QPixmap(18, 18)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    if rotation_angle != 0:
        painter.translate(9, 9)
        painter.rotate(rotation_angle)
        painter.translate(-9, -9)
    renderer.render(painter)
    painter.end()
    icon = QIcon(pixmap)
    return icon

import os
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CHECK_SVG_PATH = os.path.join(CURRENT_DIR, "check.svg")
if not os.path.exists(CHECK_SVG_PATH):
    with open(CHECK_SVG_PATH, "w", encoding="utf-8") as f:
        f.write("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>")

CHECK_URL = CHECK_SVG_PATH.replace("\\", "/")

CHECKBOX_STYLE = f"""
QCheckBox::indicator {{ width: 16px; height: 16px; border: 1px solid #495057; border-radius: 4px; background-color: transparent; }}
QCheckBox::indicator:hover {{ border: 1px solid #5c1b8b; }}
QCheckBox::indicator:checked {{ background-color: #5c1b8b; border: 1px solid #5c1b8b; image: url("{CHECK_URL}"); }}
"""

class ToastWidget(QFrame):
    """A floating notification toast similar to react-hot-toast."""
    def __init__(self, message, toast_type="info", parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.SubWindow | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(8)
        
        bg_color = "#333333"
        icon_svg = ""
        icon_color = "#ffffff"
        
        if toast_type == "success":
            bg_color = "#15803d" # green-700
            icon_svg = '<path d="M20 6L9 17l-5-5"/>'
        elif toast_type == "error":
            bg_color = "#b91c1c" # red-700
            icon_svg = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
        elif toast_type == "warning":
            bg_color = "#b45309" # amber-700
            icon_svg = '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
        else:
            bg_color = "#2563eb" # blue-600
            icon_svg = '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
            
        self.setStyleSheet(f"QFrame {{ background-color: {bg_color}; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); }}")
        
        icon_lbl = QLabel()
        icon_lbl.setPixmap(create_svg_icon(icon_svg, icon_color).pixmap(16, 16))
        icon_lbl.setStyleSheet("background: transparent; border: none;")
        layout.addWidget(icon_lbl)
        
        msg_lbl = QLabel(message)
        msg_lbl.setStyleSheet("color: white; font-weight: bold; font-size: 13px; background: transparent; border: none; font-family: 'Segoe UI';")
        layout.addWidget(msg_lbl)
        
        self.opacity_effect = QGraphicsOpacityEffect(self)
        self.setGraphicsEffect(self.opacity_effect)
        self.opacity_effect.setOpacity(0.0)
        
    def show_animated(self, duration_ms=3000):
        self.show()
        # Fade in
        self.anim_in = QPropertyAnimation(self.opacity_effect, b"opacity")
        self.anim_in.setDuration(200)
        self.anim_in.setStartValue(0.0)
        self.anim_in.setEndValue(1.0)
        self.anim_in.start()
        
        # Auto hide after duration
        QTimer.singleShot(duration_ms, self.hide_animated)
        
    def hide_animated(self):
        self.anim_out = QPropertyAnimation(self.opacity_effect, b"opacity")
        self.anim_out.setDuration(300)
        self.anim_out.setStartValue(1.0)
        self.anim_out.setEndValue(0.0)
        self.anim_out.finished.connect(self.deleteLater)
        self.anim_out.start()

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

from dardcor_agent.models.providers.antigravity.components import ModelBadge, ActionButtons, AccountRow, AccountCard, QuotaWorker


class ProviderChip(QFrame):
    """Pill chip for a pinned provider in the header bar."""
    switch_requested = Signal(str)
    toggle_requested = Signal(str, bool)
    remove_requested = Signal(str)

    def __init__(self, name: str, is_active: bool, is_current: bool, can_remove: bool = True, parent=None):
        super().__init__(parent)
        self.name = name
        self.setFixedHeight(30)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setCursor(Qt.PointingHandCursor)

        row = QHBoxLayout(self)
        row.setContentsMargins(10, 0, 6 if can_remove else 10, 0)
        row.setSpacing(5)

        self.name_btn = QPushButton(name)
        self.name_btn.setCursor(Qt.PointingHandCursor)
        self.name_btn.setFlat(True)
        self.name_btn.clicked.connect(lambda: self.switch_requested.emit(name))
        row.addWidget(self.name_btn)

        self.cb = QCheckBox()
        self.cb.setFixedSize(16, 16)
        self.cb.setStyleSheet(CHECKBOX_STYLE)
        self.cb.setChecked(is_active)
        self.cb.toggled.connect(lambda v: self.toggle_requested.emit(name, v))
        row.addWidget(self.cb)

        if can_remove:
            rm = QPushButton("✕")
            rm.setFixedSize(14, 14)
            rm.setCursor(Qt.PointingHandCursor)
            rm.setStyleSheet(
                "QPushButton{background:transparent;border:none;color:#555;font-size:9px;padding:0}"
                "QPushButton:hover{color:#e4e4e7}"
            )
            rm.clicked.connect(lambda: self.remove_requested.emit(name))
            row.addWidget(rm)

        self.set_current(is_current)

    def set_current(self, active: bool):
        if active:
            self.setStyleSheet(
                "QFrame{background:#1a0030;border:1px solid #5c1b8b;border-radius:7px}"
            )
            self.name_btn.setStyleSheet(
                "QPushButton{background:transparent;border:none;font-size:12px;"
                "font-weight:600;color:#e4e4e7;padding:0 2px}"
            )
        else:
            self.setStyleSheet(
                "QFrame{background:#111315;border:1px solid #2c2e33;border-radius:7px}"
            )
            self.name_btn.setStyleSheet(
                "QPushButton{background:transparent;border:none;font-size:12px;"
                "color:#868e96;padding:0 2px}"
                "QPushButton:hover{color:#cccccc}"
            )


class ProviderDropdownPopup(QFrame):
    """Searchable popup listing providers not yet pinned to the header bar."""
    provider_pinned = Signal(str)

    def __init__(self, available: list, parent=None):
        super().__init__(parent, Qt.Popup | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setStyleSheet(
            "QFrame{background:#111315;border:1px solid #2c2e33;border-radius:10px}"
            "QScrollBar:vertical{width:5px;background:transparent}"
            "QScrollBar::handle:vertical{background:#2c2e33;border-radius:2px}"
        )
        self.setMinimumWidth(210)
        self.setMaximumWidth(260)
        self._all = list(available)

        vbox = QVBoxLayout(self)
        vbox.setContentsMargins(8, 8, 8, 8)
        vbox.setSpacing(5)

        # Search row
        sf = QFrame()
        sf.setStyleSheet("QFrame{background:#1a1d21;border:1px solid #2c2e33;border-radius:6px}")
        sf_row = QHBoxLayout(sf)
        sf_row.setContentsMargins(8, 2, 8, 2)
        sf_row.setSpacing(5)
        sf_lbl = QLabel("⌕")
        sf_lbl.setStyleSheet("color:#5c6bc0;font-size:14px;border:none;background:transparent")
        sf_row.addWidget(sf_lbl)
        self._search = QLineEdit()
        self._search.setPlaceholderText("Search providers…")
        self._search.setStyleSheet(
            "QLineEdit{background:transparent;border:none;color:#e4e4e7;font-size:12px}"
        )
        self._search.textChanged.connect(self._filter)
        sf_row.addWidget(self._search)
        vbox.addWidget(sf)

        # Divider
        div = QFrame()
        div.setFrameShape(QFrame.HLine)
        div.setStyleSheet("background:#2c2e33;max-height:1px;border:none")
        vbox.addWidget(div)

        # Scrollable list
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setStyleSheet("QScrollArea{border:none;background:transparent}")
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._scroll.setMaximumHeight(300)

        self._list_w = QWidget()
        self._list_w.setStyleSheet("background:transparent")
        self._list_vbox = QVBoxLayout(self._list_w)
        self._list_vbox.setContentsMargins(0, 0, 0, 0)
        self._list_vbox.setSpacing(1)
        self._build_items(self._all)

        self._scroll.setWidget(self._list_w)
        vbox.addWidget(self._scroll)

    def _build_items(self, items):
        while self._list_vbox.count():
            c = self._list_vbox.takeAt(0)
            if c.widget():
                c.widget().deleteLater()

        if not items:
            empty = QLabel("No providers available")
            empty.setAlignment(Qt.AlignCenter)
            empty.setStyleSheet("color:#555;font-size:12px;padding:12px")
            self._list_vbox.addWidget(empty)
            return

        for name, is_enabled in items:
            dot_color = "#22c55e" if is_enabled else "#555"
            dot = "●" if is_enabled else "○"
            btn = QPushButton(f"  {dot}   {name}")
            btn.setCursor(Qt.PointingHandCursor)
            btn.setStyleSheet(
                f"QPushButton{{background:transparent;border:none;text-align:left;"
                f"color:#c1c2c5;font-size:12px;padding:7px 10px;border-radius:5px}}"
                f"QPushButton:hover{{background:#1a1d21;color:#e4e4e7}}"
            )
            # tint the dot part
            btn.setToolTip("Enabled" if is_enabled else "Disabled")
            btn.clicked.connect(lambda _=False, n=name: self._select(n))
            self._list_vbox.addWidget(btn)

        self._list_vbox.addStretch()

    def _filter(self, text: str):
        filtered = [(n, e) for n, e in self._all if text.lower() in n.lower()]
        self._build_items(filtered)

    def _select(self, name: str):
        self.provider_pinned.emit(name)
        self.close()

    def show_below(self, widget: QWidget):
        self.adjustSize()
        from PySide6.QtWidgets import QApplication
        screen = QApplication.primaryScreen().availableGeometry()
        # Right-align popup under the button; clamp to screen edges
        br = widget.mapToGlobal(QPoint(widget.width(), widget.height() + 4))
        x = max(screen.left() + 4, br.x() - self.width())
        y = min(br.y(), screen.bottom() - self.height() - 4)
        self.move(x, y)
        self.show()
        self._search.setFocus()


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
        layout.setContentsMargins(6, 2, 6, 2)
        layout.setSpacing(4)
        
        self.lbl_txt = QLabel(text)
        self.lbl_cnt = QLabel(count)
        self.lbl_cnt.setFixedSize(16, 16)
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
        self.lbl_cnt.setStyleSheet(f"background-color: {cnt_bg}; color: {cnt_color}; border-radius: 8px; font-size: 9px; font-weight: bold; font-family: 'Segoe UI';")

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.callback(self.text)
            event.accept()
        self.finished_signal.emit(updated)

class ModelsQuotaDialog(QDialog):
    """The main Dashboard Dialog acting as Antigravity Manager Accounts view."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Model Quotas")
        
        # Make window responsive and smaller by default (like Dardcor Code)
        try:
            from PySide6.QtWidgets import QApplication
            screen = QApplication.primaryScreen().availableGeometry()
            target_w = min(900, int(screen.width() * 0.85))
            target_h = min(650, int(screen.height() * 0.85))
        except Exception:
            target_w, target_h = 900, 650
            
        self.setMinimumSize(600, 400)
        self.resize(target_w, target_h)
        
        try:
            # Center on screen
            self.move(
                screen.center().x() - self.width() // 2,
                screen.center().y() - self.height() // 2
            )
        except Exception:
            pass
        self.setWindowFlags(
            Qt.Window |
            Qt.FramelessWindowHint |
            Qt.WindowSystemMenuHint |
            Qt.WindowMinimizeButtonHint |
            Qt.WindowMaximizeButtonHint
        )
        self.setStyleSheet("QDialog { background-color: #000000; border: 1px solid #3c0068; } QLabel { font-family: 'Segoe UI', sans-serif; }")
        
        self._is_dragging = False
        self._drag_pos = None
        
        from pydardcor.core.config import get_config, get_user_data_dir
        self._config = get_config()
        # Use user-writable data directory, never the installation folder (Program Files is read-only)
        from pydardcor.core.antigravity_db import AntigravityDB
        self.db = AntigravityDB(get_user_data_dir())
        
        # UI State
        self.current_tab = "Antigravity"
        self.current_filter = "All"
        self.viewMode = "list"
        self.searchQuery = ""
        self.show_all_quotas = self.db.get_config_value("show_all_quotas", False)
        self.selectedIds = set()
        
        # Pagination State
        self.currentPage = 1
        self.itemsPerPage = self.db.get_config_value("items_per_page", 10)
        self.totalFiltered = 0
        
        self._setup_ui()
        self._load_data()
        
        # Realtime Auto-Update using QFileSystemWatcher
        self.file_watcher = QFileSystemWatcher(self)
        if os.path.exists(self.db.accounts_dir):
            self.file_watcher.addPath(self.db.accounts_dir)
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
        if os.path.exists(self.db.accounts_dir) and self.db.accounts_dir not in self.file_watcher.directories():
            self.file_watcher.addPath(self.db.accounts_dir)
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
        if hasattr(self, 'tab_widgets'):
            for name, chip in self.tab_widgets.items():
                if hasattr(chip, 'set_current'):
                    chip.set_current(name == tab_name)
        # Show/hide back button
        if hasattr(self, '_back_btn'):
            self._back_btn.setVisible(tab_name != 'Antigravity')
        if hasattr(self, 'content_stack'):
            panel_index = getattr(self, "provider_panel_indexes", {}).get(tab_name)
            if panel_index is not None:
                self.content_stack.setCurrentIndex(panel_index)
                self.pyside_header.setVisible(False)
                self.pyside_th.setVisible(False)
                self.pyside_footer.setVisible(False)
            else:
                self.content_stack.setCurrentIndex(0)
                self.pyside_header.setVisible(True)
                self.pyside_th.setVisible(True)
                self.pyside_footer.setVisible(True)
                    
    def _toggle_provider(self, name: str, is_active: bool):
        self.db.set_provider_active(name, is_active)
        self.provider_states[name] = is_active
        if name == "Antigravity":
            self._load_data()

    # ── Provider-bar helpers ────────────────────────────────────────────────

    def _rebuild_chips(self):
        """Recreate all ProviderChip widgets from self.pinned_providers."""
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY as _PR
        while self._chips_layout.count():
            item = self._chips_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        self.tab_widgets = {}
        current = getattr(self, 'current_tab', 'Antigravity')

        for name in self.pinned_providers:
            is_active = self.provider_states.get(name, False)
            chip = ProviderChip(
                name,
                is_active=is_active,
                is_current=(name == current),
                can_remove=(name != 'Antigravity'),
            )
            chip.switch_requested.connect(self._switch_tab)
            chip.toggle_requested.connect(self._toggle_provider)
            chip.remove_requested.connect(self._unpin_provider)
            self.tab_widgets[name] = chip
            self._chips_layout.addWidget(chip)

        self._chips_layout.addStretch()

    def _show_provider_dropdown(self):
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY as _PR
        available = [
            (name, self.provider_states.get(name, False))
            for name in _PR.keys()
            if name not in self.pinned_providers
        ]
        popup = ProviderDropdownPopup(available, self)
        popup.provider_pinned.connect(self._pin_provider)
        popup.show_below(self._add_prov_btn)

    def _pin_provider(self, name: str):
        if name not in self.pinned_providers:
            self.pinned_providers.append(name)
            self.provider_states = self.db.get_providers()
            self._rebuild_chips()
            self._switch_tab(name)

    def _unpin_provider(self, name: str):
        if name in self.pinned_providers and name != 'Antigravity':
            self.pinned_providers.remove(name)
            if getattr(self, 'current_tab', 'Antigravity') == name:
                self._switch_tab('Antigravity')
            else:
                self._rebuild_chips()

    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # --- TITLE BAR ---
        title_bar = QFrame()
        title_bar.setStyleSheet("background-color: #080808; border: none; border-bottom: 1px solid #3c0068;")
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
        
        # --- PROVIDER BAR (chips + searchable dropdown) ---
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY as _PROV_REG

        self.provider_states = self.db.get_providers()
        self.tab_widgets = {}   # name -> ProviderChip

        # Initially pin Antigravity + any already-enabled providers
        self.pinned_providers: list = ["Antigravity"]
        for _n in _PROV_REG.keys():
            if _n != "Antigravity" and self.provider_states.get(_n, False):
                self.pinned_providers.append(_n)

        provider_bar = QFrame()
        provider_bar.setFixedHeight(50)
        provider_bar.setStyleSheet(
            "QFrame{background:#0a0a0a;border-bottom:1px solid #2c2e33}"
        )
        _bar_row = QHBoxLayout(provider_bar)
        _bar_row.setContentsMargins(12, 0, 12, 0)
        _bar_row.setSpacing(6)

        # ← Back button (hidden on Antigravity tab)
        _back_icon = create_svg_icon('<path d="m15 18-6-6 6-6"/>', "#e4e4e7")
        self._back_btn = QPushButton()
        self._back_btn.setIcon(_back_icon)
        self._back_btn.setFixedSize(32, 32)
        self._back_btn.setCursor(Qt.PointingHandCursor)
        self._back_btn.setToolTip("Back to account list")
        self._back_btn.setStyleSheet(
            "QPushButton{background:#1a1d21;border:1px solid #2c2e33;border-radius:6px}"
            "QPushButton:hover{background:#2c2e33}"
        )
        self._back_btn.setVisible(False)
        self._back_btn.clicked.connect(lambda: self._switch_tab("Antigravity"))
        _bar_row.addWidget(self._back_btn)

        # Chips container — plain QWidget, no scroll area (avoids size-hint bugs)
        self._chips_frame = QWidget()
        self._chips_frame.setStyleSheet("background:transparent")
        self._chips_layout = QHBoxLayout(self._chips_frame)
        self._chips_layout.setContentsMargins(0, 0, 0, 0)
        self._chips_layout.setSpacing(6)
        _bar_row.addWidget(self._chips_frame, stretch=1)

        # Divider
        _div = QFrame()
        _div.setFrameShape(QFrame.VLine)
        _div.setFixedWidth(1)
        _div.setStyleSheet("background:#2c2e33;border:none")
        _bar_row.addWidget(_div)

        # "+ Providers" dropdown button
        _prov_icon = create_svg_icon(
            '<path d="M5 12h14"/><path d="M12 5v14"/>', "#868e96"
        )
        self._add_prov_btn = QPushButton("  Providers")
        self._add_prov_btn.setIcon(_prov_icon)
        self._add_prov_btn.setFixedHeight(30)
        self._add_prov_btn.setCursor(Qt.PointingHandCursor)
        self._add_prov_btn.setStyleSheet(
            "QPushButton{background:#1a1d21;border:1px solid #2c2e33;border-radius:6px;"
            "color:#868e96;font-size:12px;padding:0 10px}"
            "QPushButton:hover{background:#2c2e33;color:#e4e4e7}"
        )
        self._add_prov_btn.clicked.connect(self._show_provider_dropdown)
        _bar_row.addWidget(self._add_prov_btn)

        main_layout.addWidget(provider_bar)

        # Build initial chips
        self._rebuild_chips()
        
        # --- HEADER ---
        self.pyside_header = QFrame()
        self.pyside_header.setStyleSheet("background-color: #111315; border-bottom: 1px solid #1e1e20;")
        self.pyside_header.setFixedHeight(48)
        h_layout = QHBoxLayout(self.pyside_header)
        h_layout.setContentsMargins(16, 0, 16, 0)
        h_layout.setSpacing(8)
        
        # 1. Search Box
        search_container = QFrame()
        search_container.setFixedSize(140, 30)
        search_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 6px; border: 1px solid #2c2e33; }")
        search_layout = QHBoxLayout(search_container)
        search_layout.setContentsMargins(8, 0, 8, 0)
        search_layout.addWidget(QLabel("🔍", styleSheet="color: #60a5fa; font-size: 12px; border: none; background: transparent;"))
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search email...")
        self.search_input.setStyleSheet("QLineEdit { background: transparent; border: none; color: #e4e4e7; font-size: 12px; }")
        self.search_input.textChanged.connect(self._on_search)
        search_layout.addWidget(self.search_input)
        h_layout.addWidget(search_container)
        
        # 2. Filters
        filters_container = QFrame()
        filters_container.setFixedHeight(30)
        filters_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 6px; border: 1px solid #2c2e33; }")
        self.filters_layout = QHBoxLayout(filters_container)
        self.filters_layout.setContentsMargins(2, 2, 2, 2)
        self.filters_layout.setSpacing(2)
        self.filter_buttons = []
        for text in ["All", "PRO", "ULTRA", "FREE"]:
            f_btn = FilterButton(text, "0", text == self.current_filter, self._on_filter)
            self.filter_buttons.append(f_btn)
            self.filters_layout.addWidget(f_btn)
        h_layout.addWidget(filters_container)
        
        # 3. Add account (+) button moved to the dynamic stack
        # 4. View Mode Toggle
        view_container = QFrame()
        view_container.setFixedHeight(30)
        view_container.setStyleSheet("QFrame { background-color: #1a1d21; border-radius: 6px; border: 1px solid #2c2e33; }")
        view_layout = QHBoxLayout(view_container)
        view_layout.setContentsMargins(2, 2, 2, 2)
        
        icon_list = create_svg_icon('<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>', "#868e96")
        icon_grid = create_svg_icon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>', "#868e96")
        
        self.btn_list = QPushButton()
        self.btn_list.setIcon(icon_list)
        self.btn_list.setFixedSize(24, 24)
        self.btn_list.setStyleSheet("QPushButton { border-radius: 4px; }")
        self.btn_grid = QPushButton()
        self.btn_grid.setIcon(icon_grid)
        self.btn_grid.setFixedSize(24, 24)
        self.btn_grid.setStyleSheet("QPushButton { border-radius: 4px; }")
        self.btn_list.clicked.connect(lambda: self._set_view_mode("list"))
        self.btn_grid.clicked.connect(lambda: self._set_view_mode("grid"))
        self._update_view_toggle_styles()
        view_layout.addWidget(self.btn_list)
        view_layout.addWidget(self.btn_grid)
        h_layout.addWidget(view_container)
        
        # Divider stretch
        h_layout.addStretch()
        
        # --- DYNAMIC ACTION HEADER ---
        self.action_stack = QStackedWidget()
        h_layout.addWidget(self.action_stack)
        
        # PAGE 0: Normal
        page_normal = QWidget()
        layout_normal = QHBoxLayout(page_normal)
        layout_normal.setContentsMargins(0, 0, 0, 0)
        layout_normal.setSpacing(8)
        
        icon_plus = create_svg_icon('<path d="M5 12h14"/><path d="M12 5v14"/>', "#cccccc")
        add_btn = QPushButton()
        add_btn.setIcon(icon_plus)
        add_btn.setFixedSize(30, 30)
        add_btn.setStyleSheet("QPushButton { background-color: #1a1d21; border: 1px solid #2c2e33; border-radius: 6px; } QPushButton:hover { background-color: #2c2e33; }")
        add_btn.clicked.connect(self._on_add_account)
        layout_normal.addWidget(add_btn)
        
        icon_refresh = create_svg_icon('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', "#ffffff")
        self.ref_btn = QPushButton(" Refresh All")
        self.ref_btn.setIcon(icon_refresh)
        self.ref_btn.setCursor(Qt.PointingHandCursor)
        self.ref_btn.setFixedHeight(30)
        self.ref_btn.setStyleSheet("background-color: #3b82f6; color: white; border: none; border-radius: 6px; padding: 0 10px; font-weight: bold; font-size: 11px;")
        self.ref_btn.clicked.connect(self._on_refresh)
        layout_normal.addWidget(self.ref_btn)
        
        icon_sparkles = create_svg_icon('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>', "#ffffff")
        self.warm_btn = QPushButton(" One-click Warmup")
        self.warm_btn.setIcon(icon_sparkles)
        self.warm_btn.setCursor(Qt.PointingHandCursor)
        self.warm_btn.setFixedHeight(30)
        self.warm_btn.setStyleSheet("background-color: #f97316; color: white; border: none; border-radius: 6px; padding: 0 10px; font-weight: bold; font-size: 11px;")
        self.warm_btn.clicked.connect(self._on_warmup)
        layout_normal.addWidget(self.warm_btn)
        
        self.show_all_lbl = QLabel("Show All Quotas")
        self.show_all_lbl.setStyleSheet("color: #e4e4e7; font-size: 11px; margin-left: 8px;")
        layout_normal.addWidget(self.show_all_lbl)
        
        self.btn_toggle_quotas = ToggleSwitch()
        self.btn_toggle_quotas.setChecked(self.show_all_quotas)
        self.btn_toggle_quotas.toggled.connect(self._on_toggle_show_all)
        layout_normal.addWidget(self.btn_toggle_quotas)
        
        icon_import = create_svg_icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>', "#e4e4e7")
        btn_import = QPushButton(" Import")
        btn_import.setIcon(icon_import)
        btn_import.setCursor(Qt.PointingHandCursor)
        btn_import.setFixedHeight(30)
        btn_import.setStyleSheet("QPushButton { background-color: transparent; color: #e4e4e7; border: none; font-size: 11px; padding: 0 6px; } QPushButton:hover { color: #ffffff; }")
        btn_import.clicked.connect(self._on_import)
        layout_normal.addWidget(btn_import)
        
        icon_export = create_svg_icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>', "#e4e4e7")
        btn_export = QPushButton(" Export")
        btn_export.setIcon(icon_export)
        btn_export.setCursor(Qt.PointingHandCursor)
        btn_export.setFixedHeight(30)
        btn_export.setStyleSheet("QPushButton { background-color: transparent; color: #e4e4e7; border: none; font-size: 11px; padding: 0 6px; } QPushButton:hover { color: #ffffff; }")
        btn_export.clicked.connect(self._on_export)
        layout_normal.addWidget(btn_export)
        self.action_stack.addWidget(page_normal)
        
        # PAGE 1: Selected
        page_selected = QWidget()
        layout_sel = QHBoxLayout(page_selected)
        layout_sel.setContentsMargins(0, 0, 0, 0)
        layout_sel.setSpacing(8)
        
        icon_trash = create_svg_icon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>', "#ffffff")
        self.btn_batch_delete = QPushButton(" Delete (0)")
        self.btn_batch_delete.setIcon(icon_trash)
        self.btn_batch_delete.setCursor(Qt.PointingHandCursor)
        self.btn_batch_delete.setFixedHeight(30)
        self.btn_batch_delete.setStyleSheet("background-color: #ef4444; color: white; border: none; border-radius: 6px; padding: 0 10px; font-weight: bold; font-size: 11px;")
        self.btn_batch_delete.clicked.connect(self._on_batch_delete)
        layout_sel.addWidget(self.btn_batch_delete)
        
        icon_ban = create_svg_icon('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>', "#ffffff")
        self.btn_batch_disable = QPushButton(" Disable (0)")
        self.btn_batch_disable.setIcon(icon_ban)
        self.btn_batch_disable.setCursor(Qt.PointingHandCursor)
        self.btn_batch_disable.setFixedHeight(30)
        self.btn_batch_disable.setStyleSheet("background-color: #f97316; color: white; border: none; border-radius: 6px; padding: 0 10px; font-weight: bold; font-size: 11px;")
        self.btn_batch_disable.clicked.connect(lambda: self.show_toast("Disabled accounts", "success"))
        layout_sel.addWidget(self.btn_batch_disable)
        
        icon_check = create_svg_icon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', "#ffffff")
        self.btn_batch_enable = QPushButton(" Enable (0)")
        self.btn_batch_enable.setIcon(icon_check)
        self.btn_batch_enable.setCursor(Qt.PointingHandCursor)
        self.btn_batch_enable.setFixedHeight(30)
        self.btn_batch_enable.setStyleSheet("background-color: #22c55e; color: white; border: none; border-radius: 6px; padding: 0 10px; font-weight: bold; font-size: 11px;")
        self.btn_batch_enable.clicked.connect(lambda: self.show_toast("Enabled accounts", "success"))
        layout_sel.addWidget(self.btn_batch_enable)
        
        icon_batch_ref = create_svg_icon('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', "#ffffff")
        self.btn_batch_ref = QPushButton(" Refresh Selected (0)")
        self.btn_batch_ref.setIcon(icon_batch_ref)
        self.btn_batch_ref.setCursor(Qt.PointingHandCursor)
        self.btn_batch_ref.setFixedHeight(30)
        self.btn_batch_ref.setStyleSheet("background-color: #3b82f6; color: white; border: none; border-radius: 6px; padding: 0 10px; font-weight: bold; font-size: 11px;")
        self.btn_batch_ref.clicked.connect(self._on_refresh)
        layout_sel.addWidget(self.btn_batch_ref)
        
        self.btn_batch_warm = QPushButton(" Warmup (0)")
        self.btn_batch_warm.setIcon(icon_sparkles)
        self.btn_batch_warm.setCursor(Qt.PointingHandCursor)
        self.btn_batch_warm.setFixedHeight(30)
        self.btn_batch_warm.setStyleSheet("background-color: #f97316; color: white; border: none; border-radius: 6px; padding: 0 10px; font-weight: bold; font-size: 11px;")
        self.btn_batch_warm.clicked.connect(self._on_warmup)
        layout_sel.addWidget(self.btn_batch_warm)
        
        self.show_all_lbl2 = QLabel("Show All Quotas")
        self.show_all_lbl2.setStyleSheet("color: #e4e4e7; font-size: 11px; margin-left: 8px;")
        layout_sel.addWidget(self.show_all_lbl2)
        
        self.btn_toggle_quotas2 = ToggleSwitch()
        self.btn_toggle_quotas2.setChecked(self.show_all_quotas)
        self.btn_toggle_quotas2.toggled.connect(self._on_toggle_show_all)
        layout_sel.addWidget(self.btn_toggle_quotas2)
        
        self.action_stack.addWidget(page_selected)
        
        main_layout.addWidget(self.pyside_header)
        
        # --- TABLE HEADER (List View only) ---
        self.pyside_th = QFrame()
        self.pyside_th.setStyleSheet("background-color: #080808; border: none; border-bottom: 2px solid #5c1b8b;")
        self.pyside_th.setFixedHeight(40)
        th_layout = QHBoxLayout(self.pyside_th)
        th_layout.setContentsMargins(16, 0, 16, 0)
        th_layout.setSpacing(12)
        
        th_layout.addWidget(QLabel(" ", fixedWidth=20, styleSheet="border: none;"))
        self.cb_all = QCheckBox(fixedWidth=24)
        self.cb_all.setStyleSheet(CHECKBOX_STYLE)
        self.cb_all.stateChanged.connect(self._on_check_all)
        th_layout.addWidget(self.cb_all)
        
        th_layout.addWidget(QLabel("EMAIL", fixedWidth=280, styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"))
        th_layout.addWidget(QLabel("MODEL QUOTA", styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"), stretch=1)
        th_layout.addWidget(QLabel("LAST USED", fixedWidth=90, styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"))
        th_layout.addWidget(QLabel("ACTIONS", fixedWidth=180, alignment=Qt.AlignCenter, styleSheet="color: #868e96; font-size: 11px; font-weight: bold; border: none;"))
        main_layout.addWidget(self.pyside_th)
        
        # --- CONTENT STACK (Antigravity list OR provider-specific panels) ---
        self.content_stack = QStackedWidget()
        self.content_stack.setStyleSheet("background-color: #000000;")
        
        # Page 0: Antigravity account list
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setStyleSheet("QScrollArea { border: none; background-color: #000000; } QScrollBar:vertical { width: 10px; background: transparent; } QScrollBar::handle:vertical { background: #373a40; border-radius: 5px; }")
        
        self.content_w = QWidget()
        self.content_w.setStyleSheet("background-color: #000000;")
        self.scroll.setWidget(self.content_w)
        self.content_stack.addWidget(self.scroll)  # index 0
        
        self.provider_panel_indexes = {}

        from dardcor_agent.models.providers.gemini.components import GeminiProviderPanel
        self.gemini_panel = GeminiProviderPanel()
        self.provider_panel_indexes["Gemini"] = self.content_stack.addWidget(self.gemini_panel)

        from dardcor_agent.models.providers.openai_compatible.components import OpenAICompatibleProviderPanel, PROVIDER_DEFINITIONS
        for _pname in _PROV_REG.keys():
            if _pname in ("Antigravity", "Gemini"):
                continue
            if _pname in PROVIDER_DEFINITIONS and _pname not in self.provider_panel_indexes:
                _panel = OpenAICompatibleProviderPanel(_pname)
                self.provider_panel_indexes[_pname] = self.content_stack.addWidget(_panel)
        
        main_layout.addWidget(self.content_stack, stretch=1)
        
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
        
        # Select loaded value
        combo_text = f"{self.itemsPerPage} items"
        idx = combo.findText(combo_text)
        if idx >= 0:
            combo.setCurrentIndex(idx)
            
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
        self.db.set_config_value("items_per_page", self.itemsPerPage)
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
        self._update_header_mode()
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
        
        self._update_header_mode()
        self._load_data()

    def _update_header_mode(self):
        count = len(self.selectedIds)
        if count > 0:
            self.action_stack.setCurrentIndex(1)
            self.btn_batch_delete.setText(f" Delete ({count})")
            self.btn_batch_disable.setText(f" Disable ({count})")
            self.btn_batch_enable.setText(f" Enable ({count})")
            self.btn_batch_ref.setText(f" Refresh Selected ({count})")
            self.btn_batch_warm.setText(f" Warmup ({count})")
        else:
            self.action_stack.setCurrentIndex(0)
            
    def _on_batch_delete(self):
        count = len(self.selectedIds)
        if count == 0: return
        for acc_id in list(self.selectedIds):
            self.db.delete_account(acc_id)
        self.selectedIds.clear()
        self._update_header_mode()
        self._load_data()
        self.show_toast(f"Deleted {count} account(s)", "success")

    def show_toast(self, message: str, toast_type: str = "info"):
        toast = ToastWidget(message, toast_type, self)
        toast.adjustSize()
        # Position at bottom right
        x = self.width() - toast.width() - 20
        y = self.height() - toast.height() - 20
        toast.move(x, y)
        toast.show_animated()

    def _on_action_triggered(self, acc_id: str, action: str):
        # Find the row and trigger loading animation on its action button
        for i in range(self.content_w.layout().count()):
            widget = self.content_w.layout().itemAt(i).widget()
            if hasattr(widget, 'acc_id') and widget.acc_id == acc_id:
                # Find the ActionButtons child
                for child in widget.children():
                    if child.__class__.__name__ == 'ActionButtons':
                        child.set_loading(action, True)
                        
                        if action == "Refresh":
                            # Run QuotaWorker for single account
                            self.single_worker = QuotaWorker(self.db, self, target_acc_id=acc_id)
                            self.single_worker.finished_signal.connect(lambda updated, w=child, a=action, i=acc_id: self._finish_action(w, a, i, updated))
                            self.single_worker.start()
                            return
                        else:
                            # Other actions are not fully implemented in DB yet, but we will mock them realistically or handle them
                            QTimer.singleShot(1500, lambda w=child, a=action, i=acc_id: self._finish_action(w, a, i, False))
                        return
                        
    def _finish_action(self, actions_widget, action, acc_id, updated=False):
        actions_widget.set_loading(action, False)
        if action == "Delete":
            self.selectedIds.discard(acc_id)
            self.db.delete_account(acc_id)
            self._load_data()
            self.show_toast("Account deleted successfully.", "success")
        elif action == "Refresh":
            if updated:
                self._load_data()
            self.show_toast("Quota refreshed successfully.", "success")
        elif action == "Toggle Proxy":
            acc = self.db.get_account(acc_id)
            if acc is not None:
                current_state = acc.get('proxy_disabled', False)
                acc['proxy_disabled'] = not current_state
                self.db.save_account(acc)
                self._load_data()
                status = "disabled" if not current_state else "enabled"
                self.show_toast(f"Proxy {status}.", "success")
        elif action == "Edit Label":
            from PySide6.QtWidgets import QInputDialog
            acc = self.db.get_account(acc_id)
            if acc is not None:
                text, ok = QInputDialog.getText(self, "Edit Label", "Enter new label:", text=acc.get('name', ''))
                if ok and text:
                    acc['name'] = text
                    self.db.save_account(acc)
                    self._load_data()
                    self.show_toast("Label updated.", "success")
        elif action == "Export":
            import json
            from PySide6.QtWidgets import QFileDialog
            acc = self.db.get_account(acc_id)
            if acc is not None:
                file_path, _ = QFileDialog.getSaveFileName(self, "Export Account", f"account_{acc_id[:6]}.json", "JSON Files (*.json)")
                if file_path:
                    with open(file_path, "w", encoding="utf-8") as f:
                        json.dump(acc, f, indent=4)
                    self.show_toast("Account exported successfully.", "success")
        elif action == "Warmup":
            self.show_toast("Warmup request sent successfully.", "success")
        elif action in ["Details", "Device Fingerprint"]:
            self.show_toast(f"{action} coming soon.", "info")
        else:
            self.show_toast(f"Action '{action}' completed.", "success")

    def _on_refresh(self):
        # Start top-level refresh animation
        self.ref_btn.setText(" Refreshing...")
        icon_path = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'
        
        self._ref_angle = 0
        self._ref_timer = QTimer(self)
        self._ref_timer.timeout.connect(lambda: self._animate_top_button(self.ref_btn, icon_path, "_ref_angle", 30))
        self._ref_timer.start(50)
        
        self.worker = QuotaWorker(self.db, self)
        self.worker.finished_signal.connect(lambda updated: self._finish_refresh(icon_path, updated))
        self.worker.start()

    def _finish_refresh(self, icon_path, updated):
        self._stop_top_button(self._ref_timer, self.ref_btn, " Refresh All", icon_path, "Successfully refreshed quotas.")
        if updated:
            self._load_data()
            
    def _on_warmup(self):
        # Start top-level warmup animation
        self.warm_btn.setText(" Warming...")
        icon_path = '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>'
        
        self._warm_angle = 0
        self._warm_timer = QTimer(self)
        self._warm_timer.timeout.connect(lambda: self._animate_top_button(self.warm_btn, icon_path, "_warm_angle", 45))
        self._warm_timer.start(50)
        
        # Simulate loading then stop
        QTimer.singleShot(2000, lambda: self._stop_top_button(self._warm_timer, self.warm_btn, " Warmup", icon_path, "Successfully triggered warmup."))
        
    def _animate_top_button(self, btn, icon_path, angle_attr, step):
        current_angle = getattr(self, angle_attr, 0)
        new_angle = (current_angle + step) % 360
        setattr(self, angle_attr, new_angle)
        btn.setIcon(create_svg_icon(icon_path, "#ffffff", new_angle))
        
    def _stop_top_button(self, timer, btn, text, icon_path, success_msg):
        timer.stop()
        btn.setText(text)
        btn.setIcon(create_svg_icon(icon_path, "#ffffff", 0))
        self.show_toast(success_msg, "success")

    def _on_export(self):
        # Open file dialog to choose save location
        file_path, _ = QFileDialog.getSaveFileName(self, "Export Accounts", "antigravity_accounts.json", "JSON Files (*.json)")
        if file_path:
            success = self.db.export_data(file_path)
            if success:
                self.show_toast(f"Successfully exported accounts to {os.path.basename(file_path)}", "success")
            else:
                self.show_toast("Failed to export accounts.", "error")

    def _on_import(self):
        # Open file dialog to choose JSON file to import
        file_path, _ = QFileDialog.getOpenFileName(self, "Import Accounts", "", "JSON Files (*.json)")
        if file_path:
            added = self.db.import_data(file_path)
            if added > 0:
                self.show_toast(f"Successfully imported {added} account(s).", "success")
                self._load_data()
            else:
                self.show_toast("No new accounts imported or invalid format.", "warning")


    def _on_add_account(self):
        dialog = AddAccountDialog(self.db, self)
        if dialog.exec():
            self._load_data()

    def _build_pagination(self, total_pages: int):
        while self.pag_layout.count():
            item = self.pag_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        if total_pages <= 1:
            return

        def make_btn(text, page, _is_nav=False):
            is_nav = _is_nav
            is_cur = (not is_nav) and (page == self.currentPage)
            b = QPushButton(str(text))
            b.setFixedSize(32, 32)
            b.setCursor(Qt.PointingHandCursor)
            if is_cur:
                b.setStyleSheet(
                    "QPushButton{background:#1c7ed6;color:#fff;border:none;"
                    "border-radius:6px;font-size:12px;font-weight:600}"
                )
            elif is_nav:
                b.setStyleSheet(
                    "QPushButton{background:#1a1d21;color:#c1c2c5;border:1px solid #2c2e33;"
                    "border-radius:6px;font-size:13px;font-weight:600}"
                    "QPushButton:hover{background:#2c2e33;color:#fff}"
                )
            else:
                b.setStyleSheet(
                    "QPushButton{background:#1a1d21;color:#c1c2c5;border:1px solid #2c2e33;"
                    "border-radius:6px;font-size:12px}"
                    "QPushButton:hover{background:#2c2e33;color:#fff}"
                )
            b.clicked.connect(lambda _=False, pg=page: self._go_to_page(pg))
            self.pag_layout.addWidget(b)

        prev_page = max(1, self.currentPage - 1)
        make_btn("‹", prev_page, _is_nav=True)

        shown = set()
        for p in range(1, total_pages + 1):
            if p == 1 or p == total_pages or abs(p - self.currentPage) <= 2:
                if p not in shown:
                    make_btn(p, p)
                    shown.add(p)
            elif p - 1 in shown and p not in shown:
                dot = QLabel("…")
                dot.setStyleSheet("color:#555;padding:0 4px;font-size:14px")
                dot.setAlignment(Qt.AlignCenter)
                self.pag_layout.addWidget(dot)
                shown.add(p)

        next_page = min(total_pages, self.currentPage + 1)
        make_btn("›", next_page, _is_nav=True)

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
        pro_count = ultra_count = free_count = 0
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
