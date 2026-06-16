import os
import json
from PySide6.QtWidgets import QWidget, QVBoxLayout
from PySide6.QtCore import Signal, Qt, QTimer, QUrl
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings, QWebEnginePage
from PySide6.QtWebChannel import QWebChannel

from .bridge import EditorBridge
from .language import detect_language, LANGUAGE_DISPLAY

class MonacoEditorWidget(QWidget):
    """Single Monaco Editor instance backed by QWebEngineView."""

    content_changed = Signal(str)
    cursor_position_changed = Signal(int, int)
    save_requested = Signal()
    command_palette_requested = Signal()
    diagnostics_ready = Signal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._file_path = None
        self._language = "plaintext"
        self._dirty = False
        self._content = ""
        self._view_ready = False
        self.diagnostics_ready.connect(self.set_diagnostics)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._view = QWebEngineView(self)
        self._view.setContextMenuPolicy(Qt.NoContextMenu)
        
        settings = self._view.page().profile().settings()
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)

        self._channel = QWebChannel()
        self._bridge = EditorBridge(self)
        self._channel.registerObject("editor_backend", self._bridge)
        self._view.page().setWebChannel(self._channel)

        # Wire bridge signals
        self._bridge.content_changed.connect(self._on_content_changed)
        self._bridge.cursor_changed.connect(self.cursor_position_changed)
        self._bridge.save_requested.connect(self.save_requested)
        self._bridge.command_palette_requested.connect(self.command_palette_requested)

        self._view.loadFinished.connect(self._on_load_finished)

        # Base path pointing correctly to assets
        html_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "assets", "monaco", "monaco_editor.html"
        )
        self._view.load(QUrl.fromLocalFile(html_path))
        layout.addWidget(self._view)

    def _on_load_finished(self, ok):
        self._view_ready = True
        # Apply content if already set
        if self._content is not None:
            QTimer.singleShot(150, self._apply_pending_content)
            if self._file_path and self._file_path.endswith(".py"):
                QTimer.singleShot(600, self._run_linter)

    def _apply_pending_content(self):
        import json
        safe_content_js = json.dumps(self._content)
        lang_js = json.dumps(self._language)
        fpath_js = json.dumps(self._file_path or "")
        js = f"setEditorContent({safe_content_js}, {lang_js}, {fpath_js});"
        self._view.page().runJavaScript(js)

    def _on_content_changed(self, content):
        self._content = content
        self._dirty = True
        self.content_changed.emit(content)

    def open_file(self, file_path):
        self._file_path = file_path
        self._language = detect_language(file_path)
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                self._content = f.read()
        except Exception as e:
            self._content = f"# Error opening file: {e}"
        self._dirty = False
        if self._view_ready:
            self._apply_pending_content()

    def set_content(self, content, language="plaintext"):
        self._content = content
        self._language = language
        self._dirty = False
        if self._view_ready:
            QTimer.singleShot(50, self._apply_pending_content)

    def get_content(self):
        return self._content

    def save(self):
        if not self._file_path:
            return False
        try:
            with open(self._file_path, "w", encoding="utf-8") as f:
                f.write(self._content)
            self._dirty = False
            
            # Run linter on save
            if self._file_path.endswith(".py"):
                self._run_linter()
                
            return True
        except Exception:
            return False

    def save_as(self, path):
        self._file_path = path
        self._language = detect_language(path)
        return self.save()

    def is_dirty(self):
        return self._dirty

    def get_file_path(self):
        return self._file_path

    def get_language(self):
        return LANGUAGE_DISPLAY.get(self._language, self._language.capitalize())

    def set_font_size(self, size):
        if self._view_ready:
            self._view.page().runJavaScript(f"setFontSize({size});")

    def set_word_wrap(self, enabled):
        if self._view_ready:
            val = "true" if enabled else "false"
            self._view.page().runJavaScript(f"setWordWrap({val});")

    def set_minimap(self, enabled):
        if self._view_ready:
            val = "true" if enabled else "false"
            self._view.page().runJavaScript(f"setMinimap({val});")

    def trigger_find(self):
        if self._view_ready:
            self._view.page().runJavaScript("triggerFind();")

    def trigger_find_replace(self):
        if self._view_ready:
            self._view.page().runJavaScript("triggerFindReplace();")

    def trigger_format(self):
        if self._view_ready:
            self._view.page().runJavaScript("triggerFormat();")

    def reveal_line(self, line):
        if self._view_ready:
            self._view.page().runJavaScript(f"revealLine({line});")

    def set_diagnostics(self, markers):
        if self._view_ready:
            js_markers = json.dumps(markers)
            self._view.page().runJavaScript(f"setDiagnostics({js_markers});")

    def undo(self):
        if self._view_ready:
            self._view.page().runJavaScript("undo();")

    def redo(self):
        if self._view_ready:
            self._view.page().runJavaScript("redo();")

    def cut(self):
        self._view.triggerPageAction(QWebEnginePage.WebAction.Cut)

    def copy(self):
        self._view.triggerPageAction(QWebEnginePage.WebAction.Copy)

    def paste(self):
        self._view.triggerPageAction(QWebEnginePage.WebAction.Paste)

    def focus(self):
        if self._view_ready:
            self._view.page().runJavaScript("focusEditor();")
        self._view.setFocus()

    def _run_linter(self):
        if not self._file_path or not self._file_path.endswith(".py"):
            return

        import threading
        def worker():
            markers = []
            
            # 1. Built-in Syntax check using ast.parse (zero-dependency and fast)
            try:
                import ast
                ast.parse(self._content, filename=self._file_path)
            except SyntaxError as e:
                markers.append({
                    "severity": "error",
                    "startLine": e.lineno or 1,
                    "startColumn": e.offset or 1,
                    "endLine": e.lineno or 1,
                    "endColumn": (e.offset or 1) + 5,
                    "message": e.msg,
                    "source": "python-syntax"
                })
            except Exception:
                pass
            
            # 2. Try running flake8 if available
            if not markers:
                try:
                    import subprocess
                    kwargs = {}
                    if os.name == 'nt':
                        kwargs['creationflags'] = 0x08000000  # CREATE_NO_WINDOW
                    result = subprocess.run(
                        ["flake8", self._file_path, "--format=%(row)d:%(col)d:%(code)s:%(text)s"],
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=5,
                        **kwargs
                    )
                    if result.stdout:
                        for line in result.stdout.splitlines():
                            parts = line.split(":", 3)
                            if len(parts) == 4:
                                row, col, code, text = parts
                                severity = "error" if code.startswith("F") or code.startswith("E9") else "warning"
                                markers.append({
                                    "severity": severity,
                                    "startLine": int(row),
                                    "startColumn": int(col),
                                    "endLine": int(row),
                                    "endColumn": int(col) + 5,
                                    "message": f"[{code}] {text}",
                                    "source": "flake8"
                                })
                except Exception:
                    pass

            self.diagnostics_ready.emit(markers)

        threading.Thread(target=worker, daemon=True).start()

    def expand_selection(self):
        if self._view_ready:
            self._view.page().runJavaScript("editor.trigger('keyboard', 'editor.action.smartSelect.expand', null);")
            
    def shrink_selection(self):
        if self._view_ready:
            self._view.page().runJavaScript("editor.trigger('keyboard', 'editor.action.smartSelect.shrink', null);")

    def copy_line_up(self):
        if self._view_ready:
            self._view.page().runJavaScript("editor.trigger('keyboard', 'editor.action.copyLinesUpAction', null);")

    def copy_line_down(self):
        if self._view_ready:
            self._view.page().runJavaScript("editor.trigger('keyboard', 'editor.action.copyLinesDownAction', null);")

    def go_to_definition(self):
        if self._view_ready:
            self._view.page().runJavaScript("editor.trigger('keyboard', 'editor.action.revealDefinition', null);")

    def toggle_breakpoint(self):
        if self._view_ready:
            js = """
                var pos = editor.getPosition();
                if (pos) {
                    addBreakpoint(pos.lineNumber);
                }
            """
            self._view.page().runJavaScript(js)
