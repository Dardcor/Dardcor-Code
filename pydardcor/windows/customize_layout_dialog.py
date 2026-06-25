"""Customize Layout Dialog — VS Code style floating popup."""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QSizePolicy, QApplication
)
from PySide6.QtCore import Qt, QPoint, Signal
from PySide6.QtGui import QPainter, QColor, QBrush, QPen, QPainterPath, QFont


# ── Small toggle button that draws an icon ──────────────────────────────────

class PanelToggleButton(QPushButton):
    """A toggle button with a panel icon for Customize Layout popup."""

    ICONS = {
        "activity_bar":     "Activity Bar",
        "primary_sidebar":  "Primary Side Bar",
        "secondary_sidebar":"Secondary Side Bar",
        "panel":            "Panel",
        "status_bar":       "Status Bar",
        "menu_bar":         "Menu Bar",
    }

    def __init__(self, panel_id: str, main_window, parent=None):
        super().__init__(parent)
        self.panel_id = panel_id
        self.mw = main_window
        self.setCheckable(True)
        self.setFixedHeight(28)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.setCursor(Qt.PointingHandCursor)
        self._update_style()
        self.clicked.connect(self._on_toggle)

    def _update_style(self):
        checked = self.isChecked()
        self.setStyleSheet(f"""
            QPushButton {{
                background-color: {"#2c2c2c" if not checked else "rgba(74,0,114,0.5)"};
                color: {"#858585" if not checked else "#cccccc"};
                border: 1px solid {"#3c3c3c" if not checked else "#4a0072"};
                border-radius: 4px;
                font-size: 12px;
                font-family: 'Segoe UI', sans-serif;
                padding: 0 10px;
                text-align: center;
            }}
            QPushButton:hover {{
                background-color: {"#3c3c3c" if not checked else "rgba(90,0,156,0.6)"};
                color: #cccccc;
            }}
        """)

    def setChecked(self, v: bool):
        super().setChecked(v)
        self._update_style()

    def _on_toggle(self):
        """Delegate the actual toggle to MainWindow."""
        self._update_style()
        mw = self.mw
        pid = self.panel_id
        if pid == "activity_bar":
            mw._toggle_activity_bar_force(self.isChecked())
        elif pid == "primary_sidebar":
            mw._toggle_primary_sidebar_force(self.isChecked())
        elif pid == "secondary_sidebar":
            mw._toggle_secondary_sidebar_force(self.isChecked())
        elif pid == "panel":
            mw._toggle_panel_force(self.isChecked())
        elif pid == "status_bar":
            mw._toggle_status_bar_force(self.isChecked())
        elif pid == "menu_bar":
            mw._toggle_menu_bar_force(self.isChecked())


# ── Customize Layout Popup ───────────────────────────────────────────────────

