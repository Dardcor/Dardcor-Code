import os
from PySide6.QtWidgets import QWidget, QVBoxLayout
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtCore import Signal, QUrl
from .bridge import GitBridge

class GitPanel(QWidget):
    # Backward compatibility signals if main_window still needs them
    file_open_requested = Signal(str)
    diff_open_requested = Signal(str, str, str)
    refreshed = Signal()
    counts_changed = Signal(int)

    def __init__(self, root_path=None, parent=None):
        super().__init__(parent)
        self._root = root_path or ""
        self._webview_loaded = False
        
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)

        # Bridge is lightweight; defer the heavy QWebEngineView until first show.
        self.bridge = GitBridge(self)
        self.channel = None
        self.webview = None
        
        if root_path:
            self.set_root(root_path)

    def _ensure_webview(self):
        if self._webview_loaded:
            return
        self._webview_loaded = True

        self.webview = QWebEngineView(self)
        self.webview.page().setBackgroundColor(0)
        self.layout.addWidget(self.webview)

        self.channel = QWebChannel()
        self.channel.registerObject("gitBridge", self.bridge)
        self.webview.page().setWebChannel(self.channel)

        project_root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
        index_path = os.path.join(project_root, "script", "index", "source_control.html")
        self.webview.loadFinished.connect(self._on_load_finished)
        self.webview.load(QUrl.fromLocalFile(index_path))

    def _on_load_finished(self, ok):
        if ok:
            from ..app.theme_manager import ThemeManager
            theme = ThemeManager.THEMES.get(ThemeManager._current_theme, {})
            colors = theme.get("colors", {})
            if colors:
                self.apply_theme(colors)

    def apply_theme(self, colors: dict):
        if self.webview and self._webview_loaded:
            import json
            script = f"if(typeof setTheme === 'function') setTheme({json.dumps(colors)});"
            self.webview.page().runJavaScript(script)

    def showEvent(self, event):
        self._ensure_webview()
        super().showEvent(event)

    def set_app(self, app):
        """Pass the main app reference to the bridge for openDiff etc."""
        self.bridge.set_app(app)

    def set_root(self, path):
        self._root = path
        self.bridge.set_workspace(path)

    def set_workspace_path(self, path):
        self.set_root(path)
