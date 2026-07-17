import os
import json
import base64
import datetime
import re
from PySide6.QtCore import QObject, Signal, Slot


class EditorBridge(QObject):
    content_changed = Signal(str)
    content_changed_incremental = Signal(str, int, int, int, int, str)  # file_path, startLine, startCol, endLine, endCol, text
    cursor_changed = Signal(int, int)
    multi_cursor_changed = Signal(str)  # JSON array of {line, column}
    selection_changed = Signal(int, int)
    selection_state_changed = Signal(str)  # JSON of all selections
    save_requested = Signal()
    format_on_save_requested = Signal()
    code_actions_on_save_requested = Signal(str)
    command_palette_requested = Signal()
    extension_command_requested = Signal(str)
    open_with_live_server_requested = Signal(str)
    workspace_edit_requested = Signal(str)
    comment_gutter_clicked = Signal(str, int)
    editor_scroll_changed = Signal(float, float)
    language_changed = Signal(str)
    undo_stack_available = Signal(str)  # JSON serialized undo stack
    view_state_changed = Signal(str)    # view state JSON per file

    def __init__(self, parent=None):
        super().__init__(parent)
        self._diagnostics_callback = None
        self._file_path = None
        self._lsp_client = None
        self._document_version = 0
        self._pending_change = None

    def set_lsp_client(self, client):
        self._lsp_client = client

    @Slot(result=str)
    def get_file_content(self) -> str:
        widget = self.parent()
        if widget:
            return getattr(widget, "_content", "")
        return ""

    @Slot(str)
    def on_content_changed(self, content):
        self._content = content
        self._document_version += 1
        if self._lsp_client and self._file_path:
            self._lsp_client.did_change(
                self._file_path,
                [{"range": {"start": {"line": 0, "character": 0}, "end": {"line": 99999, "character": 0}}, "text": content}],
                self._document_version,
            )
        self.content_changed.emit(content)

    @Slot(int, int, int, int, str)
    def on_content_changed_incremental(self, start_line, start_col, end_line, end_col, text):
        """Incremental text change from Monaco: range that was replaced + new text."""
        full_content = None
        if self._lsp_client and self._file_path:
            self._document_version += 1
            try:
                self._lsp_client.did_change(
                    self._file_path,
                    [{"range": {
                        "start": {"line": start_line - 1, "character": start_col - 1},
                        "end": {"line": end_line - 1, "character": end_col - 1}
                    }, "text": text}],
                    self._document_version,
                )
            except Exception:
                pass
        widget = self.parent()
        if widget and hasattr(widget, "_content"):
            lines = widget._content.splitlines(True)
            total_lines = len(lines)
            if 1 <= start_line <= total_lines and 1 <= end_line <= total_lines:
                head = "".join(lines[:start_line - 1])
                tail = "".join(lines[end_line:])
                before_part = lines[start_line - 1][:start_col - 1]
                after_part = lines[end_line - 1][end_col - 1:]
                if start_line == end_line:
                    head += before_part
                    tail = after_part + tail
                else:
                    head += before_part + "\n"
                    tail = after_part + tail
                full_content = head + text + tail
            else:
                full_content = widget._content
            widget._content = full_content
            self._content = full_content
        else:
            full_content = text
            self._content = full_content
        self.content_changed.emit(full_content or text)
        self.content_changed_incremental.emit(
            self._file_path or "", start_line, start_col, end_line, end_col, text
        )

    @Slot(int, int)
    def on_cursor_changed(self, line, col):
        self.cursor_changed.emit(line, col)

    @Slot(str)
    def on_multi_cursor_changed(self, cursors_json):
        """Called from JS when the user has multiple cursors."""
        self.multi_cursor_changed.emit(cursors_json)

    @Slot(int, int)
    def on_selection_changed(self, selected_chars, selected_lines):
        self.selection_changed.emit(selected_chars, selected_lines)

    @Slot(str)
    def on_selection_state_changed(self, selections_json):
        """All selections (primary + secondary) as JSON array."""
        self.selection_state_changed.emit(selections_json)

    @Slot(float, float)
    def on_editor_scroll(self, scroll_top, scroll_left):
        self.editor_scroll_changed.emit(scroll_top, scroll_left)

    @Slot(str)
    def save_view_state(self, state_json):
        widget = self.parent()
        if widget and hasattr(widget, "persist_view_state"):
            widget.persist_view_state(state_json)
        self.view_state_changed.emit(state_json)

    @Slot(str)
    def restore_view_state(self, state_json):
        """Called from Python to restore view state in Monaco."""
        widget = self.parent()
        if widget:
            safe = json.dumps(state_json)
            widget._view.page().runJavaScript(f"window.restoreViewState({safe});")

    @Slot(str)
    def persist_undo_stack(self, undo_stack_json):
        """Save undo/redo stack for current file."""
        widget = self.parent()
        if widget and hasattr(widget, "persist_undo_stack"):
            widget.persist_undo_stack(undo_stack_json)
        self.undo_stack_available.emit(undo_stack_json)

    @Slot(str)
    def restore_undo_stack(self, undo_stack_json):
        """Restore undo/redo stack in Monaco."""
        widget = self.parent()
        if widget:
            safe = json.dumps(undo_stack_json)
            widget._view.page().runJavaScript(f"window.restoreUndoStack({safe});")

    @Slot(str)
    def handle_image_paste(self, base64_image):
        widget = self.parent()
        if not widget:
            return

        if "," in base64_image:
            _, data_str = base64_image.split(",", 1)
        else:
            data_str = base64_image

        try:
            img_data = base64.b64decode(data_str)
        except Exception:
            return

        from ..core.config import get_config
        config = get_config()
        ws = config.workspace_path

        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"pasted_image_{timestamp}.png"

        if ws and os.path.isdir(ws):
            dest_dir = os.path.join(ws, "images")
            os.makedirs(dest_dir, exist_ok=True)
            filepath = os.path.join(dest_dir, filename)
            rel_path = f"images/{filename}"
        else:
            from ..core.config import get_user_data_dir
            dest_dir = os.path.join(get_user_data_dir(), "temp_images")
            os.makedirs(dest_dir, exist_ok=True)
            filepath = os.path.join(dest_dir, filename)
            rel_path = filepath

        try:
            with open(filepath, "wb") as f:
                f.write(img_data)
        except Exception:
            return

        markdown_link = f"![Pasted Image]({rel_path})"
        widget.insert_text(markdown_link)

    @Slot()
    def request_save(self):
        if self._lsp_client and self._file_path:
            self._lsp_client.did_save(self._file_path, self._content)
        self.save_requested.emit()

    @Slot()
    def request_format_on_save(self):
        self.format_on_save_requested.emit()

    @Slot()
    def request_code_actions_on_save(self):
        if self._file_path:
            self.code_actions_on_save_requested.emit(self._file_path)

    @Slot()
    def request_command_palette(self):
        self.command_palette_requested.emit()

    @Slot()
    def request_open_with_live_server(self):
        if self._file_path:
            self.open_with_live_server_requested.emit(self._file_path)

    @Slot(str)
    def request_ai_chat(self, text):
        widget = self.parent()
        if widget:
            main_win = widget.window()
            if main_win and hasattr(main_win, "_chat_panel") and main_win._chat_panel:
                main_win._chat_panel.new_chat_with_text(text)

    @Slot(str)
    def on_language_changed(self, language):
        self.language_changed.emit(language)

    # ── Editor settings slots (called from Python to update Monaco) ──

    @Slot(int)
    def set_font_size(self, size):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setFontSize({size});")

    @Slot(str)
    def set_font_family(self, family):
        widget = self.parent()
        if widget:
            safe = json.dumps(family)
            widget._view.page().runJavaScript(f"setFontFamily({safe});")

    @Slot(bool)
    def set_font_ligatures(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setFontLigatures({str(enabled).lower()});")

    @Slot(str)
    def set_line_numbers(self, setting):
        """'on', 'off', 'relative', 'interval'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(setting)
            widget._view.page().runJavaScript(f"setLineNumbers({safe});")

    @Slot(str)
    def set_cursor_style(self, style):
        """'line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(style)
            widget._view.page().runJavaScript(f"setCursorStyle({safe});")

    @Slot(str)
    def set_cursor_blinking(self, style):
        """'blink', 'smooth', 'phase', 'expand', 'solid'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(style)
            widget._view.page().runJavaScript(f"setCursorBlinking({safe});")

    @Slot(bool)
    def set_cursor_smooth_caret_animation(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setCursorSmoothCaretAnimation({str(enabled).lower()});")

    @Slot(bool)
    def set_smooth_scrolling(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setSmoothScrolling({str(enabled).lower()});")

    @Slot(bool)
    def set_mouse_wheel_zoom(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setMouseWheelZoom({str(enabled).lower()});")

    @Slot(str)
    def set_word_wrap(self, setting):
        """'off', 'on', 'wordWrapColumn', 'bounded'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(setting)
            widget._view.page().runJavaScript(f"setWordWrap({safe});")

    @Slot(int)
    def set_word_wrap_column(self, column):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setWordWrapColumn({column});")

    @Slot(bool)
    def set_minimap(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setMinimap({str(enabled).lower()});")

    @Slot(bool)
    def set_minimap_side(self, side):
        """'right' or 'left'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(side)
            widget._view.page().runJavaScript(f"setMinimapSide({safe});")

    @Slot(str)
    def set_rulers(self, rulers_json):
        """JSON array of column numbers"""
        widget = self.parent()
        if widget:
            safe = json.dumps(rulers_json)
            widget._view.page().runJavaScript(f"setRulers({safe});")

    @Slot(int)
    def set_tab_size(self, size):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setTabSize({size});")

    @Slot(bool)
    def set_insert_spaces(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setInsertSpaces({str(enabled).lower()});")

    @Slot(bool)
    def set_detect_indentation(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setDetectIndentation({str(enabled).lower()});")

    @Slot(bool)
    def set_format_on_paste(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setFormatOnPaste({str(enabled).lower()});")

    @Slot(bool)
    def set_format_on_type(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setFormatOnType({str(enabled).lower()});")

    @Slot(bool)
    def set_auto_indent(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setAutoIndent({str(enabled).lower()});")

    @Slot(str)
    def set_auto_closing_brackets(self, setting):
        """'always', 'languageDefined', 'beforeWhitespace', 'never'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(setting)
            widget._view.page().runJavaScript(f"setAutoClosingBrackets({safe});")

    @Slot(str)
    def set_auto_closing_quotes(self, setting):
        widget = self.parent()
        if widget:
            safe = json.dumps(setting)
            widget._view.page().runJavaScript(f"setAutoClosingQuotes({safe});")

    @Slot(bool)
    def set_bracket_pair_colorization(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setBracketPairColorization({str(enabled).lower()});")

    @Slot(bool, bool, bool)
    def set_guides(self, bracket_pairs, indentation, highlight_active):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(
                f"setGuides({str(bracket_pairs).lower()}, {str(indentation).lower()}, {str(highlight_active).lower()});"
            )

    @Slot(bool)
    def set_folding(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setFolding({str(enabled).lower()});")

    @Slot(bool)
    def set_folding_highlight(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setFoldingHighlight({str(enabled).lower()});")

    @Slot(bool)
    def set_glyph_margin(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setGlyphMargin({str(enabled).lower()});")

    @Slot(bool)
    def set_color_decorators(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setColorDecorators({str(enabled).lower()});")

    @Slot(bool)
    def set_semantic_highlighting(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setSemanticHighlighting({str(enabled).lower()});")

    @Slot(bool)
    def set_unicode_highlight(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setUnicodeHighlight({str(enabled).lower()});")

    @Slot(str)
    def set_unicode_highlight_options(self, options_json):
        """Detailed unicode highlight config: {nonBasicASCII, invisibleCharacters, ambiguousCharacters, includeComments, includeStrings}"""
        widget = self.parent()
        if widget:
            safe = json.dumps(options_json)
            widget._view.page().runJavaScript(f"setUnicodeHighlightOptions({safe});")

    @Slot(bool)
    def set_render_whitespace(self, setting):
        """'none', 'boundary', 'selection', 'trailing', 'all'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(setting)
            widget._view.page().runJavaScript(f"setRenderWhitespace({safe});")

    @Slot(bool)
    def set_trim_auto_whitespace(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setTrimAutoWhitespace({str(enabled).lower()});")

    @Slot(bool)
    def set_drag_and_drop(self, enabled):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setDragAndDrop({str(enabled).lower()});")

    @Slot(bool)
    def set_multi_cursor_modifier(self, modifier):
        """'altKey', 'metaKey', 'ctrlKey'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(modifier)
            widget._view.page().runJavaScript(f"setMultiCursorModifier({safe});")

    @Slot(bool)
    def set_multi_cursor_paste(self, setting):
        """'spread' or 'full'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(setting)
            widget._view.page().runJavaScript(f"setMultiCursorPaste({safe});")

    @Slot(str)
    def set_suggest_selection_mode(self, mode):
        """'always', 'recentlyUsed', 'recentlyUsedByPrefix'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(mode)
            widget._view.page().runJavaScript(f"setSuggestSelectionMode({safe});")

    @Slot(str)
    def set_snippet_suggestions(self, setting):
        """'top', 'bottom', 'inline', 'none'"""
        widget = self.parent()
        if widget:
            safe = json.dumps(setting)
            widget._view.page().runJavaScript(f"setSnippetSuggestions({safe});")

    @Slot(bool, bool, bool)
    def set_quick_suggestions(self, other, comments, strings):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(
                f"setQuickSuggestions({str(other).lower()}, {str(comments).lower()}, {str(strings).lower()});"
            )

    @Slot(bool)
    def set_quick_suggestions_delay(self, ms):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setQuickSuggestionsDelay({ms});")

    @Slot(str)
    def set_theme(self, is_dark):
        widget = self.parent()
        if widget:
            widget._view.page().runJavaScript(f"setTheme({str(is_dark).lower()});")

    @Slot(str)
    def define_custom_theme(self, theme_json):
        widget = self.parent()
        if widget:
            safe = json.dumps(theme_json)
            widget._view.page().runJavaScript(f"defineCustomTheme({safe});")

    @Slot(bool, str)
    def set_language_tab_size(self, language, size):
        widget = self.parent()
        if widget:
            safe_lang = json.dumps(language)
            widget._view.page().runJavaScript(f"setLanguageTabSize({safe_lang}, {size});")

    @Slot(bool, str)
    def set_language_insert_spaces(self, language, enabled):
        widget = self.parent()
        if widget:
            safe_lang = json.dumps(language)
            widget._view.page().runJavaScript(f"setLanguageInsertSpaces({safe_lang}, {str(enabled).lower()});")

    def apply_editor_options(self, options: dict):
        """Batch apply multiple editor options via a single JS call."""
        widget = self.parent()
        if widget:
            safe = json.dumps(options)
            widget._view.page().runJavaScript(f"applyEditorOptions({safe});")

    # ── LSP and editor features ──

    def _typed_prefix(self, code, line, col) -> str:
        lines = code.splitlines()
        current_line = lines[line - 1] if 0 < line <= len(lines) else ""
        if current_line and 0 < col <= len(current_line) + 1:
            match = re.search(r"([a-zA-Z_][a-zA-Z0-9_\-]*)$", current_line[:col - 1])
            if match:
                return match.group(1)
        return ""

    def _snippet_completions(self, code, line, col) -> list:
        try:
            widget = self.parent()
            language = getattr(widget, "_language", "") or "plaintext"

            from ..core.extension_contributions import get_contribution_parser
            snippets = get_contribution_parser().get_snippets_for_language(language)
            if not snippets:
                return []

            prefix = self._typed_prefix(code, line, col)
            results = []
            for snip in snippets:
                label = snip.get("label", "")
                if prefix and not label.lower().startswith(prefix.lower()):
                    continue
                results.append({
                    "label": label,
                    "insertText": snip.get("insertText", label),
                    "kind": 27,
                    "insertTextRules": 4,
                    "detail": snip.get("detail", "snippet"),
                    "documentation": snip.get("description", ""),
                    "typedLength": len(prefix),
                })
            return results[:30]
        except Exception:
            return []

    def _user_snippet_completions(self, code, line, col) -> list:
        try:
            widget = self.parent()
            language = getattr(widget, "_language", "") or "plaintext"
            prefix = self._typed_prefix(code, line, col)

            from .snippet_manager import get_snippet_manager
            snippets = get_snippet_manager().get_completions_for_prefix(language, prefix)
            results = []
            for snip in snippets:
                results.append({
                    "label": snip.prefix,
                    "insertText": snip.get_insert_text(),
                    "kind": 27,
                    "insertTextRules": 4,
                    "detail": snip.description or snip.name,
                    "documentation": snip.description,
                    "typedLength": len(prefix),
                })
            return results[:30]
        except Exception:
            return []

    def _resolve_file_path(self, file_path: str) -> str:
        return file_path or self._file_path or ""

    def _lsp_location_to_json(self, loc: dict) -> dict:
        uri = loc.get("uri", "")
        rng = loc.get("range", {})
        start = rng.get("start", {})
        end = rng.get("end", start)
        return {
            "uri": uri,
            "line": start.get("line", 0) + 1,
            "character": start.get("character", 0) + 1,
            "endLine": end.get("line", start.get("line", 0)) + 1,
            "endCharacter": end.get("character", start.get("character", 0)) + 1,
        }

    def _lsp_workspace_edit_to_json(self, edit: dict) -> list:
        edits = []
        if not edit:
            return edits
        changes = edit.get("changes") or {}
        for uri, text_edits in changes.items():
            for te in text_edits or []:
                rng = te.get("range", {})
                start = rng.get("start", {})
                end = rng.get("end", start)
                edits.append({
                    "uri": uri,
                    "startLine": start.get("line", 0) + 1,
                    "startColumn": start.get("character", 0) + 1,
                    "endLine": end.get("line", start.get("line", 0)) + 1,
                    "endColumn": end.get("character", start.get("character", 0)) + 1,
                    "text": te.get("newText", ""),
                })
        for doc_change in edit.get("documentChanges") or []:
            uri = doc_change.get("textDocument", {}).get("uri", "")
            for te in doc_change.get("edits") or []:
                if "range" in te:
                    rng = te.get("range", {})
                    start = rng.get("start", {})
                    end = rng.get("end", start)
                    edits.append({
                        "uri": uri,
                        "startLine": start.get("line", 0) + 1,
                        "startColumn": start.get("character", 0) + 1,
                        "endLine": end.get("line", start.get("line", 0)) + 1,
                        "endColumn": end.get("character", start.get("character", 0)) + 1,
                        "text": te.get("newText", ""),
                    })
        return edits

    def _lsp_signature_help_to_json(self, result: dict) -> dict:
        signatures = []
        for sig in result.get("signatures") or []:
            label = sig.get("label", "")
            if isinstance(label, list):
                label = "".join(str(part) for part in label)
            params = []
            for param in sig.get("parameters") or []:
                plabel = param.get("label", "")
                if isinstance(plabel, list) and len(plabel) == 2:
                    plabel = label[plabel[0]:plabel[1]] if isinstance(label, str) else str(plabel)
                doc = param.get("documentation", "")
                if isinstance(doc, dict):
                    doc = doc.get("value", "")
                params.append({"label": plabel, "documentation": doc})
            doc = sig.get("documentation", "")
            if isinstance(doc, dict):
                doc = doc.get("value", "")
            signatures.append({"label": label, "documentation": doc, "parameters": params})
        return {
            "signatures": signatures,
            "activeSignature": result.get("activeSignature", 0),
            "activeParameter": result.get("activeParameter", 0),
        }

    @Slot(str, int, int, result=str)
    def get_completions(self, code, line, col):
        snippet_items = self._snippet_completions(code, line, col) + self._user_snippet_completions(code, line, col)

        if self._lsp_client and self._file_path:
            try:
                items = self._lsp_client.completion(self._file_path, line - 1, col - 1)
                results = list(snippet_items)
                for item in items[:50]:
                    kind_map = {
                        1: 1, 2: 2, 3: 2, 4: 5, 5: 6, 6: 4,
                        7: 5, 8: 9, 9: 9, 10: 6, 11: 12, 12: 12,
                        13: 5, 14: 12, 15: 15, 16: 14, 17: 17,
                        18: 17, 19: 19, 20: 5, 21: 4, 22: 5,
                        23: 12, 24: 12, 25: 5,
                    }
                    insert = item.get("insertText", {})
                    insert_text = insert.get("value", item.get("label", "")) if isinstance(insert, dict) else str(insert)
                    results.append({
                        "label": item.get("label", ""),
                        "insertText": insert_text,
                        "kind": kind_map.get(item.get("kind", 1), 12),
                        "detail": item.get("detail", ""),
                        "documentation": item.get("documentation", "") if isinstance(item.get("documentation"), str) else "",
                        "typedLength": 0,
                    })
                return json.dumps(results)
            except Exception:
                pass

        try:
            fallback = json.loads(self._fallback_completions(code, line, col) or "[]")
        except Exception:
            fallback = []
        return json.dumps(snippet_items + fallback)

    def _fallback_completions(self, code, line, col):
        try:
            widget = self.parent()
            if widget and hasattr(widget, "_lsp_client") and widget._lsp_client:
                lsp = widget._lsp_client
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
                        kind_map = {1: 18, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 14: 12}
                        l_kind = item.get("kind", 1)
                        m_kind = kind_map.get(l_kind, 18)

                        results.append({
                            "label": item.get("label", ""),
                            "insertText": item.get("insertText", item.get("label", "")),
                            "kind": m_kind,
                            "detail": item.get("detail", ""),
                            "typedLength": 0
                        })
                    return json.dumps(results)

            import jedi
            script = jedi.Script(code, path=self._file_path or "")
            completions = script.complete(line, col - 1)
            results = []
            for c in completions:
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
                    "typedLength": len(c.name) - len(c.complete),
                })
            return json.dumps(results)
        except Exception:
            pass

        keywords = ["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "as", "pass", "break", "continue", "print", "len", "range", "self", "None", "True", "False"]
        words = set(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", code))
        all_suggestions = sorted(list(words.union(keywords)))

        lines = code.splitlines()
        current_line = lines[line - 1] if 0 < line <= len(lines) else ""
        typed_word = ""
        if current_line and 0 < col <= len(current_line) + 1:
            match = re.search(r"([a-zA-Z_][a-zA-Z0-9_]*)$", current_line[:col - 1])
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
                    "typedLength": len(typed_word),
                })
        return json.dumps(results)

    @Slot(int, int, result=str)
    def get_hover(self, line, col):
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

    @Slot(str, int, int, result=str)
    def get_definition(self, file, line, col):
        file_path = self._resolve_file_path(file)
        if self._lsp_client and file_path:
            try:
                result = self._lsp_client.definition(file_path, line - 1, col - 1)
                if isinstance(result, dict) and result.get("uri"):
                    return json.dumps(self._lsp_location_to_json(result))
                if isinstance(result, list) and result:
                    return json.dumps(self._lsp_location_to_json(result[0]))
            except Exception:
                pass
        return ""

    @Slot(str, int, int, str, result=str)
    def get_rename(self, file, line, col, new_name):
        file_path = self._resolve_file_path(file)
        if self._lsp_client and file_path and new_name:
            try:
                result = self._lsp_client.rename(file_path, line - 1, col - 1, new_name)
                edits = self._lsp_workspace_edit_to_json(result)
                if edits:
                    return json.dumps({"edits": edits})
            except Exception:
                pass
        return ""

    @Slot(str)
    def apply_workspace_edit(self, edits_json):
        from ..core.event_bus import EventBus
        EventBus.instance().emit("workspace.edit_requested", edits_json)

    @Slot(str, int, int, result=str)
    def get_references(self, file, line, col):
        return ""

    @Slot(str, int, int, result=str)
    def get_inline_completions(self, file, line, col):
        return ""

    @Slot(str, int, int, result=str)
    def get_signature_help(self, file, line, col):
        file_path = self._resolve_file_path(file)
        if self._lsp_client and file_path:
            try:
                result = self._lsp_client.signature_help(file_path, line - 1, col - 1)
                if result and result.get("signatures"):
                    return json.dumps(self._lsp_signature_help_to_json(result))
            except Exception:
                pass
        return ""

    @Slot(str, result=str)
    def get_semantic_tokens(self, file):
        file_path = self._resolve_file_path(file)
        if not self._lsp_client or not file_path:
            return ""
        try:
            if not self._lsp_client.supports_semantic_tokens():
                return ""
            result = self._lsp_client.semantic_tokens_full(file_path)
            if not result or not result.get("data"):
                return ""
            legend = self._lsp_client.semantic_tokens_legend() or {}
            return json.dumps({
                "data": result.get("data", []),
                "resultId": result.get("resultId"),
                "legend": {
                    "tokenTypes": legend.get("tokenTypes", []),
                    "tokenModifiers": legend.get("tokenModifiers", []),
                },
            })
        except Exception:
            return ""

    @Slot(str, result=str)
    def get_document_symbols(self, code):
        symbols = []
        for i, line_text in enumerate(code.splitlines(), 1):
            m = re.match(r"^(class|def|async def)\s+(\w+)", line_text)
            if m:
                symbols.append({
                    "name": m.group(2),
                    "kind": 5 if m.group(1) == "class" else 12,
                    "line": i,
                })
        return json.dumps(symbols)

    @Slot(str, result=str)
    def get_extension_menu_items(self, menu_id: str) -> str:
        try:
            from ..core.extension_contributions import get_contribution_parser
            items = get_contribution_parser().get_menu_items(menu_id)
            return json.dumps([
                {
                    "command": m.command,
                    "label": m.label,
                    "group": m.group,
                    "order": m.order,
                }
                for m in items
            ])
        except Exception:
            return "[]"

    @Slot(str)
    def execute_extension_command(self, command_id: str):
        if command_id:
            self.extension_command_requested.emit(command_id)

    def set_file_path(self, path):
        self._file_path = path
        self._document_version = 0
        if self._lsp_client and path:
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                lang = "python" if path.endswith(".py") else "plaintext"
                self._lsp_client.did_open(path, lang, content)
            except Exception:
                pass

    def notify_closed(self):
        if self._lsp_client and self._file_path:
            try:
                self._lsp_client.did_close(self._file_path)
            except Exception:
                pass

    @Slot(int)
    def on_comment_gutter_clicked(self, line: int):
        self.comment_gutter_clicked.emit(self._file_path or "", line)

    @Slot(str, int, int, int, int, result=str)
    def get_inlay_hints(self, file, start_line, start_col, end_line, end_col):
        file_path = self._resolve_file_path(file)
        if self._lsp_client and file_path:
            try:
                range_param = {
                    "start": {"line": start_line - 1, "character": start_col - 1},
                    "end": {"line": end_line - 1, "character": end_col - 1}
                }
                result = self._lsp_client.inlay_hints(file_path, range_param)
                if result:
                    formatted = []
                    for item in result:
                        pos = item.get("position", {})
                        lbl = item.get("label", "")
                        if isinstance(lbl, list):
                            lbl = "".join(p.get("value", "") for p in lbl)
                        formatted.append({
                            "label": lbl,
                            "position": {
                                "lineNumber": pos.get("line", 0) + 1,
                                "column": pos.get("character", 0) + 1
                            },
                            "kind": item.get("kind", 0),
                            "tooltip": item.get("tooltip", ""),
                            "paddingLeft": item.get("paddingLeft", False),
                            "paddingRight": item.get("paddingRight", False)
                        })
                    return json.dumps(formatted)
            except Exception as e:
                pass
        return "[]"

    @Slot(str, result=str)
    def get_code_lens(self, file):
        file_path = self._resolve_file_path(file)
        if self._lsp_client and file_path:
            try:
                result = self._lsp_client.code_lens(file_path)
                if result:
                    formatted = []
                    for item in result:
                        rng = item.get("range", {})
                        start = rng.get("start", {})
                        end = rng.get("end", {})
                        cmd = item.get("command", {})
                        formatted.append({
                            "range": {
                                "startLineNumber": start.get("line", 0) + 1,
                                "startColumn": start.get("character", 0) + 1,
                                "endLineNumber": end.get("line", 0) + 1,
                                "endColumn": end.get("character", 0) + 1
                            },
                            "command": {
                                "id": cmd.get("command", ""),
                                "title": cmd.get("title", ""),
                                "arguments": cmd.get("arguments", [])
                            } if cmd else None
                        })
                    return json.dumps(formatted)
            except Exception as e:
                pass
        return "[]"
