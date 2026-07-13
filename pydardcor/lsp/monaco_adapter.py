from typing import Any, Dict, List, Optional, Union
from .client import LspClient


class MonacoLspAdapter:
    """Translates Monaco Editor positions/events to LSP Protocol and vice-versa.
    Monaco is 1-indexed (line, column), LSP is 0-indexed (line, character).
    """

    def __init__(self, lsp_client: LspClient):
        self.lsp = lsp_client
        self._document_versions: Dict[str, int] = {}

    # ── Coordinate Conversion ──────────────────────────────────────────────

    def _to_lsp_position(self, line: int, character: int) -> Dict:
        return {"line": line - 1, "character": character - 1}

    def _from_lsp_position(self, pos: Dict) -> Dict:
        return {"line": pos.get("line", 0) + 1, "character": pos.get("character", 0) + 1}

    def _to_lsp_range(self, start_line: int, start_col: int,
                      end_line: int, end_col: int) -> Dict:
        return {
            "start": self._to_lsp_position(start_line, start_col),
            "end": self._to_lsp_position(end_line, end_col),
        }

    def _from_lsp_range(self, rng: Dict) -> Dict:
        return {
            "start": self._from_lsp_position(rng.get("start", {})),
            "end": self._from_lsp_position(rng.get("end", {})),
        }

    # ── Text Document Sync ─────────────────────────────────────────────────

    def did_open(self, uri: str, language_id: str, text: str):
        self._document_versions[uri] = 1
        self.lsp.did_open(uri, language_id, text, 1)

    def did_change(self, uri: str, text: str):
        if uri not in self._document_versions:
            self._document_versions[uri] = 1
        else:
            self._document_versions[uri] += 1
        version = self._document_versions[uri]
        self.lsp.did_change_full(uri, version, text)

    def did_change_incremental(self, uri: str, start_line: int, start_col: int,
                               end_line: int, end_col: int, text: str):
        if uri not in self._document_versions:
            self._document_versions[uri] = 1
        else:
            self._document_versions[uri] += 1
        version = self._document_versions[uri]
        self.lsp.did_change_incremental(
            uri, version,
            self._to_lsp_range(start_line, start_col, end_line, end_col),
            text
        )

    def will_save(self, uri: str, reason: int = 0):
        self.lsp.will_save(uri, reason)

    def did_save(self, uri: str, text: Optional[str] = None):
        self.lsp.did_save(uri, text)

    def did_close(self, uri: str):
        self.lsp.did_close(uri)
        self._document_versions.pop(uri, None)

    # ── Completion ─────────────────────────────────────────────────────────

    def get_completions(self, uri: str, line: int, character: int,
                        context: Optional[Dict] = None) -> Dict:
        result = self.lsp.get_completion(uri, line - 1, character - 1, context)
        return result or {}

    # ── Hover ──────────────────────────────────────────────────────────────

    def to_monaco_hover(self, lsp_hover: Optional[Dict]) -> Optional[Dict]:
        if not lsp_hover:
            return None
        contents = lsp_hover.get("contents", {})
        if isinstance(contents, str):
            contents = {"kind": "markdown", "value": contents}
        elif isinstance(contents, list):
            contents = {
                "kind": "markdown",
                "value": "\n---\n".join(
                    c["value"] if isinstance(c, dict) else str(c)
                    for c in contents
                )
            }
        range_data = lsp_hover.get("range")
        result = {"contents": contents}
        if range_data:
            result["range"] = self._from_lsp_range(range_data)
        return result

    def get_hover(self, uri: str, line: int, character: int) -> Optional[Dict]:
        lsp_result = self.lsp.get_hover(uri, line - 1, character - 1)
        return self.to_monaco_hover(lsp_result)

    # ── Signature Help ─────────────────────────────────────────────────────

    def to_monaco_signature_help(self, lsp_result: Optional[Dict]) -> Optional[Dict]:
        if not lsp_result:
            return None
        result = {}
        signatures = lsp_result.get("signatures", [])
        result["signatures"] = signatures
        result["activeSignature"] = lsp_result.get("activeSignature", 0)
        result["activeParameter"] = lsp_result.get("activeParameter", 0)
        return result

    def get_signature_help(self, uri: str, line: int, character: int) -> Optional[Dict]:
        lsp_result = self.lsp.get_signature_help(uri, line - 1, character - 1)
        return self.to_monaco_signature_help(lsp_result)

    # ── Definition / Go-To ─────────────────────────────────────────────────

    def to_monaco_definition(self, lsp_result: Any) -> Union[List, Dict, None]:
        if not lsp_result:
            return None
        if isinstance(lsp_result, list):
            return [self._from_lsp_position(
                loc.get("range", {}).get("start", loc) if isinstance(loc, dict) else loc
            ) if isinstance(loc, dict) and "uri" in loc else loc for loc in lsp_result]
        if isinstance(lsp_result, dict) and "uri" in lsp_result:
            return {
                "uri": lsp_result["uri"],
                "range": self._from_lsp_range(lsp_result.get("range", {})),
            }
        if isinstance(lsp_result, dict) and "line" in lsp_result:
            return [self._from_lsp_position(lsp_result)]
        return lsp_result

    def get_definition(self, uri: str, line: int, character: int) -> Any:
        return self.lsp.goto_definition(uri, line - 1, character - 1)

    def get_declaration(self, uri: str, line: int, character: int) -> Any:
        return self.lsp.goto_declaration(uri, line - 1, character - 1)

    def get_type_definition(self, uri: str, line: int, character: int) -> Any:
        return self.lsp.goto_type_definition(uri, line - 1, character - 1)

    def get_implementation(self, uri: str, line: int, character: int) -> Any:
        return self.lsp.goto_implementation(uri, line - 1, character - 1)

    # ── References ─────────────────────────────────────────────────────────

    def to_monaco_references(self, lsp_result: List) -> List:
        return [{
            "uri": ref.get("uri", ""),
            "range": self._from_lsp_range(ref.get("range", {})),
        } for ref in lsp_result if isinstance(ref, dict)]

    def get_references(self, uri: str, line: int, character: int,
                       include_declaration: bool = True) -> List:
        lsp_result = self.lsp.find_references(uri, line - 1, character - 1, include_declaration)
        return self.to_monaco_references(lsp_result)

    # ── Document Highlight ─────────────────────────────────────────────────

    def to_monaco_highlights(self, lsp_result: List) -> List:
        kind_map = {1: "text", 2: "read", 3: "write"}
        return [{
            "range": self._from_lsp_range(h.get("range", {})),
            "kind": kind_map.get(h.get("kind", 1), "text"),
        } for h in lsp_result if isinstance(h, dict)]

    def get_document_highlight(self, uri: str, line: int, character: int) -> List:
        lsp_result = self.lsp.get_document_highlight(uri, line - 1, character - 1)
        return self.to_monaco_highlights(lsp_result)

    # ── Document Symbols ───────────────────────────────────────────────────

    def to_monaco_symbols(self, lsp_result: List, container_name: str = "") -> List:
        """Convert LSP document symbols to Monaco outline format."""
        symbols = []
        for sym in lsp_result:
            if isinstance(sym, dict):
                info = {
                    "name": sym.get("name", ""),
                    "kind": sym.get("kind", 0),
                    "detail": sym.get("detail", ""),
                    "tags": sym.get("tags", []),
                    "containerName": container_name,
                    "range": self._from_lsp_range(sym.get("range", {})),
                    "selectionRange": self._from_lsp_range(sym.get("selectionRange", {})),
                }
                symbols.append(info)
                children = sym.get("children", [])
                if children:
                    symbols.extend(
                        self.to_monaco_symbols(children, info["name"])
                    )
        return symbols

    def get_document_symbols(self, uri: str) -> List:
        lsp_result = self.lsp.get_document_symbols(uri)
        return self.to_monaco_symbols(lsp_result)

    # ── Workspace Symbols ──────────────────────────────────────────────────

    def get_workspace_symbols(self, query: str) -> List:
        return self.lsp.get_workspace_symbols(query) or []

    # ── Code Actions ───────────────────────────────────────────────────────

    def get_code_actions(self, uri: str, start_line: int, start_col: int,
                         end_line: int, end_col: int,
                         diagnostics: Optional[List[Dict]] = None) -> List:
        context = {"diagnostics": diagnostics or []}
        rng = self._to_lsp_range(start_line, start_col, end_line, end_col)
        return self.lsp.get_code_actions(uri, rng, context) or []

    # ── Code Lens ──────────────────────────────────────────────────────────

    def to_monaco_code_lens(self, lsp_result: List) -> List:
        return [{
            "range": self._from_lsp_range(lens.get("range", {})),
            "id": lens.get("data", str(i)),
            "command": lens.get("command", {}),
        } for i, lens in enumerate(lsp_result) if isinstance(lens, dict)]

    def get_code_lens(self, uri: str) -> List:
        lsp_result = self.lsp.get_code_lens(uri)
        return self.to_monaco_code_lens(lsp_result)

    # ── Formatting ─────────────────────────────────────────────────────────

    def to_monaco_edits(self, lsp_result: List) -> List:
        return [{
            "range": self._from_lsp_range(edit.get("range", {})),
            "text": edit.get("text", ""),
        } for edit in lsp_result if isinstance(edit, dict)]

    def get_formatting(self, uri: str, tab_size: int = 4,
                       insert_spaces: bool = True) -> List:
        options = {"tabSize": tab_size, "insertSpaces": insert_spaces}
        lsp_result = self.lsp.get_formatting(uri, options)
        return self.to_monaco_edits(lsp_result)

    def get_range_formatting(self, uri: str, start_line: int, start_col: int,
                             end_line: int, end_col: int,
                             tab_size: int = 4, insert_spaces: bool = True) -> List:
        rng = self._to_lsp_range(start_line, start_col, end_line, end_col)
        options = {"tabSize": tab_size, "insertSpaces": insert_spaces}
        lsp_result = self.lsp.get_range_formatting(uri, rng, options)
        return self.to_monaco_edits(lsp_result)

    # ── Rename ─────────────────────────────────────────────────────────────

    def prepare_rename(self, uri: str, line: int, character: int) -> Any:
        return self.lsp.prepare_rename(uri, line - 1, character - 1)

    def rename(self, uri: str, line: int, character: int, new_name: str) -> Optional[Dict]:
        return self.lsp.rename(uri, line - 1, character - 1, new_name)

    # ── Folding Range ──────────────────────────────────────────────────────

    def to_monaco_folding_ranges(self, lsp_result: List) -> List:
        kind_map = {1: "comment", 2: "imports", 3: "region"}
        return [{
            "start": fr.get("startLine", 0) + 1,
            "end": fr.get("endLine", 0) + 1,
            "kind": kind_map.get(fr.get("kind"), None),
        } for fr in lsp_result if isinstance(fr, dict)]

    def get_folding_ranges(self, uri: str) -> List:
        lsp_result = self.lsp.get_folding_range(uri)
        return self.to_monaco_folding_ranges(lsp_result)

    # ── Selection Range ────────────────────────────────────────────────────

    def to_monaco_selection_ranges(self, positions: List, lsp_result: List) -> List:
        if not lsp_result:
            return []
        ranges = []
        for item in lsp_result:
            if isinstance(item, dict):
                rng = item.get("range", {})
                parent = item.get("parent")
                ranges.append({
                    "range": self._from_lsp_range(rng),
                    "parent": self._from_lsp_range(parent.get("range", {})) if isinstance(parent, dict) else None,
                })
        return ranges

    def get_selection_ranges(self, uri: str, positions: List[Dict]) -> List:
        lsp_positions = [
            self._to_lsp_position(p["line"], p["character"])
            for p in positions
        ]
        return self.lsp.get_selection_range(uri, lsp_positions)

    # ── Document Link ──────────────────────────────────────────────────────

    def to_monaco_links(self, lsp_result: List) -> List:
        return [{
            "range": self._from_lsp_range(link.get("range", {})),
            "url": link.get("target", link.get("url", "")),
            "tooltip": link.get("tooltip", ""),
        } for link in lsp_result if isinstance(link, dict)]

    def get_document_links(self, uri: str) -> List:
        lsp_result = self.lsp.get_document_links(uri)
        return self.to_monaco_links(lsp_result)

    # ── Document Color ─────────────────────────────────────────────────────

    def to_monaco_color_info(self, lsp_result: List) -> List:
        return [{
            "range": self._from_lsp_range(ci.get("range", {})),
            "color": self._to_monaco_color(ci.get("color", {})),
        } for ci in lsp_result if isinstance(ci, dict)]

    def _to_monaco_color(self, color: Dict) -> Dict:
        return {
            "red": color.get("red", 0),
            "green": color.get("green", 0),
            "blue": color.get("blue", 0),
            "alpha": color.get("alpha", 1),
        }

    def get_document_colors(self, uri: str) -> List:
        lsp_result = self.lsp.get_document_color(uri)
        return self.to_monaco_color_info(lsp_result)

    def get_color_presentations(self, uri: str, color: Dict,
                                start_line: int, start_col: int,
                                end_line: int, end_col: int) -> List:
        rng = self._to_lsp_range(start_line, start_col, end_line, end_col)
        monaco_color = self._to_monaco_color(color)
        return self.lsp.get_color_presentation(uri, monaco_color, rng) or []

    # ── Semantic Tokens ────────────────────────────────────────────────────

    def to_monaco_semantic_tokens(self, lsp_result: Optional[Dict]) -> Optional[Dict]:
        if not lsp_result:
            return None
        return {
            "data": lsp_result.get("data", []),
            "resultId": lsp_result.get("resultId"),
        }

    def get_semantic_tokens(self, uri: str) -> Optional[Dict]:
        lsp_result = self.lsp.get_semantic_tokens_full(uri)
        return self.to_monaco_semantic_tokens(lsp_result)

    def get_semantic_tokens_delta(self, uri: str, previous_result_id: str) -> Optional[Dict]:
        return self.lsp.get_semantic_tokens_delta(uri, previous_result_id)

    def get_semantic_tokens_range(self, uri: str, start_line: int, start_col: int,
                                  end_line: int, end_col: int) -> Optional[Dict]:
        rng = self._to_lsp_range(start_line, start_col, end_line, end_col)
        return self.lsp.get_semantic_tokens_range(uri, rng)

    # ── Inlay Hints ────────────────────────────────────────────────────────

    def to_monaco_inlay_hints(self, lsp_result: List) -> List:
        result = []
        for hint in lsp_result:
            if isinstance(hint, dict):
                # LSP position is at the *end* of the hint;
                # convert label parts
                labels = hint.get("label", [])
                if isinstance(labels, str):
                    labels = [labels]
                elif isinstance(labels, dict):
                    labels = [labels]
                result.append({
                    "position": self._from_lsp_position(hint.get("position", {})),
                    "label": labels,
                    "kind": hint.get("kind", 1),
                    "paddingLeft": hint.get("paddingLeft", False),
                    "paddingRight": hint.get("paddingRight", False),
                    "tooltip": hint.get("tooltip", ""),
                })
        return result

    def get_inlay_hints(self, uri: str, start_line: int, start_col: int,
                        end_line: int, end_col: int) -> List:
        rng = self._to_lsp_range(start_line, start_col, end_line, end_col)
        lsp_result = self.lsp.get_inlay_hints(uri, rng)
        return self.to_monaco_inlay_hints(lsp_result)

    # ── Call Hierarchy ─────────────────────────────────────────────────────

    def prepare_call_hierarchy(self, uri: str, line: int, character: int) -> Any:
        return self.lsp.prepare_call_hierarchy(uri, line - 1, character - 1)

    def get_call_hierarchy_incoming(self, item: Dict) -> List:
        return self.lsp.get_call_hierarchy_incoming("", item) or []

    def get_call_hierarchy_outgoing(self, item: Dict) -> List:
        return self.lsp.get_call_hierarchy_outgoing("", item) or []

    # ── Type Hierarchy ─────────────────────────────────────────────────────

    def prepare_type_hierarchy(self, uri: str, line: int, character: int) -> Any:
        return self.lsp.prepare_type_hierarchy(uri, line - 1, character - 1)

    def get_type_hierarchy_supertypes(self, item: Dict) -> List:
        return self.lsp.get_type_hierarchy_supertypes(item) or []

    def get_type_hierarchy_subtypes(self, item: Dict) -> List:
        return self.lsp.get_type_hierarchy_subtypes(item) or []

    # ── Linked Editing Range ───────────────────────────────────────────────

    def get_linked_editing_range(self, uri: str, line: int, character: int) -> Optional[Dict]:
        lsp_result = self.lsp.get_linked_editing_range(uri, line - 1, character - 1)
        if isinstance(lsp_result, dict):
            return {
                "ranges": [self._from_lsp_range(r) for r in lsp_result.get("ranges", [])],
                "wordPattern": lsp_result.get("wordPattern"),
            }
        return None

    # ── Diagnostics ────────────────────────────────────────────────────────

    def get_diagnostic(self, uri: str, previous_result_id: Optional[str] = None) -> Optional[Dict]:
        return self.lsp.get_diagnostic(uri, previous_result_id)

    # ── Workspace ──────────────────────────────────────────────────────────

    def did_change_configuration(self, settings: Dict):
        self.lsp.did_change_configuration(settings)

    def did_change_workspace_folders(self, added: List[Dict], removed: List[Dict]):
        self.lsp.did_change_workspace_folders(added, removed)

    def execute_command(self, command: str, args: Optional[List] = None) -> Any:
        return self.lsp.execute_command(command, args)

    def apply_workspace_edit(self, edit: Dict) -> Optional[Dict]:
        return self.lsp.apply_edit(edit)
