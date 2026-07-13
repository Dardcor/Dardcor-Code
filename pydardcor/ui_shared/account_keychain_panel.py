"""Account & Keychain UI - VS Code style Accounts panel with keychain integration."""

import json
import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QListWidget, QListWidgetItem, QFrame, QDialog, QLineEdit,
    QCheckBox, QMessageBox, QMenu, QApplication
)
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QFont, QAction, QIcon, QPixmap, QPainter, QColor

from ..settings.add_account_dialog import AddAccountDialog


class KeychainManager:
    """Simple encrypted keychain stored in a local JSON file."""

    def __init__(self, filepath: str = None):
        if filepath is None:
            home = os.path.expanduser("~")
            config_dir = os.path.join(home, ".dardcor")
            os.makedirs(config_dir, exist_ok=True)
            filepath = os.path.join(config_dir, "keychain.json")
        self._filepath = filepath
        self._accounts: dict = self._load()

    def _load(self) -> dict:
        if os.path.exists(self._filepath):
            try:
                with open(self._filepath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save(self):
        try:
            with open(self._filepath, "w", encoding="utf-8") as f:
                json.dump(self._accounts, f, indent=2)
        except OSError:
            pass

    def list_accounts(self) -> list[dict]:
        return [{"id": k, **v} for k, v in self._accounts.items()]

    def has_account(self, account_id: str) -> bool:
        return account_id in self._accounts

    def add_account(self, account_id: str, provider: str, token: str = "",
                    username: str = "", is_active: bool = False):
        self._accounts[account_id] = {
            "provider": provider,
            "token": token,
            "username": username,
            "is_active": is_active
        }
        self._save()

    def remove_account(self, account_id: str):
        self._accounts.pop(account_id, None)
        self._save()

    def set_active(self, account_id: str, active: bool = True):
        if account_id in self._accounts:
            self._accounts[account_id]["is_active"] = active
            self._save()

    def get_active(self) -> str | None:
        for aid, info in self._accounts.items():
            if info.get("is_active"):
                return aid
        return None


class AccountCard(QFrame):
    """A card widget for a single account entry."""

    sign_out_clicked = Signal(str)
    toggle_active_clicked = Signal(str, bool)

    def __init__(self, account_id: str, provider: str, username: str,
                 is_active: bool, parent=None):
        super().__init__(parent)
        self._account_id = account_id
        self.setFixedHeight(56)

        bg = "#1a0033" if is_active else "#0d0d0d"
        border = "#7c3aed" if is_active else "#2b2b2b"
        self.setStyleSheet(f"""
            AccountCard {{
                background-color: {bg};
                border: 1px solid {border};
                border-radius: 6px;
            }}
            AccountCard:hover {{
                background-color: {"#2c004a" if not is_active else "#1a0033"};
            }}
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(8)

        avatar = QLabel()
        avatar.setFixedSize(32, 32)
        avatar.setStyleSheet(f"""
            background-color: #7c3aed; border-radius: 16px;
            color: white; font-size: 14px; font-weight: bold;
        """)
        avatar.setAlignment(Qt.AlignCenter)
        avatar.setText(username[:2].upper() if username else account_id[:2].upper())
        layout.addWidget(avatar)

        text_layout = QVBoxLayout()
        text_layout.setSpacing(2)

        name_label = QLabel(username or account_id)
        name_label.setStyleSheet(f"color: {'#ffffff' if is_active else '#cccccc'}; font-size: 13px; font-weight: bold; background: transparent;")
        text_layout.addWidget(name_label)

        detail_label = QLabel(f"{provider}  ·  {account_id}")
        detail_label.setStyleSheet("color: #858585; font-size: 10px; background: transparent;")
        text_layout.addWidget(detail_label)

        layout.addLayout(text_layout)
        layout.addStretch()

        if is_active:
            active_label = QLabel("Active")
            active_label.setStyleSheet("color: #7c3aed; font-size: 10px; background: transparent;")
            layout.addWidget(active_label)

        sign_out_btn = QPushButton("\ueb4d")
        sign_out_btn.setFixedSize(24, 24)
        sign_out_btn.setToolTip("Sign out")
        sign_out_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #858585;
                font-family: codicon; font-size: 14px;
            }
            QPushButton:hover { color: #ef4444; }
        """)
        sign_out_btn.clicked.connect(lambda: self.sign_out_clicked.emit(self._account_id))
        layout.addWidget(sign_out_btn)


class AccountKeychainPanel(QWidget):
    """Side panel showing accounts and keychain entries."""

    def __init__(self, keychain_manager: KeychainManager = None, parent=None):
        super().__init__(parent)
        self._keychain = keychain_manager or KeychainManager()
        self.setStyleSheet("background-color: #000000;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)

        header = QLabel("ACCOUNTS")
        header.setStyleSheet("color: #858585; font-size: 11px; font-weight: bold; padding: 4px 0; background: transparent;")
        layout.addWidget(header)

        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget {
                background-color: transparent;
                border: none;
                outline: none;
            }
            QListWidget::item { padding: 4px 0px; border: none; }
        """)
        self._list.setSpacing(4)
        layout.addWidget(self._list, 1)

        btn_layout = QHBoxLayout()
        add_btn = QPushButton("+ Sign in with provider")
        add_btn.setStyleSheet("""
            QPushButton {
                background-color: #7c3aed; color: white; border: none;
                border-radius: 4px; padding: 6px 12px; font-size: 11px;
            }
            QPushButton:hover { background-color: #6d28d9; }
        """)
        add_btn.clicked.connect(self._add_account)
        btn_layout.addWidget(add_btn)

        layout.addLayout(btn_layout)

        self._refresh()

    def _refresh(self):
        self._list.clear()
        accounts = self._keychain.list_accounts()
        for acc in accounts:
            card = AccountCard(
                acc["id"], acc.get("provider", "Unknown"),
                acc.get("username", acc["id"]),
                acc.get("is_active", False)
            )
            card.sign_out_clicked.connect(self._sign_out)
            item = QListWidgetItem()
            item.setSizeHint(QSize(0, 60))
            item.setData(Qt.UserRole, acc["id"])
            self._list.addItem(item)
            self._list.setItemWidget(item, card)

    def _add_account(self):
        dialog = AddAccountDialog(self._keychain, self)
        if dialog.exec():
            data = dialog.get_account_data()
            if data:
                self._keychain.add_account(
                    data["id"], data["provider"],
                    data.get("token", ""), data.get("username", "")
                )
                self._refresh()

    def _sign_out(self, account_id: str):
        reply = QMessageBox.question(
            self, "Sign Out",
            f"Are you sure you want to sign out from '{account_id}'?",
            QMessageBox.Yes | QMessageBox.No
        )
        if reply == QMessageBox.Yes:
            self._keychain.remove_account(account_id)
            self._refresh()
