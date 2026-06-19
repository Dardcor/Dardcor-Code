"""Chat Panel - VS Code Copilot-style AI chat sidebar."""

import json
from datetime import datetime
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit,
    QPushButton, QLabel, QFrame, QScrollArea, QComboBox,
    QStyledItemDelegate
)
from PySide6.QtCore import Signal, Qt, QTimer, QSize, QThread, QCoreApplication
from PySide6.QtGui import QColor, QTextCursor, QTextCharFormat, QFont, QKeyEvent, QIcon
import os
import html

from ..core.config import get_config
from ..core.antigravity_db import AntigravityDB

class UpwardComboBox(QComboBox):
    def showPopup(self):
        super().showPopup()
        popup = self.view().window()
        # Move the popup above the combo box
        global_pos = self.mapToGlobal(self.rect().topLeft())
        popup.move(global_pos.x(), global_pos.y() - popup.height() - 2)

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
    _append_tool_call_signal = Signal(str, str, str)
    _set_enabled_signal = Signal(bool)
    _show_typing_signal = Signal(bool)

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
        self._set_enabled_signal.connect(self._safe_set_enabled)
        self._show_typing_signal.connect(self._safe_show_typing)
        
        self._config = get_config()
        # Use user-writable data directory, never the installation folder (Program Files is read-only)
        from ..core.config import get_user_data_dir
        self.db = AntigravityDB(get_user_data_dir())
        self._provider_timer = QTimer(self)
        self._provider_timer.timeout.connect(self._check_provider_status)
        self._provider_timer.start(1500)

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

        # Chat history
        self._history = QTextEdit()
        self._history.setReadOnly(True)
        self._history.setTextInteractionFlags(Qt.TextBrowserInteraction)
        self._history.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self._history.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._history.setStyleSheet("""
            QTextEdit {
                background-color: #000000;
                border: none;
                color: #d4d4d4;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                font-size: 11px;
                padding: 12px 2px 12px 12px;
                selection-background-color: #4a0072;
            }
            QScrollBar:vertical {
                background-color: transparent;
                width: 4px;
                border: none;
                margin: 0px;
            }
            QScrollBar::handle:vertical {
                background-color: #3c0068;
                min-height: 20px;
                border-radius: 2px;
            }
            QScrollBar::handle:vertical:hover {
                background-color: #5a009c;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
                background: transparent;
            }
            QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
                background: transparent;
            }
        """)
        layout.addWidget(self._history, 1)

        # Workspace Title
        self._workspace_lbl = QLabel("")
        self._workspace_lbl.setStyleSheet("""
            color: #ffffff;
            font-size: 14px;
            font-weight: bold;
            padding: 8px 16px 0px 16px;
            background-color: #000000;
        """)
        layout.addWidget(self._workspace_lbl)

        # Typing Indicator
        self._typing_lbl = QLabel("")
        self._typing_lbl.setStyleSheet("""
            color: #c586c0;
            font-size: 12px;
            font-style: italic;
            padding: 0px 16px 4px 16px;
            background-color: #000000;
        """)
        self._typing_lbl.hide()
        layout.addWidget(self._typing_lbl)

        # Timer for typing animation
        self._typing_timer = QTimer(self)
        self._typing_timer.timeout.connect(self._animate_typing)
        self._typing_dots = 0

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
        self._input.setFixedHeight(50)
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
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        assets_dir = os.path.join(base_dir, "assets")

        attach_btn = QPushButton()
        attach_btn.setIcon(QIcon(os.path.join(assets_dir, "plus.svg")))
        attach_btn.setIconSize(QSize(18, 18))
        attach_btn.setFixedSize(28, 28)
        attach_btn.setToolTip("Upload File")
        attach_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none;
                border-radius: 14px;
            }
            QPushButton:hover { background-color: #333333; }
        """)
        attach_btn.clicked.connect(self.select_file_requested.emit)
        input_bottom_layout.addWidget(attach_btn)
        
        chevron_path = os.path.join(assets_dir, "chevron-up.svg").replace("\\", "/")
        self.model_dropdown = UpwardComboBox()
        self.model_dropdown.setItemDelegate(QStyledItemDelegate())
        self.model_dropdown.setVisible(False)
        self.model_dropdown.setStyleSheet("""
            QComboBox {
                background-color: transparent;
                color: #e4e4e7;
                border: 1px solid #2c2e33;
                border-radius: 4px;
                padding: 2px 8px;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                font-size: 11.5px;
                font-weight: 500;
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
                background-color: #1a1d21;
                color: #e4e4e7;
                border: 1px solid #373a40;
                border-radius: 6px;
                outline: 0px;
                padding: 4px;
            }
            QComboBox QAbstractItemView::item {
                padding: 8px 12px;
                border-radius: 4px;
                min-height: 20px;
            }
            QComboBox QAbstractItemView::item:hover {
                background-color: #2c2e33;
            }
            QComboBox QAbstractItemView::item:selected {
                background-color: #3b82f6;
                color: #ffffff;
            }
        """ % chevron_path)
        self.model_dropdown.setFixedHeight(26)
        input_bottom_layout.addWidget(self.model_dropdown)

        input_bottom_layout.addStretch()

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
                background-color: #333333;
                border: none;
                border-radius: 14px;
            }
            QPushButton:hover { background-color: #444444; }
            QPushButton:pressed { background-color: #222222; }
            QPushButton:disabled {
                background-color: #2a2a2a;
            }
        """)
        self._send_btn.clicked.connect(self._on_send_btn_clicked)
        input_bottom_layout.addWidget(self._send_btn)

        input_box_layout.addWidget(input_bottom)
        input_layout.addWidget(input_box)

        # Disclaimer
        disclaimer = QLabel("AI may make mistakes. Double-check all generated code.")
        disclaimer.setAlignment(Qt.AlignCenter)
        disclaimer.setStyleSheet("color: #666666; font-size: 10px;")
        input_layout.addWidget(disclaimer)

        layout.addWidget(input_container)

        # Show welcome message
        self._show_welcome()

    def _check_provider_status(self):
        try:
            is_active = self.db.get_providers().get("Antigravity", False)
            if is_active != self.model_dropdown.isVisible():
                self.model_dropdown.setVisible(is_active)
                if is_active:
                    self._populate_models()
        except Exception:
            pass
            
    def _populate_models(self):
        current_text = self.model_dropdown.currentText()
        self.model_dropdown.clear()
        
        # These display names must match the _MODEL_MAP in agent.py
        antigravity_models = [
            "Gemini 3.5 Flash (High)",
            "Gemini 3.5 Flash (Medium)",
            "Gemini 3.5 Flash (Low)",
            "Gemini 3.1 Pro (High)",
            "Gemini 3.1 Pro (Low)",
            "Gemini 3 Flash",
            "Gemini 2.5 Pro",
            "Claude Opus 4.6 (Thinking)",
            "Claude Sonnet 4.6 (Thinking)",
            "Claude Sonnet 4.6",
        ]
            
        self.model_dropdown.addItems(antigravity_models)
        
        if current_text in antigravity_models:
            self.model_dropdown.setCurrentText(current_text)

    def _show_welcome(self):
        pass

    def set_workspace_name(self, name: str):
        self._workspace_lbl.setText(name)

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
        if self._is_generating:
            return
        text = self._input.toPlainText().strip()
        has_attach = self._attachments_layout.count() > 0
        if text or has_attach:
            self._send_btn.setIcon(self._send_icon)
        else:
            self._send_btn.setIcon(self._mic_icon)

    def _on_send_btn_clicked(self):
        if self._is_generating:
            self.stop_requested.emit()
        else:
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
                
        self._append_user_message(display_text.strip())
        self._input.clear()
        self.clear_attachments()
        self._on_input_changed()
        
        if final_text.startswith("/"):
            self._handle_slash_command(final_text)
        else:
            self.show_typing(True)
            self.message_sent.emit(final_text)

    def _append_user_message(self, text: str):
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        # Message body wrapped in an HTML table with a full dark purple border enclosuring the text
        html = (
            f"<table style='border: 1px solid #3c0068; background-color: #161616; "
            f"               border-collapse: collapse; margin-top: 4px; margin-bottom: 4px;'>"
            f"  <tr>"
            f"    <td style='padding: 8px 10px; color: #e0e0e0; font-family: \"Segoe UI\", sans-serif; "
            f"               font-size: 11px; white-space: pre-wrap;'>{text}</td>"
            f"  </tr>"
            f"</table>"
        )
        cursor.insertHtml(html)
        cursor.insertText("\n")

        self._scroll_to_bottom()

    def show_typing(self, show: bool):
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._show_typing_signal.emit(show)
        else:
            self._safe_show_typing(show)

    def _safe_show_typing(self, show: bool):
        if show:
            self._typing_dots = 0
            self._typing_lbl.setText("<span style='color: #4facfe;'>Dardcor Agent is thinking</span>")
            self._typing_lbl.show()
            self._typing_timer.start(300)
            self._scroll_to_bottom()
        else:
            self._typing_timer.stop()
            self._typing_lbl.hide()

    def _animate_typing(self):
        self._typing_dots = (self._typing_dots + 1) % 4
        dots = "." * self._typing_dots
        color = "#4facfe" if self._typing_dots % 2 == 0 else "#6ab0ff"
        self._typing_lbl.setText(f"<span style='color: {color}; font-style: italic;'>Dardcor Agent is thinking{dots}</span>")

    def append_agent_message(self, text: str, is_html: bool = False):
        self.show_typing(False)
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._append_agent_signal.emit(text, is_html)
        else:
            self._safe_append_agent_message(text, is_html)

    def _safe_append_agent_message(self, text: str, is_html: bool = False):
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        if is_html:
            # Clean agent text/HTML response (no container borders/backgrounds as requested)
            cursor.insertHtml(text)
            cursor.insertText("\n")
        else:
            # Clean plain-text agent response by converting basic markdown to HTML
            html = self._parse_basic_markdown(text)
            cursor.insertHtml(html)
            cursor.insertText("\n\n")

        self._scroll_to_bottom()

    def _parse_basic_markdown(self, text: str) -> str:
        """A simple markdown parser for bold, italics, code blocks, and lists."""
        import html
        import re
        
        # Escape HTML first
        text = html.escape(text)
        
        # Handle thinking blocks
        def thinking_replacer(match):
            thought = match.group(1).strip()
            thought = thought.replace('\n', '<br/>')
            return (f"<div style='background-color: #1e1e1e; border: 1px solid #3e3e42; border-left: 3px solid #6c757d; "
                    f"padding: 10px; border-radius: 6px; margin-bottom: 12px; margin-top: 8px; color: #a9a9a9; font-size: 11px;'>"
                    f"<div style='color: #8a8a8a; font-weight: bold; margin-bottom: 6px;'>🧠 Proses Berpikir</div>"
                    f"<div style='line-height: 1.4;'>{thought}</div>"
                    f"</div>")
        text = re.sub(r'@@THINKING_START@@(.*?)@@THINKING_END@@', thinking_replacer, text, flags=re.DOTALL)
        
        # Handle code blocks
        def code_block_replacer(match):
            lang = match.group(1).strip()
            code = match.group(2)
            return f"<pre style='background-color: #1e1e1e; color: #d4d4d4; padding: 10px; border-radius: 4px; font-family: monospace;'>{code}</pre>"
        text = re.sub(r'```(\w*)\n(.*?)\n```', code_block_replacer, text, flags=re.DOTALL)
        
        # Handle inline code
        text = re.sub(r'`([^`]+)`', r"<code style='background-color: #333333; color: #ce9178; padding: 2px 4px; border-radius: 3px; font-family: monospace;'>\1</code>", text)
        
        # Handle bold
        text = re.sub(r'\*\*([^*]+)\*\*', r"<b>\1</b>", text)
        
        # Handle italic
        text = re.sub(r'\*([^*]+)\*', r"<i>\1</i>", text)
        
        # Handle newlines
        text = text.replace('\n', '<br/>')
        
        return f"<div style='color: #d4d4d4; font-size: 12px;'>{text}</div>"

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
                    "      <td style='padding: 6px 4px; font-weight: bold; color: #ce9178;'>/models</td>"
                    "      <td style='padding: 6px 4px;'>Melihat status provider dan model AI yang dikonfigurasi.</td>"
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

            elif cmd == "/models":
                try:
                    from ..settings.models_dialog import ModelsQuotaDialog
                    self._models_dialog = ModelsQuotaDialog(parent=None)
                    self._models_dialog.setAttribute(Qt.WA_DeleteOnClose)
                    self._models_dialog.show()
                except Exception as e:
                    self.append_system_message(f"Error opening Models Dashboard: {e}")

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
                    from ..git.panel import run_git
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
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        fmt = QTextCharFormat()
        fmt.setForeground(QColor("#858585"))
        fmt.setFontItalic(True)
        fmt.setFontPointSize(9)
        cursor.insertText(f"{text}\n\n", fmt)

        self._scroll_to_bottom()

    def append_tool_call(self, tool_name: str, args: str, status: str = "running"):
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._append_tool_call_signal.emit(tool_name, args, status)
        else:
            self._safe_append_tool_call(tool_name, args, status)

    def _safe_append_tool_call(self, tool_name: str, args: str, status: str = "running"):
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        color_map = {
            "running": "#dcdcaa",
            "success": "#4ec9b0",
            "error": "#f14c4c",
        }
        color = color_map.get(status, "#858585")

        status_icon = {
            "running": "⏳",
            "success": "✅",
            "error": "❌",
        }
        icon = status_icon.get(status, "\u2022")

        html_content = (
            f"<div style='background-color: #1e1e1e; border: 1px solid {color}; border-left: 3px solid {color}; padding: 8px; "
            f"border-radius: 6px; margin-bottom: 8px; margin-top: 4px; color: #d4d4d4; font-family: monospace; font-size: 11px;'>"
            f"<b style='color: #e0e0e0; font-size: 12px;'>{icon} {tool_name}</b> <span style='color: #858585; font-size: 10px;'>[{status.upper()}]</span><br>"
            f"<span style='color: #ce9178; display: inline-block; margin-top: 4px;'>args: {html.escape(args[:120])}{'...' if len(args) > 120 else ''}</span>"
            f"</div>"
        )
        cursor.insertHtml(html_content)
        cursor.insertText("\n")

        self._scroll_to_bottom()

    def _scroll_to_bottom(self):
        QTimer.singleShot(10, lambda: self._history.verticalScrollBar().setValue(
            self._history.verticalScrollBar().maximum()
        ))

    def clear(self):
        self._history.clear()
        self.clear_attachments()

    def set_enabled(self, enabled: bool):
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._set_enabled_signal.emit(enabled)
        else:
            self._safe_set_enabled(enabled)

    def _safe_set_enabled(self, enabled: bool):
        self._is_generating = not enabled
        self._input.setEnabled(enabled)
        self._send_btn.setEnabled(True)  # always clickable (send OR stop)
        if not enabled:
            # Switch to STOP mode — red pill button with stop icon
            self._send_btn.setIcon(self._stop_icon)
            self._send_btn.setStyleSheet("""
                QPushButton {
                    background-color: #7f1d1d;
                    border: none;
                    border-radius: 14px;
                }
                QPushButton:hover { background-color: #991b1b; }
                QPushButton:pressed { background-color: #450a0a; }
            """)
        else:
            # Restore normal send/mic mode
            self._send_btn.setStyleSheet("""
                QPushButton {
                    background-color: #333333;
                    border: none;
                    border-radius: 14px;
                }
                QPushButton:hover { background-color: #444444; }
                QPushButton:pressed { background-color: #222222; }
                QPushButton:disabled { background-color: #2a2a2a; }
            """)
            self._on_input_changed()


class ChatInput(QTextEdit):
    """Custom text input that submits on Enter."""

    submit_pressed = Signal()
    file_pasted = Signal(list)

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if not (event.modifiers() & Qt.ShiftModifier):
                self.submit_pressed.emit()
                return
        super().keyPressEvent(event)

    def insertFromMimeData(self, source):
        if source.hasUrls():
            file_paths = []
            for url in source.urls():
                if url.isLocalFile():
                    file_paths.append(url.toLocalFile())
            if file_paths:
                self.file_pasted.emit(file_paths)
                return
        super().insertFromMimeData(source)
