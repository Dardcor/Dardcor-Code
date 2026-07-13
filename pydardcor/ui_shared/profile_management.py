"""Profile Management UI - VS Code style profile management."""

import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QListWidget, QListWidgetItem, QWidget, QFrame, QInputDialog,
    QMessageBox, QFileDialog, QApplication
)
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QFont, QColor

from ..settings.profile import ProfileManager


class ProfileCard(QFrame):
    """A card representing a single profile in the list."""

    switch_clicked = Signal(str)
    delete_clicked = Signal(str)
    export_clicked = Signal(str)

    def __init__(self, profile_name: str, is_active: bool, is_builtin: bool = False, parent=None):
        super().__init__(parent)
        self._profile_name = profile_name
        self._is_active = is_active
        self.setFixedHeight(56)
        self.setCursor(Qt.PointingHandCursor)

        bg = "#1a0033" if is_active else "#0d0d0d"
        border = "#7c3aed" if is_active else "#2b2b2b"
        self.setStyleSheet(f"""
            ProfileCard {{
                background-color: {bg};
                border: 1px solid {border};
                border-left: 3px solid {"#7c3aed" if is_active else "transparent"};
                border-radius: 6px;
            }}
            ProfileCard:hover {{
                background-color: {"#2c004a" if not is_active else "#1a0033"};
            }}
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(8)

        icon = QLabel("\uea77" if is_builtin else "\ueb51")
        icon.setFont(QFont("codicon", 18))
        icon.setStyleSheet(f"color: {'#7c3aed' if is_active else '#858585'}; background: transparent;")
        icon.setFixedWidth(24)
        layout.addWidget(icon)

        text_layout = QVBoxLayout()
        text_layout.setSpacing(2)

        name_label = QLabel(profile_name)
        name_label.setStyleSheet(f"color: {'#ffffff' if is_active else '#cccccc'}; font-size: 13px; font-weight: bold; background: transparent;")
        text_layout.addWidget(name_label)

        if is_active:
            active_label = QLabel("Active")
            active_label.setStyleSheet("color: #7c3aed; font-size: 10px; background: transparent;")
            text_layout.addWidget(active_label)

        layout.addLayout(text_layout)
        layout.addStretch()

        if not is_active:
            switch_btn = QPushButton("Switch")
            switch_btn.setFixedSize(60, 24)
            switch_btn.setStyleSheet("""
                QPushButton {
                    background-color: #7c3aed; color: white; border: none;
                    border-radius: 4px; font-size: 11px;
                }
                QPushButton:hover { background-color: #6d28d9; }
            """)
            switch_btn.clicked.connect(lambda: self.switch_clicked.emit(self._profile_name))
            layout.addWidget(switch_btn)

        export_btn = QPushButton("\ueb41")
        export_btn.setFixedSize(24, 24)
        export_btn.setToolTip("Export Profile")
        export_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #858585; font-family: codicon; font-size: 14px;
            }
            QPushButton:hover { color: #cccccc; }
        """)
        export_btn.clicked.connect(lambda: self.export_clicked.emit(self._profile_name))
        layout.addWidget(export_btn)


class ProfileManagementDialog(QDialog):
    """VS Code style Profile Management dialog."""

    profile_switched = Signal(str)

    def __init__(self, profile_manager: ProfileManager, parent=None):
        super().__init__(parent)
        self._profile_manager = profile_manager
        self.setWindowTitle("Profile Management")
        self.setFixedSize(520, 480)
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 8px;
            }
        """)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self._setup_ui()
        self._refresh_list()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 16)
        layout.setSpacing(12)

        header = QHBoxLayout()
        title = QLabel("Profile Management")
        title.setStyleSheet("color: #ffffff; font-size: 18px; font-weight: bold; background: transparent;")
        header.addWidget(title)
        header.addStretch()

        close_btn = QPushButton("✕")
        close_btn.setFixedSize(28, 28)
        close_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #858585; border: none;
                font-size: 16px; border-radius: 14px;
            }
            QPushButton:hover { background-color: #27272a; color: #ffffff; }
        """)
        close_btn.clicked.connect(self.reject)
        header.addWidget(close_btn)
        layout.addLayout(header)

        desc = QLabel("Profiles let you customize settings, keybindings, snippets, and extensions for different workflows.")
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #858585; font-size: 12px; background: transparent;")
        layout.addWidget(desc)

        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget {
                background-color: transparent;
                border: none;
                outline: none;
            }
            QListWidget::item {
                padding: 4px 0px;
                border: none;
            }
        """)
        self._list.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self._list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._list.setSpacing(4)
        layout.addWidget(self._list, 1)

        btn_bar = QHBoxLayout()
        btn_bar.setSpacing(8)

        create_btn = QPushButton("\uea60  Create Profile")
        create_btn.setStyleSheet("""
            QPushButton {
                background-color: #7c3aed; color: white; border: none;
                border-radius: 6px; padding: 8px 16px; font-size: 12px;
            }
            QPushButton:hover { background-color: #6d28d9; }
        """)
        create_btn.clicked.connect(self._create_profile)
        btn_bar.addWidget(create_btn)

        delete_btn = QPushButton("\uea76  Delete")
        delete_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent; color: #ef4444; border: 1px solid #ef4444;
                border-radius: 6px; padding: 8px 16px; font-size: 12px;
            }
            QPushButton:hover { background-color: rgba(239,68,68,0.1); }
        """)
        delete_btn.clicked.connect(self._delete_profile)
        btn_bar.addWidget(delete_btn)

        import_btn = QPushButton("\ueab4  Import")
        import_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent; color: #cccccc; border: 1px solid #3c0068;
                border-radius: 6px; padding: 8px 16px; font-size: 12px;
            }
            QPushButton:hover { background-color: #1a0033; }
        """)
        import_btn.clicked.connect(self._import_profile)
        btn_bar.addWidget(import_btn)

        layout.addLayout(btn_bar)

    def _refresh_list(self):
        self._list.clear()
        active = self._profile_manager.get_active_profile()
        profiles = self._profile_manager.get_profiles()

        for name in profiles:
            is_active = name == active
            is_builtin = name == "Default"
            card = ProfileCard(name, is_active, is_builtin)
            card.switch_clicked.connect(self._switch_profile)
            card.export_clicked.connect(self._export_profile)
            card.delete_clicked.connect(self._delete_specific)

            item = QListWidgetItem()
            item.setSizeHint(QSize(0, 60))
            item.setData(Qt.UserRole, name)
            self._list.addItem(item)
            self._list.setItemWidget(item, card)

    def _switch_profile(self, name: str):
        self._profile_manager.switch_profile(name)
        self.profile_switched.emit(name)
        self._refresh_list()

    def _create_profile(self):
        name, ok = QInputDialog.getText(self, "Create Profile", "Profile name:")
        if ok and name.strip():
            if self._profile_manager.create_profile(name.strip()):
                self._refresh_list()
            else:
                QMessageBox.warning(self, "Error", f"Profile '{name}' already exists or is invalid.")

    def _delete_profile(self):
        name = self._get_selected_profile()
        if name and name != "Default" and name != self._profile_manager.get_active_profile():
            reply = QMessageBox.question(
                self, "Delete Profile",
                f"Are you sure you want to delete '{name}'?",
                QMessageBox.Yes | QMessageBox.No
            )
            if reply == QMessageBox.Yes:
                self._profile_manager.delete_profile(name)
                self._refresh_list()

    def _delete_specific(self, name: str):
        if name != "Default" and name != self._profile_manager.get_active_profile():
            reply = QMessageBox.question(
                self, "Delete Profile",
                f"Are you sure you want to delete '{name}'?",
                QMessageBox.Yes | QMessageBox.No
            )
            if reply == QMessageBox.Yes:
                self._profile_manager.delete_profile(name)
                self._refresh_list()

    def _export_profile(self, name: str):
        filepath, _ = QFileDialog.getSaveFileName(
            self, "Export Profile", f"{name}.dardcor-profile",
            "Dardcor Profile (*.dardcor-profile);;JSON (*.json)"
        )
        if filepath:
            if self._profile_manager.export_profile(name, filepath):
                QMessageBox.information(self, "Export", f"Profile '{name}' exported successfully.")
            else:
                QMessageBox.warning(self, "Error", f"Failed to export profile '{name}'.")

    def _import_profile(self):
        filepath, _ = QFileDialog.getOpenFileName(
            self, "Import Profile", "",
            "Dardcor Profile (*.dardcor-profile);;JSON (*.json)"
        )
        if filepath:
            if self._profile_manager.import_profile(filepath):
                self._refresh_list()
                QMessageBox.information(self, "Import", "Profile imported successfully.")
            else:
                QMessageBox.warning(self, "Error", "Failed to import profile.")

    def _get_selected_profile(self) -> str:
        item = self._list.currentItem()
        if item:
            return item.data(Qt.UserRole)
        return None
