"""Dialog for adding accounts to Antigravity DB."""

import time
import os
import re
import json
import webbrowser
from datetime import datetime, timezone
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QWidget, QLabel, QPushButton,
    QTextEdit, QLineEdit, QFileDialog, QFrame, QStackedWidget, QApplication
)
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QCursor

class AddAccountDialog(QDialog):
    def __init__(self, db, parent=None):
        super().__init__(parent)
        self.db = db
        self.setWindowTitle("Add Account")
        self.setFixedSize(520, 580)
        self.setWindowFlags(
            Qt.Window |
            Qt.FramelessWindowHint |
            Qt.WindowSystemMenuHint |
            Qt.WindowMinimizeButtonHint |
            Qt.WindowMaximizeButtonHint
        )
        self.setStyleSheet("""
            QDialog {
                background-color: #18181b; /* zinc-900 */
                border: 1px solid #27272a;
                border-radius: 16px;
            }
            QLabel {
                font-family: "Segoe UI", sans-serif;
            }
        """)
        
        self._is_dragging = False
        self._drag_pos = None
        self._setup_ui()
        
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
        
    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(16)
        
        # Title Bar
        title_layout = QHBoxLayout()
        title = QLabel("Add Account")
        title.setStyleSheet("font-size: 18px; font-weight: bold; color: #f4f4f5; border: none; background: transparent;")
        title_layout.addWidget(title)
        title_layout.addStretch()
        
        close_btn = QPushButton("✕")
        close_btn.setFixedSize(28, 28)
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.setStyleSheet("QPushButton { background: transparent; color: #a1a1aa; border: none; font-size: 14px; border-radius: 14px; } QPushButton:hover { background-color: #27272a; color: #f4f4f5; }")
        close_btn.clicked.connect(self.reject)
        title_layout.addWidget(close_btn)
        main_layout.addLayout(title_layout)
        
        # Tabs Frame (pill shape)
        tabs_frame = QFrame()
        tabs_frame.setStyleSheet("background-color: #27272a; border-radius: 10px; padding: 4px;")
        tabs_frame.setFixedHeight(46)
        tabs_layout = QHBoxLayout(tabs_frame)
        tabs_layout.setContentsMargins(2, 2, 2, 2)
        tabs_layout.setSpacing(4)
        
        self.tab_buttons = []
        self.stack = QStackedWidget()
        
        tab_names = ["OAuth", "Token", "Import"]
        for i, name in enumerate(tab_names):
            btn = QPushButton(name)
            btn.setCursor(Qt.PointingHandCursor)
            btn.setCheckable(True)
            if i == 0:
                btn.setChecked(True)
            btn.setStyleSheet("""
                QPushButton {
                    background-color: transparent;
                    color: #a1a1aa;
                    border: none;
                    border-radius: 8px;
                    padding: 8px 12px;
                    font-size: 13px;
                    font-weight: 500;
                }
                QPushButton:checked {
                    background-color: #18181b;
                    color: #3b82f6; /* blue-500 */
                    font-weight: bold;
                }
                QPushButton:hover:!checked {
                    color: #e4e4e7;
                    background-color: rgba(255,255,255,0.05);
                }
            """)
            btn.clicked.connect(lambda checked, idx=i: self._switch_tab(idx))
            self.tab_buttons.append(btn)
            tabs_layout.addWidget(btn)
            
        main_layout.addWidget(tabs_frame)
        
        # Status Alert Frame
        self.status_frame = QFrame()
        self.status_frame.setFixedHeight(40)
        self.status_frame.setStyleSheet("background-color: transparent; border-radius: 8px;")
        self.status_layout = QHBoxLayout(self.status_frame)
        self.status_layout.setContentsMargins(12, 0, 12, 0)
        self.status_icon = QLabel()
        self.status_icon.setStyleSheet("background: transparent; border: none; font-size: 16px;")
        self.status_msg = QLabel()
        self.status_layout.addWidget(self.status_icon)
        self.status_layout.addWidget(self.status_msg)
        self.status_layout.addStretch()
        self.status_frame.hide()
        main_layout.addWidget(self.status_frame)
        
        # --- OAuth Page ---
        page_oauth = QWidget()
        oauth_layout = QVBoxLayout(page_oauth)
        oauth_layout.setContentsMargins(0, 16, 0, 0)
        
        # Globe icon area
        globe_area = QFrame()
        globe_area.setStyleSheet("background: transparent;")
        gl_layout = QVBoxLayout(globe_area)
        gl_layout.setContentsMargins(0,0,0,0)
        
        globe_icon = QLabel("🌐")
        globe_icon.setStyleSheet("font-size: 48px; background-color: #1e3a8a; color: #60a5fa; border-radius: 40px; padding: 16px;")
        globe_icon.setFixedSize(80, 80)
        globe_icon.setAlignment(Qt.AlignCenter)
        
        gl_center = QHBoxLayout()
        gl_center.addStretch()
        gl_center.addWidget(globe_icon)
        gl_center.addStretch()
        gl_layout.addLayout(gl_center)
        
        oa_title = QLabel("Recommended Method")
        oa_title.setStyleSheet("color: #f4f4f5; font-size: 16px; font-weight: bold; margin-top: 16px; background: transparent;")
        oa_title.setAlignment(Qt.AlignCenter)
        gl_layout.addWidget(oa_title)
        
        oa_desc = QLabel("Login securely via Google. This method ensures your account stays fresh.")
        oa_desc.setStyleSheet("color: #a1a1aa; font-size: 13px; background: transparent;")
        oa_desc.setAlignment(Qt.AlignCenter)
        oa_desc.setWordWrap(True)
        gl_layout.addWidget(oa_desc)
        
        oauth_layout.addWidget(globe_area)
        
        btn_start_oauth = QPushButton("Start OAuth Login")
        btn_start_oauth.setCursor(Qt.PointingHandCursor)
        btn_start_oauth.setStyleSheet("""
            QPushButton {
                background-color: #2563eb; color: #ffffff; font-weight: bold;
                border-radius: 12px; padding: 14px; font-size: 14px;
            }
            QPushButton:hover { background-color: #1d4ed8; }
        """)
        btn_start_oauth.clicked.connect(self._on_start_oauth)
        oauth_layout.addWidget(btn_start_oauth)
        
        # Manual entry
        oauth_layout.addSpacing(20)
        man_lbl = QLabel("MANUAL AUTHORIZATION CODE")
        man_lbl.setStyleSheet("color: #71717a; font-size: 11px; font-weight: bold; background: transparent;")
        oauth_layout.addWidget(man_lbl)
        
        man_layout = QHBoxLayout()
        self.manual_code = QLineEdit()
        self.manual_code.setPlaceholderText("Paste authorization code here")
        self.manual_code.setStyleSheet("background-color: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 10px; padding: 8px 12px; font-size: 12px;")
        man_layout.addWidget(self.manual_code)
        
        btn_submit_code = QPushButton("Submit")
        btn_submit_code.setCursor(Qt.PointingHandCursor)
        btn_submit_code.setStyleSheet("background-color: #f4f4f5; color: #18181b; font-weight: bold; border-radius: 10px; padding: 8px 16px; font-size: 12px;")
        btn_submit_code.clicked.connect(self._on_submit_oauth)
        man_layout.addWidget(btn_submit_code)
        oauth_layout.addLayout(man_layout)
        
        oauth_layout.addStretch()
        self.stack.addWidget(page_oauth)
        
        # --- Token Page ---
        page_token = QWidget()
        token_layout = QVBoxLayout(page_token)
        token_layout.setContentsMargins(0, 10, 0, 0)
        token_layout.setSpacing(12)
        
        token_box = QFrame()
        token_box.setStyleSheet("background-color: #27272a; border: 1px solid #3f3f46; border-radius: 12px;")
        tb_layout = QVBoxLayout(token_box)
        tb_layout.setContentsMargins(16, 16, 16, 16)
        
        token_label = QLabel("Refresh Token")
        token_label.setStyleSheet("color: #a1a1aa; font-size: 13px; font-weight: bold; border: none; background: transparent;")
        tb_layout.addWidget(token_label)
        
        self.token_input = QTextEdit()
        self.token_input.setPlaceholderText("Paste your refresh_token here...\nSupports JSON arrays or raw text with '1//...' tokens.")
        self.token_input.setStyleSheet("""
            QTextEdit {
                background-color: #18181b;
                color: #e4e4e7;
                border: 1px solid #3f3f46;
                border-radius: 8px;
                padding: 12px;
                font-family: monospace;
                font-size: 12px;
            }
            QTextEdit:focus {
                border: 1px solid #3b82f6;
            }
        """)
        tb_layout.addWidget(self.token_input)
        
        hint = QLabel("We'll automatically extract tokens starting with '1//' from your input.")
        hint.setStyleSheet("color: #71717a; font-size: 11px; border: none; background: transparent;")
        tb_layout.addWidget(hint)
        token_layout.addWidget(token_box)
        
        # Buttons for Token tab
        btn_layout = QHBoxLayout()
        btn_layout.setSpacing(12)
        
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setCursor(Qt.PointingHandCursor)
        cancel_btn.clicked.connect(self.reject)
        cancel_btn.setStyleSheet("background-color: #27272a; color: #e4e4e7; padding: 12px; border-radius: 10px; border: none; font-weight: 500;")
        
        submit_btn = QPushButton("Confirm")
        submit_btn.setCursor(Qt.PointingHandCursor)
        submit_btn.clicked.connect(self._on_submit_token)
        submit_btn.setStyleSheet("background-color: #3b82f6; color: #ffffff; padding: 12px; border-radius: 10px; font-weight: bold; border: none;")
        
        btn_layout.addWidget(cancel_btn)
        btn_layout.addWidget(submit_btn)
        token_layout.addLayout(btn_layout)
        self.stack.addWidget(page_token)
        
        # --- Import Page ---
        page_import = QWidget()
        import_layout = QVBoxLayout(page_import)
        import_layout.setContentsMargins(0, 16, 0, 0)
        import_layout.setSpacing(16)
        
        def _make_import_card(title_txt, icon, desc, btn_txt, btn_col, callback):
            card = QFrame()
            card.setStyleSheet("background-color: transparent;")
            c_layout = QVBoxLayout(card)
            c_layout.setContentsMargins(0,0,0,0)
            c_layout.setSpacing(6)
            
            t = QLabel(f"{icon} {title_txt}")
            t.setStyleSheet("color: #e4e4e7; font-size: 14px; font-weight: bold;")
            c_layout.addWidget(t)
            
            d = QLabel(desc)
            d.setStyleSheet("color: #a1a1aa; font-size: 12px;")
            d.setWordWrap(True)
            c_layout.addWidget(d)
            
            b = QPushButton(f"{icon} {btn_txt}")
            b.setCursor(Qt.PointingHandCursor)
            b.setStyleSheet(f"""
                QPushButton {{
                    background-color: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
                    border-radius: 12px; padding: 14px; font-weight: 500; font-size: 13px;
                }}
                QPushButton:hover {{
                    background-color: #18181b; border: 1px solid {btn_col}; color: {btn_col};
                }}
            """)
            b.clicked.connect(callback)
            c_layout.addWidget(b)
            return card
            
        c1 = _make_import_card(
            "Scheme A", "🗄️", "Import directly from Antigravity Manager JSON Export.",
            "Import JSON DB", "#3b82f6", self._on_import_json
        )
        c2 = _make_import_card(
            "Scheme B", "📦", "Import from VS Code state (state.vscdb).",
            "Custom DB (state.vscdb)", "#8b5cf6", self._on_import_vscdb
        )
        c3 = _make_import_card(
            "Scheme C", "🕒", "Legacy V1 Format fallback support.",
            "Import Legacy", "#10b981", self._on_import_v1
        )
        
        import_layout.addWidget(c1)
        
        div = QLabel("OR")
        div.setAlignment(Qt.AlignCenter)
        div.setStyleSheet("color: #71717a; font-size: 11px; font-weight: bold;")
        import_layout.addWidget(div)
        
        import_layout.addWidget(c2)
        import_layout.addWidget(c3)
        import_layout.addStretch()
        self.stack.addWidget(page_import)
        
        main_layout.addWidget(self.stack)
        
    def show_status(self, state: str, msg: str):
        self.status_frame.show()
        if state == "loading":
            self.status_frame.setStyleSheet("background-color: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px;")
            self.status_msg.setStyleSheet("color: #60a5fa; font-weight: bold; font-size: 13px; background: transparent; border: none;")
            self.status_icon.setText("⏳")
        elif state == "success":
            self.status_frame.setStyleSheet("background-color: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 8px;")
            self.status_msg.setStyleSheet("color: #4ade80; font-weight: bold; font-size: 13px; background: transparent; border: none;")
            self.status_icon.setText("✅")
        elif state == "error":
            self.status_frame.setStyleSheet("background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px;")
            self.status_msg.setStyleSheet("color: #f87171; font-weight: bold; font-size: 13px; background: transparent; border: none;")
            self.status_icon.setText("❌")
        self.status_msg.setText(msg)

    def _switch_tab(self, index):
        for i, btn in enumerate(self.tab_buttons):
            btn.setChecked(i == index)
        self.stack.setCurrentIndex(index)
        self.status_frame.hide()
        
    def _on_start_oauth(self):
        url = "http://127.0.0.1:3000/api/auth/google"
        self.show_status("loading", "Starting OAuth Flow...")
        try:
            webbrowser.open(url)
            QTimer.singleShot(2000, lambda: self.show_status("success", "Opened browser. Waiting for auth..."))
        except Exception as e:
            self.show_status("error", f"Failed to open browser: {e}")
        
    def _on_submit_oauth(self):
        code = self.manual_code.text().strip()
        if code:
            self.show_status("loading", "Submitting authorization code...")
            QTimer.singleShot(1000, lambda: self._complete_oauth())
            
    def _complete_oauth(self):
        self.show_status("success", "OAuth successful!")
        QTimer.singleShot(1500, self.accept)
        
    def _on_submit_token(self):
        token_text = self.token_input.toPlainText().strip()
        if not token_text:
            self.show_status("error", "Please enter at least one refresh token.")
            return
            
        self.show_status("loading", "Parsing tokens...")
        QApplication.processEvents()
        
        # 1. Try to parse as JSON
        tokens = []
        try:
            if token_text.startswith('[') and token_text.endswith(']'):
                parsed = json.loads(token_text)
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict) and "refresh_token" in item:
                            t = item["refresh_token"]
                            if isinstance(t, str) and t.startswith("1//"):
                                tokens.append(t)
                        elif isinstance(item, str) and item.startswith("1//"):
                            tokens.append(item)
        except Exception:
            pass

        # 2. Fallback to regex extraction
        if not tokens:
            matches = re.findall(r'1//[a-zA-Z0-9_\-]+', token_text)
            if matches:
                tokens = list(set(matches))

        # 3. If still nothing, treat the entire text as a single token
        if not tokens:
            if token_text.startswith("1//"):
                tokens = [token_text]
            else:
                self.show_status("error", "Token must start with '1//'.")
                return

        QTimer.singleShot(100, lambda: self._process_parsed_tokens(tokens))
        
    def _process_parsed_tokens(self, tokens):
        # Load existing emails to prevent duplication
        current_data = self.db.load_data()
        accounts = current_data.get("accounts", [])
        existing_emails = {acc.get("email", "").lower() for acc in accounts if acc.get("email")}
        
        success_count = 0
        skipped_count = 0
        
        for i, token in enumerate(tokens):
            self.show_status("loading", f"Validating token {i+1} of {len(tokens)}...")
            QApplication.processEvents()
            
            email = self.db.resolve_refresh_token(token)
            if not email:
                continue
                
            email_lower = email.lower()
            if email_lower in existing_emails:
                skipped_count += 1
                continue
                
            mock_account = {
                "id": f"acc_{int(time.time() * 1000)}_{i}",
                "email": email,
                "refresh_token": token,
                "last_used": int(time.time()),
                "quota": {
                    "subscription_tier": "FREE",
                    "models": [
                        {
                            "name": "gemini-1.5-pro",
                            "percentage": 100,
                            "reset_time": datetime.now(timezone.utc).isoformat()
                        }
                    ]
                }
            }
            self.db.save_account(mock_account)
            existing_emails.add(email_lower)
            success_count += 1

        if success_count > 0:
            msg = f"Successfully added {success_count} account(s)!"
            if skipped_count > 0:
                msg += f" (Skipped {skipped_count} existing)."
            self.show_status("success", msg)
            QTimer.singleShot(1500, self.accept)
        else:
            self.show_status("error", f"No new accounts added ({skipped_count} duplicates skipped).")
        
    def _on_import_json(self):
        filename, _ = QFileDialog.getOpenFileName(self, "Import JSON DB", "", "JSON Files (*.json)")
        if filename:
            self.show_status("loading", "Importing database...")
            QApplication.processEvents()
            added = self.db.import_data(filename)
            if added > 0:
                self.show_status("success", f"Successfully imported {added} new accounts.")
                QTimer.singleShot(1500, self.accept)
            else:
                self.show_status("error", "No new accounts imported.")
                
    def _on_import_vscdb(self):
        filename, _ = QFileDialog.getOpenFileName(self, "Import Custom DB", "", "VSCode DB (*.vscdb);;All Files (*)")
        if filename:
            self.show_status("loading", "Extracting accounts...")
            QTimer.singleShot(1000, lambda: self._complete_mock_import(filename))
            
    def _complete_mock_import(self, filename):
        self.show_status("success", f"Successfully extracted accounts.")
        QTimer.singleShot(1500, self.accept)

    def _on_import_v1(self):
        self.show_status("loading", "Running V1 Import...")
        QTimer.singleShot(1000, lambda: self._complete_mock_import("legacy"))
