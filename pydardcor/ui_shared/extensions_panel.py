"""Extensions Panel - VS Code style extensions sidebar."""

import os
import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QTreeWidget, QTreeWidgetItem, QFileDialog,
    QMessageBox, QCheckBox, QFrame, QSizePolicy, QComboBox,
)
from PySide6.QtCore import Signal, Qt, QSize, QTimer, QObject, QEvent
from PySide6.QtGui import QColor, QFont, QIcon, QPixmap, QFontMetrics
from PySide6.QtWidgets import QSizePolicy

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


class _LabelElider(QObject):
    def eventFilter(self, obj, event):
        if event.type() == QEvent.Resize:
            self._apply(obj)
        return False

    def _apply(self, label):
        full = label.property("_full_text") or ""
        if not full:
            return
        metrics = QFontMetrics(label.font())
        available = max(0, label.width())
        elided = metrics.elidedText(full, Qt.ElideRight, available) if available else full
        if label.text() != elided:
            label.setText(elided)


def configure_elided_label(label, text: str):
    label.setProperty("_full_text", text)
    label.setText(text)
    label.setToolTip(text)
    label.setTextInteractionFlags(Qt.NoTextInteraction)
    label.setSizePolicy(QSizePolicy.Policy.Ignored, label.sizePolicy().verticalPolicy())

    elider = label.findChild(_LabelElider)
    if elider is None:
        elider = _LabelElider(label)
        label.installEventFilter(elider)
    return label


