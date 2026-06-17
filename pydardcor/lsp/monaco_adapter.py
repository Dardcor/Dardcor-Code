from typing import Any, Dict
from .client import LspClient

class MonacoLspAdapter:
    """Translates Monaco Editor positions/events to LSP Protocol and vice-versa."""

    def __init__(self, lsp_client: LspClient):
        self.lsp = lsp_client
        self._document_versions: Dict[str, int] = {}

    def did_open(self, uri: str, language_id: str, text: str):
        self._document_versions[uri] = 1
        self.lsp.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": 1,
                "text": text
            }
        })

    def did_change(self, uri: str, text: str):
        if uri not in self._document_versions:
            self._document_versions[uri] = 1
        else:
            self._document_versions[uri] += 1
            
        self.lsp.send_notification("textDocument/didChange", {
            "textDocument": {
                "uri": uri,
                "version": self._document_versions[uri]
            },
            "contentChanges": [
                {"text": text}
            ]
        })

    def did_close(self, uri: str):
        self.lsp.send_notification("textDocument/didClose", {
            "textDocument": {
                "uri": uri
            }
        })
        if uri in self._document_versions:
            del self._document_versions[uri]

    def get_completions(self, uri: str, line: int, character: int) -> dict:
        """Fetch completions for a given position (Monaco is 1-indexed, LSP is 0-indexed)."""
        try:
            response = self.lsp.send_request("textDocument/completion", {
                "textDocument": {"uri": uri},
                "position": {
                    "line": line - 1,
                    "character": character - 1
                }
            })
            return response
        except Exception:
            return {}

    def get_hover(self, uri: str, line: int, character: int) -> dict:
        """Fetch hover information."""
        try:
            response = self.lsp.send_request("textDocument/hover", {
                "textDocument": {"uri": uri},
                "position": {
                    "line": line - 1,
                    "character": character - 1
                }
            })
            return response
        except Exception:
            return {}

    def get_definition(self, uri: str, line: int, character: int) -> list:
        """Fetch definition."""
        try:
            response = self.lsp.send_request("textDocument/definition", {
                "textDocument": {"uri": uri},
                "position": {
                    "line": line - 1,
                    "character": character - 1
                }
            })
            
            if isinstance(response, dict):
                return [response]
            return response or []
        except Exception:
            return []
