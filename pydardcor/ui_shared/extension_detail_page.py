"""Extension detail page — VS Code-style extension inspector dialog."""

import threading
from typing import Optional, Union

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTabWidget, QWidget, QScrollArea,
)
from PySide6.QtCore import Signal, Qt, QUrl
from PySide6.QtGui import QPixmap, QColor
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtGui import QDesktopServices

from ..core.extension_manager import (
    get_extension_manager, InstalledExtension, SOURCE_VSCODE, SOURCE_OPENVSX,
)
from .extension_icons import (
    ExtensionIconLoader, load_pixmap_from_file, default_extension_pixmap,
    installed_extension_icon_path,
)
from .markdown_html import markdown_to_html, wrap_html_document


class ExtensionDetailPage(QDialog):
    """Modal dialog showing extension README, changelog, dependencies, and metadata."""

    _detail_ready = Signal(object)
    install_requested = Signal(dict)

    def __init__(self, ext_ref: Union[InstalledExtension, dict], parent=None):
        super().__init__(parent)
        self._ext_ref = ext_ref
        self._is_installed = isinstance(ext_ref, InstalledExtension)
        self._ext_manager = get_extension_manager()
        self._icon_loader = ExtensionIconLoader(self)
        self._icon_loader.icon_ready.connect(self._on_icon_ready)
        self._detail_ready.connect(self._apply_details)
        self._details: Optional[dict] = None
        self.setWindowTitle("Extension Details")
        self.setMinimumSize(720, 520)
        self.resize(860, 600)
        self.setStyleSheet("""
            QDialog { background-color: #000000; color: #cccccc; }
            QLabel { border: none; background: transparent; }
        """)
        self._setup_ui()
        self._load_details()

    def _setup_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        header = QWidget()
        header.setStyleSheet("background-color: #0a0a0a; border-bottom: 1px solid #333333;")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(16, 12, 16, 12)
        header_layout.setSpacing(12)

        self._icon_label = QLabel()
        self._icon_label.setFixedSize(64, 64)
        self._icon_label.setStyleSheet("border: 1px solid #333333; border-radius: 8px; background: #1a1a1a;")
        self._icon_label.setAlignment(Qt.AlignCenter)
        self._set_header_icon(default_extension_pixmap(48))
        self._info_layout = QVBoxLayout()
        self._info_layout.setSpacing(4)
        header_layout.addLayout(self._info_layout, 1)

        self._title_label = QLabel()
        self._title_label.setStyleSheet("font-size: 24px; color: #ffffff; font-weight: 300;")
        self._info_layout.addWidget(self._title_label)

        self._desc_label = QLabel()
        self._desc_label.setStyleSheet("font-size: 13px; color: #aaaaaa;")
        self._desc_label.setWordWrap(True)
        self._info_layout.addWidget(self._desc_label)

        self._meta_label = QLabel()
        self._meta_label.setStyleSheet("font-size: 11px; color: #888888;")
        self._info_layout.addWidget(self._meta_label)
        
        self._rating_label = QLabel()
        self._rating_label.setStyleSheet("font-size: 11px; color: #ffcc00;")
        self._info_layout.addWidget(self._rating_label)

        self._action_btn = QPushButton("Install")
        self._action_btn.setFixedHeight(32)
        self._action_btn.setCursor(Qt.PointingHandCursor)
        self._action_btn.setStyleSheet("""
            QPushButton {
                background-color: #333333; color: #ffffff; border: none;
                border-radius: 4px; font-size: 12px; font-weight: bold; padding: 0 16px;
            }
            QPushButton:hover { background-color: #444444; }
            QPushButton:disabled { background-color: #2a2a2a; color: #858585; }
        """)
        self._action_btn.clicked.connect(self._on_action)
        header_layout.addWidget(self._action_btn)

        close_btn = QPushButton("\u00d7")
        close_btn.setFixedSize(28, 28)
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.setStyleSheet("""
            QPushButton { background: transparent; color: #cccccc; border: none; font-size: 18px; }
            QPushButton:hover { background-color: #1a1a1a; border-radius: 4px; color: #ffffff; }
        """)
        close_btn.clicked.connect(self.reject)
        header_layout.addWidget(close_btn)
        root.addWidget(header)

        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)

        self._tabs = QTabWidget()
        self._tabs.setStyleSheet("""
            QTabWidget::pane { border: none; background: #000000; }
            QTabBar::tab {
                background: #0a0a0a; color: #888888; padding: 8px 16px;
                border: none; border-bottom: 2px solid transparent; font-size: 11px;
                font-weight: 600; letter-spacing: 0.5px;
            }
            QTabBar::tab:selected { color: #ffffff; border-bottom: 2px solid #ffffff; }
            QTabBar::tab:hover:!selected { color: #aaaaaa; background: #1a1a1a; }
        """)

        self._readme_view = self._make_markdown_view()
        self._changelog_view = self._make_markdown_view()
        self._deps_view = self._make_markdown_view()
        self._features_view = self._make_markdown_view()

        self._tabs.addTab(self._readme_view, "DETAILS")
        self._tabs.addTab(self._changelog_view, "CHANGELOG")
        self._tabs.addTab(self._deps_view, "DEPENDENCIES")
        self._tabs.addTab(self._features_view, "FEATURES")
        body.addWidget(self._tabs, 1)

        sidebar = QScrollArea()
        sidebar.setFixedWidth(240)
        sidebar.setWidgetResizable(True)
        sidebar.setStyleSheet("QScrollArea { border: none; background: #0a0a0a; border-left: 1px solid #333333; }")
        sidebar_inner = QWidget()
        sidebar_inner.setStyleSheet("background: #0a0a0a;")
        self._sidebar_layout = QVBoxLayout(sidebar_inner)
        self._sidebar_layout.setContentsMargins(12, 12, 12, 12)
        self._sidebar_layout.setSpacing(8)
        sidebar.setWidget(sidebar_inner)
        body.addWidget(sidebar)
        root.addLayout(body, 1)

        self._show_loading()

    def _make_markdown_view(self) -> QWebEngineView:
        view = QWebEngineView()
        view.page().setBackgroundColor(QColor(0, 0, 0))
        view.setStyleSheet("background-color: #000000; border: none;")
        settings = view.page().settings()
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        return view

    def _set_markdown_view(self, view: QWebEngineView, markdown: str, base_url: str = ""):
        body = markdown_to_html(markdown)
        html = wrap_html_document(body, base_url)
        view.setHtml(html, QUrl(base_url) if base_url else QUrl())

    def _show_loading(self):
        self._title_label.setText("Loading...")
        self._subtitle_label.setText("")
        self._set_markdown_view(self._readme_view, "Loading extension details...")
        self._action_btn.setEnabled(False)

    def _set_header_icon(self, pm: QPixmap):
        scaled = pm.scaled(48, 48, Qt.KeepAspectRatio, Qt.SmoothTransformation)
        self._icon_label.setPixmap(scaled)

    def _on_icon_ready(self, key: str, pm: QPixmap):
        if self._details and key.startswith(self._details.get("icon_url", "") or "___"):
            self._set_header_icon(pm)

    def _load_details(self):
        if self._is_installed:
            ext: InstalledExtension = self._ext_ref
            details = self._ext_manager.get_installed_extension_details(ext.name)
            if details:
                icon_path = installed_extension_icon_path(ext.path, ext.manifest or {})
                if icon_path:
                    pm = load_pixmap_from_file(icon_path, 48)
                    if pm:
                        self._set_header_icon(pm)
            self._apply_details(details or {})
            return

        ext_dict: dict = self._ext_ref
        ext_id = ext_dict.get("id", "")
        source = ext_dict.get("source", SOURCE_VSCODE)
        icon_url = ext_dict.get("icon_url", "")
        if icon_url:
            self._set_header_icon(self._icon_loader.pixmap_for_url(icon_url, 48))

        def fetch():
            details = self._ext_manager.get_marketplace_extension_details(ext_id, source)
            if not details:
                details = dict(ext_dict)
                details.setdefault("readme", ext_dict.get("description", ""))
                details.setdefault("changelog", "")
                details.setdefault("dependencies", [])
            self._detail_ready.emit(details)

        threading.Thread(target=fetch, daemon=True).start()

    def _apply_details(self, details: dict):
        self._details = details
        name = details.get("display_name") or details.get("name", "")
        publisher = details.get("publisher", "")
        version = details.get("version", "")
        self._title_label.setText(name)
        self._subtitle_label.setText(details.get("description", ""))

        readme = details.get("readme") or details.get("description", "") or "No README available."
        changelog = details.get("changelog") or "No changelog available."
        deps = details.get("dependencies") or []
        if deps:
            deps_text = "\n".join(f"- `{d}`" for d in deps)
        else:
            deps_text = "No dependencies."

        base_url = details.get("asset_base_url", "")
        if not base_url and details.get("path"):
            from pathlib import Path
            base_url = Path(details["path"]).as_uri() + "/"

        self._set_markdown_view(self._readme_view, readme, base_url)
        self._set_markdown_view(self._changelog_view, changelog, base_url)
        self._set_markdown_view(self._deps_view, deps_text, base_url)

        self._rebuild_sidebar(details)

        installed = details.get("installed", self._is_installed)
        if installed:
            self._action_btn.setText("Installed")
            self._action_btn.setEnabled(False)
        else:
            self._action_btn.setText("Install")
            self._action_btn.setEnabled(True)

    def _rebuild_sidebar(self, d: dict):
        while self._sidebar_layout.count():
            item = self._sidebar_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        self._sidebar_layout.addWidget(self._section_title("Installation"))
        self._sidebar_layout.addWidget(self._info_row("Identifier", d.get("id", "")))
        self._sidebar_layout.addWidget(self._info_row("Version", d.get("version", "")))
        self._sidebar_layout.addWidget(self._info_row("Last Updated", d.get("last_updated") or d.get("last_released", "—")))
        if d.get("size"):
            self._sidebar_layout.addWidget(self._info_row("Size", d.get("size", "")))

        self._sidebar_layout.addWidget(self._section_title("Marketplace"))
        self._sidebar_layout.addWidget(self._info_row("Published", d.get("published", "—")))
        self._sidebar_layout.addWidget(self._info_row("Last Released", d.get("last_released", "—")))
        cats = d.get("categories") or []
        self._sidebar_layout.addWidget(self._info_row("Categories", ", ".join(cats) if cats else "—"))

        self._sidebar_layout.addWidget(self._section_title("Resources"))
        for label, url in (
            ("Repository", d.get("repository", "")),
            ("Issues", d.get("bugs", "")),
            ("License", d.get("license", "")),
            ("Marketplace", d.get("marketplace_url") or d.get("homepage", "")),
        ):
            if url and (url.startswith("http") or label == "License"):
                self._sidebar_layout.addWidget(self._link_row(label, url if url.startswith("http") else url))
        self._sidebar_layout.addStretch()

    def _section_title(self, text: str) -> QLabel:
        lbl = QLabel(text.upper())
        lbl.setStyleSheet("color: #888888; font-size: 10px; font-weight: 600; letter-spacing: 1px; padding-top: 8px;")
        return lbl

    def _info_row(self, label: str, value: str) -> QLabel:
        lbl = QLabel(f"<span style='color:#858585'>{label}</span><br><span style='color:#cccccc'>{value or '—'}</span>")
        lbl.setWordWrap(True)
        lbl.setTextFormat(Qt.RichText)
        lbl.setStyleSheet("font-size: 11px; padding: 2px 0;")
        return lbl

    def _link_row(self, label: str, url: str) -> QWidget:
        row = QWidget()
        lay = QHBoxLayout(row)
        lay.setContentsMargins(0, 0, 0, 0)
        lbl = QLabel(f"{label}: ")
        lbl.setStyleSheet("color: #858585; font-size: 11px;")
        btn = QPushButton(url if len(url) < 40 else url[:37] + "...")
        btn.setCursor(Qt.PointingHandCursor)
        btn.setStyleSheet("""
            QPushButton { background: transparent; color: #4daafc; border: none;
                font-size: 11px; text-align: left; padding: 0; }
            QPushButton:hover { color: #ffffff; }
        """)
        btn.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(url)))
        lay.addWidget(lbl)
        lay.addWidget(btn, 1)
        return row

    def _on_action(self):
        if not self._details or self._is_installed:
            return
        self.install_requested.emit(self._details)
        self.accept()


def show_extension_detail(ext_ref: Union[InstalledExtension, dict], parent=None,
                          on_install=None) -> None:
    """Open the extension detail dialog for an installed extension or marketplace dict."""
    dlg = ExtensionDetailPage(ext_ref, parent)
    if on_install:
        dlg.install_requested.connect(on_install)
    dlg.exec()
