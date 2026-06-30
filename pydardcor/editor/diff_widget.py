from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtCore import QUrl, QObject, Slot
import os

class DiffBridge(QObject):
    @Slot(str)
    def log(self, msg):
        print(f"[DiffEditor] {msg}")

class DiffEditorWidget(QWebEngineView):
    """Monaco-based side-by-side diff editor widget."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.bridge = DiffBridge()
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.page().setWebChannel(self.channel)
        
        # Load the diff editor HTML (assumes assets/monaco/diff.html exists)
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.html_path = os.path.join(base_dir, "assets", "monaco", "diff.html")
        
        # If the file doesn't exist yet in assets, we use standard index.html but we'd need JS changes
        if not os.path.exists(self.html_path):
            self.html_path = os.path.join(base_dir, "assets", "monaco", "index.html")
            
        self.load(QUrl.fromLocalFile(self.html_path))
        self._is_ready = False
        self.page().loadFinished.connect(self._on_load_finished)
        
        self._pending_original = ""
        self._pending_modified = ""
        self._pending_lang = "plaintext"

    def _on_load_finished(self, ok):
        if ok:
            self._is_ready = True
            if self._pending_original or self._pending_modified:
                self.set_diff(self._pending_original, self._pending_modified, self._pending_lang)

    def set_diff(self, original: str, modified: str, language: str):
        if not self._is_ready:
            self._pending_original = original
            self._pending_modified = modified
            self._pending_lang = language
            return
            
        import json
        orig_json = json.dumps(original)
        mod_json = json.dumps(modified)
        lang_json = json.dumps(language)
        
        script = f"""
        if (typeof createDiffEditor === 'function') {{
            createDiffEditor({orig_json}, {mod_json}, {lang_json});
        }} else {{
            console.log("Diff editor not implemented in HTML yet.");
        }}
        """
        self.page().runJavaScript(script)