class _ExtensionCardBase(QWidget):
    detail_requested = Signal(object)

    CARD_HEIGHT = 62
    ICON_CONTAINER = 42
    ICON_SIZE = 42

    _STYLE_NORMAL = """
        #extensionCard {
            background-color: transparent;
            border: none;
        }
    """
    _STYLE_HOVER = """
        #extensionCard {
            background-color: #2a2d2e;
            border: none;
        }
    """
    _ICON_LABEL_STYLE = """
        QLabel {
            background-color: transparent;
            border: none;
        }
    """
    _NAME_STYLE = "color: #cccccc; font-size: 13px; font-weight: 600; border: none; background: transparent;"
    _VERSION_STYLE = "color: #969696; font-size: 11px; border: none; background: transparent;"
    _DESC_STYLE = (
        "color: #cccccc; font-size: 11px; "
        "border: none; background: transparent;"
    )
    _INSTALL_BTN_STYLE = """
        QPushButton {
            background-color: #0e639c; color: #ffffff; border: none;
            border-radius: 2px; font-size: 11px;
            min-height: 20px; padding: 0 8px;
        }
        QPushButton:hover { background-color: #1177bb; }
        QPushButton:disabled {
            background-color: transparent; color: #cccccc; font-size: 16px; font-family: 'codicon'; padding: 0; min-height: 24px;
        }
    """
    _UNINSTALL_BTN_STYLE = ""
    _ENABLE_CB_STYLE = ""
    _GEAR_BTN_STYLE = """
        QPushButton {
            background-color: transparent; color: #cccccc; border: none;
            border-radius: 4px; font-size: 14px; font-family: 'codicon'; padding: 4px;
        }
        QPushButton:hover { background-color: rgba(90, 93, 94, 0.31); color: #ffffff; }
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
        self.action_btn.setText("\ueb51") # Gear icon for installed
        self.action_btn.setEnabled(False)

    def set_failed(self):
        self.action_btn.setText("Retry")
        self.action_btn.setEnabled(True)

    def _setup_ui(self):
        self.setFixedHeight(self.CARD_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        self._icon_label = self._create_icon_label()
        self._set_icon_pixmap(self._icon_label, default_extension_pixmap(self.ICON_SIZE))
        layout.addWidget(self._icon_label, 0, Qt.AlignTop)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(2)
        info_layout.setContentsMargins(0, 0, 0, 0)

        header_layout = QHBoxLayout()
        header_layout.setSpacing(6)
        name_label = QLabel()
        configure_elided_label(
            name_label, self._ext.get("display_name", self._ext.get("name", "")))
        name_label.setStyleSheet(self._NAME_STYLE)
        header_layout.addWidget(name_label)

        version_label = QLabel(
            self._ext.get('publisher', '')
        )
        version_label.setStyleSheet(self._VERSION_STYLE)
        header_layout.addWidget(version_label, 1)
        info_layout.addLayout(header_layout)

        desc_label = QLabel(self._ext.get("description", "No description"))
        desc_label.setStyleSheet(self._DESC_STYLE)
        desc_label.setWordWrap(False)
        desc_label.setMaximumHeight(16)
        info_layout.addWidget(desc_label)
        
        footer_layout = QHBoxLayout()
        footer_layout.setSpacing(6)
        footer_layout.setContentsMargins(0, 4, 0, 0)
        
        count = self._ext.get("download_count", 0)
        rating = self._ext.get("rating", 0.0)
        
        def shorten_count(c):
            if c < 1000: return str(c)
            if c < 1000000: return f"{c/1000:.1f}K".replace('.0K', 'K')
            return f"{c/1000000:.1f}M".replace('.0M', 'M')
        
        stats_label = QLabel(f"\ueab6 {shorten_count(count)}" + (f"  \ueb53 {rating:.1f}" if rating > 0 else ""))
        stats_label.setStyleSheet("color: #cccccc; font-size: 10px; font-family: 'codicon'; border: none; background: transparent;")
        footer_layout.addWidget(stats_label)
        footer_layout.addStretch()

        self.action_btn = QPushButton("Install" if not self._is_installed else "\ueb51")
        self.action_btn.setEnabled(not self._is_installed)
        self.action_btn.setFixedHeight(20 if not self._is_installed else 24)
        self.action_btn.setMinimumWidth(50 if not self._is_installed else 24)
        self.action_btn.setCursor(Qt.PointingHandCursor)
        self.action_btn.setStyleSheet(self._INSTALL_BTN_STYLE)
        if not self._is_installed:
            self.action_btn.clicked.connect(lambda: self.install_requested.emit(self._ext))
        footer_layout.addWidget(self.action_btn)

        info_layout.addLayout(footer_layout)
        layout.addLayout(info_layout, 1)


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
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        self._icon_label = self._create_icon_label()
        icon_path = installed_extension_icon_path(self._ext.path, self._ext.manifest or {})
        pm = (
            load_pixmap_from_file(icon_path, self.ICON_SIZE)
            if icon_path else default_extension_pixmap(self.ICON_SIZE)
        )
        self._set_icon_pixmap(self._icon_label, pm)
        layout.addWidget(self._icon_label, 0, Qt.AlignTop)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(2)
        info_layout.setContentsMargins(0, 0, 0, 0)

        header_layout = QHBoxLayout()
        header_layout.setSpacing(6)
        name_label = QLabel()
        configure_elided_label(name_label, self._ext.display_name or self._ext.name)
        name_label.setStyleSheet(self._NAME_STYLE)
        header_layout.addWidget(name_label)

        version_label = QLabel(self._ext.publisher)
        version_label.setStyleSheet(self._VERSION_STYLE)
        header_layout.addWidget(version_label, 1)
        info_layout.addLayout(header_layout)

        desc_label = QLabel(self._ext.description or "No description")
        desc_label.setStyleSheet(self._DESC_STYLE)
        desc_label.setWordWrap(False)
        desc_label.setMaximumHeight(16)
        info_layout.addWidget(desc_label)
        
        footer_layout = QHBoxLayout()
        footer_layout.setSpacing(6)
        footer_layout.setContentsMargins(0, 4, 0, 0)
        
        from ..app.theme_manager import ThemeManager
        c = ThemeManager.THEMES.get(ThemeManager.current_theme_id(), ThemeManager.THEMES["dardcor-purple"])["colors"]
        
        gear_btn = QPushButton("\ueb51")
        gear_btn.setFixedSize(24, 24)
        gear_btn.setCursor(Qt.PointingHandCursor)
        gear_btn.setStyleSheet(self._GEAR_BTN_STYLE)
        
        from PySide6.QtWidgets import QMenu
        from PySide6.QtGui import QAction
        
        def show_menu():
            menu = QMenu(self)
            menu.setStyleSheet(f"QMenu {{ background-color: #252526; color: #cccccc; border: 1px solid #454545; }} QMenu::item:selected {{ background-color: {c.get('accent', '#007acc')}; }}")
            act_toggle = QAction("Disable" if self._ext.enabled else "Enable", self)
            act_toggle.triggered.connect(lambda: self.toggle_requested.emit(self._ext.name, not self._ext.enabled))
            menu.addAction(act_toggle)
            menu.addSeparator()
            act_uninstall = QAction("Uninstall", self)
            act_uninstall.triggered.connect(lambda: self.uninstall_requested.emit(self._ext.name))
            menu.addAction(act_uninstall)
            menu.exec(gear_btn.mapToGlobal(gear_btn.rect().bottomLeft()))
            
        gear_btn.clicked.connect(show_menu)
        
        footer_layout.addStretch()
        footer_layout.addWidget(gear_btn)

        info_layout.addLayout(footer_layout)
        layout.addLayout(info_layout, 1)
        
        if not self._ext.enabled:
            self.setStyleSheet(self._STYLE_NORMAL + " #extensionCard { opacity: 0.5; }")
            name_label.setStyleSheet(self._NAME_STYLE + " color: #6a6a6a;")
            version_label.setStyleSheet(self._VERSION_STYLE + " color: #6a6a6a;")
            desc_label.setStyleSheet(self._DESC_STYLE + " color: #6a6a6a;")


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
    _recommendations_ready = Signal(list)

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
        self._recommendations_ready.connect(self._render_recommendations)
        self._setup_ui()
        self._refresh_extensions()
        if get_config().extensions_auto_update:
            QTimer.singleShot(2000, self._run_auto_update_check)

    def _current_source(self) -> str:
        return getattr(self, '_source_idx', 0)

    def _set_source(self, index: int):
        self._source_idx = index
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

        from ..app.theme_manager import ThemeManager
        c = ThemeManager.THEMES.get(ThemeManager.current_theme_id(), ThemeManager.THEMES["dardcor-purple"])["colors"]
        
        refresh_btn = QPushButton("\u21bb")
        refresh_btn.setToolTip("Refresh installed extensions")
        refresh_btn.setFixedSize(24, 24)
        refresh_btn.setCursor(Qt.PointingHandCursor)
        refresh_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent; color: {c.get('foreground', '#cccccc')}; border: none;
                font-size: 14px; font-weight: bold;
            }}
            QPushButton:hover {{ color: #ffffff; background-color: {c.get('hover', '#1a1a1a')}; border-radius: 4px; }}
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

        import os
        from PySide6.QtGui import QIcon
        image_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "image")
        
        more_btn = QPushButton()
        more_btn.setIcon(QIcon(os.path.join(image_dir, "more.svg")))
        more_btn.setToolTip("Views and More Actions...")
        more_btn.setFixedSize(24, 24)
        more_btn.setCursor(Qt.PointingHandCursor)
        more_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent; border: none;
            }}
            QPushButton:hover {{ background-color: {c.get('hover', '#1a1a1a')}; border-radius: 4px; }}
        """)
        
        from PySide6.QtWidgets import QMenu
        from PySide6.QtGui import QAction
        
        def show_more_menu():
            class KeepOpenMenu(QMenu):
                def mouseReleaseEvent(self, e):
                    action = self.actionAt(e.pos())
                    if action and action.isCheckable():
                        action.trigger()
                        self.update()
                        e.accept()
                        return
                    super().mouseReleaseEvent(e)

            menu = KeepOpenMenu(self)
            
            check_icon_path = os.path.join(image_dir, 'menu_check.svg').replace('\\', '/')
            menu.setStyleSheet(f"""
                QMenu {{ background-color: {c.get('sidebar', '#252526')}; color: {c.get('foreground', '#cccccc')}; border: 1px solid {c.get('border', '#454545')}; }}
                QMenu::item:selected {{ background-color: {c.get('accent', '#007acc')}; }}
                QMenu::indicator {{ width: 16px; height: 16px; padding-left: 6px; }}
                QMenu::indicator:checked {{ image: url({check_icon_path}); }}
                QMenu::indicator:non-exclusive:checked {{ image: url({check_icon_path}); }}
                QMenu::indicator:exclusive:checked {{ image: url({check_icon_path}); }}
            """)
            act_install = QAction("Install from VSIX...", self)
            act_install.triggered.connect(self._install_from_vsix)
            menu.addAction(act_install)
            menu.addSeparator()
            
            from PySide6.QtGui import QActionGroup
            source_group = QActionGroup(self)
            
            act_vscode = QAction("VS Code Marketplace", self)
            act_vscode.setCheckable(True)
            act_vscode.setChecked(getattr(self, '_source_idx', 0) == 0)
            act_vscode.triggered.connect(lambda: self._set_source(0))
            source_group.addAction(act_vscode)
            menu.addAction(act_vscode)
            
            act_openvsx = QAction("Open VSX Registry", self)
            act_openvsx.setCheckable(True)
            act_openvsx.setChecked(getattr(self, '_source_idx', 0) == 1)
            act_openvsx.triggered.connect(lambda: self._set_source(1))
            source_group.addAction(act_openvsx)
            menu.addAction(act_openvsx)
            
            menu.addSeparator()
            
            act_auto = QAction("Auto Update Extensions", self)
            act_auto.setCheckable(True)
            act_auto.setChecked(get_config().extensions_auto_update)
            act_auto.toggled.connect(self._on_auto_update_toggled)
            menu.addAction(act_auto)
            menu.exec(more_btn.mapToGlobal(more_btn.rect().bottomLeft()))
            
        more_btn.clicked.connect(show_more_menu)
        header_layout.addWidget(more_btn)

        layout.addWidget(header)

        self._search_input = QLineEdit()
        self._search_input.setPlaceholderText("Search Extensions in Marketplace...")
        self._search_input.setFixedHeight(26)
        self._search_input.setStyleSheet(f"""
            QLineEdit {{
                background-color: {c.get('sidebar', '#1e1e1e')}; color: {c.get('foreground', '#cccccc')};
                border: 1px solid {c.get('border', '#333333')}; border-radius: 4px;
                padding: 2px 8px; font-size: 12px;
                selection-background-color: {c.get('selection', '#2a2a2a')};
            }}
            QLineEdit:focus {{ border: 1px solid {c.get('accent', '#007acc')}; background-color: {c.get('background', '#0a0a0a')}; }}
            QLineEdit::placeholder {{ color: #666666; }}
        """)
        self._search_input.textChanged.connect(self._on_search_changed)
        
        search_container = QWidget()
        search_layout = QVBoxLayout(search_container)
        search_layout.setContentsMargins(14, 6, 14, 6)
        search_layout.addWidget(self._search_input)
        layout.addWidget(search_container)

        tab_bar = QWidget()
        tab_bar.setFixedHeight(32)
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
                border-bottom: 2px solid transparent; 
                padding-top: 4px; padding-bottom: 8px; padding-left: 4px; padding-right: 4px; 
                font-size: 11px;
            }
            QPushButton:checked { color: #ffffff; border-bottom: 2px solid #ffffff; }
            QPushButton:hover:!checked { color: #aaaaaa; }
        """)
        self._tab_installed.clicked.connect(self._show_installed)
        tab_layout.addWidget(self._tab_installed)

        self._tab_marketplace = QPushButton("Marketplace")
        self._tab_marketplace.setCheckable(True)
        self._tab_marketplace.setStyleSheet("""
            QPushButton {
                background: transparent; color: #888888; border: none;
                border-bottom: 2px solid transparent; 
                padding-top: 4px; padding-bottom: 8px; padding-left: 4px; padding-right: 4px; 
                font-size: 11px;
            }
            QPushButton:checked { color: #ffffff; border-bottom: 2px solid #ffffff; }
            QPushButton:hover:!checked { color: #aaaaaa; }
        """)
        self._tab_marketplace.clicked.connect(self._show_marketplace)
        tab_layout.addWidget(self._tab_marketplace)

        self._tab_recommendations = QPushButton("Recommended")
        self._tab_recommendations.setCheckable(True)
        self._tab_recommendations.setStyleSheet("""
            QPushButton {
                background: transparent; color: #888888; border: none;
                border-bottom: 2px solid transparent; 
                padding-top: 4px; padding-bottom: 8px; padding-left: 4px; padding-right: 4px; 
                font-size: 11px;
            }
            QPushButton:checked { color: #ffffff; border-bottom: 2px solid #ffffff; }
            QPushButton:hover:!checked { color: #aaaaaa; }
        """)
        self._tab_recommendations.clicked.connect(self._show_recommendations)
        tab_layout.addWidget(self._tab_recommendations)

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
        self._tab_recommendations.setChecked(False)
        self._search_input.setPlaceholderText("Search Installed Extensions...")
        self._refresh_extensions()

    def _show_marketplace(self):
        self._tab_installed.setChecked(False)
        self._tab_marketplace.setChecked(True)
        self._tab_recommendations.setChecked(False)
        self._search_input.setPlaceholderText("Search Extensions in Marketplace...")
        query = self._search_input.text().strip()
        if len(query) >= 2:
            self._do_marketplace_search()
        else:
            self._load_featured()

    def _show_recommendations(self):
        self._tab_installed.setChecked(False)
        self._tab_marketplace.setChecked(False)
        self._tab_recommendations.setChecked(True)
        self._search_input.setPlaceholderText("Search Recommendations...")
        self._load_recommendations()

    def _load_recommendations(self):
        self._empty_state.hide()
        self._tree.show()
        self._tree.clear()
        self._count_label.setText("Loading recommendations...")

        def fetch():
            recs = self._ext_manager.get_recommendations()
            self._recommendations_ready.emit(recs)

        threading.Thread(target=fetch, daemon=True).start()

    def _render_recommendations(self, recs: list):
        self._tree.clear()
        self._cards.clear()

        if not recs:
            self._count_label.setText("No recommendations available")
            self._empty_state.hide()
            self._tree.show()
            return

        self._empty_state.hide()
        self._tree.show()
        self._count_label.setText(f"{len(recs)} recommendations")

        installed_names = {ext.name for ext in self._ext_manager.get_installed_extensions()}

        for rec in recs:
            card = OnlineExtensionCard(rec, self._icon_loader,
                                       is_installed=rec.get("id", "").split("/")[-1].split(".")[-1] in installed_names)
            card.install_requested.connect(self._install_from_marketplace)
            card.detail_requested.connect(self._open_detail)

            item = QTreeWidgetItem()
            item.setSizeHint(0, QSize(0, _ExtensionCardBase.CARD_HEIGHT + 6))
            item.setData(0, Qt.UserRole, rec.get("id", ""))
            self._tree.addTopLevelItem(item)
            self._tree.setItemWidget(item, 0, card)
            self._cards.append(card)

    def _on_source_changed(self, _index: int):
        if self._tab_marketplace.isChecked():
            query = self._search_input.text().strip()
            if len(query) >= 2:
                self._do_marketplace_search()
            else:
                self._load_featured()

    def _load_featured(self):
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
        elif self._tab_recommendations.isChecked():
            self._filter_recommendations(text)
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

    def _filter_recommendations(self, text: str):
        text = text.lower()
        count = 0
        for i in range(self._tree.topLevelItemCount()):
            item = self._tree.topLevelItem(i)
            ext_id = item.data(0, Qt.UserRole) or ""
            visible = text in ext_id.lower() if text else True
            item.setHidden(not visible)
            if visible:
                count += 1
        if text:
            self._count_label.setText(f"{count} recommendation(s) match")
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

            deps = ext.manifest.get("extensionDependencies", []) if ext.manifest else []
            pack = ext.manifest.get("extensionPack", []) if ext.manifest else []
            msg = f"'{ext.display_name}' v{ext.version} installed successfully!"
            if deps or pack:
                all_deps = deps + pack
                msg += f"\n\nDependencies installed: {len(all_deps)} extension(s)"
            QMessageBox.information(self, "Extension Installed", msg)
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
            self._tab_recommendations.setChecked(False)

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
            if self._tab_marketplace.isChecked() or self._tab_recommendations.isChecked():
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