class CustomizeLayoutPopup(QWidget):
    """Floating popup shown when clicking the Customize Layout button in title bar."""

    def __init__(self, main_window, parent=None):
        super().__init__(parent, Qt.Popup | Qt.FramelessWindowHint | Qt.NoDropShadowWindowHint)
        self.mw = main_window
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setMinimumWidth(260)
        self._build_ui()

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Container card
        self._card = QFrame()
        self._card.setObjectName("CustomizeCard")
        self._card.setStyleSheet("""
            QFrame#CustomizeCard {
                background-color: #1f1f1f;
                border: 1px solid #3c0068;
                border-radius: 8px;
            }
        """)
        card_layout = QVBoxLayout(self._card)
        card_layout.setContentsMargins(0, 0, 0, 0)
        card_layout.setSpacing(0)

        # ── Header ──────────────────────────────────────────
        header = QWidget()
        header.setFixedHeight(36)
        header.setStyleSheet("background: transparent;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(14, 0, 14, 0)

        lbl = QLabel("Customize Layout")
        lbl.setStyleSheet("color: #cccccc; font-size: 12px; font-weight: 600;")
        h_lay.addWidget(lbl)
        h_lay.addStretch()

        close_btn = QPushButton("✕")
        close_btn.setFixedSize(20, 20)
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #858585;
                font-size: 11px;
            }
            QPushButton:hover { color: #ffffff; }
        """)
        close_btn.clicked.connect(self.close)
        h_lay.addWidget(close_btn)
        card_layout.addWidget(header)

        # Separator
        sep = QFrame()
        sep.setFixedHeight(1)
        sep.setStyleSheet("background-color: #3c0068;")
        card_layout.addWidget(sep)

        # ── Content ─────────────────────────────────────────
        content = QWidget()
        content.setStyleSheet("background: transparent;")
        c_lay = QVBoxLayout(content)
        c_lay.setContentsMargins(14, 12, 14, 14)
        c_lay.setSpacing(6)

        # Primary Side Bar Position
        c_lay.addWidget(self._section_label("Primary Side Bar Position"))
        pos_row = QWidget()
        pos_row.setStyleSheet("background: transparent;")
        pos_layout = QHBoxLayout(pos_row)
        pos_layout.setContentsMargins(0, 0, 0, 0)
        pos_layout.setSpacing(6)

        self.btn_sidebar_left = self._pos_button("Left", "left")
        self.btn_sidebar_right = self._pos_button("Right", "right")
        pos_layout.addWidget(self.btn_sidebar_left)
        pos_layout.addWidget(self.btn_sidebar_right)
        c_lay.addWidget(pos_row)

        # Panel Position
        c_lay.addWidget(self._section_label("Panel Position"))
        panel_pos_row = QWidget()
        panel_pos_row.setStyleSheet("background: transparent;")
        pp_layout = QHBoxLayout(panel_pos_row)
        pp_layout.setContentsMargins(0, 0, 0, 0)
        pp_layout.setSpacing(6)
        self.btn_panel_bottom = self._pos_button("Bottom", "panel_bottom")
        self.btn_panel_left   = self._pos_button("Left",   "panel_left")
        self.btn_panel_right  = self._pos_button("Right",  "panel_right")
        self.btn_panel_top    = self._pos_button("Top",    "panel_top")
        pp_layout.addWidget(self.btn_panel_bottom)
        pp_layout.addWidget(self.btn_panel_left)
        pp_layout.addWidget(self.btn_panel_right)
        pp_layout.addWidget(self.btn_panel_top)
        c_lay.addWidget(panel_pos_row)

        # Separator
        sep2 = QFrame()
        sep2.setFixedHeight(1)
        sep2.setStyleSheet("background-color: #2a2a2a;")
        c_lay.addWidget(sep2)

        # Visibility toggles
        c_lay.addWidget(self._section_label("Visibility"))

        toggle_data = [
            ("activity_bar",      "Activity Bar"),
            ("primary_sidebar",   "Primary Side Bar"),
            ("secondary_sidebar", "Secondary Side Bar"),
            ("panel",             "Panel"),
            ("status_bar",        "Status Bar"),
            ("menu_bar",          "Menu Bar"),
        ]

        self._toggle_btns = {}
        for panel_id, label in toggle_data:
            row = self._toggle_row(panel_id, label)
            c_lay.addWidget(row)

        card_layout.addWidget(content)
        root.addWidget(self._card)

    def _section_label(self, text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setStyleSheet("color: #858585; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; margin-top: 4px;")
        lbl.setContentsMargins(0, 4, 0, 2)
        return lbl

    def _pos_button(self, label: str, pos_id: str) -> QPushButton:
        btn = QPushButton(label)
        btn.setCheckable(True)
        btn.setFixedHeight(24)
        btn.setCursor(Qt.PointingHandCursor)
        btn.setProperty("pos_id", pos_id)
        btn._pos_id = pos_id
        btn.setStyleSheet("""
            QPushButton {
                background-color: #2c2c2c;
                color: #858585;
                border: 1px solid #3c3c3c;
                border-radius: 3px;
                font-size: 11px;
                padding: 0 8px;
            }
            QPushButton:checked {
                background-color: rgba(74,0,114,0.5);
                color: #cccccc;
                border: 1px solid #4a0072;
            }
            QPushButton:hover:!checked { color: #cccccc; background-color: #3c3c3c; }
        """)
        btn.clicked.connect(lambda: self._on_pos_clicked(btn))
        return btn

    def _on_pos_clicked(self, clicked_btn):
        pos_id = clicked_btn._pos_id
        # Sidebar position
        if pos_id in ("left", "right"):
            for b in [self.btn_sidebar_left, self.btn_sidebar_right]:
                b.setChecked(b is clicked_btn)
            self.mw._set_primary_sidebar_position(pos_id)
        # Panel position
        elif pos_id in ("panel_bottom", "panel_left", "panel_right", "panel_top"):
            for b in [self.btn_panel_bottom, self.btn_panel_left,
                      self.btn_panel_right, self.btn_panel_top]:
                b.setChecked(b is clicked_btn)
            self.mw._set_panel_position(pos_id)

    def _toggle_row(self, panel_id: str, label: str) -> QWidget:
        row = QWidget()
        row.setStyleSheet("background: transparent;")
        lay = QHBoxLayout(row)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(8)

        lbl = QLabel(label)
        lbl.setStyleSheet("color: #cccccc; font-size: 12px;")
        lay.addWidget(lbl, 1)

        btn = _TogglePill(panel_id, self.mw)
        self._toggle_btns[panel_id] = btn
        lay.addWidget(btn, 0)
        return row

    def refresh_state(self):
        """Read current visibility state from MainWindow and update buttons."""
        mw = self.mw

        # Sidebar position
        pos = getattr(mw, '_primary_sidebar_position', 'left')
        self.btn_sidebar_left.setChecked(pos == 'left')
        self.btn_sidebar_right.setChecked(pos == 'right')

        # Panel position
        pp = getattr(mw, '_panel_position', 'panel_bottom')
        self.btn_panel_bottom.setChecked(pp == 'panel_bottom')
        self.btn_panel_left.setChecked(pp == 'panel_left')
        self.btn_panel_right.setChecked(pp == 'panel_right')
        self.btn_panel_top.setChecked(pp == 'panel_top')

        # Visibility
        checks = {
            "activity_bar":      mw._activity_bar.isVisible(),
            "primary_sidebar":   mw._sidebar_stack.isVisible(),
            "secondary_sidebar": mw._chat_panel.isVisible(),
            "panel":             mw._bottom_panel.isVisible(),
            "status_bar":        mw._status_bar.isVisible(),
            "menu_bar":          mw._title_bar.menu_bar.isVisible(),
        }
        for pid, vis in checks.items():
            if pid in self._toggle_btns:
                self._toggle_btns[pid].setChecked(vis)

    def show_at(self, global_pos: QPoint):
        self.refresh_state()
        self.adjustSize()
        # Position it just below the button
        x = global_pos.x() - self.width() + 30
        y = global_pos.y() + 5
        # Keep within screen
        screen = QApplication.primaryScreen().availableGeometry()
        if x + self.width() > screen.right():
            x = screen.right() - self.width() - 4
        if x < screen.left():
            x = screen.left() + 4
        self.move(x, y)
        self.show()
        self.raise_()

    def paintEvent(self, event):
        # Transparent outer widget — card does its own painting
        super().paintEvent(event)


# ── Pill Toggle ──────────────────────────────────────────────────────────────

class _TogglePill(QWidget):
    """A pill-shaped on/off toggle like VS Code's Customize Layout checkboxes."""

    def __init__(self, panel_id: str, main_window, parent=None):
        super().__init__(parent)
        self.panel_id = panel_id
        self.mw = main_window
        self._checked = True
        self.setFixedSize(36, 20)
        self.setCursor(Qt.PointingHandCursor)

    def isChecked(self) -> bool:
        return self._checked

    def setChecked(self, v: bool):
        self._checked = v
        self.update()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._checked = not self._checked
            self.update()
            self._dispatch()

    def _dispatch(self):
        mw = self.mw
        pid = self.panel_id
        show = self._checked
        if pid == "activity_bar":
            mw._toggle_activity_bar_force(show)
        elif pid == "primary_sidebar":
            mw._toggle_primary_sidebar_force(show)
        elif pid == "secondary_sidebar":
            mw._toggle_secondary_sidebar_force(show)
        elif pid == "panel":
            mw._toggle_panel_force(show)
        elif pid == "status_bar":
            mw._toggle_status_bar_force(show)
        elif pid == "menu_bar":
            mw._toggle_menu_bar_force(show)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        w, h = self.width(), self.height()
        r = h / 2

        # Track background
        track_color = QColor("#4a0072") if self._checked else QColor("#3c3c3c")
        painter.setBrush(QBrush(track_color))
        painter.setPen(Qt.NoPen)
        track_path = QPainterPath()
        track_path.addRoundedRect(0, 0, w, h, r, r)
        painter.drawPath(track_path)

        # Knob
        knob_x = (w - h + 4) if self._checked else 4
        knob_y = 4
        knob_size = h - 8
        painter.setBrush(QBrush(QColor("#ffffff")))
        painter.drawEllipse(int(knob_x), int(knob_y), int(knob_size), int(knob_size))
        painter.end()
