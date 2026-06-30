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
        
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)
        
        self.webview = QWebEngineView(self)
        
        # Transparent background trick if supported
        self.webview.page().setBackgroundColor(0) 
        
        self.layout.addWidget(self.webview)
        
        # Setup Bridge
        self.channel = QWebChannel()
        self.bridge = GitBridge(self)
        self.channel.registerObject("gitBridge", self.bridge)
        self.webview.page().setWebChannel(self.channel)
        
        # Load the custom html from centralized script directory
        project_root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
        index_path = os.path.join(project_root, "script", "index", "source_control.html")
        self.webview.load(QUrl.fromLocalFile(index_path))
        
        if root_path:
            self.set_root(root_path)

    def set_app(self, app):
        """Pass the main app reference to the bridge for openDiff etc."""
        self.bridge.set_app(app)

    def set_root(self, path):
        self._root = path
        self.bridge.set_workspace(path)

    def set_workspace_path(self, path):
        self.set_root(path)
