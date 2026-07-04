"""Status Bar - VS Code exact replica status bar."""

from PySide6.QtWidgets import QWidget, QHBoxLayout, QLabel, QPushButton, QStatusBar
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QColor, QPainter, QPen


class StatusBarButton(QPushButton):
    """Clickable status bar item with perfectly aligned icon and text."""

    def __init__(self, text="", parent=None):
        super().__init__("", parent)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                padding: 0px;
                margin: 0px;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.12);
            }
        """)

        # Internal layout to align icon and text perfectly
        self._layout = QHBoxLayout(self)
        self._layout.setContentsMargins(6, 0, 6, 0)
        self._layout.setSpacing(4)
        self._layout.setAlignment(Qt.AlignCenter)

        self.icon_label = QLabel()
        self.icon_label.setStyleSheet("color: #ffffff; background: transparent; border: none; font-size: 12px; font-family: 'codicon';")
        self.icon_label.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        self.icon_label.setFixedWidth(14)
        self.icon_label.setAlignment(Qt.AlignCenter)

        self.text_label = QLabel()
        # Add 'codicon' to fallback font-family to avoid DirectWrite fallback failure to raster font '8514oem'
        self.text_label.setStyleSheet("color: #ffffff; background: transparent; border: none; font-size: 12px; font-family: 'Inter', 'Segoe UI', 'Ubuntu', 'codicon', sans-serif;")
        self.text_label.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        self.text_label.setAlignment(Qt.AlignCenter)

        self._layout.addWidget(self.icon_label)
        self._layout.addWidget(self.text_label)

        if text:
            self.setText(text)

    def sizeHint(self):
        margins = self._layout.contentsMargins()
        width = margins.left() + margins.right()
        height = margins.top() + margins.bottom()

        visible_widgets = []
        if self.icon_label.isVisible() and self.icon_label.text():
            visible_widgets.append(self.icon_label)
        if self.text_label.isVisible() and self.text_label.text():
            visible_widgets.append(self.text_label)

        for i, widget in enumerate(visible_widgets):
            sh = widget.sizeHint()
            width += sh.width()
            height = max(height, sh.height() + margins.top() + margins.bottom())
            if i > 0:
                width += self._layout.spacing()

        return QSize(width, max(22, height))

    def minimumSizeHint(self):
        return self.sizeHint()

    def setText(self, text):
        if not text:
            self.icon_label.setText("")
            self.text_label.setText("")
            self.icon_label.hide()
            self.text_label.hide()
            self.updateGeometry()
            return

        first_char = text[0]
        # Check if the first character belongs to Unicode private use area E000-F8FF (icon font)
        if 0xE000 <= ord(first_char) <= 0xF8FF:
            self.icon_label.setText(first_char)
            self.icon_label.show()
            rest = text[1:].strip()
            if rest:
                self.text_label.setText(rest)
                self.text_label.show()
            else:
                self.text_label.hide()
        else:
            self.icon_label.hide()
            self.text_label.setText(text)
            self.text_label.show()
        self.updateGeometry()


class StatusBar(QStatusBar):
    """VS Code style status bar at the bottom of the window."""

    command_palette_requested = Signal()
    go_to_line_requested = Signal()
    models_requested = Signal()
    git_branch_requested = Signal()
    problems_requested = Signal()
    ext_status_clicked = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("statusBar")
        self.setFixedHeight(22)
        self.setStyleSheet("""
            #statusBar {
                background-color: #000000;
                min-height: 22px;
                max-height: 22px;
                border-top: 1px solid #3c0068;
            }
        """)
        self._ext_status_items: dict = {}
        self._setup_ui()

    def _setup_ui(self):
        # Remove default margins and spacing
        self.setContentsMargins(0, 0, 0, 0)

        self.setSizeGripEnabled(True)

        # LEFT SIDE (addWidget = left-aligned)
        self._remote_btn = StatusBarButton()
        self._remote_btn.hide()
        self.addWidget(self._remote_btn)

        self._git_btn = StatusBarButton("\uea68 main")
        self._git_btn.setToolTip("Git Branch")
        self._git_btn.clicked.connect(self.git_branch_requested.emit)
        self.addWidget(self._git_btn)

        self._sync_btn = StatusBarButton("\uea77")
        self._sync_btn.setToolTip("Synchronize Changes")
        self._sync_btn.setFixedWidth(24)
        self.addWidget(self._sync_btn)

        self._errors_btn = StatusBarButton("\uea87 0  \uea6c 0")
        self._errors_btn.setToolTip("No Problems")
        self._errors_btn.clicked.connect(self.problems_requested.emit)
        self.addWidget(self._errors_btn)

        # RIGHT SIDE (addPermanentWidget = right-aligned)
        self._cursor_btn = StatusBarButton("Ln 1, Col 1")
        self._cursor_btn.setToolTip("Go to Line/Column")
        self._cursor_btn.clicked.connect(self.go_to_line_requested.emit)
        self.addPermanentWidget(self._cursor_btn)

        self._indent_btn = StatusBarButton("Spaces: 4")
        self._indent_btn.setToolTip("Select Indentation")
        self._indent_btn.clicked.connect(self.command_palette_requested.emit)
        self.addPermanentWidget(self._indent_btn)

        self._encoding_btn = StatusBarButton("UTF-8")
        self._encoding_btn.setToolTip("Select Encoding")
        self._encoding_btn.clicked.connect(self.command_palette_requested.emit)
        self.addPermanentWidget(self._encoding_btn)

        self._eol_btn = StatusBarButton("CRLF")
        self._eol_btn.setToolTip("Select End of Line Sequence")
        self._eol_btn.clicked.connect(self.command_palette_requested.emit)
        self.addPermanentWidget(self._eol_btn)

        self._lang_btn = StatusBarButton("Plain Text")
        self._lang_btn.setToolTip("Select Language Mode")
        self._lang_btn.clicked.connect(self.command_palette_requested.emit)
        self.addPermanentWidget(self._lang_btn)

        self._models_btn = StatusBarButton("\ueb66 Models")
        self._models_btn.setToolTip("View Model Quotas")
        self._models_btn.clicked.connect(self.models_requested.emit)
        self.addPermanentWidget(self._models_btn)

        self._ext_status_container = QWidget()
        self._ext_status_layout = QHBoxLayout(self._ext_status_container)
        self._ext_status_layout.setContentsMargins(0, 0, 0, 0)
        self._ext_status_layout.setSpacing(0)
        self._ext_status_container.setStyleSheet("background: transparent;")
        self._ext_status_container.hide()
        self.addPermanentWidget(self._ext_status_container)

        self._ai_btn = StatusBarButton("\ueab2 Dardcor - Settings")
        self._ai_btn.setToolTip("Dardcor Settings")
        self.addPermanentWidget(self._ai_btn)

        self._notif_btn = StatusBarButton("\ueaa2")
        self._notif_btn.setFixedWidth(28)
        self._notif_btn.setToolTip("No Notifications")
        self.addPermanentWidget(self._notif_btn)

    def set_notifications(self, count: int):
        """Update the notification bell tooltip to reflect pending toast count."""
        if count <= 0:
            self._notif_btn.setToolTip("No Notifications")
        elif count == 1:
            self._notif_btn.setToolTip("1 Notification")
        else:
            self._notif_btn.setToolTip(f"{count} Notifications")

    def set_connected(self, connected: bool):
        if connected:
            self._ai_btn.setText("\ueab2 Dardcor - Settings")
            self._ai_btn.setToolTip("Settings Ready")
        else:
            self._ai_btn.setText("\uea76 Settings Offline")
            self._ai_btn.setToolTip("Settings Offline - Check Configuration")

    def set_cursor_position(self, line: int, col: int):
        self._cursor_btn.setText(f"Ln {line}, Col {col}")

    def set_language(self, language: str):
        self._lang_btn.setText(language)

    def set_git_branch(self, branch: str):
        if not branch:
            self._git_btn.hide()
            self._sync_btn.hide()
        else:
            self._git_btn.setText(f"\uea68 {branch}")
            self._git_btn.show()
            self._sync_btn.show()

    def set_encoding(self, encoding: str):
        self._encoding_btn.setText(encoding)

    def set_eol(self, eol: str):
        self._eol_btn.setText(eol)

    def set_indent(self, spaces: int):
        self._indent_btn.setText(f"Spaces: {spaces}")

    def set_errors_warnings(self, errors: int, warnings: int):
        self._errors_btn.setText(f"\uea87 {errors}  \uea6c {warnings}")
        if errors > 0:
            self._errors_btn.setToolTip(f"{errors} Error(s), {warnings} Warning(s)")
        elif warnings > 0:
            self._errors_btn.setToolTip(f"{warnings} Warning(s)")
        else:
            self._errors_btn.setToolTip("No Problems")

    def set_remote_name(self, name: str):
        if name:
            self._remote_btn.setText(f">{name}")
            self._remote_btn.show()
        else:
            self._remote_btn.hide()

    def set_ext_status_item(self, item_id: str, text: str, tooltip: str = "",
                            command: str = ""):
        """Show or update a status bar item keyed by extension-provided id."""
        if not item_id:
            item_id = "default"
        if not text:
            self.remove_ext_status_item(item_id)
            return
        btn = self._ext_status_items.get(item_id)
        if btn is None:
            btn = StatusBarButton("")
            btn.setStyleSheet("""
                QPushButton {
                    background: #3c0068; color: #ffffff; border: none;
                    padding: 0px 8px; font-size: 11px;
                }
                QPushButton:hover { background-color: #4a0072; }
            """)
            btn.clicked.connect(lambda _checked=False, i=item_id: self._on_ext_item_clicked(i))
            self._ext_status_items[item_id] = btn
            self._ext_status_layout.addWidget(btn)
        btn.setProperty("_ext_command", command)
        btn.setText(text)
        btn.setToolTip(tooltip or text)
        btn.show()
        self._ext_status_container.show()

    def remove_ext_status_item(self, item_id: str):
        btn = self._ext_status_items.pop(item_id, None)
        if btn is not None:
            self._ext_status_layout.removeWidget(btn)
            btn.deleteLater()
        if not self._ext_status_items:
            self._ext_status_container.hide()

    def clear_all_ext_status(self):
        for item_id in list(self._ext_status_items.keys()):
            self.remove_ext_status_item(item_id)

    def set_ext_status(self, text: str, tooltip: str = ""):
        """Backward-compatible single-item API."""
        self.set_ext_status_item("default", text, tooltip)

    def clear_ext_status(self):
        self.remove_ext_status_item("default")

    def _on_ext_item_clicked(self, item_id: str):
        btn = self._ext_status_items.get(item_id)
        if btn is None:
            return
        cmd = btn.property("_ext_command") or ""
        if cmd:
            self.ext_status_clicked.emit(str(cmd))

    def resizeEvent(self, event):
        w = event.size().width()
        
        # Hide items progressively as the window gets smaller
        self._encoding_btn.setVisible(w > 800)
        self._eol_btn.setVisible(w > 700)
        self._indent_btn.setVisible(w > 600)
        self._lang_btn.setVisible(w > 500)
        self._git_btn.setVisible(w > 400)
        self._errors_btn.setVisible(w > 300)
        
        super().resizeEvent(event)

