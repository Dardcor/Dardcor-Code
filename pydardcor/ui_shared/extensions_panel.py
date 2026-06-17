"""Extensions Panel - VS Code style extensions sidebar."""

import os
import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QTreeWidget, QTreeWidgetItem, QFileDialog,
    QMessageBox, QCheckBox, QFrame, QSizePolicy
)
from PySide6.QtCore import Signal, Qt, QSize, QTimer
from PySide6.QtGui import QColor, QFont, QIcon

from ..engine.extension_manager import get_extension_manager, InstalledExtension


class OnlineExtensionCard(QWidget):
    install_requested = Signal(str)

    def __init__(self, ext_dict: dict, is_installed: bool = False, parent=None):
        super().__init__(parent)
        self._ext = ext_dict
        self._is_installed = is_installed
        self._setup_ui()

    def _setup_ui(self):
        self.setFixedHeight(100)
        self.setStyleSheet("""
            QWidget {
                background-color: #0d001a;
                border: 1px solid #2c004a;
                border-radius: 6px;
            }
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(12)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(4)

        name_label = QLabel(self._ext.get("display_name", self._ext.get("name", "")))
        name_label.setStyleSheet("color: #cccccc; font-size: 13px; font-weight: bold; border: none;")
        info_layout.addWidget(name_label)

        version_label = QLabel(f"v{self._ext.get('version', '0.0.0')}  by {self._ext.get('publisher', '')}")
        version_label.setStyleSheet("color: #858585; font-size: 11px; border: none;")
        info_layout.addWidget(version_label)

        desc_label = QLabel(self._ext.get("description", "No description"))
        desc_label.setStyleSheet("color: #999999; font-size: 11px; border: none;")
        desc_label.setWordWrap(True)
        desc_label.setMaximumHeight(30)
        info_layout.addWidget(desc_label)

        layout.addLayout(info_layout, 1)

        btn_layout = QVBoxLayout()
        btn_layout.setSpacing(4)

        installs_label = QLabel(f"📥 {self._ext.get('download_count', 0):,}")
        installs_label.setStyleSheet("color: #858585; font-size: 10px; border: none;")
        btn_layout.addWidget(installs_label)

        self.action_btn = QPushButton("Install" if not self._is_installed else "Installed")
        self.action_btn.setEnabled(not self._is_installed)
        self.action_btn.setFixedSize(80, 28)
        self.action_btn.setCursor(Qt.PointingHandCursor)
        self.action_btn.setStyleSheet("""
            QPushButton {
                background-color: #3c0068; color: #ffffff; border: none;
                border-radius: 4px; font-size: 11px; font-weight: bold;
            }
            QPushButton:hover { background-color: #4a0072; }
            QPushButton:disabled { background-color: #2a2a2a; color: #858585; }
        """)
        self.action_btn.clicked.connect(lambda: self.install_requested.emit(self._ext["id"]))
        btn_layout.addWidget(self.action_btn)

        layout.addLayout(btn_layout)


class ExtensionCard(QWidget):
    uninstall_requested = Signal(str)
    toggle_requested = Signal(str, bool)

    def __init__(self, ext: InstalledExtension, parent=None):
        super().__init__(parent)
        self._ext = ext
        self._setup_ui()

    def _setup_ui(self):
        self.setFixedHeight(100)
        self.setStyleSheet("""
            QWidget {
                background-color: #1a0033;
                border: 1px solid #2c004a;
                border-radius: 6px;
            }
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(12)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(4)

        name_label = QLabel(self._ext.display_name or self._ext.name)
        name_label.setStyleSheet("color: #cccccc; font-size: 13px; font-weight: bold; border: none;")
        info_layout.addWidget(name_label)

        version_label = QLabel(f"v{self._ext.version}  by {self._ext.publisher}")
        version_label.setStyleSheet("color: #858585; font-size: 11px; border: none;")
        info_layout.addWidget(version_label)

        desc_label = QLabel(self._ext.description or "No description")
        desc_label.setStyleSheet("color: #999999; font-size: 11px; border: none;")
        desc_label.setWordWrap(True)
        desc_label.setMaximumHeight(30)
        info_layout.addWidget(desc_label)

        layout.addLayout(info_layout, 1)

        btn_layout = QVBoxLayout()
        btn_layout.setSpacing(4)

        self._enable_cb = QCheckBox("Enabled")
        self._enable_cb.setChecked(self._ext.enabled)
        self._enable_cb.setStyleSheet("""
            QCheckBox { color: #cccccc; font-size: 11px; border: none; spacing: 6px; }
            QCheckBox::indicator { width: 14px; height: 14px; border: 1px solid #555555; border-radius: 3px; background: #2a2a2a; }
            QCheckBox::indicator:checked { background: #4a0072; border-color: #6b21a8; }
            QCheckBox::indicator:hover { border-color: #888888; }
        """)
        self._enable_cb.toggled.connect(lambda checked: self.toggle_requested.emit(self._ext.name, checked))
        btn_layout.addWidget(self._enable_cb)

        uninstall_btn = QPushButton("Uninstall")
        uninstall_btn.setFixedSize(80, 28)
        uninstall_btn.setCursor(Qt.PointingHandCursor)
        uninstall_btn.setStyleSheet("""
            QPushButton {
                background-color: #c42b1c; color: #ffffff; border: none;
                border-radius: 4px; font-size: 11px; font-weight: bold;
            }
            QPushButton:hover { background-color: #e04838; }
        """)
        uninstall_btn.clicked.connect(lambda: self.uninstall_requested.emit(self._ext.name))
        btn_layout.addWidget(uninstall_btn)

        layout.addLayout(btn_layout)


class ExtensionsPanel(QWidget):
    extension_installed = Signal(str)

    _results_ready = Signal(str, list)
    _status_signal = Signal(str)
    _install_done = Signal(bool, str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._ext_manager = get_extension_manager()
        self._cards = []
        self._search_timer = QTimer()
        self._search_timer.setSingleShot(True)
        self._search_timer.setInterval(500)
        self._search_timer.timeout.connect(self._do_marketplace_search)
        self._online_results = []
        self._search_seq = 0
        self.setObjectName("extensionsPanel")
        self._results_ready.connect(self._render_online_results)
        self._status_signal.connect(self._set_status)
        self._install_done.connect(self._on_install_done)
        self._setup_ui()
        self._refresh_extensions()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #000000;")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(20, 0, 8, 0)

        title = QLabel("EXTENSIONS")
        title.setStyleSheet("color: #bbbbbb; font-size: 11px; font-weight: 600; letter-spacing: 1.2px;")
        header_layout.addWidget(title)
        header_layout.addStretch()

        install_btn = QPushButton("\u2b07 Install .vsix")
        install_btn.setFixedHeight(24)
        install_btn.setCursor(Qt.PointingHandCursor)
        install_btn.setStyleSheet("""
            QPushButton {
                background-color: #3c0068; color: #ffffff; border: none;
                border-radius: 4px; font-size: 11px; padding: 2px 10px; font-weight: bold;
            }
            QPushButton:hover { background-color: #4a0072; }
        """)
        install_btn.clicked.connect(self._install_from_vsix)
        header_layout.addWidget(install_btn)

        layout.addWidget(header)

        self._search_input = QLineEdit()
        self._search_input.setPlaceholderText("\U0001F50D  Search Extensions in Marketplace...")
        self._search_input.setFixedHeight(32)
        self._search_input.setStyleSheet("""
            QLineEdit {
                background-color: #1e1e1e; color: #cccccc;
                border: 1px solid #3c0068; border-radius: 4px;
                padding: 6px 12px; font-size: 13px;
                selection-background-color: #4a0072;
            }
            QLineEdit:focus { border: 1px solid #6b21a8; background-color: #252526; }
            QLineEdit::placeholder { color: #666666; }
        """)
        self._search_input.textChanged.connect(self._on_search_changed)
        layout.addWidget(self._search_input)

        tab_bar = QWidget()
        tab_bar.setFixedHeight(30)
        tab_bar.setStyleSheet("background-color: #000000;")
        tab_layout = QHBoxLayout(tab_bar)
        tab_layout.setContentsMargins(8, 0, 8, 0)
        tab_layout.setSpacing(0)

        self._tab_installed = QPushButton("Installed")
        self._tab_installed.setCheckable(True)
        self._tab_installed.setChecked(True)
        self._tab_installed.setStyleSheet("""
            QPushButton {
                background: transparent; color: #888888; border: none;
                border-bottom: 2px solid transparent; padding: 4px 12px; font-size: 11px;
            }
            QPushButton:checked { color: #cccccc; border-bottom: 2px solid #4a0072; font-weight: bold; }
            QPushButton:hover:!checked { color: #aaaaaa; }
        """)
        self._tab_installed.clicked.connect(self._show_installed)
        tab_layout.addWidget(self._tab_installed)

        self._tab_marketplace = QPushButton("Marketplace")
        self._tab_marketplace.setCheckable(True)
        self._tab_marketplace.setStyleSheet("""
            QPushButton {
                background: transparent; color: #888888; border: none;
                border-bottom: 2px solid transparent; padding: 4px 12px; font-size: 11px;
            }
            QPushButton:checked { color: #cccccc; border-bottom: 2px solid #4a0072; font-weight: bold; }
            QPushButton:hover:!checked { color: #aaaaaa; }
        """)
        self._tab_marketplace.clicked.connect(self._show_marketplace)
        tab_layout.addWidget(self._tab_marketplace)

        tab_layout.addStretch()
        layout.addWidget(tab_bar)

        self._count_label = QLabel("")
        self._count_label.setStyleSheet("color: #858585; font-size: 11px; padding: 4px 12px; background-color: #000000;")
        layout.addWidget(self._count_label)

        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(0)
        self._tree.setUniformRowHeights(False)
        self._tree.setVerticalScrollMode(QTreeWidget.ScrollPerPixel)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000; border: none; color: #cccccc;
                font-family: "Segoe UI", sans-serif; font-size: 12px; outline: none;
            }
            QTreeWidget::item { padding: 2px 4px; border: none; }
            QTreeWidget::item:selected { background-color: #04395e; color: #ffffff; }
            QTreeWidget::item:hover:!selected { background-color: #1a0033; }
        """)
        layout.addWidget(self._tree)

        self._empty_state = QWidget()
        self._empty_state.setStyleSheet("background-color: #000000;")
        empty_layout = QVBoxLayout(self._empty_state)
        empty_layout.setAlignment(Qt.AlignCenter)
        empty_layout.setContentsMargins(24, 32, 24, 32)

        puzzle_icon = QLabel("\U0001F9E9")
        puzzle_icon.setStyleSheet("font-size: 40px;")
        puzzle_icon.setAlignment(Qt.AlignCenter)
        empty_layout.addWidget(puzzle_icon)

        empty_text = QLabel("No extensions installed yet")
        empty_text.setStyleSheet("color: #cccccc; font-size: 13px; font-weight: bold; padding: 8px;")
        empty_text.setAlignment(Qt.AlignCenter)
        empty_layout.addWidget(empty_text)

        hint_text = QLabel(
            "Search the marketplace to find extensions\n"
            "or install from .vsix files using the button above"
        )
        hint_text.setStyleSheet("color: #858585; font-size: 12px; line-height: 1.5;")
        hint_text.setAlignment(Qt.AlignCenter)
        hint_text.setWordWrap(True)
        empty_layout.addWidget(hint_text)

        layout.addWidget(self._empty_state)

    def _show_installed(self):
        self._tab_installed.setChecked(True)
        self._tab_marketplace.setChecked(False)
        self._search_input.setPlaceholderText("\U0001F50D  Search Installed Extensions...")
        self._refresh_extensions()

    def _show_marketplace(self):
        self._tab_installed.setChecked(False)
        self._tab_marketplace.setChecked(True)
        self._search_input.setPlaceholderText("\U0001F50D  Search Extensions in Marketplace...")
        query = self._search_input.text().strip()
        if len(query) >= 2:
            self._do_marketplace_search()
        else:
            self._empty_state.hide()
            self._tree.show()
            self._tree.clear()
            self._count_label.setText("Type to search marketplace...")

    def _on_search_changed(self, text: str):
        self._search_timer.stop()
        if self._tab_marketplace.isChecked():
            if len(text.strip()) >= 2:
                self._search_timer.start()
            else:
                self._tree.clear()
                self._count_label.setText("Type to search marketplace...")
        else:
            self._filter_local(text)

    def _filter_local(self, text: str):
        text = text.lower()
        count = 0
        for i in range(self._tree.topLevelItemCount()):
            item = self._tree.topLevelItem(i)
            ext_name = item.data(0, Qt.UserRole) or ""
            visible = text in ext_name.lower() if text else True
            item.setHidden(not visible)
            if visible:
                count += 1
        if text:
            self._count_label.setText(f"{count} extension(s) match")
        else:
            self._count_label.setText("")

    def _refresh_extensions(self):
        self._tree.clear()
        self._cards.clear()

        if not self._tab_installed.isChecked():
            return

        extensions = self._ext_manager.get_installed_extensions()

        if not extensions:
            self._empty_state.show()
            self._tree.hide()
            self._count_label.setText("")
            return

        self._empty_state.hide()
        self._tree.show()
        self._count_label.setText(f"{len(extensions)} extension(s) installed")

        for ext in extensions:
            card = ExtensionCard(ext)
            card.uninstall_requested.connect(self._uninstall_extension)
            card.toggle_requested.connect(self._toggle_extension)

            item = QTreeWidgetItem()
            item.setSizeHint(0, QSize(0, 100))
            item.setData(0, Qt.UserRole, ext.name)
            self._tree.addTopLevelItem(item)
            self._tree.setItemWidget(item, 0, card)
            self._cards.append(card)

    def _install_from_vsix(self):
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Install Extension from VSIX",
            os.path.expanduser("~"),
            "VSIX Files (*.vsix);;All Files (*)"
        )
        if not file_path:
            return

        try:
            ext = self._ext_manager.install_from_vsix(file_path)
            self._ext_manager.activate_extension(ext.name)
            self._refresh_extensions()
            self.extension_installed.emit(ext.name)
            QMessageBox.information(
                self, "Extension Installed",
                f"'{ext.display_name}' v{ext.version} installed successfully!"
            )
        except Exception as e:
            QMessageBox.warning(self, "Installation Failed", f"Failed to install extension:\n{str(e)}")

    def _uninstall_extension(self, ext_name: str):
        reply = QMessageBox.question(
            self, "Uninstall Extension",
            f"Are you sure you want to uninstall '{ext_name}'?",
            QMessageBox.Yes | QMessageBox.No
        )
        if reply == QMessageBox.Yes:
            self._ext_manager.uninstall_extension(ext_name)
            self._refresh_extensions()

    def _toggle_extension(self, ext_name: str, enabled: bool):
        self._ext_manager.toggle_extension(ext_name, enabled)
        if enabled:
            self._ext_manager.activate_extension(ext_name)

    def _do_marketplace_search(self):
        query = self._search_input.text().strip()
        if len(query) < 2:
            return

        if not self._tab_marketplace.isChecked():
            self._tab_installed.setChecked(False)
            self._tab_marketplace.setChecked(True)

        self._count_label.setText("Searching marketplace...")
        self._count_label.show()

        self._search_seq += 1
        seq = self._search_seq

        def search():
            results = self._ext_manager.search_open_vsx(query, limit=20)
            if seq == self._search_seq:
                self._results_ready.emit(query, results)

        threading.Thread(target=search, daemon=True).start()

    def _render_online_results(self, query: str, results: list):
        self._tree.clear()
        self._cards.clear()

        installed_names = {ext.name for ext in self._ext_manager.get_installed_extensions()}

        if not results:
            self._count_label.setText("No results found")
            self._empty_state.hide()
            self._tree.show()
            return

        self._empty_state.hide()
        self._tree.show()
        self._count_label.setText(f"{len(results)} extensions found")

        for ext in results:
            card = OnlineExtensionCard(ext, is_installed=ext["name"] in installed_names)
            card.install_requested.connect(self._install_from_marketplace)

            item = QTreeWidgetItem()
            item.setSizeHint(0, QSize(0, 100))
            item.setData(0, Qt.UserRole, ext["id"])
            self._tree.addTopLevelItem(item)
            self._tree.setItemWidget(item, 0, card)
            self._cards.append(card)

    def _install_from_marketplace(self, ext_id: str):
        self._count_label.setText(f"Installing {ext_id}...")
        self._count_label.show()

        def install():
            ext = self._ext_manager.install_from_open_vsx(ext_id)
            self._install_done.emit(ext is not None, ext.name if ext else "")

        threading.Thread(target=install, daemon=True).start()

    def _on_install_done(self, success: bool, ext_name: str):
        if success:
            self._ext_manager.activate_extension(ext_name)
            self._refresh_extensions()
            self.extension_installed.emit(ext_name)
        else:
            self._count_label.setText("Installation failed")

    def _set_status(self, text: str):
        self._count_label.setText(text)
        self._count_label.show()

    def refresh(self):
        self._refresh_extensions()
