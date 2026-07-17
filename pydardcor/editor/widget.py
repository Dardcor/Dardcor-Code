import os
import json
from PySide6.QtWidgets import QWidget, QVBoxLayout
from PySide6.QtCore import Signal, Qt, QTimer, QUrl
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings, QWebEnginePage
from PySide6.QtWebChannel import QWebChannel

from .bridge import EditorBridge
from .language import detect_language, LANGUAGE_DISPLAY

# Active extension color theme (Monaco format) shared by every editor instance,
# so newly opened editors pick it up when their web view finishes loading.
_GLOBAL_CUSTOM_THEME = None


def set_global_custom_theme(theme_data):
    global _GLOBAL_CUSTOM_THEME
    _GLOBAL_CUSTOM_THEME = theme_data


def get_global_custom_theme():
    return _GLOBAL_CUSTOM_THEME


def get_editor_states_file() -> str:
    from ..core.config import get_user_data_dir
    return os.path.join(get_user_data_dir(), "editor_states.json")


def load_editor_states() -> dict:
    path = get_editor_states_file()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_editor_states(states: dict):
    path = get_editor_states_file()
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(states, f, indent=2)
    except Exception:
        pass


class MonacoEditorWidget(QWidget):
    content_changed = Signal(str)
    cursor_position_changed = Signal(int, int)
    selection_changed = Signal(int, int)
    multi_cursor_changed = Signal(str)
    selection_state_changed = Signal(str)
    save_requested = Signal()
    format_on_save_requested = Signal()
    code_actions_on_save_requested = Signal(str)
    command_palette_requested = Signal()
    diagnostics_ready = Signal(list)
    definition_found = Signal(str, int, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._file_path = None
        self._language = "plaintext"
        self._dirty = False
        self._content = ""
        self._view_ready = False
        self._lsp_client = None
        self._read_only = False
        
        # Debounce timer for LSP didChange notifications (BUG-041)
        self._lsp_debounce_timer = QTimer(self)
        self._lsp_debounce_timer.setSingleShot(True)
        self._lsp_debounce_timer.setInterval(300)
        self._lsp_debounce_timer.timeout.connect(self._flush_lsp_did_change)
        
        self.diagnostics_ready.connect(self.set_diagnostics)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._view = QWebEngineView(self)
        from PySide6.QtGui import QColor
        self._view.page().setBackgroundColor(QColor(0, 0, 0, 0))
        self._view.setContextMenuPolicy(Qt.NoContextMenu)
        
        settings = self._view.page().profile().settings()
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.WebGLEnabled, True)
        settings.setAttribute(QWebEngineSettings.Accelerated2dCanvasEnabled, True)

        self._channel = QWebChannel()
        self._bridge = EditorBridge(self)
        self._channel.registerObject("editor_backend", self._bridge)
        self._view.page().setWebChannel(self._channel)

        # Wire bridge signals
        self._bridge.content_changed.connect(self._on_content_changed)
        self._bridge.content_changed_incremental.connect(self._on_content_changed_incremental)
        self._bridge.multi_cursor_changed.connect(self.multi_cursor_changed.emit)
        self._bridge.selection_state_changed.connect(self.selection_state_changed.emit)
        self._bridge.format_on_save_requested.connect(self._on_format_on_save)
        self._bridge.code_actions_on_save_requested.connect(self._on_code_actions_on_save)
        self._bridge.language_changed.connect(self._on_editor_language_changed)
        self._bridge.view_state_changed.connect(self._on_view_state_changed)
        self._bridge.undo_stack_available.connect(self._on_undo_stack_available)
        
        self._cursor_line = 1
        self._cursor_col = 1
        def _handle_cursor_changed(line, col):
            self._cursor_line = line
            self._cursor_col = col
            self.cursor_position_changed.emit(line, col)
        
        self._bridge.cursor_changed.connect(_handle_cursor_changed)
        self._bridge.selection_changed.connect(self.selection_changed.emit)
        
        self._bridge.save_requested.connect(self.save_requested)
        self._bridge.command_palette_requested.connect(self.command_palette_requested)
        self._bridge.extension_command_requested.connect(self._on_extension_command)
        self._bridge.open_with_live_server_requested.connect(self._open_with_live_server)

        self._view.loadFinished.connect(self._on_load_finished)

        settings.setAttribute(QWebEngineSettings.ScrollAnimatorEnabled, True)

        self._view.page().profile().clearHttpCache()
        
        # We need absolute path for local files in QWebEngine
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        html_path = os.path.join(base_dir, "assets", "monaco", "monaco_editor.html")
        self._view.load(QUrl.fromLocalFile(html_path))
        
        from pydardcor.app.theme_manager import ThemeManager
        self._view.setZoomFactor(1.1 ** ThemeManager._current_zoom_level)
        
        layout.addWidget(self._view)

    def _on_load_finished(self, ok):
        self._view_ready = True
        # Apply content if already set
        if self._content is not None:
            QTimer.singleShot(150, self._apply_pending_content)
            if self._file_path and self._file_path.endswith(".py"):
                QTimer.singleShot(600, self._run_linter)
        if _GLOBAL_CUSTOM_THEME is not None:
            QTimer.singleShot(200, lambda: self.set_custom_theme(_GLOBAL_CUSTOM_THEME))
        QTimer.singleShot(250, self.refresh_extension_context_menu)
        QTimer.singleShot(260, self.refresh_live_server_context_menu)

    def _apply_pending_content(self):
        import json
        lang_js = json.dumps(self._language)
        fpath_js = json.dumps(self._file_path or "")
        js = f"requestContentFromBackend({lang_js}, {fpath_js});"
        if self._file_path:
            states = load_editor_states()
            state = states.get(self._file_path)
            if state:
                js += f" setTimeout(function() {{ restoreViewState({json.dumps(state)}); }}, 200);"
        self._view.page().runJavaScript(js)
        self._apply_editor_options()

    def _is_file_read_only(self, file_path: str) -> bool:
        try:
            return not os.access(file_path, os.W_OK)
        except OSError:
            return True

    def _apply_editor_options(self):
        if not self._view_ready:
            return
        import json
        placeholder = ""
        if not self._file_path and not (self._content or "").strip():
            placeholder = "Start typing, or press Ctrl+Space for suggestions"
        self._view.page().runJavaScript(f"setPlaceholder({json.dumps(placeholder)});")
        ro = "true" if self._read_only else "false"
        self._view.page().runJavaScript(f"setReadOnly({ro});")

    def persist_view_state(self, state_json):
        if not self._file_path:
            return
        states = load_editor_states()
        states[self._file_path] = state_json
        save_editor_states(states)

    def insert_text(self, text):
        import json
        safe_text = json.dumps(text)
        self._view.page().runJavaScript(f"insertTextAtCursor({safe_text});")

    def _on_content_changed(self, content):
        self._content = content
        self._dirty = True
        self.content_changed.emit(content)
        if not self._file_path and self._view_ready:
            self._apply_editor_options()
        
        if self._lsp_client and self._file_path:
            self._lsp_debounce_timer.start()

    def _on_content_changed_incremental(self, file_path, start_line, start_col, end_line, end_col, text):
        pass

    def _on_format_on_save(self):
        self.format_on_save_requested.emit()
        if self._view_ready and self._file_path:
            self._view.page().runJavaScript("editor.getAction('editor.action.formatDocument').run();")

    def _on_code_actions_on_save(self, file_path):
        self.code_actions_on_save_requested.emit(file_path)
        self._view.page().runJavaScript("editor.trigger('keyboard', 'editor.action.quickFix', null);")

    def _on_editor_language_changed(self, language):
        self._language = language

    def _on_view_state_changed(self, state_json):
        pass

    def _on_undo_stack_available(self, stack_json):
        pass

    def _flush_lsp_did_change(self):
        if self._lsp_client and self._file_path and self._content is not None:
            from pathlib import Path
            uri = Path(self._file_path).as_uri()
            try:
                self._lsp_client.send_notification("textDocument/didChange", {
                    "textDocument": {"uri": uri, "version": 2},
                    "contentChanges": [{"text": self._content}]
                })
            except Exception:
                pass

    def open_file(self, file_path):
        if self._file_path and self._lsp_client:
            self._bridge.notify_closed()
        self._file_path = file_path
        self._language = detect_language(file_path)
        self._encoding = "utf-8"
        try:
            import tokenize
            try:
                with open(file_path, "rb") as f:
                    self._encoding, _ = tokenize.detect_encoding(f.readline)
            except Exception:
                self._encoding = "utf-8"
                
            with open(file_path, "r", encoding=self._encoding, errors="replace") as f:
                self._content = f.read()
            if "\r\n" in self._content:
                self._eol = "CRLF"
            elif "\r" in self._content:
                self._eol = "CR"
            else:
                self._eol = "LF"
        except Exception as e:
            self._content = f"# Error opening file: {e}"
            self._eol = "LF"
        self._dirty = False
        self._read_only = self._is_file_read_only(file_path)
        if self._view_ready:
            self._apply_pending_content()
        self._bridge.set_file_path(file_path)
        if self._view_ready:
            QTimer.singleShot(300, self.refresh_live_server_context_menu)
        if self._lsp_client:
            QTimer.singleShot(300, self._run_lsp_diagnostics)
        elif self._file_path and self._file_path.endswith(".py"):
            QTimer.singleShot(600, self._run_linter)

    def set_content(self, content, language="plaintext"):
        self._content = content
        self._language = language
        self._encoding = "utf-8"
        self._eol = "LF"
        self._dirty = False
        self._read_only = False
        if self._view_ready:
            QTimer.singleShot(50, self._apply_pending_content)

    def get_content(self):
        return self._content

    def get_selection(self) -> str:
        """Return the currently selected text in the editor (empty string if none)."""
        return getattr(self, "_selected_text", "")

    def save(self):
        if not self._file_path:
            return False
        try:
            # Auto-insert final newline for the saved file on disk,
            # but do not force-update the Monaco value via setValue,
            # to preserve Monaco's undo/redo history.
            content_to_save = self._content
            if content_to_save and not content_to_save.endswith("\n"):
                content_to_save += "\n"

            enc = getattr(self, "_encoding", "utf-8")
            with open(self._file_path, "w", encoding=enc) as f:
                f.write(content_to_save)
            self._dirty = False
            self.show_message("File saved successfully", 2000)

            # Save a local history snapshot (VS Code Local History parity)
            try:
                from .local_history import save_version
                workspace_root = getattr(self, "_workspace_root", "")
                save_version(self._file_path, self._content, workspace_root)
            except Exception:
                pass

            # Run linter on save
            if self._file_path.endswith(".py"):
                self._run_linter()

            return True
        except Exception:
            return False


    def show_message(self, text, duration=3000):
        if self._view_ready:
            import json
            safe_text = json.dumps(text)
            self._view.page().runJavaScript(f"showEditorMessage({safe_text}, {duration});")

    def save_as(self, path):
        self._file_path = path
        self._language = detect_language(path)
        return self.save()

    def set_lsp_client(self, client):
        self._lsp_client = client
        self._bridge.set_lsp_client(client)

    def _run_lsp_diagnostics(self):
        if not self._lsp_client or not self._file_path:
            return

        def worker():
            try:
                import urllib.parse
                uri = "file:///" + self._file_path.replace("\\", "/")
                from ..core.lsp_client import LSPClient
                resp = self._lsp_client._send_request_sync("textDocument/diagnostic", {
                    "textDocument": {"uri": uri}
                }, timeout=5.0)
                diagnostics = []
                if resp and "items" in resp:
                    for d in resp["items"]:
                        rng = d.get("range", {})
                        start = rng.get("start", {})
                        end = rng.get("end", {})
                        sev = d.get("severity", 1)
                        markers = {1: "error", 2: "warning", 3: "information", 4: "hint"}
                        diagnostics.append({
                            "severity": markers.get(sev, "warning"),
                            "startLine": start.get("line", 0) + 1,
                            "startColumn": start.get("character", 0),
                            "endLine": end.get("line", 0) + 1,
                            "endColumn": end.get("character", 0),
                            "message": d.get("message", ""),
                            "source": d.get("source", "lsp"),
                        })
                self.diagnostics_ready.emit(diagnostics)
            except Exception:
                pass

        import threading
        threading.Thread(target=worker, daemon=True).start()

    def go_to_definition(self):
        if self._lsp_client and self._file_path and self._view_ready:
            def worker():
                js = "var pos = editor.getPosition(); pos ? pos.lineNumber + ',' + pos.column : '0,0';"
                result = [None]
                self._view.page().runJavaScript(js, lambda r: result.__setitem__(0, r))
                import time
                time.sleep(0.1)
                if result[0]:
                    parts = result[0].split(",")
                    line, col = int(parts[0]), int(parts[1])
                    def_result = self._bridge.get_definition(self._file_path or "", line, col)
                    if def_result:
                        data = json.loads(def_result)
                        uri = data.get("uri", "")
                        def_line = data.get("line", 0)
                        def_char = data.get("character", 0)
                        if uri.startswith("file:///"):
                            def_path = uri[8:].replace("/", os.sep)
                            self.definition_found.emit(def_path, def_line, def_char)
            import threading
            threading.Thread(target=worker, daemon=True).start()
        elif self._view_ready:
            self._view.page().runJavaScript("editor.trigger('keyboard', 'editor.action.revealDefinition', null);")

    def get_hover_at_cursor(self):
        if self._lsp_client and self._file_path and self._view_ready:
            js = "var pos = editor.getPosition(); pos ? pos.lineNumber + ',' + pos.column : '0,0';"
            result = [None]
            self._view.page().runJavaScript(js, lambda r: result.__setitem__(0, r))
            import time
            time.sleep(0.1)
            if result[0]:
                parts = result[0].split(",")
                line, col = int(parts[0]), int(parts[1])
                return self._bridge.get_hover(line, col)
        return ""

    def is_dirty(self):
        return self._dirty

    def get_file_path(self):
        return self._file_path

    def get_cursor_position(self):
        return getattr(self, "_cursor_line", 1), getattr(self, "_cursor_col", 1)

    def get_encoding(self):
        return getattr(self, "_encoding", "utf-8").upper().replace("_", "-")

    def get_eol(self):
        return getattr(self, "_eol", "LF")

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

    def set_theme(self, is_dark):
        if self._view_ready:
            val = "true" if is_dark else "false"
            self._view.page().runJavaScript(f"setTheme({val});")

    def set_custom_theme(self, theme_data):
        """Apply a VS Code extension theme (Monaco format dict) or None to reset."""
        if not self._view_ready:
            return
        payload = json.dumps(json.dumps(theme_data) if theme_data is not None else None)
        self._view.page().runJavaScript(f"defineCustomTheme({payload});")

    def show_progress(self, visible):
        if self._view_ready:
            val = "true" if visible else "false"
            self._view.page().runJavaScript(f"showProgress({val});")

    def trigger_find(self):
        if self._view_ready:
            self._view.page().runJavaScript("triggerFind();")

    def trigger_find_replace(self):
        if self._view_ready:
            self._view.page().runJavaScript("triggerFindReplace();")

    def trigger_format(self):
        if self._view_ready:
            self.show_progress(True)
            from PySide6.QtCore import QTimer
            QTimer.singleShot(1000, lambda: self.show_progress(False))
            self._view.page().runJavaScript("triggerFormat();")

    def reveal_line(self, line):
        if self._view_ready:
            self._view.page().runJavaScript(f"revealLine({line});")

    def add_zone_widget(self, widget_id: str, after_line: int, height_lines: int, html_content: str):
        if self._view_ready:
            import json
            safe_html = json.dumps(html_content)
            self._view.page().runJavaScript(f"addZoneWidget('{widget_id}', {after_line}, {height_lines}, {safe_html});")

    def remove_zone_widget(self, widget_id: str):
        if self._view_ready:
            self._view.page().runJavaScript(f"removeZoneWidget('{widget_id}');")

    def clear_zone_widgets(self):
        if self._view_ready:
            self._view.page().runJavaScript("clearZoneWidgets();")

    def show_quick_diff_widget(self, line: int, diff_html: str):
        """Show an inline quick diff widget using Zone Widget."""
        self.add_zone_widget(f"quick_diff_{line}", line, 10, f"<div class='quick-diff-container'>{diff_html}</div>")

    def show_inline_value(self, line: int, column: int, text: str):
        if self._view_ready:
            import json
            safe_text = json.dumps(text)
            # Use Monaco's decorations to show inline text
            script = f"""
            if(editor) {{
                editor.deltaDecorations([], [{{
                    range: new monaco.Range({line}, {column}, {line}, {column}),
                    options: {{
                        after: {{
                            content: ' = ' + {safe_text},
                            inlineClassName: 'debug-inline-value'
                        }}
                    }}
                }}]);
            }}
            """
            self._view.page().runJavaScript(script)

    def set_debug_hover(self, variable_name: str, value: str):
        if self._view_ready:
            import json
            safe_var = json.dumps(variable_name)
            safe_val = json.dumps(value)
            script = f"""
            if(window.registerDebugHover) {{
                window.registerDebugHover({safe_var}, {safe_val});
            }}
            """
            self._view.page().runJavaScript(script)

    def set_diagnostics(self, markers):
        self.show_progress(False)
        if self._view_ready:
            import json
            js_markers = json.dumps(markers)
            self._view.page().runJavaScript(f"setDiagnostics({js_markers});")

    def _on_lsp_diagnostics(self, uri: str, markers: list):
        # We only care about diagnostics for the currently opened file
        from pathlib import Path
        if not self._file_path:
            return
        current_uri = Path(self._file_path).as_uri()
        if uri == current_uri:
            self.set_diagnostics(markers)

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

    def _on_extension_command(self, command_id: str):
        p = self.parentWidget()
        while p:
            if hasattr(p, "_run_extension_command"):
                p._run_extension_command(command_id)
                return
            if hasattr(p, "_execute_command"):
                p._execute_command(command_id)
                return
            p = p.parentWidget()

    def _open_with_live_server(self, file_path: str):
        win = self.window()
        if win and hasattr(win, "_open_with_live_server"):
            win._open_with_live_server(file_path)

    def refresh_live_server_context_menu(self):
        """Show built-in Open with Live Server when the open file is a frontend asset."""
        if not self._view_ready:
            return
        try:
            from ..remote.live_server import is_frontend_file
            enabled = bool(self._file_path and is_frontend_file(self._file_path))
        except Exception:
            enabled = False
        val = "true" if enabled else "false"
        self._view.page().runJavaScript(f"setLiveServerContextMenu({val});")

    def refresh_extension_context_menu(self):
        """Push latest extension editor/context items into Monaco."""
        if not self._view_ready:
            return
        try:
            from ..core.extension_contributions import get_contribution_parser
            items = get_contribution_parser().get_menu_items("editor/context")
            payload = json.dumps([
                {"command": m.command, "label": m.label, "group": m.group, "order": m.order}
                for m in items
            ])
            self._view.page().runJavaScript(f"setExtensionContextMenuItems({payload});")
        except Exception:
            pass

    def _run_linter(self):
        if not self._file_path or not self._file_path.endswith(".py"):
            return

        self.show_progress(True)
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


    def toggle_breakpoint(self):
        if self._view_ready:
            js = """
                var pos = editor.getPosition();
                if (pos) {
                    addBreakpoint(pos.lineNumber);
                }
            """
            self._view.page().runJavaScript(js)

    def set_comment_markers(self, markers: dict):
        """Set comment gutter markers. markers: {line_number: [thread_summary, ...]}"""
        if self._view_ready:
            import json
            js_markers = json.dumps(markers)
            self._view.page().runJavaScript(f"setCommentMarkers({js_markers});")

    def clear_comment_markers(self):
        if self._view_ready:
            self._view.page().runJavaScript("clearCommentMarkers();")

    def set_multi_cursor_modifier(self, modifier: str):
        if self._view_ready:
            self._view.page().runJavaScript(f"setMultiCursorModifier('{modifier}');")

    def closeEvent(self, event):
        self.cleanup()
        super().closeEvent(event)

    def cleanup(self):
        if self._file_path and self._lsp_client:
            try:
                self._bridge.notify_closed()
            except Exception:
                pass

        try:
            self._lsp_debounce_timer.stop()
            self._lsp_debounce_timer.timeout.disconnect()
        except Exception:
            pass

        try:
            self.diagnostics_ready.disconnect()
        except Exception:
            pass

        try:
            self._view.loadFinished.disconnect(self._on_load_finished)
        except Exception:
            pass

        if hasattr(self, "_bridge") and self._bridge:
            try:
                self._bridge.content_changed.disconnect()
                self._bridge.content_changed_incremental.disconnect()
                self._bridge.cursor_changed.disconnect()
                self._bridge.selection_changed.disconnect()
                self._bridge.multi_cursor_changed.disconnect()
                self._bridge.selection_state_changed.disconnect()
                self._bridge.save_requested.disconnect()
                self._bridge.format_on_save_requested.disconnect()
                self._bridge.code_actions_on_save_requested.disconnect()
                self._bridge.command_palette_requested.disconnect()
                self._bridge.extension_command_requested.disconnect()
                self._bridge.open_with_live_server_requested.disconnect()
                self._bridge.language_changed.disconnect()
                self._bridge.view_state_changed.disconnect()
                self._bridge.undo_stack_available.disconnect()
            except Exception:
                pass

        if hasattr(self, "_channel") and self._channel:
            try:
                self._channel.disconnect()
            except TypeError:
                pass
            if hasattr(self, "_bridge") and self._bridge:
                try:
                    self._channel.deregisterObject(self._bridge)
                except Exception:
                    pass
            self._channel.deleteLater()
            self._channel = None

        if hasattr(self, "_view") and self._view:
            self._view.stop()
            page = self._view.page()
            if page:
                try:
                    channel = page.webChannel()
                    if channel:
                        try:
                            channel.disconnect()
                        except TypeError:
                            pass
                    page.setWebChannel(None)
                except Exception:
                    pass
            self._view.setParent(None)
            self._view.setAttribute(Qt.WA_DeleteOnClose, True)
            self._view.deleteLater()
            self._view = None

        self._bridge = None
        self._lsp_client = None
