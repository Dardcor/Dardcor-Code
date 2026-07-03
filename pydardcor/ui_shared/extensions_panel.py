"""Extensions Panel - VS Code style extensions sidebar."""

import os
import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QTreeWidget, QTreeWidgetItem, QFileDialog,
    QMessageBox, QCheckBox, QFrame, QSizePolicy, QComboBox,
)
from PySide6.QtCore import Signal, Qt, QSize, QTimer
from PySide6.QtGui import QColor, QFont, QIcon, QPixmap

from ..core.extension_manager import (
    get_extension_manager, InstalledExtension,
    SOURCE_VSCODE, SOURCE_OPENVSX,
)
from ..core.config import get_extensions_dir, get_global_home_dir, get_config
from .extension_icons import (
    ExtensionIconLoader, load_pixmap_from_file, default_extension_pixmap,
    installed_extension_icon_path,
)
from .extension_detail_page import show_extension_detail


class _ExtensionCardBase(QWidget):
    detail_requested = Signal(object)

    CARD_HEIGHT = 112
    ICON_CONTAINER = 48
    ICON_SIZE = 36

    _STYLE_NORMAL = """
        #extensionCard {
            background-color: #111111;
            border: 1px solid #2b2b2b;
            border-radius: 8px;
        }
    """
    _STYLE_HOVER = """
        #extensionCard {
            background-color: #1a1a1a;
            border: 1px solid #333333;
            border-radius: 8px;
        }
    """
    _ICON_LABEL_STYLE = """
        QLabel {
            background-color: #161616;
            border-radius: 8px;
            border: none;
        }
    """
    _NAME_STYLE = "color: #e6e6e6; font-size: 13px; font-weight: 600; border: none; background: transparent;"
    _VERSION_STYLE = "color: #9a9a9a; font-size: 11px; border: none; background: transparent;"
    _DESC_STYLE = (
        "color: #6a6a6a; font-size: 11px; line-height: 1.45; "
        "border: none; background: transparent;"
    )
    _INSTALL_BTN_STYLE = """
        QPushButton {
            background-color: #0e639c; color: #ffffff; border: none;
            border-radius: 5px; font-size: 11px; font-weight: 600;
            min-height: 28px; padding: 0 14px;
        }
        QPushButton:hover { background-color: #1177bb; }
        QPushButton:disabled {
            background-color: #1a1a1a; color: #6a6a6a;
            border: 1px solid #2b2b2b;
        }
    """
    _UNINSTALL_BTN_STYLE = """
        QPushButton {
            background-color: #c42b1c; color: #ffffff; border: none;
            border-radius: 5px; font-size: 11px; font-weight: 600;
            min-height: 28px; padding: 0 14px;
        }
        QPushButton:hover { background-color: #e04838; }
    """
    _ENABLE_CB_STYLE = """
        QCheckBox {
            color: #9a9a9a; font-size: 11px; border: none;
            background: transparent; spacing: 6px;
        }
        QCheckBox:checked { color: #e6e6e6; }
        QCheckBox::indicator {
            width: 16px; height: 16px;
            border: 1px solid #333333; border-radius: 4px;
            background: #161616;
        }
        QCheckBox::indicator:checked {
            background: #0e639c; border-color: #1177bb;
        }
        QCheckBox::indicator:hover { border-color: #444444; }
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("extensionCard")
        self.setCursor(Qt.PointingHandCursor)
        self._apply_card_style(hover=False)

    def enterEvent(self, event):
        self._apply_card_style(hover=True)
        super().enterEvent(event)

    def leaveEvent(self, event):
        self._apply_card_style(hover=False)
        super().leaveEvent(event)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            w = self.childAt(event.pos())
            while w and w is not self:
                if isinstance(w, (QPushButton, QCheckBox)):
                    return super().mousePressEvent(event)
                w = w.parentWidget()
            self.detail_requested.emit(self._get_detail_ref())
        super().mousePressEvent(event)

    def _get_detail_ref(self):
        raise NotImplementedError

    def _apply_card_style(self, hover: bool):
        self.setStyleSheet(self._STYLE_HOVER if hover else self._STYLE_NORMAL)

    def _create_icon_label(self) -> QLabel:
        label = QLabel()
        label.setFixedSize(self.ICON_CONTAINER, self.ICON_CONTAINER)
        label.setAlignment(Qt.AlignCenter)
        label.setStyleSheet(self._ICON_LABEL_STYLE)
        return label

    def _set_icon_pixmap(self, label: QLabel, pm: QPixmap):
        scaled = pm.scaled(
            self.ICON_SIZE, self.ICON_SIZE,
            Qt.KeepAspectRatio, Qt.SmoothTransformation,
        )
        label.setPixmap(scaled)


class OnlineExtensionCard(_ExtensionCardBase):
    install_requested = Signal(dict)

    def __init__(self, ext_dict: dict, icon_loader: ExtensionIconLoader,
                 is_installed: bool = False, parent=None):
        super().__init__(parent)
        self._ext = ext_dict
        self._icon_loader = icon_loader
        self._is_installed = is_installed
        self._icon_label = None
        self._icon_key = ""
        self._setup_ui()
        self._load_icon()

    def _get_detail_ref(self):
        return self._ext

    def _load_icon(self):
        url = self._ext.get("icon_url", "")
        if url and self._icon_label:
            self._icon_key = f"{url}@{self.ICON_SIZE}"
            self._icon_loader.icon_ready.connect(self._on_icon_ready)
            pm = self._icon_loader.pixmap_for_url(url, self.ICON_SIZE)
            self._set_icon_pixmap(self._icon_label, pm)

    def _on_icon_ready(self, key: str, pm: QPixmap):
        if key == self._icon_key and self._icon_label:
            self._set_icon_pixmap(self._icon_label, pm)

    def set_installing(self):
        self.action_btn.setText("Installing...")
        self.action_btn.setEnabled(False)

    def set_installed(self):
        self.action_btn.setText("Installed")
        self.action_btn.setEnabled(False)

    def set_failed(self):
        self.action_btn.setText("Retry")
        self.action_btn.setEnabled(True)

    def _setup_ui(self):
        self.setFixedHeight(self.CARD_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(14)

        self._icon_label = self._create_icon_label()
        self._set_icon_pixmap(self._icon_label, default_extension_pixmap(self.ICON_SIZE))
        layout.addWidget(self._icon_label)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(5)
        info_layout.setContentsMargins(0, 2, 0, 2)

        name_label = QLabel(self._ext.get("display_name", self._ext.get("name", "")))
        name_label.setStyleSheet(self._NAME_STYLE)
        info_layout.addWidget(name_label)

        version_label = QLabel(
            f"v{self._ext.get('version', '0.0.0')}  ·  {self._ext.get('publisher', '')}"
        )
        version_label.setStyleSheet(self._VERSION_STYLE)
        info_layout.addWidget(version_label)

        desc_label = QLabel(self._ext.get("description", "No description"))
        desc_label.setStyleSheet(self._DESC_STYLE)
        desc_label.setWordWrap(True)
        desc_label.setMaximumHeight(34)
        info_layout.addWidget(desc_label)

        layout.addLayout(info_layout, 1)

        btn_layout = QVBoxLayout()
        btn_layout.setSpacing(6)
        btn_layout.setAlignment(Qt.AlignTop | Qt.AlignRight)

        count = self._ext.get("download_count", 0)
        installs_label = QLabel(f"\u2193  {count:,}")
        installs_label.setStyleSheet(
            "color: #6a6a6a; font-size: 10px; border: none; background: transparent;"
        )
        installs_label.setAlignment(Qt.AlignRight)
        btn_layout.addWidget(installs_label)

        self.action_btn = QPushButton("Install" if not self._is_installed else "Installed")
        self.action_btn.setEnabled(not self._is_installed)
        self.action_btn.setFixedHeight(28)
        self.action_btn.setMinimumWidth(80)
        self.action_btn.setCursor(Qt.PointingHandCursor)
        self.action_btn.setStyleSheet(self._INSTALL_BTN_STYLE)
        self.action_btn.clicked.connect(lambda: self.install_requested.emit(self._ext))
        btn_layout.addWidget(self.action_btn, 0, Qt.AlignRight)

        layout.addLayout(btn_layout)


class ExtensionCard(_ExtensionCardBase):
    uninstall_requested = Signal(str)
    toggle_requested = Signal(str, bool)

    def __init__(self, ext: InstalledExtension, parent=None):
        super().__init__(parent)
        self._ext = ext
        self._icon_label = None
        self._setup_ui()

    def _get_detail_ref(self):
        return self._ext

    def _setup_ui(self):
        self.setFixedHeight(self.CARD_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(14)

        self._icon_label = self._create_icon_label()
        icon_path = installed_extension_icon_path(self._ext.path, self._ext.manifest or {})
        pm = (
            load_pixmap_from_file(icon_path, self.ICON_SIZE)
            if icon_path else default_extension_pixmap(self.ICON_SIZE)
        )
        self._set_icon_pixmap(self._icon_label, pm)
        layout.addWidget(self._icon_label)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(5)
        info_layout.setContentsMargins(0, 2, 0, 2)

        name_label = QLabel(self._ext.display_name or self._ext.name)
        name_label.setStyleSheet(self._NAME_STYLE)
        info_layout.addWidget(name_label)

        version_label = QLabel(f"v{self._ext.version}  ·  {self._ext.publisher}")
        version_label.setStyleSheet(self._VERSION_STYLE)
        info_layout.addWidget(version_label)

        desc_label = QLabel(self._ext.description or "No description")
        desc_label.setStyleSheet(self._DESC_STYLE)
        desc_label.setWordWrap(True)
        desc_label.setMaximumHeight(34)
        info_layout.addWidget(desc_label)

        layout.addLayout(info_layout, 1)

        btn_layout = QVBoxLayout()
        btn_layout.setSpacing(6)
        btn_layout.setAlignment(Qt.AlignTop | Qt.AlignRight)

        self._enable_cb = QCheckBox("Enabled")
        self._enable_cb.setChecked(self._ext.enabled)
        self._enable_cb.setCursor(Qt.PointingHandCursor)
        self._enable_cb.setStyleSheet(self._ENABLE_CB_STYLE)
        self._update_enable_label()
        self._enable_cb.toggled.connect(self._on_toggle)
        btn_layout.addWidget(self._enable_cb, 0, Qt.AlignRight)

        uninstall_btn = QPushButton("Uninstall")
        uninstall_btn.setFixedHeight(28)
        uninstall_btn.setMinimumWidth(80)
        uninstall_btn.setCursor(Qt.PointingHandCursor)
        uninstall_btn.setStyleSheet(self._UNINSTALL_BTN_STYLE)
        uninstall_btn.clicked.connect(lambda: self.uninstall_requested.emit(self._ext.name))
        btn_layout.addWidget(uninstall_btn, 0, Qt.AlignRight)

        layout.addLayout(btn_layout)

    def _update_enable_label(self):
        if self._enable_cb.isChecked():
            self._enable_cb.setText("\u2713 Enabled")
        else:
            self._enable_cb.setText("Enabled")

    def _on_toggle(self, checked: bool):
        self._update_enable_label()
        self.toggle_requested.emit(self._ext.name, checked)


class ExtensionsPanel(QWidget):
    extension_installed = Signal(str)
    extensions_changed = Signal()

    _results_ready = Signal(str, list)
    _status_signal = Signal(str)
    _install_done = Signal(bool, str)
    _updates_done = Signal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._ext_manager = get_extension_manager()
        self._icon_loader = ExtensionIconLoader(self)
        self._cards = []
        self._search_timer = QTimer()
        self._search_timer.setSingleShot(True)
        self._search_timer.setInterval(500)
        self._search_timer.timeout.connect(self._do_marketplace_search)
        self._online_results = []
        self._search_seq = 0
        self._installing_ids = set()
        self.setObjectName("extensionsPanel")
        self._results_ready.connect(self._render_online_results)
        self._status_signal.connect(self._set_status)
        self._install_done.connect(self._on_install_done)
        self._updates_done.connect(self._on_updates_done)
        self._setup_ui()
        self._refresh_extensions()
        if get_config().extensions_auto_update:
            QTimer.singleShot(2000, self._run_auto_update_check)

    def _current_source(self) -> str:
        return SOURCE_VSCODE if self._source_combo.currentIndex() == 0 else SOURCE_OPENVSX

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

        refresh_btn = QPushButton("\u21bb")
        refresh_btn.setToolTip("Refresh installed extensions")
        refresh_btn.setFixedSize(24, 24)
        refresh_btn.setCursor(Qt.PointingHandCursor)
        refresh_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent; color: #cccccc; border: none;
                font-size: 14px; font-weight: bold;
            }
            QPushButton:hover { color: #ffffff; background-color: #1a1a1a; border-radius: 4px; }
        """)
        refresh_btn.clicked.connect(self._reload_installed)
        header_layout.addWidget(refresh_btn)

        folder_btn = QPushButton("\U0001F4C1")
        folder_btn.setToolTip(f"Open extensions folder ({get_extensions_dir()})")
        folder_btn.setFixedSize(24, 24)
        folder_btn.setCursor(Qt.PointingHandCursor)
        folder_btn.setStyleSheet(refresh_btn.styleSheet())
        folder_btn.clicked.connect(self._open_extensions_folder)
        header_layout.addWidget(folder_btn)

        install_btn = QPushButton("\u2b07 Install .vsix")
        install_btn.setFixedHeight(24)
        install_btn.setCursor(Qt.PointingHandCursor)
        install_btn.setStyleSheet("""
            QPushButton {
                background-color: #333333; color: #ffffff; border: none;
                border-radius: 4px; font-size: 11px; padding: 2px 10px; font-weight: bold;
            }
            QPushButton:hover { background-color: #444444; }
        """)
        install_btn.clicked.connect(self._install_from_vsix)
        header_layout.addWidget(install_btn)

        self._auto_update_cb = QCheckBox("Auto Update")
        self._auto_update_cb.setChecked(get_config().extensions_auto_update)
        self._auto_update_cb.setToolTip("Automatically update extensions from the marketplace")
        self._auto_update_cb.setStyleSheet("""
            QCheckBox { color: #aaaaaa; font-size: 10px; border: none; spacing: 4px; }
            QCheckBox::indicator { width: 12px; height: 12px; border: 1px solid #555555; border-radius: 2px; background: #2a2a2a; }
            QCheckBox::indicator:checked { background: #ffffff; border-color: #cccccc; }
        """)
        self._auto_update_cb.toggled.connect(self._on_auto_update_toggled)
        header_layout.addWidget(self._auto_update_cb)

        layout.addWidget(header)

        self._search_input = QLineEdit()
        self._search_input.setPlaceholderText("\U0001F50D  Search Extensions in Marketplace...")
        self._search_input.setFixedHeight(32)
        self._search_input.setStyleSheet("""
            QLineEdit {
                background-color: #1e1e1e; color: #cccccc;
                border: 1px solid #333333; border-radius: 4px;
                padding: 6px 12px; font-size: 13px;
                selection-background-color: #2a2a2a;
            }
            QLineEdit:focus { border: 1px solid #555555; background-color: #0a0a0a; }
            QLineEdit::placeholder { color: #666666; }
        """)
        self._search_input.textChanged.connect(self._on_search_changed)
        layout.addWidget(self._search_input)

        self._source_combo = QComboBox()
        self._source_combo.addItem("VS Code Marketplace")
        self._source_combo.addItem("Open VSX Registry")
        self._source_combo.setFixedHeight(26)
        self._source_combo.setCursor(Qt.PointingHandCursor)
        self._source_combo.setStyleSheet("""
            QComboBox {
                background-color: #1e1e1e; color: #cccccc;
                border: 1px solid #333333; border-radius: 4px;
                padding: 2px 8px; font-size: 11px;
            }
            QComboBox:hover { border-color: #555555; }
            QComboBox::drop-down { border: none; width: 18px; }
            QComboBox QAbstractItemView {
                background-color: #0a0a0a; color: #cccccc;
                selection-background-color: #2a2a2a;
                border: 1px solid #333333;
            }
        """)
        self._source_combo.currentIndexChanged.connect(self._on_source_changed)
        layout.addWidget(self._source_combo)

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
            QPushButton:checked { color: #ffffff; border-bottom: 2px solid #ffffff; font-weight: bold; }
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
            QPushButton:checked { color: #ffffff; border-bottom: 2px solid #ffffff; font-weight: bold; }
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
            QTreeWidget::item { padding: 3px 6px; border: none; }
            QTreeWidget::item:selected { background-color: #04395e; color: #ffffff; }
            QTreeWidget::item:hover:!selected { background-color: #1a1a1a; }
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

        self._path_footer = QLabel(get_global_home_dir())
        self._path_footer.setStyleSheet(
            "color: #555555; font-size: 10px; padding: 4px 12px; background-color: #000000;"
        )
        self._path_footer.setToolTip(get_extensions_dir())
        layout.addWidget(self._path_footer)

    def _reload_installed(self):
        """Rescan ~/.dardcor-code/extensions for manually added folders."""
        self._ext_manager.reload_extensions()
        self._refresh_extensions()
        self.extensions_changed.emit()
        count = len(self._ext_manager.get_installed_extensions())
        self._count_label.setText(f"{count} extension(s) installed")

    def _open_extensions_folder(self):
        import subprocess
        import sys
        path = get_extensions_dir()
        os.makedirs(path, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])

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
            self._load_featured()

    def _on_source_changed(self, _index: int):
        if self._tab_marketplace.isChecked():
            query = self._search_input.text().strip()
            if len(query) >= 2:
                self._do_marketplace_search()
            else:
                self._load_featured()

    def _load_featured(self):
        """Show popular extensions when no search query is entered."""
        self._empty_state.hide()
        self._tree.show()
        self._tree.clear()
        self._count_label.setText("Loading popular extensions...")

        self._search_seq += 1
        seq = self._search_seq
        source = self._current_source()

        def fetch():
            results = self._ext_manager.get_featured_extensions(limit=20, source=source)
            if seq == self._search_seq:
                self._results_ready.emit("", results)

        threading.Thread(target=fetch, daemon=True).start()

    def _on_search_changed(self, text: str):
        self._search_timer.stop()
        if self._tab_marketplace.isChecked():
            if len(text.strip()) >= 2:
                self._search_timer.start()
            else:
                self._load_featured()
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
            card.detail_requested.connect(self._open_detail)

            item = QTreeWidgetItem()
            item.setSizeHint(0, QSize(0, _ExtensionCardBase.CARD_HEIGHT + 6))
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
            self.extensions_changed.emit()
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
            self.extensions_changed.emit()

    def _toggle_extension(self, ext_name: str, enabled: bool):
        self._ext_manager.toggle_extension(ext_name, enabled)
        if enabled:
            self._ext_manager.activate_extension(ext_name)
        self.extensions_changed.emit()

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
        source = self._current_source()

        def search():
            results = self._ext_manager.search_marketplace(query, limit=20, source=source)
            if seq == self._search_seq:
                self._results_ready.emit(query, results)

        threading.Thread(target=search, daemon=True).start()

    def _render_online_results(self, query: str, results: list):
        self._tree.clear()
        self._cards.clear()

        installed_names = {ext.name for ext in self._ext_manager.get_installed_extensions()}

        if not results:
            self._count_label.setText(
                "No results found" if query else
                "Could not reach marketplace. Check your internet connection.")
            self._empty_state.hide()
            self._tree.show()
            return

        self._empty_state.hide()
        self._tree.show()
        self._count_label.setText(
            f"{len(results)} extensions found" if query else
            f"Popular extensions ({len(results)})")

        for ext in results:
            card = OnlineExtensionCard(ext, self._icon_loader,
                                       is_installed=ext["name"] in installed_names)
            card.install_requested.connect(self._install_from_marketplace)
            card.detail_requested.connect(self._open_detail)

            item = QTreeWidgetItem()
            item.setSizeHint(0, QSize(0, _ExtensionCardBase.CARD_HEIGHT + 6))
            item.setData(0, Qt.UserRole, ext["id"])
            self._tree.addTopLevelItem(item)
            self._tree.setItemWidget(item, 0, card)
            self._cards.append(card)

    def _install_from_marketplace(self, ext_dict: dict):
        ext_id = ext_dict.get("id", "")
        source = ext_dict.get("source", SOURCE_VSCODE)
        download_url = ext_dict.get("download_url", "")

        if ext_id in self._installing_ids:
            return
        self._installing_ids.add(ext_id)

        for card in self._cards:
            if isinstance(card, OnlineExtensionCard) and card._ext.get("id") == ext_id:
                card.set_installing()

        self._count_label.setText(f"Installing {ext_id}...")
        self._count_label.show()

        def install():
            ext = self._ext_manager.install_from_marketplace(
                ext_id, source=source, download_url=download_url)
            self._installing_ids.discard(ext_id)
            self._install_done.emit(ext is not None, ext.name if ext else ext_id)

        threading.Thread(target=install, daemon=True).start()

    def _on_install_done(self, success: bool, ext_name: str):
        if success:
            self._ext_manager.activate_extension(ext_name)
            self.extension_installed.emit(ext_name)
            self.extensions_changed.emit()
            if self._tab_marketplace.isChecked():
                installed_names = {e.name for e in self._ext_manager.get_installed_extensions()}
                for card in self._cards:
                    if isinstance(card, OnlineExtensionCard) and card._ext.get("name") in installed_names:
                        card.set_installed()
                self._count_label.setText(f"'{ext_name}' installed")
            else:
                self._refresh_extensions()
        else:
            self._count_label.setText(f"Installation of '{ext_name}' failed")
            for card in self._cards:
                if isinstance(card, OnlineExtensionCard) and card._ext.get("id") == ext_name:
                    card.set_failed()

    def _set_status(self, text: str):
        self._count_label.setText(text)
        self._count_label.show()

    def _open_detail(self, ext_ref):
        show_extension_detail(ext_ref, self, on_install=self._install_from_marketplace)

    def _on_auto_update_toggled(self, checked: bool):
        cfg = get_config()
        cfg.extensions_auto_update = checked
        cfg.save()

    def _run_auto_update_check(self):
        if not get_config().extensions_auto_update:
            return

        def check():
            outdated = self._ext_manager.check_for_updates()
            if outdated and get_config().extensions_auto_update:
                updated = self._ext_manager.auto_update_all()
                self._updates_done.emit(updated)
            else:
                self._updates_done.emit([])

        threading.Thread(target=check, daemon=True).start()

    def _on_updates_done(self, updated: list):
        if updated:
            self._count_label.setText(f"Auto-updated: {', '.join(updated)}")
            self._reload_installed()
            self.extensions_changed.emit()

    def refresh(self):
        self._refresh_extensions()
