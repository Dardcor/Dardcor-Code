import os
import json
import subprocess
from PySide6.QtCore import QObject, Signal, Slot

class EditorBridge(QObject):
    """Bridge object exposed to Monaco Editor via QWebChannel."""

    # Signals (Monaco -> Python)
    content_changed = Signal(str)       # fired whenever user types
    cursor_changed = Signal(int, int)   # line, column
    save_requested = Signal()
    command_palette_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._diagnostics_callback = None
        self._file_path = None

    @Slot(str)
    def on_content_changed(self, content):
        """Called by Monaco when user edits text."""
        self.content_changed.emit(content)

    @Slot(int, int)
    def on_cursor_changed(self, line, col):
        """Called by Monaco when cursor moves."""
        self.cursor_changed.emit(line, col)

    @Slot()
    def request_save(self):
        """Called by Monaco when user presses Ctrl+S."""
        self.save_requested.emit()

    @Slot()
    def request_command_palette(self):
        """Called by Monaco when user presses Ctrl+Shift+P."""
        self.command_palette_requested.emit()

    @Slot(str, int, int, result=str)
    def get_completions(self, code, line, col):
        """Called by Monaco to get python/word completions."""
        try:
            # Try LSP first
            widget = self.parent()
            if widget and hasattr(widget, "_lsp_client") and widget._lsp_client:
                lsp = widget._lsp_client
                # Convert path to URI
                from pathlib import Path
                uri = Path(self._file_path).as_uri() if self._file_path else "untitled:Untitled-1"
                
                resp = lsp.send_request_sync("textDocument/completion", {
                    "textDocument": {"uri": uri},
                    "position": {"line": line - 1, "character": col - 1}
                }, timeout=1.0)
                
                if "result" in resp and resp["result"]:
                    items = resp["result"]
                    if isinstance(items, dict) and "items" in items:
                        items = items["items"]
                    
                    results = []
                    for item in items:
                        # Map LSP CompletionItemKind to Monaco CompletionItemKind
                        # LSP: 1=Text, 2=Method, 3=Function, 4=Constructor, 5=Field, 6=Variable, 7=Class, 8=Interface, 9=Module, 10=Property, 11=Unit, 12=Value, 13=Enum, 14=Keyword
                        # Monaco: 1=Method, 2=Function, 3=Constructor, 4=Field, 5=Variable, 6=Class, ...
                        kind_map = {1: 18, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 14: 12}
                        l_kind = item.get("kind", 1)
                        m_kind = kind_map.get(l_kind, 18)
                        
                        results.append({
                            "label": item.get("label", ""),
                            "insertText": item.get("insertText", item.get("label", "")),
                            "kind": m_kind,
                            "detail": item.get("detail", ""),
                            "typedLength": 0  # We let Monaco handle replacement ranges based on trigger
                        })
                    return json.dumps(results)
                    
            # Fallback to Jedi
            import jedi
            script = jedi.Script(code, path=self._file_path or '')
            completions = script.complete(line, col - 1)
            results = []
            for c in completions:
                # Monaco Suggestion Kinds: Class=5, Function=2, Keyword=12, Variable=4
                kind = 12
                if c.type == "class":
                    kind = 5
                elif c.type in ("function", "method"):
                    kind = 2
                elif c.type == "statement":
                    kind = 4
                results.append({
                    "label": c.name,
                    "insertText": c.complete,
                    "kind": kind,
                    "detail": c.description,
                    "typedLength": len(c.name) - len(c.complete)
                })
            return json.dumps(results)
        except Exception as e:
            print("Completion error:", e)
            # Intelligent fallback parser using regex for local tokens
            import re
            keywords = ["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "as", "pass", "break", "continue", "print", "len", "range", "self", "None", "True", "False"]
            words = set(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", code))
            all_suggestions = sorted(list(words.union(keywords)))
            
            # Extract word being typed
            lines = code.splitlines()
            current_line = lines[line - 1] if 0 < line <= len(lines) else ""
            typed_word = ""
            if current_line and 0 < col <= len(current_line) + 1:
                match = re.search(r"([a-zA-Z_][a-zA-Z0-9_]*)$", current_line[:col-1])
                if match:
                    typed_word = match.group(1)
            
            results = []
            for w in all_suggestions:
                if w.lower().startswith(typed_word.lower()) and w != typed_word:
                    results.append({
                        "label": w,
                        "insertText": w[len(typed_word):],
                        "kind": 12 if w in keywords else 4,
                        "detail": "keyword" if w in keywords else "local token",
                        "typedLength": len(typed_word)
                    })
            return json.dumps(results)

    @Slot(int, int, result=str)
    def get_hover(self, line, col):
        """Called by Monaco to get hover documentation."""
        widget = self.parent()
        if widget and hasattr(widget, "_lsp_client") and widget._lsp_client:
            lsp = widget._lsp_client
            from pathlib import Path
            uri = Path(self._file_path).as_uri() if self._file_path else "untitled:Untitled-1"
            
            resp = lsp.send_request_sync("textDocument/hover", {
                "textDocument": {"uri": uri},
                "position": {"line": line - 1, "character": col - 1}
            }, timeout=1.0)
            
            if "result" in resp and resp["result"]:
                contents = resp["result"].get("contents", "")
                if isinstance(contents, dict):
                    return contents.get("value", "")
                elif isinstance(contents, list):
                    return "\n\n".join([c.get("value", "") if isinstance(c, dict) else c for c in contents])
                elif isinstance(contents, str):
                    return contents
        return ""

    def set_file_path(self, path):
        self._file_path = path
