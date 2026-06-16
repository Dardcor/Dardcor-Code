"""Dialog for adding accounts to Antigravity DB."""

import time
import os
from datetime import datetime, timezone
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QWidget, QLabel, QPushButton,
    QTextEdit, QLineEdit, QFileDialog, QMessageBox, QFrame, QStackedWidget
)
from PySide6.QtCore import Qt

class AddAccountDialog(QDialog):
    def __init__(self, db, parent=None):
        super().__init__(parent)
        self.db = db
        self.setWindowTitle("Add Account")
        self.resize(500, 450)
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
            }
            QLabel {
                color: #cccccc;
                font-family: "Segoe UI", sans-serif;
            }
        """)
        self._setup_ui()
        
    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(16)
        
        # Title
        title = QLabel("Add Account")
        title.setStyleSheet("font-size: 18px; font-weight: bold; color: #ffffff;")
        main_layout.addWidget(title)
        
        # Tabs Frame (pill shape)
        tabs_frame = QFrame()
        tabs_frame.setStyleSheet("background-color: #1e1e1e; border-radius: 8px; padding: 4px;")
        tabs_frame.setFixedHeight(45)
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
                    color: #868e96;
                    border: none;
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-size: 13px;
                }
                QPushButton:checked {
                    background-color: #000000;
                    color: #1c7ed6;
                    font-weight: bold;
                }
                QPushButton:hover:!checked {
                    color: #ffffff;
                }
            """)
            btn.clicked.connect(lambda checked, idx=i: self._switch_tab(idx))
            self.tab_buttons.append(btn)
            tabs_layout.addWidget(btn)
            
        main_layout.addWidget(tabs_frame)
        
        # OAuth Page
        page_oauth = QWidget()
        oauth_layout = QVBoxLayout(page_oauth)
        oauth_layout.setContentsMargins(0, 0, 0, 0)
        oauth_info = QLabel("\U0001f310\n\nOAuth requires the Rust backend to intercept browser redirects.\n\nPlease use the Token or Import tab to add your accounts for now.")
        oauth_info.setStyleSheet("color: #868e96; font-size: 13px;")
        oauth_info.setWordWrap(True)
        oauth_info.setAlignment(Qt.AlignCenter)
        oauth_layout.addWidget(oauth_info)
        self.stack.addWidget(page_oauth)
        
        # Token Page
        page_token = QWidget()
        token_layout = QVBoxLayout(page_token)
        token_layout.setContentsMargins(0, 10, 0, 0)
        token_layout.setSpacing(12)
        
        token_label = QLabel("Refresh Token")
        token_label.setStyleSheet("font-size: 13px; font-weight: bold;")
        token_layout.addWidget(token_label)
        
        self.token_input = QTextEdit()
        self.token_input.setPlaceholderText("Paste your refresh_token here...\nExample: 1//0e...")
        self.token_input.setStyleSheet("""
            QTextEdit {
                background-color: #1e1e1e;
                color: #cccccc;
                border: 1px solid #3c0068;
                border-radius: 6px;
                padding: 10px;
                font-family: monospace;
                font-size: 12px;
            }
        """)
        token_layout.addWidget(self.token_input)
        
        btn_layout = QHBoxLayout()
        btn_layout.setSpacing(10)
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setCursor(Qt.PointingHandCursor)
        cancel_btn.clicked.connect(self.reject)
        cancel_btn.setStyleSheet("background-color: #1e1e1e; color: #ffffff; padding: 10px; border-radius: 8px; border: none; font-weight: bold;")
        
        submit_btn = QPushButton("Confirm")
        submit_btn.setCursor(Qt.PointingHandCursor)
        submit_btn.clicked.connect(self._on_submit_token)
        submit_btn.setStyleSheet("background-color: #1c7ed6; color: #ffffff; padding: 10px; border-radius: 8px; font-weight: bold; border: none;")
        
        btn_layout.addWidget(cancel_btn)
        btn_layout.addWidget(submit_btn)
        token_layout.addLayout(btn_layout)
        self.stack.addWidget(page_token)
        
        # Import Page
        page_import = QWidget()
        import_layout = QVBoxLayout(page_import)
        import_layout.setContentsMargins(0, 10, 0, 0)
        
        import_info = QLabel("Import accounts from an existing Antigravity Manager JSON backup.")
        import_info.setStyleSheet("color: #868e96; font-size: 13px; margin-bottom: 20px;")
        import_info.setWordWrap(True)
        import_layout.addWidget(import_info)
        
        import_btn = QPushButton("\U0001f4c2 Import JSON Database")
        import_btn.setCursor(Qt.PointingHandCursor)
        import_btn.setStyleSheet("""
            QPushButton {
                background-color: #1e1e1e;
                color: #cccccc;
                border: 1px solid #3c0068;
                border-radius: 8px;
                padding: 15px;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #2b1114;
                border: 1px solid #e03131;
            }
        """)
        import_btn.clicked.connect(self._on_import_db)
        import_layout.addWidget(import_btn)
        import_layout.addStretch()
        self.stack.addWidget(page_import)
        
        main_layout.addWidget(self.stack)
        
    def _switch_tab(self, index):
        for i, btn in enumerate(self.tab_buttons):
            btn.setChecked(i == index)
        self.stack.setCurrentIndex(index)
        
    def _on_submit_token(self):
        token_text = self.token_input.toPlainText().strip()
        if not token_text:
            QMessageBox.warning(self, "Error", "Please enter a refresh token.")
            return
            
        # 1. Try to parse as JSON list
        tokens = []
        try:
            if token_text.startswith('[') and token_text.endswith(']'):
                import json as py_json
                parsed = py_json.loads(token_text)
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
            import re
            matches = re.findall(r'1//[a-zA-Z0-9_\-]+', token_text)
            if matches:
                tokens = list(set(matches))

        # 3. If still nothing, treat the entire text as a single token
        if not tokens:
            tokens = [token_text]

        success_count = 0
        current_data = self.db.load_data()
        accounts = current_data.get("accounts", [])
        
        from datetime import datetime, timezone
        
        for i, token in enumerate(tokens):
            email = self.db.resolve_refresh_token(token)
            
            # Avoid duplicate emails
            if any(acc.get("email") == email for acc in accounts):
                continue
                
            mock_account = {
                "id": f"acc_{int(time.time())}_{i}",
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
            accounts.append(mock_account)
            success_count += 1

        if success_count > 0:
            current_data["accounts"] = accounts
            self.db.save_data(current_data)
            QMessageBox.information(self, "Success", f"Successfully added {success_count} account(s)!")
            self.accept()
        else:
            QMessageBox.warning(self, "Warning", "No new accounts were added (they might already exist).")
        
    def _on_import_db(self):
        filename, _ = QFileDialog.getOpenFileName(self, "Import Accounts", "", "JSON Files (*.json)")
        if filename:
            added = self.db.import_data(filename)
            if added > 0:
                QMessageBox.information(self, "Success", f"Successfully imported {added} accounts.")
                self.accept()
            else:
                QMessageBox.warning(self, "Warning", "No new accounts imported.")
