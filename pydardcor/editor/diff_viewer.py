import os
from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QPushButton
from PySide6.QtGui import QIcon, QFont
from PySide6.QtCore import Signal, Qt, QTimer, QUrl, QObject, Slot
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebChannel import QWebChannel

from .language import detect_language, LANGUAGE_DISPLAY


class DiffBridge(QObject):
    """Bridge object for Diff Editor communicating between Python and Monaco."""
    ready = Signal()

    @Slot()
    def on_ready(self):
        self.ready.emit()


class MonacoDiffEditorWidget(QWidget):
    """Monaco Diff Editor widget backed by QWebEngineView."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._file_path = None
        self._language = "plaintext"
        self._view_ready = False
        self._original_content = ""
        self._modified_content = ""
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._view = QWebEngineView(self)
        
        # Add Toolbar
        toolbar_layout = QHBoxLayout()
        toolbar_layout.setContentsMargins(10, 4, 10, 4)
        toolbar_layout.setSpacing(8)
        
        # We assume codicon is loaded, but using text for safety
        self.btn_prev = QPushButton("Previous Diff")
        self.btn_next = QPushButton("Next Diff")
        self.btn_revert = QPushButton("Revert Block")
        self.btn_stage = QPushButton("Stage Block")
        
        for btn in [self.btn_prev, self.btn_next, self.btn_revert, self.btn_stage]:
            btn.setStyleSheet("""
                QPushButton { background: #333333; color: white; border: none; padding: 4px 8px; border-radius: 2px; }
                QPushButton:hover { background: #444444; }
            """)
            toolbar_layout.addWidget(btn)
        toolbar_layout.addStretch()
        
        self.btn_prev.clicked.connect(self._prev_diff)
        self.btn_next.clicked.connect(self._next_diff)
        self.btn_revert.clicked.connect(self._revert_block)
        self.btn_stage.clicked.connect(self._stage_block)
        
        layout.addLayout(toolbar_layout)
        from PySide6.QtGui import QColor
        self._view.page().setBackgroundColor(QColor(0, 0, 0, 0))
        self._view.setContextMenuPolicy(Qt.NoContextMenu)

        settings = self._view.page().profile().settings()
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)

        self._channel = QWebChannel()
        self._bridge = DiffBridge(self)
        self._channel.registerObject("diff_backend", self._bridge)
        self._view.page().setWebChannel(self._channel)

        self._bridge.ready.connect(self._on_bridge_ready)

        # Base path pointing correctly to assets
        html_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "assets", "monaco", "diff_editor.html"
        )
        self._view.load(QUrl.fromLocalFile(html_path))
        layout.addWidget(self._view)

    def _on_bridge_ready(self):
        self._view_ready = True
        self._apply_diff_content()
        try:
            from .widget import get_global_custom_theme
            theme = get_global_custom_theme()
            if theme is not None:
                QTimer.singleShot(200, lambda: self.set_custom_theme(theme))
        except Exception:
            pass

    def set_diff(self, original, modified, file_path):
        self._original_content = original
        self._modified_content = modified
        self._file_path = file_path
        self._language = detect_language(file_path) if file_path else "plaintext"
        if self._view_ready:
            self._apply_diff_content()

    def _apply_diff_content(self):
        import json
        orig_js = json.dumps(self._original_content)
        mod_js = json.dumps(self._modified_content)
        lang_js = json.dumps(self._language)
        js = f"setDiffContent({orig_js}, {mod_js}, {lang_js});"
        self._view.page().runJavaScript(js)

    def _prev_diff(self):
        if self._view_ready:
            self._view.page().runJavaScript("if (typeof diffEditor !== 'undefined') diffEditor.goToDiff('previous');")
            
    def _next_diff(self):
        if self._view_ready:
            self._view.page().runJavaScript("if (typeof diffEditor !== 'undefined') diffEditor.goToDiff('next');")
            
    def _revert_block(self):
        if self._view_ready:
            # We trigger a JS function that grabs the current diff block and reverts it
            self._view.page().runJavaScript("if (typeof revertCurrentBlock !== 'undefined') revertCurrentBlock();")
            
    def _stage_block(self):
        if self._view_ready:
            self._view.page().runJavaScript("if (typeof stageCurrentBlock !== 'undefined') stageCurrentBlock();")

    def get_file_path(self):
        return self._file_path

    def get_language(self):
        return LANGUAGE_DISPLAY.get(self._language, self._language.capitalize())

    def is_dirty(self):
        return False

    def save(self):
        return False

    def focus(self):
        self._view.setFocus()

    def set_theme(self, is_dark):
        if self._view_ready:
            val = "true" if is_dark else "false"
            self._view.page().runJavaScript(f"setTheme({val});")

    def set_custom_theme(self, theme_data):
        if not self._view_ready:
            return
        import json
        payload = json.dumps(json.dumps(theme_data) if theme_data is not None else None)
        self._view.page().runJavaScript(f"defineCustomTheme({payload});")

    def toggle_inline_view(self, inline: bool):
        if self._view_ready:
            val = "true" if inline else "false"
            self._view.page().runJavaScript(f"toggleInline({val});")

    def closeEvent(self, event):
        self.cleanup()
        super().closeEvent(event)

    def cleanup(self):
        try:
            self._bridge.ready.disconnect(self._on_bridge_ready)
        except Exception:
            pass
        if hasattr(self, "_view") and self._view:
            self._view.stop()
            page = self._view.page()
            if page:
                page.setWebChannel(None)
            self._view.setParent(None)
            self._view.deleteLater()
            self._view = None
        if hasattr(self, "_channel") and self._channel:
            if hasattr(self, "_bridge") and self._bridge:
                self._channel.deregisterObject(self._bridge)
            self._channel = None
        self._bridge = None
