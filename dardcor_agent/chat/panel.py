"""Chat Panel - VS Code Copilot-style AI chat sidebar."""

import json
from datetime import datetime
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit,
    QPushButton, QLabel, QFrame, QScrollArea, QComboBox,
    QStyledItemDelegate, QCompleter, QSizePolicy, QMenu, QFileDialog,
    QTextBrowser, QApplication,
)
from PySide6.QtCore import Signal, Qt, QTimer, QSize, QThread, QCoreApplication, QUrl
from PySide6.QtGui import QColor, QTextCursor, QTextCharFormat, QFont, QKeyEvent, QKeySequence, QIcon, QStandardItemModel, QStandardItem, QShortcut
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
import os
import html

from pydardcor.core.config import get_config
from pydardcor.core.antigravity_db import AntigravityDB
from dardcor_agent.chat.web_bridge import WebBridge

# ChatHistory has been replaced by QWebEngineView and sliced into dardcor_agent/chat/web/index.html


class ChatHistoryView(QTextBrowser):
    """Read-only history pane with selectable text and link navigation."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setTextInteractionFlags(
            Qt.TextSelectableByMouse
            | Qt.TextSelectableByKeyboard
            | Qt.LinksAccessibleByMouse
            | Qt.LinksAccessibleByKeyboard
        )
        self.setFocusPolicy(Qt.StrongFocus)
        self.viewport().setCursor(Qt.IBeamCursor)


class UpwardComboBox(QComboBox):
    """ComboBox that opens its popup upward and constrains width to parent."""

    popup_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMaxVisibleItems(15)  # Limit popup height
        self._use_custom_popup = False

    def showPopup(self):
        if self._use_custom_popup:
            self.popup_requested.emit()
            return
        self._show_native_popup()

    def _show_native_popup(self):
        # Get the popup view and its container window
        popup = self.view()
        popup_window = popup.window()
        
        # Constrain popup width to match parent panel width (minus margins)
        parent_widget = self.parent()
        if parent_widget:
            max_width = parent_widget.width() - 16  # 8px margin each side
        else:
            max_width = 350
        popup.setFixedWidth(max(max_width, self.width()))
        super().showPopup()

        # Calculate position above the combo box
        global_pos = self.mapToGlobal(self.rect().topLeft())
        popup_height = popup_window.height()
        
        # Ensure popup doesn't go above screen top
        screen_top = 0
        try:
            from PySide6.QtWidgets import QApplication
            screen = QApplication.screenAt(global_pos)
            if screen:
                screen_top = screen.availableGeometry().top()
        except Exception:
            pass
        
        target_y = global_pos.y() - popup_height - 2
        if target_y < screen_top:
            target_y = screen_top
        
        # Constrain X position so popup doesn't overflow right edge
        target_x = global_pos.x()
        try:
            from PySide6.QtWidgets import QApplication
            screen = QApplication.screenAt(global_pos)
            if screen:
                screen_right = screen.availableGeometry().right()
                popup_right = target_x + popup_window.width()
                if popup_right > screen_right:
                    target_x = screen_right - popup_window.width()
        except Exception:
            pass
        
        popup_window.move(target_x, target_y)


class _ModelSearchRow(QFrame):
    """Single selectable model row: name (left) + provider (right)."""

    picked = Signal(str)

    def __init__(self, label: str, name: str, provider_label: str, is_free: bool,
                 is_current: bool, parent=None):
        super().__init__(parent)
        self._label = label
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedHeight(30)
        bg = "#3c0068" if is_current else "transparent"
        self.setStyleSheet(
            f"_ModelSearchRow{{background:{bg};border:none;border-radius:5px;}}"
            "_ModelSearchRow:hover{background:#2a2a2e;}"
        )
        row = QHBoxLayout(self)
        row.setContentsMargins(10, 0, 10, 0)
        row.setSpacing(8)

        name_color = "#a855f7" if is_current else "#e4e4e7"
        name_lbl = QLabel(name)
        name_lbl.setStyleSheet(
            f"color:{name_color};font-size:12px;border:none;background:transparent;"
        )
        row.addWidget(name_lbl)

        if is_free:
            free_lbl = QLabel("Free")
            free_lbl.setStyleSheet(
                "color:#22c55e;font-size:9px;border:1px solid #14532d;border-radius:3px;"
                "padding:0 4px;background:transparent;"
            )
            row.addWidget(free_lbl)

        row.addStretch()
        prov_lbl = QLabel(provider_label)
        prov_lbl.setStyleSheet(
            "color:#6b7280;font-size:11px;border:none;background:transparent;"
        )
        row.addWidget(prov_lbl)

    def mousePressEvent(self, event):
        self.picked.emit(self._label)
        super().mousePressEvent(event)


class ModelSearchPopup(QFrame):
    """Searchable popup listing every active model, grouped visually flat."""

    picked = Signal(str)

    def __init__(self, entries: list, current_label: str, min_width: int, parent=None):
        super().__init__(parent, Qt.Popup | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setStyleSheet(
            "QFrame{background:#161618;border:1px solid #3c0068;border-radius:10px;}"
            "QScrollBar:vertical{width:2px;background:transparent;}"
            "QScrollBar::handle:vertical{background:#3c0068;border-radius:1px;}"
        )
        self._entries = entries
        self._current_label = current_label
        self.setMinimumWidth(max(min_width, 260))
        self.setMaximumWidth(max(min_width, 420))

        vbox = QVBoxLayout(self)
        vbox.setContentsMargins(8, 8, 2, 8)
        vbox.setSpacing(6)

        search_container = QWidget()
        search_layout = QHBoxLayout(search_container)
        search_layout.setContentsMargins(0, 0, 6, 0)
        
        search_frame = QFrame()
        search_frame.setStyleSheet(
            "QFrame{background:#0e0e10;border:1px solid #3c0068;border-radius:7px;}"
        )
        sf_row = QHBoxLayout(search_frame)
        sf_row.setContentsMargins(10, 2, 10, 2)
        sf_row.setSpacing(6)
        icon = QLabel("\u2315")
        icon.setStyleSheet("color:#6b7280;font-size:14px;border:none;background:transparent;")
        sf_row.addWidget(icon)
        from PySide6.QtWidgets import QLineEdit
        self._search = QLineEdit()
        self._search.setPlaceholderText("Search models…")
        self._search.setStyleSheet(
            "QLineEdit{background:transparent;border:none;color:#e4e4e7;font-size:12px;}"
        )
        self._search.textChanged.connect(self._filter)
        sf_row.addWidget(self._search)
        
        search_layout.addWidget(search_frame)
        vbox.addWidget(search_container)

        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._scroll.setStyleSheet("QScrollArea{border:none;background:transparent;}")
        self._scroll.setFixedHeight(320)
        self._list_w = QWidget()
        self._list_w.setStyleSheet("background:transparent;")
        self._list_vbox = QVBoxLayout(self._list_w)
        self._list_vbox.setContentsMargins(0, 0, 6, 0)
        self._list_vbox.setSpacing(1)
        self._scroll.setWidget(self._list_w)
        vbox.addWidget(self._scroll)

        self._build(entries)

    def _build(self, entries: list):
        while self._list_vbox.count():
            item = self._list_vbox.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        if not entries:
            empty = QLabel("No models found")
            empty.setAlignment(Qt.AlignCenter)
            empty.setStyleSheet("color:#555;font-size:12px;padding:16px;border:none;")
            self._list_vbox.addWidget(empty)
            return

        for entry in entries:
            row = _ModelSearchRow(
                entry["label"],
                entry["name"],
                entry["provider_label"],
                entry.get("free", False),
                entry["label"] == self._current_label,
            )
            row.picked.connect(self._on_pick)
            self._list_vbox.addWidget(row)
        self._list_vbox.addStretch()

    def _filter(self, text: str):
        q = text.strip().lower()
        if not q:
            self._build(self._entries)
            return
        filtered = [
            e for e in self._entries
            if q in e["name"].lower() or q in e["provider_label"].lower()
            or q in e["model_id"].lower()
        ]
        self._build(filtered)

    def _on_pick(self, label: str):
        self.picked.emit(label)
        self.close()

    def show_above(self, widget: QWidget):
        self.adjustSize()
        from PySide6.QtWidgets import QApplication
        screen = QApplication.primaryScreen().availableGeometry()
        top_left = widget.mapToGlobal(widget.rect().topLeft())
        x = top_left.x()
        y = top_left.y() - self.height() - 4
        if y < screen.top() + 4:
            y = screen.top() + 4
        if x + self.width() > screen.right():
            x = screen.right() - self.width() - 4
        x = max(screen.left() + 4, x)
        self.move(x, y)
        self.show()
        self._search.setFocus()


class ChatPanel(QWidget):
    """VS Code Copilot Chat style panel."""

    message_sent = Signal(str)
    new_chat_requested = Signal()
    history_requested = Signal()
    select_file_requested = Signal()
    files_pasted = Signal(list)
    stop_requested = Signal()
    link_clicked = Signal(str)

    # Thread-safe slots signals
    _append_agent_signal = Signal(str, bool)
    _append_system_signal = Signal(str)
    _append_tool_call_signal = Signal(str, str, str, str)
    _update_tool_output_signal = Signal(str, str)
    _set_enabled_signal = Signal(bool)
    _show_typing_signal = Signal(bool, str)
    _show_native_notification_signal = Signal(str)
    _title_changed_signal = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("chatPanel")
        self.setMinimumWidth(300)
        self.setStyleSheet("""
            #chatPanel {
                background-color: #000000;
            }
        """)
        
        # Connect thread-safe signals
        self._append_agent_signal.connect(self._safe_append_agent_message)
        self._append_system_signal.connect(self._safe_append_system_message)
        self._append_tool_call_signal.connect(self._safe_append_tool_call)
        self._update_tool_output_signal.connect(self._safe_update_tool_output)
        self._set_enabled_signal.connect(self._safe_set_enabled)
        self._show_typing_signal.connect(self._safe_show_typing)
        self._show_native_notification_signal.connect(self._safe_show_native_notification)
        self._title_changed_signal.connect(self.set_conversation_title)
        self._history_entries = []
        self._collapsible_blocks = {}
        self._next_block_id = 1
        self._pending_user_texts = set()
        
        self._config = get_config()
        # Use user-writable data directory, never the installation folder (Program Files is read-only)
        from pydardcor.core.config import get_user_data_dir
        self.db = AntigravityDB(get_user_data_dir())
        self._provider_timer = QTimer(self)
        self._provider_timer.timeout.connect(self._check_provider_status)
        self._provider_timer.start(1500)
        self._is_populating = False

        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        self._header = QWidget()
        self._header.setObjectName("chatHeader")
        self._header.setFixedHeight(35)
        self._header.setStyleSheet("""
            #chatHeader {
                background-color: #000000;
                border-bottom: 1px solid #3c0068;
            }
        """)
        header_layout = QHBoxLayout(self._header)
        header_layout.setContentsMargins(12, 0, 8, 0)
        header_layout.setSpacing(4)

        self._title_lbl = QLabel("Dardcor Agent")
        self._title_lbl.setStyleSheet("""
            color: #cccccc;
            font-size: 13px;
            font-weight: bold;
            border-bottom: 2px solid #3c0068;
            padding-bottom: 2px;
        """)
        header_layout.addWidget(self._title_lbl)


        header_layout.addStretch()

        from PySide6.QtGui import QFont
        def create_header_btn(icon, tooltip):
            btn = QPushButton(icon)
            btn.setFixedSize(32, 32)
            btn.setToolTip(tooltip)
            btn.setFont(QFont("codicon", 16))
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent; border: none;
                    color: #e0e0e0; font-size: 16px;
                    font-family: "codicon";
                    border-radius: 4px;
                    padding: 0px; margin: 0px;
                }
                QPushButton:hover { background-color: rgba(90,93,94,0.4); }
            """)
            return btn

        new_btn = create_header_btn("\uea60", "New Chat")
        new_btn.clicked.connect(self.new_chat_requested.emit)
        header_layout.addWidget(new_btn)

        hist_btn = create_header_btn("\uea82", "History")
        hist_btn.clicked.connect(self.history_requested.emit)
        header_layout.addWidget(hist_btn)

        close_btn = create_header_btn("\uea76", "Close Chat")
        close_btn.clicked.connect(self._request_close)
        header_layout.addWidget(close_btn)

        self._close_callback = None

        layout.addWidget(self._header)
        
        # Custom Web Page to intercept link clicks
        from PySide6.QtWebEngineCore import QWebEnginePage
        class ChatWebPage(QWebEnginePage):
            def __init__(self, panel, parent=None):
                super().__init__(parent)
                self.panel = panel
            
            def acceptNavigationRequest(self, url, _type, isMainFrame):
                # Block all navigations away from the chat interface on the main frame
                url_str = url.toString()
                scheme = url.scheme()
                # Allow local file loads (file://), Qt resource loads (qrc://), and data URIs
                if isMainFrame and scheme not in ("file", "qrc", "data"):
                    self.panel.link_clicked.emit(url_str)
                    return False
                return super().acceptNavigationRequest(url, _type, isMainFrame)

        # Chat history (uses QWebEngineView for modern slicing)
        self._web_view = QWebEngineView(self)
        self._web_view.setPage(ChatWebPage(self, self._web_view))
        self._web_view.setFocusPolicy(Qt.StrongFocus)
        self._web_view.page().setBackgroundColor(QColor(0, 0, 0, 0))

        # Enable clipboard so Ctrl+C / Ctrl+A work on selected chat text
        try:
            from PySide6.QtWebEngineCore import QWebEngineSettings
            _ws = self._web_view.settings()
            _ws.setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanAccessClipboard, True)
            _ws.setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanPaste, True)
        except Exception:
            pass

        self._web_channel = QWebChannel(self._web_view.page())
        self._web_bridge = WebBridge(self)
        self._web_channel.registerObject("backend", self._web_bridge)
        self._web_view.page().setWebChannel(self._web_channel)
        self._web_bridge.action_requested.connect(self._handle_history_action)

        # Grant clipboard permission automatically when the page requests it
        try:
            from PySide6.QtWebEngineCore import QWebEnginePermission
            self._web_view.page().permissionRequested.connect(
                lambda perm: perm.grant()
                if perm.permissionType() in (
                    QWebEnginePermission.PermissionType.ClipboardReadWrite,
                    QWebEnginePermission.PermissionType.ClipboardSanitizedWrite,
                )
                else perm.deny()
            )
        except Exception:
            pass

        # Load chat UI from centralized script directory
        project_root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
        index_path = os.path.join(project_root, "script", "index", "chat.html")
        self._web_view.setUrl(QUrl.fromLocalFile(index_path))
        self._web_view.loadFinished.connect(lambda _ok: self.apply_theme())
        layout.addWidget(self._web_view, 1)


        # Input area
        input_container = QWidget()
        input_container.setObjectName("inputContainer")
        input_container.setStyleSheet("""
            #inputContainer {
                background-color: #000000;
            }
        """)
        input_layout = QVBoxLayout(input_container)
        input_layout.setContentsMargins(16, 8, 16, 6)
        input_layout.setSpacing(6)

        input_box = QFrame()
        input_box.setStyleSheet("""
            QFrame {
                background-color: #000000;
                border: 1px solid #2c004a;
                border-radius: 8px;
            }
            QFrame:focus-within {
                border-color: #a855f7;
            }
        """)
        input_box_layout = QVBoxLayout(input_box)
        input_box_layout.setContentsMargins(0, 0, 0, 0)
        input_box_layout.setSpacing(0)

        # Attachments area (hidden by default)
        self._attachments_container = QWidget()
        self._attachments_layout = QHBoxLayout(self._attachments_container)
        self._attachments_layout.setContentsMargins(12, 12, 12, 0)
        self._attachments_layout.setSpacing(8)
        self._attachments_container.hide()
        input_box_layout.addWidget(self._attachments_container)

        # Text input
        self._input = ChatInput()
        self._input.setPlaceholderText("Ask Dardcor or type /help")
        self._input.setMinimumHeight(50)
        self._input.setMaximumHeight(200)
        self._input.setAcceptRichText(False)
        self._input.setStyleSheet("""
            QTextEdit {
                background-color: transparent;
                color: #cccccc;
                border: none;
                padding: 12px;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                font-size: 13px;
                selection-background-color: #4a0072;
            }
        """)
        self._input.submit_pressed.connect(self._send_message)
        self._input.textChanged.connect(self._on_input_changed)
        self._input.file_pasted.connect(self.files_pasted.emit)
        input_box_layout.addWidget(self._input)

        # Bottom row of input box
        input_bottom = QWidget()
        input_bottom_layout = QHBoxLayout(input_bottom)
        input_bottom_layout.setContentsMargins(8, 4, 8, 8)
        input_bottom_layout.setSpacing(8)

        # Base path for assets
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        assets_dir = os.path.join(base_dir, "assets")
        image_dir = os.path.join(base_dir, "image")

        attach_btn = QPushButton()
        attach_btn.setIcon(QIcon(os.path.join(image_dir, "plus.svg")))
        if attach_btn.icon().isNull():
            attach_btn.setText("+")
        attach_btn.setIconSize(QSize(14, 14))
        attach_btn.setFixedSize(26, 26)
        attach_btn.setToolTip("Add attachment")
        attach_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none;
                border-radius: 13px;
            }
            QPushButton:hover { background-color: rgba(168, 85, 247, 0.15); }
        """)
        self._attach_menu = QMenu(attach_btn)
        self._attach_menu.setStyleSheet("""
            QMenu {
                background-color: #0a0a0a;
                color: #e4e4e7;
                border: 1px solid #2c004a;
                border-radius: 6px;
                padding: 4px;
            }
            QMenu::item {
                padding: 6px 20px;
                border-radius: 4px;
            }
            QMenu::item:selected {
                background-color: rgba(168, 85, 247, 0.2);
                color: #ffffff;
            }
        """)
        self._attach_menu.addAction("Add File", self.select_file_requested.emit)
        self._attach_menu.addAction("Add Folder", self._select_folder_attachment)
        ai_tools_menu = self._attach_menu.addMenu("AI Tools")
        ai_tools_menu.addAction("Web Search", lambda: self._insert_tool_prompt("Use web_search for: "))
        ai_tools_menu.addAction("Web Fetch", lambda: self._insert_tool_prompt("Use web_fetch on this URL: "))
        ai_tools_menu.addAction("Embeddings", lambda: self._insert_tool_prompt("Create an embedding for: "))
        ai_tools_menu.addAction("Image Generation", lambda: self._insert_tool_prompt("Generate an image: "))
        ai_tools_menu.addAction("Speech-to-Text", lambda: self._insert_tool_prompt("Transcribe this audio file: "))
        ai_tools_menu.addAction("Text-to-Speech", lambda: self._insert_tool_prompt("Create speech audio from: "))
        ai_tools_menu.addAction("Skills", lambda: self._insert_tool_prompt("List built-in skills and recommend one for: "))
        
        self._attach_menu.addSeparator()
        self._chat_mode = "Agent"
        from PySide6.QtGui import QActionGroup
        self._mode_action_group = QActionGroup(self)
        for mode in ["Agent", "Plan", "Debug", "Multitask", "Ask"]:
            action = self._attach_menu.addAction(mode)
            action.setCheckable(True)
            if mode == self._chat_mode:
                action.setChecked(True)
            self._mode_action_group.addAction(action)
            action.triggered.connect(lambda checked, m=mode: self._set_chat_mode(m))
            
        attach_btn.clicked.connect(lambda: self._attach_menu.popup(attach_btn.mapToGlobal(attach_btn.rect().topLeft())))
        input_bottom_layout.addWidget(attach_btn)
        
        chevron_path = os.path.join(image_dir, "chevron-up.svg").replace("\\", "/")
        self.model_dropdown = UpwardComboBox()
        self.model_dropdown.setItemDelegate(QStyledItemDelegate())
        self._dropdown_model = QStandardItemModel(self.model_dropdown)
        self.model_dropdown.setModel(self._dropdown_model)
        self.model_dropdown.setVisible(False)
        self.model_dropdown.setStyleSheet("""
            QComboBox {
                background-color: transparent;
                color: #e4e4e7;
                border: 1px solid #2c004a;
                border-radius: 4px;
                padding: 2px 8px;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                font-size: 11.5px;
                font-weight: 500;
            }
            QComboBox QLineEdit {
                background-color: transparent;
                color: #e4e4e7;
                border: none;
                padding: 0px 4px;
                font-size: 11.5px;
                selection-background-color: #3c0068;
            }
            QComboBox::drop-down {
                border: none;
                width: 20px;
            }
            QComboBox::down-arrow {
                image: url("%s");
                width: 12px;
                height: 12px;
                margin-right: 4px;
            }
            QComboBox QAbstractItemView {
                background-color: #000000;
                color: #e4e4e7;
                border: 1px solid #3c0068;
                border-radius: 4px;
                outline: 0px;
                padding: 2px;
            }
            QComboBox QAbstractItemView::item {
                padding: 3px 8px;
                border-radius: 3px;
                min-height: 14px;
            }
            QComboBox QAbstractItemView::item:hover {
                background-color: #1a0033;
            }
            QComboBox QAbstractItemView::item:selected {
                background-color: #3c0068;
                color: #ffffff;
            }
            QComboBox QAbstractItemView QScrollBar:vertical {
                background-color: transparent;
                width: 4px;
                border: none;
            }
            QComboBox QAbstractItemView QScrollBar::handle:vertical {
                background-color: #3c0068;
                min-height: 20px;
                border-radius: 2px;
            }
            QComboBox QAbstractItemView QScrollBar::handle:vertical:hover {
                background-color: #5a009c;
            }
            QComboBox QAbstractItemView QScrollBar::add-line:vertical,
            QComboBox QAbstractItemView QScrollBar::sub-line:vertical {
                height: 0px;
            }
            QComboBox QAbstractItemView QScrollBar::add-page:vertical,
            QComboBox QAbstractItemView QScrollBar::sub-page:vertical {
                background: transparent;
            }
        """ % chevron_path)
        self.model_dropdown.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        self.model_dropdown.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.model_dropdown.setMinimumContentsLength(12)
        self.model_dropdown.setFixedHeight(26)
        self.model_dropdown.currentTextChanged.connect(self._on_model_changed)
        self.model_dropdown._use_custom_popup = True
        self.model_dropdown.popup_requested.connect(self._show_model_search_popup)
        self._model_entries = []
        input_bottom_layout.addWidget(self.model_dropdown)

        self._mic_icon = QIcon(os.path.join(image_dir, "mic.svg"))
        self._send_icon = QIcon(os.path.join(image_dir, "send.svg"))
        self._stop_icon = QIcon(os.path.join(image_dir, "stop.svg"))
        self._is_generating = False

        self._send_btn = QPushButton()
        self._send_btn.setIcon(self._mic_icon)
        self._send_btn.setIconSize(QSize(14, 14))
        self._send_btn.setFixedSize(28, 28)
        self._send_btn.setCursor(Qt.PointingHandCursor)
        self._send_btn.setStyleSheet("""
            QPushButton {
                background-color: #444444;
                border: 1px solid #555555;
                border-radius: 14px;
            }
            QPushButton:hover { background-color: #555555; }
            QPushButton:pressed { background-color: #333333; }
            QPushButton:disabled {
                background-color: #2a2a2a;
                border-color: #333333;
            }
        """)
        self._send_btn.clicked.connect(self._on_send_btn_clicked)
        input_bottom_layout.addWidget(self._send_btn)

        input_box_layout.addWidget(input_bottom)
        input_layout.addWidget(input_box)

        paste_shortcut = QShortcut(QKeySequence.Paste, self, activated=self._paste_to_input)
        paste_shortcut.setContext(Qt.WidgetWithChildrenShortcut)

        # Disclaimer removed per user request

        layout.addWidget(input_container)

        # Show welcome message
        self._show_welcome()

    def apply_theme(self):
        try:
            from pydardcor.app.theme_manager import ThemeManager
            colors = ThemeManager.THEMES.get(ThemeManager.current_theme_id(), ThemeManager.THEMES["dardcor-purple"])["colors"]
        except Exception:
            return

        self.setStyleSheet(f"#chatPanel {{ background-color: {colors['background']}; }}")
        self._header.setStyleSheet(
            f"#chatHeader {{ background-color: {colors['background']}; border-bottom: 1px solid {colors['border']}; }}"
        )
        self._title_lbl.setStyleSheet(f"""
            color: {colors['foreground']};
            font-size: 13px;
            font-weight: bold;
            border-bottom: 2px solid {colors['accent']};
            padding-bottom: 2px;
        """)
        self._input.setStyleSheet(f"""
            QTextEdit {{
                background-color: transparent;
                color: {colors['foreground']};
                border: none;
                padding: 12px;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                font-size: 13px;
                selection-background-color: {colors['selection']};
            }}
        """)

        js = f"""
        (() => {{
            const r = document.documentElement.style;
            r.setProperty('--bg-color', {json.dumps(colors['background'])});
            r.setProperty('--text-color', {json.dumps(colors['foreground'])});
            r.setProperty('--user-bg', {json.dumps(colors['hover'])});
            r.setProperty('--user-border', {json.dumps(colors['border'])});
            r.setProperty('--accent-color', {json.dumps(colors['accent'])});
            r.setProperty('--agent-color', {json.dumps(colors['accent'])});
            const style = document.getElementById('dardcor-theme-overrides') || document.createElement('style');
            style.id = 'dardcor-theme-overrides';
            style.textContent = `
                ::-webkit-scrollbar-thumb {{ background: {colors['border']} !important; }}
                ::-webkit-scrollbar-thumb:hover {{ background: {colors['accent']} !important; }}
                .welcome-icon {{ color: {colors['accent']} !important; filter: drop-shadow(0 0 18px {colors['accent']}88) !important; }}
                .welcome-title {{ background: none !important; -webkit-text-fill-color: {colors['accent']} !important; color: {colors['accent']} !important; }}
                .content blockquote {{ border-left-color: {colors['border']} !important; }}
            `;
            document.head.appendChild(style);
        }})();
        """
        try:
            self._web_view.page().runJavaScript(js)
        except Exception:
            pass

    def _check_provider_status(self):
        try:
            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY
            providers = self.db.get_providers()
            state = tuple((name, providers.get(name, False)) for name in PROVIDER_REGISTRY.keys())
            is_active = any(active for _, active in state)
            if not hasattr(self, '_last_provider_state') or self._last_provider_state != state:
                self.model_dropdown.setVisible(is_active)
                self._last_provider_state = state
                if is_active:
                    self._populate_models(providers)
        except Exception:
            pass

    def _provider_config_path(self, provider_name: str) -> str:
        from pydardcor.core.config import get_user_data_dir
        return os.path.join(get_user_data_dir(), "database", "models", provider_name, "config.json")

    def _active_model_provider(self, providers: dict) -> str:
        for name in ["Gemini", "OpenRouter", "DeepSeek", "NVIDIA", "Antigravity"]:
            if providers.get(name, False):
                return name
        return ""

    def _set_chat_mode(self, mode: str):
        self._chat_mode = mode

    def get_chat_mode(self) -> str:
        return getattr(self, "_chat_mode", "Agent")

    def _insert_tool_prompt(self, prefix: str):
        current = self._input.toPlainText().strip()
        self._input.setPlainText(f"{prefix}{current}" if current else prefix)
        self._input.setFocus()
        cursor = self._input.textCursor()
        cursor.movePosition(QTextCursor.End)
        self._input.setTextCursor(cursor)

    def _copy_focused_text(self):
        focused = QApplication.focusWidget()
        if focused is self._input:
            self._input.copy()
            return
        try:
            from PySide6.QtWebEngineCore import QWebEnginePage
            self._web_view.page().triggerAction(QWebEnginePage.WebAction.Copy)
        except Exception:
            pass

    def _paste_to_input(self):
        if QApplication.focusWidget() is not self._input:
            self._input.setFocus()
        self._input.paste()

    def selected_model_id(self) -> str:
        text = self.model_dropdown.currentText()
        return getattr(self, "_label_to_model_id", {}).get(text, text)

    def _select_folder_attachment(self):
        folder_path = QFileDialog.getExistingDirectory(self, "Add Folder")
        if folder_path:
            self.files_pasted.emit([folder_path])
            
    def _on_model_changed(self, text: str):
        if not text or self._is_populating:
            return

        model_id = getattr(self, "_label_to_model_id", {}).get(text, text)
        provider_name = getattr(self, "_model_to_provider", {}).get(text, "")
        if provider_name and provider_name != "Antigravity":
            try:
                config_path = self._provider_config_path(provider_name)
                data = {}
                if os.path.exists(config_path):
                    with open(config_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                if data.get("selected_model") != model_id:
                    data["selected_model"] = model_id
                    os.makedirs(os.path.dirname(config_path), exist_ok=True)
                    with open(config_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=4)
            except Exception:
                pass

    def _show_model_search_popup(self):
        entries = getattr(self, "_model_entries", [])
        if not entries:
            self.model_dropdown._show_native_popup()
            return
        current_label = self.model_dropdown.currentText()
        popup = ModelSearchPopup(entries, current_label, self.model_dropdown.width(), self)
        popup.picked.connect(self._on_model_search_picked)
        popup.show_above(self.model_dropdown)
        self._model_search_popup = popup

    def _on_model_search_picked(self, label: str):
        if self.model_dropdown.currentText() != label:
            self.model_dropdown.setCurrentText(label)

    def _populate_models(self, providers: dict = None):
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY
        from dardcor_agent.models.provider_meta import get_registry_models

        providers = providers or self.db.get_providers()
        current_text = self.model_dropdown.currentText()

        model_to_provider = {}
        label_to_model_id = {}
        all_display_items = []
        model_entries = []

        for provider_name, pdef in PROVIDER_REGISTRY.items():
            if not providers.get(provider_name, False):
                continue

            provider_label = pdef.get("name", provider_name)
            id_to_model = {}

            if pdef.get("is_special"):
                for m in pdef.get("models", []):
                    mid = m.get("id", "")
                    if mid:
                        id_to_model[mid] = {"display": m.get("name", mid), "free": bool(m.get("free"))}
                provider_models = list(id_to_model.keys())
            else:
                registry_models = get_registry_models(provider_name, pdef)
                cached_models = get_registry_models(provider_name, pdef, prefer_cache=True)
                merged: dict[str, dict] = {m["id"]: m for m in registry_models}
                for m in cached_models:
                    merged[m["id"]] = m
                for m in merged.values():
                    id_to_model[m["id"]] = {"display": m.get("display", m["id"]), "free": bool(m.get("free"))}
                provider_models = list(merged.keys())

            if not provider_models:
                continue

            all_display_items.append(QStandardItem(f"── {provider_label} ──"))
            all_display_items[-1].setEnabled(False)
            font = all_display_items[-1].font()
            font.setBold(True)
            all_display_items[-1].setFont(font)
            all_display_items[-1].setForeground(QColor("#858585"))

            for model_id in provider_models:
                minfo = id_to_model.get(model_id, {"display": model_id, "free": False})
                display = minfo["display"]
                label = f"{display} — {provider_label}"
                model_to_provider[label] = provider_name
                # Same upstream model can appear under a native provider and a
                # gateway. Prefix only the gateway selection so routing keeps
                # provider/key/base_url distinct, then strip it before sending.
                routed_model_id = f"opencode/{model_id}" if provider_name == "OpenCodeZen" else model_id
                label_to_model_id[label] = routed_model_id
                all_display_items.append(QStandardItem(label))
                model_entries.append({
                    "label": label,
                    "name": display,
                    "provider_label": provider_label,
                    "model_id": routed_model_id,
                    "free": minfo["free"],
                })

        self._model_entries = model_entries

        current_items = [self._dropdown_model.item(i).text() for i in range(self._dropdown_model.rowCount())]
        display_texts = [it.text() for it in all_display_items]
        if current_items != display_texts or not self._dropdown_model.rowCount():
            self._is_populating = True
            self._dropdown_model.clear()
            for it in all_display_items:
                self._dropdown_model.appendRow(it)
            self._is_populating = False

        self._model_to_provider = model_to_provider
        self._label_to_model_id = label_to_model_id

        if current_text and current_text in model_to_provider:
            if self.model_dropdown.currentText() != current_text:
                self._is_populating = True
                self.model_dropdown.setCurrentText(current_text)
                self._is_populating = False
        elif self._dropdown_model.rowCount() > 0:
            preferred = None
            try:
                from pydardcor.core.config import get_config
                preferred = get_config().default_model
            except Exception:
                preferred = "dardcor-flash-free"
            first_selectable = None
            for i in range(self._dropdown_model.rowCount()):
                item = self._dropdown_model.item(i)
                if not item.isEnabled():
                    continue
                label = item.text()
                if preferred and label_to_model_id.get(label) == preferred:
                    first_selectable = label
                    break
                if first_selectable is None:
                    first_selectable = label
            if first_selectable and self.model_dropdown.currentText() != first_selectable:
                self._is_populating = True
                self.model_dropdown.setCurrentText(first_selectable)
                self._is_populating = False

    def _show_welcome(self):
        pass

    def set_workspace_name(self, name: str):
        pass

    def _request_new_conversation(self):
        pass

    def _request_close(self):
        if self._close_callback:
            self._close_callback()
        else:
            self.hide()

    def set_close_callback(self, callback):
        self._close_callback = callback

    def add_attachment(self, filepath: str):
        import os
        from PySide6.QtWidgets import QLabel, QHBoxLayout, QFrame, QFileIconProvider, QPushButton
        from PySide6.QtCore import QFileInfo
        
        # Prevent duplicate files
        filename = os.path.basename(filepath)
        for i in range(self._attachments_layout.count()):
            w = self._attachments_layout.itemAt(i).widget()
            if w and os.path.basename(w.property("filepath") or "") == filename:
                return
        
        icon_provider = QFileIconProvider()
        icon = icon_provider.icon(QFileInfo(filepath))

        pill = QFrame()
        pill.setFixedSize(42, 42)
        pill.setStyleSheet("""
            QFrame {
                background-color: #1e1e1e;
                border: 1px solid #3c3c3c;
                border-radius: 6px;
            }
        """)
        pill.setToolTip(filename)
        pill.setProperty("filepath", filepath)

        icon_lbl = QLabel(pill)
        icon_lbl.setPixmap(icon.pixmap(28, 28))
        icon_lbl.setFixedSize(28, 28)
        icon_lbl.move(7, 8)
        icon_lbl.setStyleSheet("border: none; background: transparent;")

        close_btn = QPushButton("x", pill)
        close_btn.setFixedSize(14, 14)
        close_btn.move(26, 1)
        close_btn.setStyleSheet("""
            QPushButton {
                background-color: #555555;
                color: #ffffff;
                border: none;
                border-radius: 7px;
                font-size: 8px;
                font-weight: bold;
                padding: 0px;
            }
            QPushButton:hover { background-color: #cc3333; }
        """)
        close_btn.clicked.connect(lambda _, p=pill: self._remove_attachment(p))

        self._attachments_layout.addWidget(pill)
        self._attachments_container.show()
        self._on_input_changed()

    def _remove_attachment(self, pill):
        self._attachments_layout.removeWidget(pill)
        pill.deleteLater()
        if self._attachments_layout.count() == 0:
            self._attachments_container.hide()
        self._on_input_changed()

    def clear_attachments(self):
        while self._attachments_layout.count():
            item = self._attachments_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._attachments_container.hide()

    def get_attachments(self) -> list:
        paths = []
        for i in range(self._attachments_layout.count()):
            widget = self._attachments_layout.itemAt(i).widget()
            if widget:
                paths.append(widget.property("filepath"))
        return paths

    def _on_input_changed(self):
        text = self._input.toPlainText().strip()
        has_attach = self._attachments_layout.count() > 0
        if text or has_attach:
            self._send_btn.setIcon(self._send_icon)
        else:
            self._send_btn.setIcon(self._mic_icon)

    def _on_send_btn_clicked(self):
        if self._is_generating:
            self._send_btn.setEnabled(False)
            self.stop_requested.emit()
            return
        self._send_message()

    def _send_message(self):
        text = self._input.toPlainText().strip()
        attachments = self.get_attachments()
        
        if not text and not attachments:
            return
            
        display_text = text
        final_text = text
        
        import os
        for path in attachments:
            filename = os.path.basename(path)
            display_text += f"\\n[Attached] {filename}"
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                final_text += f"\\n\\n[Attached File: {filename}]\\n```\\n{content}\\n```\\n"
            except UnicodeDecodeError:
                final_text += f"\\n\\n[Attached Binary File: {filename}]\\n"
                
        if final_text.startswith("/"):
            self._append_user_message(display_text.strip(), final_text)
            self._input.clear()
            self.clear_attachments()
            self._on_input_changed()
            self._handle_slash_command(final_text)
        else:
            if self._is_message_duplicate(final_text):
                self._input.clear()
                self.clear_attachments()
                self._on_input_changed()
                return
            if self._is_generating:
                self._pending_user_texts.add(final_text)
            self._append_user_message(display_text.strip(), final_text)
            self._input.clear()
            self.clear_attachments()
            self._on_input_changed()
            self.show_typing(True)
            self.message_sent.emit(final_text)

    def _is_message_duplicate(self, text: str) -> bool:
        return self._is_generating and text in self._pending_user_texts

    def _encode_action_text(self, text: str) -> str:
        import base64

        return base64.urlsafe_b64encode(text.encode("utf-8")).decode("utf-8")

    def _decode_action_text(self, text: str) -> str:
        import base64

        return base64.urlsafe_b64decode(text).decode("utf-8")

    def _collapsible_block_token(self, block_id: int) -> str:
        return f"@@COLLAPSIBLE_BLOCK_{block_id}@@"

    def _render_history_html_content(self, entries: list) -> str:
        """Render history entries with collapsible sections and action links."""
        parts: list[str] = []
        for entry in entries:
            block_id = int(entry.get("block_id", self._next_block_id))
            self._next_block_id = max(self._next_block_id, block_id + 1)
            token = self._collapsible_block_token(block_id)
            block = self._collapsible_blocks.setdefault(
                block_id, {"expanded": bool(entry.get("expanded", False)), "body": entry.get("body", "")}
            )
            title = html.escape(str(entry.get("title", "Section")))
            expand_icon = "[-]" if block["expanded"] else "[+]"
            toggle_href = f"toggleblock:{block_id}"
            body_text = block["body"] or ""
            encoded = self._encode_action_text(body_text)
            copy_href = f"copy_msg:{encoded}"
            retry_href = f"retry_msg:{encoded}"
            revert_href = f"revert_msg:{encoded}"
            body_html = html.escape(body_text) if block["expanded"] else ""
            if block["expanded"]:
                body_section = f'<div class="history-block-body">{body_html}</div>'
            else:
                body_section = ""
            parts.append(
                f'<div class="history-block">{token}'
                f'<a href="{toggle_href}">{expand_icon}</a> '
                f'<span class="history-block-title">{title}</span> '
                f'<a href="{copy_href}" title="Copy">&#x1F4CB;</a> '
                f'<a href="{retry_href}">Retry</a> '
                f'<a href="{revert_href}">Revert</a>'
                f"{body_section}</div>"
            )
        return "\n".join(parts)

    def _append_user_message(self, text: str, retry_text: str = None):
        retry_text = retry_text or text
        self._web_bridge.append_user_message.emit(text, retry_text)

    def _handle_history_action(self, action: str, payload: str):
        if action == "retry":
            self._retry_message(payload)
        elif action == "revert":
            self._revert_message(payload)
        elif action == "copy":
            try:
                from PySide6.QtWidgets import QApplication
                QApplication.clipboard().setText(payload)
            except Exception:
                pass
        elif action.startswith("toggleblock:"):
            try:
                block_id = int(action.split(":", 1)[1])
                block = self._collapsible_blocks.get(block_id)
                if block is not None:
                    block["expanded"] = not block["expanded"]
            except (ValueError, TypeError):
                pass

    def _retry_message(self, payload: str):
        text = payload
        self._append_user_message(text, text)
        self.show_typing(True)
        self.message_sent.emit(text)

    def _revert_message(self, payload: str):
        self._input.setPlainText(payload)
        self._input.setFocus()
        self._on_input_changed()

    def show_typing(self, show: bool, state: str = "thinking"):
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._show_typing_signal.emit(show, state)
        else:
            self._safe_show_typing(show, state)

    def _safe_show_typing(self, show: bool, state: str = "thinking"):
        self._web_bridge.show_typing.emit(show, state)

    def append_agent_message(self, text: str, is_html: bool = False):
        self.show_typing(False)
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._append_agent_signal.emit(text, is_html)
        else:
            self._safe_append_agent_message(text, is_html)

    def _safe_append_agent_message(self, text: str, is_html: bool = False):
        if not hasattr(self, '_agent_msg_buffer'):
            self._agent_msg_buffer = []
            self._agent_msg_timer = QTimer(self)
            self._agent_msg_timer.setInterval(50)
            self._agent_msg_timer.timeout.connect(self._flush_agent_messages)
            
        self._agent_msg_buffer.append((text, is_html))
        if not self._agent_msg_timer.isActive():
            self._agent_msg_timer.start()

    def _flush_agent_messages(self):
        if not hasattr(self, '_agent_msg_buffer') or not self._agent_msg_buffer:
            if hasattr(self, '_agent_msg_timer'):
                self._agent_msg_timer.stop()
            return
        
        combined_text = ""
        last_is_html = self._agent_msg_buffer[0][1]
        
        for t, h in self._agent_msg_buffer:
            if h == last_is_html:
                combined_text += t
            else:
                self._web_bridge.append_agent_message.emit(combined_text, last_is_html)
                combined_text = t
                last_is_html = h
                
        if combined_text:
            self._web_bridge.append_agent_message.emit(combined_text, last_is_html)
            
        self._agent_msg_buffer.clear()

    def show_native_notification(self, msg: str):
        self._show_native_notification_signal.emit(msg)

    def _safe_show_native_notification(self, msg: str):
        # Overlay label lives inside the header bar ("Dardcor Agent" strip)
        header = getattr(self, "_header", self)
        if not hasattr(self, "_notification_label"):
            from PySide6.QtWidgets import QLabel
            self._notification_label = QLabel(header)
            self._notification_label.setObjectName("nativeNotification")
            self._notification_label.setStyleSheet("""
                #nativeNotification {
                    background-color: rgba(20, 18, 32, 0.97);
                    color: #d0c8ff;
                    padding: 5px 14px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    border: 1px solid #5c3a9e;
                    letter-spacing: 0.2px;
                }
            """)
            self._notification_label.setAlignment(Qt.AlignVCenter | Qt.AlignCenter)
            self._notification_label.setAttribute(Qt.WA_TransparentForMouseEvents)

        self._notification_label.setText(msg)
        self._notification_label.adjustSize()

        # Centre horizontally inside the header, vertically centred in its 35px height
        h_w = header.width()
        h_h = header.height()
        lbl_w = self._notification_label.width()
        lbl_h = self._notification_label.height()
        target_x = max(0, (h_w - lbl_w) // 2)
        target_y = max(0, (h_h - lbl_h) // 2)
        self._notification_label.move(target_x, target_y)
        self._notification_label.raise_()
        self._notification_label.show()

        if hasattr(self, "_notification_timer"):
            self._notification_timer.stop()
        else:
            self._notification_timer = QTimer(self)
            self._notification_timer.setSingleShot(True)
            self._notification_timer.timeout.connect(self._notification_label.hide)
        # Show for 2 seconds then auto-hide
        self._notification_timer.start(2000)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "_notification_label") and self._notification_label.isVisible():
            header = getattr(self, "_header", self)
            h_w = header.width()
            h_h = header.height()
            lbl_w = self._notification_label.width()
            lbl_h = self._notification_label.height()
            target_x = max(0, (h_w - lbl_w) // 2)
            target_y = max(0, (h_h - lbl_h) // 2)
            self._notification_label.move(target_x, target_y)

    def _handle_slash_command(self, cmd_text: str):
        parts = cmd_text.split()
        cmd = parts[0].lower()
        args = parts[1:] if len(parts) > 1 else []

        if cmd == "/clear":
            self.clear()
            self.append_system_message("Chat history cleared.")
            return

        self.set_enabled(False)
        try:
            if cmd == "/help":
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>Dardcor Slash Commands</h3>"
                    "  <p style='color: #858585; margin-bottom: 12px;'>Type these commands in chat for quick offline information:</p>"
                    "  <table style='width: 100%; border-collapse: collapse;'>"
                    "    <tr style='border-bottom: 1px solid #2c004a;'>"
                    "      <th style='text-align: left; padding: 6px 4px; color: #4fc1ff; width: 30%;'>Command</th>"
                    "      <th style='text-align: left; padding: 6px 4px; color: #4fc1ff;'>Description</th>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/help</td>"
                    "      <td style='padding: 6px 4px;'>Show this command guide.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/mcp</td>"
                    "      <td style='padding: 6px 4px;'>Show local Model Context Protocol (MCP) server status.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/skill</td>"
                    "      <td style='padding: 6px 4px;'>List available agent tools.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/git</td>"
                    "      <td style='padding: 6px 4px;'>Show current Git repository status.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/settings</td>"
                    "      <td style='padding: 6px 4px;'>Show active app settings.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/clear</td>"
                    "      <td style='padding: 6px 4px;'>Clear visible chat history.</td>"
                    "    </tr>"
                    "  </table>"
                    "</div>"
                )
                self.append_agent_message(html, is_html=True)

            elif cmd == "/mcp":
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>Model Context Protocol (MCP)</h3>"
                    "  <p style='color: #f14c4c; font-weight: bold; margin-bottom: 10px;'>Status: No active MCP servers</p>"
                    "  <p>Dardcor Code supports MCP to connect the agent with external tools such as databases, custom APIs, or local systems.</p>"
                    "  <p style='color: #858585; font-size: 11px; margin-top: 10px;'>"
                    "    <i>You can add MCP servers later through configuration files or the Settings panel.</i>"
                    "  </p>"
                    "</div>"
                )
                self.append_agent_message(html, is_html=True)

            elif cmd == "/skill":
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>Agent Skills and Tools</h3>"
                    "  <p style='margin-bottom: 8px;'>Dardcor Agent can use the following tools to work autonomously on coding tasks:</p>"
                    "  <table style='width: 100%; border-collapse: collapse; font-size: 11px;'>"
                    "    <tr style='border-bottom: 1px solid #2c004a;'>"
                    "      <th style='text-align: left; padding: 4px; color: #4fc1ff; width: 40%;'>Tool</th>"
                    "      <th style='text-align: left; padding: 4px; color: #4fc1ff;'>Purpose</th>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>read_file / write_file</td>"
                    "      <td style='padding: 4px;'>Read and create or update code files.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>replace_file_content</td>"
                    "      <td style='padding: 4px;'>Apply precise edits to specific code blocks.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>search_files</td>"
                    "      <td style='padding: 4px;'>Search text across the workspace with ripgrep.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>run_command</td>"
                    "      <td style='padding: 4px;'>Run build and test commands in the integrated terminal.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>search_web / read_url</td>"
                    "      <td style='padding: 4px;'>Look up programming answers and read online documentation.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>semantic_search</td>"
                    "      <td style='padding: 4px;'>Find files and code symbols by semantic match.</td>"
                    "    </tr>"
                    "  </table>"
                    "</div>"
                )
                self.append_agent_message(html, is_html=True)

            elif cmd == "/git":
                cfg = get_config()
                root = cfg.workspace_path
                if not root or not os.path.exists(root):
                    html = (
                        "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                        "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>Git Status</h3>"
                        "  <p style='color: #f14c4c;'>Error: Workspace path is invalid or not set.</p>"
                        "</div>"
                    )
                else:
                    from pydardcor.git.panel import run_git
                    # Get current branch
                    branch_out, _, code = run_git(["rev-parse", "--abbrev-ref", "HEAD"], root)
                    if code != 0:
                        html = (
                            "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                            "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>Git Status</h3>"
                            "  <p style='color: #858585;'>The current directory is not an active Git repository.</p>"
                            "</div>"
                        )
                    else:
                        branch = branch_out.strip() if branch_out else "unknown"
                        # Get staged, modified, untracked changes using git status --porcelain
                        status_out, _, _ = run_git(["status", "--porcelain"], root)
                        
                        staged_count = 0
                        modified_count = 0
                        untracked_count = 0
                        
                        if status_out:
                            lines = status_out.splitlines()
                            for line in lines:
                                if len(line) >= 2:
                                    x, y = line[0], line[1]
                                    if x in ('A', 'M', 'D', 'R', 'C'):
                                        staged_count += 1
                                    if y in ('M', 'D'):
                                        modified_count += 1
                                    elif x == '?' and y == '?':
                                        untracked_count += 1
                                        
                        html = (
                            "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                            "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>Git Status</h3>"
                            f"  <p><b>Active branch:</b> <span style='color: #4fc1ff; font-weight: bold;'>{branch}</span></p>"
                            "  <table style='width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px;'>"
                            "    <tr style='border-bottom: 1px solid #2c004a;'>"
                            "      <th style='text-align: left; padding: 4px; color: #4fc1ff;'>File status</th>"
                            "      <th style='text-align: right; padding: 4px; color: #4fc1ff; width: 30%;'>Count</th>"
                            "    </tr>"
                            f"    <tr style='border-bottom: 1px solid #1a0033;'>"
                            "      <td style='padding: 4px;'>Staged changes</td>"
                            f"      <td style='padding: 4px; text-align: right; color: #4ec9b0; font-weight: bold;'>{staged_count}</td>"
                            "    </tr>"
                            f"    <tr style='border-bottom: 1px solid #1a0033;'>"
                            "      <td style='padding: 4px;'>Modified changes</td>"
                            f"      <td style='padding: 4px; text-align: right; color: #dcdcaa; font-weight: bold;'>{modified_count}</td>"
                            "    </tr>"
                            f"    <tr style='border-bottom: 1px solid #1a0033;'>"
                            "      <td style='padding: 4px;'>Untracked files</td>"
                            f"      <td style='padding: 4px; text-align: right; color: #858585;'>{untracked_count}</td>"
                            "    </tr>"
                            "  </table>"
                            "</div>"
                        )
                self.append_agent_message(html, is_html=True)

            elif cmd == "/settings":
                cfg = get_config()
                ws_path = cfg.workspace_path or "(Not set)"
                font_family = cfg.font_family
                font_size = cfg.font_size
                word_wrap = "On" if cfg.word_wrap else "Off"
                auto_save = "On" if cfg.auto_save else "Off"
                
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>Editor Settings</h3>"
                    "  <table style='width: 100%; border-collapse: collapse; font-size: 11px;'>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 5px 4px; font-weight: bold; color: #4fc1ff; width: 40%;'>Workspace Path:</td>"
                    f"      <td style='padding: 5px 4px; font-family: monospace;'>{ws_path}</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 5px 4px; font-weight: bold; color: #4fc1ff;'>Font Family:</td>"
                    f"      <td style='padding: 5px 4px;'>{font_family}</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 5px 4px; font-weight: bold; color: #4fc1ff;'>Font Size:</td>"
                    f"      <td style='padding: 5px 4px;'>{font_size}px</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 5px 4px; font-weight: bold; color: #4fc1ff;'>Word Wrap:</td>"
                    f"      <td style='padding: 5px 4px;'>{word_wrap}</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 5px 4px; font-weight: bold; color: #4fc1ff;'>Auto Save:</td>"
                    f"      <td style='padding: 5px 4px;'>{auto_save}</td>"
                    "    </tr>"
                    "  </table>"
                    "</div>"
                )
                self.append_agent_message(html, is_html=True)

            else:
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    f"  <p style='color: #f14c4c; font-weight: bold;'>Unknown command '{cmd}'.</p>"
                    "  <p>Type <span style='color: #ce9178; font-weight: bold;'>/help</span> to see supported slash commands.</p>"
                    "</div>"
                )
                self.append_agent_message(html, is_html=True)
                
        finally:
            self.set_enabled(True)

        self._scroll_to_bottom()

    def append_system_message(self, text: str):
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._append_system_signal.emit(text)
        else:
            self._safe_append_system_message(text)

    def _safe_append_system_message(self, text: str):
        if "You are Dardcor Code" in text:
            return
        if "Token limit reached" in text or "Batas Token Tercapai" in text or "token" in text.lower():
            self.show_native_notification(text)
        else:
            self._web_bridge.append_system_message.emit(text)

    def append_tool_call(self, tool_name: str, args: str, status: str = "running", tool_id: str = ""):
        if not tool_id:
            tool_id = f"auto-{tool_name}-{hash(args) & 0xFFFFFFFF:x}"
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._append_tool_call_signal.emit(tool_id, tool_name, args, status)
        else:
            self._safe_append_tool_call(tool_id, tool_name, args, status)

    def _safe_append_tool_call(self, tool_id: str, tool_name: str, args: str, status: str = "running"):
        self._flush_agent_messages()
        if status != "running":
            # For status updates (success/error), use a small delay to ensure
            # the QWebChannel has processed the initial "running" card creation first.
            from PySide6.QtCore import QTimer
            QTimer.singleShot(50, lambda: self._web_bridge.append_tool_call.emit(tool_id, tool_name, args, status))
        else:
            self._web_bridge.append_tool_call.emit(tool_id, tool_name, args, status)
            self.show_typing(True, "working")

    def append_tool_output(self, tool_id: str, chunk: str):
        """Stream live output into an existing tool card (thread-safe)."""
        if not tool_id or not chunk:
            return
        from PySide6.QtCore import QThread, QCoreApplication
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._update_tool_output_signal.emit(tool_id, chunk)
        else:
            self._safe_update_tool_output(tool_id, chunk)

    def _safe_update_tool_output(self, tool_id: str, chunk: str):
        self._flush_agent_messages()
        self._web_bridge.update_tool_output.emit(tool_id, chunk)

    def _scroll_to_bottom(self):
        # Scrolling is now handled automatically by JS
        pass

    def clear(self):
        self._web_bridge.clear_chat.emit()
        self.show_typing(False)
        self.clear_attachments()

    def set_enabled(self, enabled: bool):
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._set_enabled_signal.emit(enabled)
        else:
            self._safe_set_enabled(enabled)

    def _safe_set_enabled(self, enabled: bool):
        self._is_generating = not enabled
        if enabled:
            self._pending_user_texts.clear()
        self._input.setEnabled(True)
        self._send_btn.setEnabled(True)  # always clickable (send OR stop)
        if not enabled:
            # Switch to STOP mode — red pill button with stop icon
            self._send_btn.setIcon(self._stop_icon)
            self._send_btn.setToolTip("Stop generation")
            self._send_btn.setStyleSheet("""
                QPushButton {
                    background-color: #444444;
                    border: 1px solid #555555;
                    border-radius: 14px;
                }
                QPushButton:hover { background-color: #555555; }
                QPushButton:pressed { background-color: #333333; }
            """)
        else:
            # Restore normal send/mic mode
            self._send_btn.setToolTip("")
            self._send_btn.setStyleSheet("""
                QPushButton {
                    background-color: #444444;
                    border: 1px solid #555555;
                    border-radius: 14px;
                }
                QPushButton:hover { background-color: #555555; }
                QPushButton:pressed { background-color: #333333; }
                QPushButton:disabled {
                    background-color: #2a2a2a;
                    border-color: #333333;
                }
            """)
            self._on_input_changed()


    def set_conversation_title(self, text: str):
        """Smoothly transitions the chat title label to a new text."""
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._title_changed_signal.emit(text)
            return

        if not hasattr(self, '_title_lbl') or self._title_lbl.text() == text:
            return
        
        from PySide6.QtWidgets import QGraphicsOpacityEffect
        from PySide6.QtCore import QPropertyAnimation, QEasingCurve
        
        if not hasattr(self, '_title_effect') or self._title_lbl.graphicsEffect() is None:
            self._title_effect = QGraphicsOpacityEffect(self._title_lbl)
            self._title_lbl.setGraphicsEffect(self._title_effect)
            self._title_effect.setOpacity(1.0)
            
        self._fade_out = QPropertyAnimation(self._title_effect, b"opacity", self)
        self._fade_out.setDuration(150)
        self._fade_out.setStartValue(self._title_effect.opacity())
        self._fade_out.setEndValue(0.0)
        self._fade_out.setEasingCurve(QEasingCurve.InOutQuad)
        
        def on_fade_out_finished():
            self._title_lbl.setText(text)
            self._fade_in = QPropertyAnimation(self._title_effect, b"opacity", self)
            self._fade_in.setDuration(250)
            self._fade_in.setStartValue(0.0)
            self._fade_in.setEndValue(1.0)
            self._fade_in.setEasingCurve(QEasingCurve.InOutQuad)
            self._fade_in.start()
            
        self._fade_out.finished.connect(on_fade_out_finished)
        self._fade_out.start()
        

class ChatInput(QTextEdit):
    """Custom text input that submits on Enter and auto-grows with content."""

    submit_pressed = Signal()
    file_pasted = Signal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.textChanged.connect(self._adjust_height)
        self.document().documentLayout().documentSizeChanged.connect(
            lambda _: self._adjust_height()
        )

    def _adjust_height(self):
        doc_height = self.document().documentLayout().documentSize().height()
        frame = 2 * (self.frameWidth() + 4)
        target = int(doc_height + frame)
        min_h = self.minimumHeight() or 50
        max_h = self.maximumHeight() or 200
        new_h = max(min_h, min(target, max_h))
        if new_h != self.height():
            self.setFixedHeight(new_h)

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if not (event.modifiers() & Qt.ShiftModifier):
                self.submit_pressed.emit()
                return
        # Explicitly handle Ctrl+V so paste always works even with rich content.
        if event.matches(QKeySequence.Paste):
            self.paste()
            return
        super().keyPressEvent(event)

    def canInsertFromMimeData(self, source) -> bool:
        # Accept text, files, and images (base class rejects images when
        # acceptRichText is False, which silently breaks Ctrl+V for screenshots).
        if source.hasText() or source.hasUrls() or source.hasImage():
            return True
        return super().canInsertFromMimeData(source)

    def _save_clipboard_image(self, source) -> str:
        try:
            import os as _os
            import tempfile
            from datetime import datetime
            image = source.imageData()
            if image is None:
                return ""
            from PySide6.QtGui import QImage
            if not isinstance(image, QImage):
                image = QImage(image)
            if image.isNull():
                return ""
            tmp_dir = _os.path.join(tempfile.gettempdir(), "dardcor_pasted")
            _os.makedirs(tmp_dir, exist_ok=True)
            fname = f"pasted-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.png"
            path = _os.path.join(tmp_dir, fname)
            if image.save(path, "PNG"):
                return path
        except Exception:
            pass
        return ""

    def insertFromMimeData(self, source):
        # Pasted image (e.g. screenshot via Ctrl+V) → save and attach as file.
        if source.hasImage() and not source.hasUrls():
            path = self._save_clipboard_image(source)
            if path:
                self.file_pasted.emit([path])
                return

        # Check if the user pasted actual files from the OS (e.g. from Windows Explorer)
        if source.hasUrls():
            file_paths = []
            for url in source.urls():
                if url.isLocalFile():
                    file_paths.append(url.toLocalFile())
            
            # If there are files, check if the clipboard text is ONLY those file paths.
            # If the user copied conversational text that happens to contain a path, 
            # the text will be longer/different than just the file path string.
            if file_paths and source.hasText():
                raw_text = source.text().strip()
                # If the raw text is longer than the combined paths (plus some newlines), it's a text selection
                # Let's just do a simple heuristic: if there's a newline that isn't separating paths, 
                # or if the length of text is much larger than the paths, it's a chat message.
                paths_str = "\n".join(file_paths)
                
                # If it's a pure file copy from OS, the raw text is exactly the paths (sometimes with file:// prefix)
                # If it's clearly text, skip emitting file_pasted
                if len(raw_text) > len(paths_str) + 50:
                    pass # It's a text selection with a path inside, fallback to insertPlainText
                else:
                    self.file_pasted.emit(file_paths)
                    return
            elif file_paths:
                self.file_pasted.emit(file_paths)
                return
                
        # Fallback to plain text insertion if it's text
        if source.hasText():
            self.insertPlainText(source.text())
            return

        # Last resort: pasted image with no text/urls
        if source.hasImage():
            path = self._save_clipboard_image(source)
            if path:
                self.file_pasted.emit([path])
                return



