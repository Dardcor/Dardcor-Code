"""Chat Panel - VS Code Copilot-style AI chat sidebar."""

import json
from datetime import datetime
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit,
    QPushButton, QLabel, QFrame, QScrollArea,
)
from PySide6.QtCore import Signal, Qt, QTimer, QSize, QThread, QCoreApplication
from PySide6.QtGui import QColor, QTextCursor, QTextCharFormat, QFont, QKeyEvent, QIcon
import os

from ..core.config import get_config


class ChatPanel(QWidget):
    """VS Code Copilot Chat style panel."""

    message_sent = Signal(str)

    # Thread-safe slots signals
    _append_agent_signal = Signal(str, bool)
    _append_system_signal = Signal(str)
    _append_tool_call_signal = Signal(str, str, str)
    _set_enabled_signal = Signal(bool)

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
        new_btn.clicked.connect(self._request_new_conversation)
        header_layout.addWidget(new_btn)

        hist_btn = create_header_btn("\uea82", "History")
        header_layout.addWidget(hist_btn)

        close_btn = create_header_btn("\uea76", "Close Chat")
        close_btn.clicked.connect(self.hide)
        header_layout.addWidget(close_btn)

        layout.addWidget(header)

        # Chat history
        self._history = QTextEdit()
        self._history.setReadOnly(True)
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
        input_bottom_layout.addWidget(attach_btn)

        input_bottom_layout.addStretch()

        self._mic_icon = QIcon(os.path.join(assets_dir, "mic.svg"))
        self._send_icon = QIcon(os.path.join(assets_dir, "send.svg"))

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
        self._send_btn.clicked.connect(self._send_message)
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

    def _show_welcome(self):
        pass

    def set_workspace_name(self, name: str):
        self._workspace_lbl.setText(name)

    def _request_new_conversation(self):
        """Placeholder - connected by main_window."""
        pass

    def _on_input_changed(self):
        text = self._input.toPlainText().strip()
        if text:
            self._send_btn.setIcon(self._send_icon)
        else:
            self._send_btn.setIcon(self._mic_icon)

    def _send_message(self):
        text = self._input.toPlainText().strip()
        if not text:
            return
        self._append_user_message(text)
        self._input.clear()
        self._on_input_changed()
        
        if text.startswith("/"):
            self._handle_slash_command(text)
        else:
            self.message_sent.emit(text)

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

    def append_agent_message(self, text: str, is_html: bool = False):
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
                    dialog = ModelsQuotaDialog(self.window())
                    dialog.exec()
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
            "running": "\u23f3",
            "success": "\u2713",
            "error": "\u2717",
        }
        icon = status_icon.get(status, "\u2022")

        fmt = QTextCharFormat()
        fmt.setForeground(QColor(color))
        fmt.setFontFamily("Cascadia Code, Consolas, monospace")
        fmt.setFontPointSize(8.5)
        cursor.insertText(f"  {icon} {tool_name}({args[:60]}) [{status}]\n", fmt)

        self._scroll_to_bottom()

    def _scroll_to_bottom(self):
        QTimer.singleShot(10, lambda: self._history.verticalScrollBar().setValue(
            self._history.verticalScrollBar().maximum()
        ))

    def clear(self):
        self._history.clear()

    def set_enabled(self, enabled: bool):
        if QThread.currentThread() != QCoreApplication.instance().thread():
            self._set_enabled_signal.emit(enabled)
        else:
            self._safe_set_enabled(enabled)

    def _safe_set_enabled(self, enabled: bool):
        self._send_btn.setEnabled(enabled)
        self._input.setEnabled(enabled)
        if enabled:
            self._on_input_changed()


class ChatInput(QTextEdit):
    """Custom text input that submits on Enter."""

    submit_pressed = Signal()

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if not (event.modifiers() & Qt.ShiftModifier):
                self.submit_pressed.emit()
                return
        super().keyPressEvent(event)
