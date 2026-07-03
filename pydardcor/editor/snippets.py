import os
import json
import logging
from typing import Dict, List, Optional

from ..core.config import get_snippets_dir

logger = logging.getLogger(__name__)

class SnippetManager:
    """Manages TextMate style snippets (.code-snippets)."""

    def __init__(self, workspace_path: str = None):
        self.workspace_path = workspace_path
        self.snippets: Dict[str, dict] = {} # prefix -> snippet definition
        
        self.load_global_snippets()
        if self.workspace_path:
            self.load_workspace_snippets()

    def load_global_snippets(self):
        config_dir = get_snippets_dir()
        if not os.path.exists(config_dir):
            return
            
        for file in os.listdir(config_dir):
            if file.endswith(".json") or file.endswith(".code-snippets"):
                self._load_file(os.path.join(config_dir, file))

    def load_workspace_snippets(self):
        ws_snippets_dir = os.path.join(self.workspace_path, ".vscode")
        if not os.path.exists(ws_snippets_dir):
            return
            
        for file in os.listdir(ws_snippets_dir):
            if file.endswith(".code-snippets"):
                self._load_file(os.path.join(ws_snippets_dir, file))

    def _load_file(self, path: str):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = [line for line in content.split('\n') if not line.strip().startswith('//')]
                data = json.loads('\n'.join(lines))
                
                for name, snippet in data.items():
                    prefix = snippet.get("prefix")
                    if prefix:
                        if isinstance(prefix, list):
                            for p in prefix:
                                self.snippets[p] = snippet
                        else:
                            self.snippets[prefix] = snippet
                            
            logger.info(f"Loaded snippets from {path}")
        except Exception as e:
            logger.error(f"Failed to load snippets from {path}: {e}")

    def get_snippet(self, prefix: str) -> Optional[dict]:
        return self.snippets.get(prefix)

    def expand_snippet(self, body: List[str]) -> str:
        """
        Naive expansion of snippet body.
        In reality, Monaco handles the expansion using the CompletionItem `insertText` 
        with `insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet`.
        We mostly just need to provide the raw body joined by newlines to Monaco.
        """
        if isinstance(body, list):
            return "\n".join(body)
        return str(body)

    def get_completions(self, prefix: str) -> List[dict]:
        """Convert matching snippets to Monaco CompletionItem format."""
        results = []
        for p, snippet in self.snippets.items():
            if p.startswith(prefix):
                results.append({
                    "label": p,
                    "kind": 27, # Snippet
                    "detail": snippet.get("description", ""),
                    "insertText": self.expand_snippet(snippet.get("body", "")),
                    "insertTextRules": 4 # InsertAsSnippet
                })
        return results
