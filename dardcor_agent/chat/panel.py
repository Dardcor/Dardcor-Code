"""Chat Panel - VS Code Copilot-style AI chat sidebar."""

import json
from datetime import datetime
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit,
    QPushButton, QLabel, QFrame, QScrollArea, QComboBox,
    QStyledItemDelegate, QCompleter, QSizePolicy
)
from PySide6.QtCore import Signal, Qt, QTimer, QSize, QThread, QCoreApplication, QUrl
from PySide6.QtGui import QColor, QTextCursor, QTextCharFormat, QFont, QKeyEvent, QIcon, QStandardItemModel, QStandardItem
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
import os
import html

from pydardcor.core.config import get_config
from pydardcor.core.antigravity_db import AntigravityDB
from dardcor_agent.chat.web_bridge import WebBridge

# ChatHistory has been replaced by QWebEngineView and sliced into dardcor_agent/chat/web/index.html
    



class UpwardComboBox(QComboBox):
    """ComboBox that opens its popup upward and constrains width to parent."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMaxVisibleItems(15)  # Limit popup height
    
    def showPopup(self):
        # Get the popup view and its container window
        popup = self.view()
        popup_window = popup.window()
        
        # Make popup invisible during repositioning to prevent flicker
        popup_window.setWindowOpacity(0)
        
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
        
        # Show popup after repositioning (no flicker)
        popup_window.setWindowOpacity(1)

class ChatPanel(QWidget):
    """VS Code Copilot Chat style panel."""

    message_sent = Signal(str)
    new_chat_requested = Signal()
    history_requested = Signal()
    select_file_requested = Signal()
    files_pasted = Signal(list)
    stop_requested = Signal()

    # Thread-safe slots signals
    _append_agent_signal = Signal(str, bool)
    _append_system_signal = Signal(str)
    _append_tool_call_signal = Signal(str, str, str, str)
    _update_tool_output_signal = Signal(str, str)
    _set_enabled_signal = Signal(bool)
    _show_typing_signal = Signal(bool, str)

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
        header = QWidget()
        header.setObjectName("chatHeader")
        header.setFixedHeight(35)
        header.setStyleSheet("""
            #chatHeader {
                background-color: #000000;
                border-bottom: 1px solid #3c0068;
            }
        """)
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(12, 0, 8, 0)
        header_layout.setSpacing(4)

        title = QLabel("Dardcor Agent")
        title.setStyleSheet("""
            color: #cccccc;
            font-size: 13px;
            font-weight: bold;
            border-bottom: 2px solid #3c0068;
            padding-bottom: 2px;
        """)
        header_layout.addWidget(title)

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

        layout.addWidget(header)

        # Chat history (uses QWebEngineView for modern slicing)
        self._web_view = QWebEngineView(self)
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

        web_dir = os.path.join(os.path.dirname(__file__), "web")
        index_path = os.path.join(web_dir, "index.html")
        self._web_view.setUrl(QUrl.fromLocalFile(index_path))
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
        assets_dir = os.path.join(base_dir, "pydardcor", "assets")

        attach_btn = QPushButton()
        attach_btn.setIcon(QIcon(os.path.join(assets_dir, "plus.svg")))
        attach_btn.setIconSize(QSize(14, 14))
        attach_btn.setFixedSize(26, 26)
        attach_btn.setToolTip("Upload File")
        attach_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none;
                border-radius: 13px;
            }
            QPushButton:hover { background-color: #333333; }
        """)
        attach_btn.clicked.connect(self.select_file_requested.emit)
        input_bottom_layout.addWidget(attach_btn)
        
        chevron_path = os.path.join(assets_dir, "chevron-up.svg").replace("\\", "/")
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
        input_bottom_layout.addWidget(self.model_dropdown)

        self._mic_icon = QIcon(os.path.join(assets_dir, "mic.svg"))
        self._send_icon = QIcon(os.path.join(assets_dir, "send.svg"))
        self._stop_icon = QIcon(os.path.join(assets_dir, "stop.svg"))
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

        # Disclaimer removed per user request

        layout.addWidget(input_container)

        # Show welcome message
        self._show_welcome()

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
        project_root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
        return os.path.join(project_root, "database", "models", provider_name, "config.json")

    def _active_model_provider(self, providers: dict) -> str:
        for name in ["Gemini", "OpenRouter", "DeepSeek", "NVIDIA", "Antigravity"]:
            if providers.get(name, False):
                return name
        return ""
            
    def _on_model_changed(self, text: str):
        if not text or self._is_populating:
            return

        provider_name = getattr(self, "_model_to_provider", {}).get(text, "")
        if provider_name and provider_name != "Antigravity":
            try:
                config_path = self._provider_config_path(provider_name)
                if os.path.exists(config_path):
                    with open(config_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if data.get("selected_model") != text:
                        data["selected_model"] = text
                        with open(config_path, "w", encoding="utf-8") as f:
                            json.dump(data, f, indent=4)
            except Exception:
                pass

    def _populate_models(self, providers: dict = None):
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY
        providers = providers or self.db.get_providers()
        current_text = self.model_dropdown.currentText()

        model_to_provider = {}
        all_display_items = []

        for provider_name, pdef in PROVIDER_REGISTRY.items():
            if not providers.get(provider_name, False):
                continue

            provider_models = []
            if pdef.get("is_special"):
                provider_models = [m["id"] for m in pdef.get("models", [])]
            else:
                try:
                    config_path = self._provider_config_path(provider_name)
                    if os.path.exists(config_path):
                        with open(config_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        for m in data.get("models", []):
                            model_id = m.get("id")
                            if model_id:
                                provider_models.append(model_id)
                        if not provider_models and data.get("selected_model"):
                            provider_models.append(data.get("selected_model"))
                except Exception:
                    pass
                # Show registry defaults when user enabled provider but hasn't fetched yet
                if not provider_models:
                    provider_models = [m["id"] for m in pdef.get("models", [])]

            if not provider_models:
                continue

            for m in provider_models:
                model_to_provider[m] = provider_name

            all_display_items.append(QStandardItem(f"── {provider_name} ──"))
            all_display_items[-1].setEnabled(False)
            font = all_display_items[-1].font()
            font.setBold(True)
            all_display_items[-1].setFont(font)
            all_display_items[-1].setForeground(QColor("#858585"))

            for model_id in provider_models:
                item = QStandardItem(model_id)
                all_display_items.append(item)

        current_items = [self._dropdown_model.item(i).text() for i in range(self._dropdown_model.rowCount())]
        display_texts = [it.text() for it in all_display_items]
        if current_items != display_texts or not self._dropdown_model.rowCount():
            self._is_populating = True
            self._dropdown_model.clear()
            for it in all_display_items:
                self._dropdown_model.appendRow(it)
            self._is_populating = False

        self._model_to_provider = model_to_provider
        if current_text and current_text in model_to_provider:
            if self.model_dropdown.currentText() != current_text:
                self._is_populating = True
                self.model_dropdown.setCurrentText(current_text)
                self._is_populating = False
        elif self._dropdown_model.rowCount() > 0:
            first_selectable = None
            for i in range(self._dropdown_model.rowCount()):
                if self._dropdown_model.item(i).isEnabled():
                    first_selectable = self._dropdown_model.item(i).text()
                    break
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

        close_btn = QPushButton("✕", pill)
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
            display_text += f"\\n📎 {filename}"
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

    def _append_user_message(self, text: str, retry_text: str = None):
        retry_text = retry_text or text
        self._web_bridge.append_user_message.emit(text, retry_text)

    def _handle_history_action(self, action: str, payload: str):
        if action == "retry":
            self._retry_message(payload)
        elif action == "revert":
            self._revert_message(payload)
        elif action == "copy":
            import base64
            try:
                from PySide6.QtWidgets import QApplication
                text = base64.b64decode(payload).decode("utf-8")
                QApplication.clipboard().setText(text)
            except Exception:
                pass

    def _retry_message(self, payload: str):
        import base64
        try:
            text = base64.b64decode(payload).decode("utf-8")
        except Exception:
            text = payload
        self._append_user_message(text, text)
        self.show_typing(True)
        self.message_sent.emit(text)

    def _revert_message(self, payload: str):
        import base64
        try:
            text = base64.b64decode(payload).decode("utf-8")
        except Exception:
            text = payload
        self._input.setPlainText(text)
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
        self._web_bridge.append_agent_message.emit(text, is_html)

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
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>💬 Perintah Slash Dardcor</h3>"
                    "  <p style='color: #858585; margin-bottom: 12px;'>Ketik perintah berikut langsung di kolom chat untuk mendapatkan info cepat secara offline:</p>"
                    "  <table style='width: 100%; border-collapse: collapse;'>"
                    "    <tr style='border-bottom: 1px solid #2c004a;'>"
                    "      <th style='text-align: left; padding: 6px 4px; color: #4fc1ff; width: 30%;'>Perintah</th>"
                    "      <th style='text-align: left; padding: 6px 4px; color: #4fc1ff;'>Deskripsi</th>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/help</td>"
                    "      <td style='padding: 6px 4px;'>Menampilkan panduan dan daftar perintah ini.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/mcp</td>"
                    "      <td style='padding: 6px 4px;'>Melihat status Model Context Protocol (MCP) server lokal.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/skill</td>"
                    "      <td style='padding: 6px 4px;'>Daftar kemampuan / tools yang dimiliki oleh agen AI.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/git</td>"
                    "      <td style='padding: 6px 4px;'>Melihat status Git repositori saat ini secara instan.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/settings</td>"
                    "      <td style='padding: 6px 4px;'>Menampilkan konfigurasi aktif aplikasi (Font, Size, dll).</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/clear</td>"
                    "      <td style='padding: 6px 4px;'>Membersihkan riwayat chat di layar obrolan.</td>"
                    "    </tr>"
                    "  </table>"
                    "</div>"
                )
                self.append_agent_message(html, is_html=True)

            elif cmd == "/mcp":
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>🔌 Model Context Protocol (MCP)</h3>"
                    "  <p style='color: #f14c4c; font-weight: bold; margin-bottom: 10px;'>Status: Tidak Ada Server MCP Aktif</p>"
                    "  <p>Dardcor Code mendukung protokol MCP untuk menghubungkan AI dengan tool eksternal (seperti database, API custom, atau sistem lokal).</p>"
                    "  <p style='color: #858585; font-size: 11px; margin-top: 10px;'>"
                    "    <i>Anda dapat menambahkan server MCP di masa mendatang dengan mengonfigurasinya melalui file konfigurasi atau panel Settings.</i>"
                    "  </p>"
                    "</div>"
                )
                self.append_agent_message(html, is_html=True)

            elif cmd == "/skill":
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>🛠️ Kemampuan Agen AI (Skills & Tools)</h3>"
                    "  <p style='margin-bottom: 8px;'>Dardcor Agent memiliki akses langsung ke sistem Anda untuk melakukan tugas coding secara otonom melalui tool berikut:</p>"
                    "  <table style='width: 100%; border-collapse: collapse; font-size: 11px;'>"
                    "    <tr style='border-bottom: 1px solid #2c004a;'>"
                    "      <th style='text-align: left; padding: 4px; color: #4fc1ff; width: 40%;'>Nama Tool</th>"
                    "      <th style='text-align: left; padding: 4px; color: #4fc1ff;'>Kegunaan</th>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>read_file / write_file</td>"
                    "      <td style='padding: 4px;'>Membaca dan membuat/menulis berkas kode.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>replace_file_content</td>"
                    "      <td style='padding: 4px;'>Mengedit blok kode spesifik dalam berkas secara akurat.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>search_files</td>"
                    "      <td style='padding: 4px;'>Mencari teks di seluruh workspace menggunakan ripgrep.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>run_command</td>"
                    "      <td style='padding: 4px;'>Menjalankan perintah build/test di terminal terintegrasi.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>search_web / read_url</td>"
                    "      <td style='padding: 4px;'>Mencari jawaban pemrograman dan membaca dokumentasi online.</td>"
                    "    </tr>"
                    "    <tr style='border-bottom: 1px solid #1a0033;'>"
                    "      <td style='padding: 4px; font-family: monospace; color: #9cdcfe;'>semantic_search</td>"
                    "      <td style='padding: 4px;'>Mencari berkas dan simbol kode berbasis kecocokan semantik.</td>"
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
                        "  <p style='color: #f14c4c;'>Error: Workspace path tidak valid atau belum diset.</p>"
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
                            "  <p style='color: #858585;'>Direktori saat ini bukan merupakan repositori Git aktif.</p>"
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
                            "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>🌿 Git Status</h3>"
                            f"  <p><b>Cabang Aktif:</b> <span style='color: #4fc1ff; font-weight: bold;'>{branch}</span></p>"
                            "  <table style='width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px;'>"
                            "    <tr style='border-bottom: 1px solid #2c004a;'>"
                            "      <th style='text-align: left; padding: 4px; color: #4fc1ff;'>Status Berkas</th>"
                            "      <th style='text-align: right; padding: 4px; color: #4fc1ff; width: 30%;'>Jumlah</th>"
                            "    </tr>"
                            f"    <tr style='border-bottom: 1px solid #1a0033;'>"
                            "      <td style='padding: 4px;'>Staged Changes (Siap Commit)</td>"
                            f"      <td style='padding: 4px; text-align: right; color: #4ec9b0; font-weight: bold;'>{staged_count}</td>"
                            "    </tr>"
                            f"    <tr style='border-bottom: 1px solid #1a0033;'>"
                            "      <td style='padding: 4px;'>Modified Changes (Termodifikasi)</td>"
                            f"      <td style='padding: 4px; text-align: right; color: #dcdcaa; font-weight: bold;'>{modified_count}</td>"
                            "    </tr>"
                            f"    <tr style='border-bottom: 1px solid #1a0033;'>"
                            "      <td style='padding: 4px;'>Untracked Files (Belum Dilacak)</td>"
                            f"      <td style='padding: 4px; text-align: right; color: #858585;'>{untracked_count}</td>"
                            "    </tr>"
                            "  </table>"
                            "</div>"
                        )
                self.append_agent_message(html, is_html=True)

            elif cmd == "/settings":
                cfg = get_config()
                ws_path = cfg.workspace_path or "(Belum diatur)"
                font_family = cfg.font_family
                font_size = cfg.font_size
                word_wrap = "Aktif" if cfg.word_wrap else "Nonaktif"
                auto_save = "Aktif" if cfg.auto_save else "Nonaktif"
                
                html = (
                    "<div style='font-family: \"Segoe UI\", sans-serif; color: #d4d4d4; line-height: 1.4; font-size: 11px;'>"
                    "  <h3 style='color: #c586c0; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #3c0068; padding-bottom: 4px;'>⚙️ Konfigurasi Editor</h3>"
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
                    f"  <p style='color: #f14c4c; font-weight: bold;'>Perintah '{cmd}' tidak dikenali.</p>"
                    "  <p>Silakan ketik <span style='color: #ce9178; font-weight: bold;'>/help</span> untuk melihat daftar perintah slash yang didukung.</p>"
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
        if "Batas Token Tercapai" in text or "token" in text.lower():
            self._web_bridge.show_notification.emit(text)
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
        super().keyPressEvent(event)

    def insertFromMimeData(self, source):
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
            
        super().insertFromMimeData(source)
